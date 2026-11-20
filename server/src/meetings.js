import { db, now } from './db.js';
import { tg } from './bot.js';
import { hooks } from './bot.js';

// Встречи с друзьями: точная дата или опрос дат, ответы «иду / может быть / не иду»,
// уведомления в Telegram с кнопками, календарь месяца для вкладки «Личное».

const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 3);
const q = (sql) => db.prepare(sql);
const dateStr = (off = 0) => new Date(Date.now() + TZ * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const human = (date, time) => {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${time ? `, ${time}` : ''}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const first = (u) => String(u.name || '').split(' ')[0];
const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const bad = (code, status = 400) => Object.assign(new Error(code), { statusCode: status });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const isTime = (t) => !t || /^\d{2}:\d{2}$/.test(t);
const RSVP = { yes: '✅ Иду', maybe: '🤔 Может быть', no: '🚫 Не иду' };
const startTs = (m) => {
  const [y, mo, d] = m.date.split('-').map(Number);
  const [h, mi] = (m.time || '12:00').split(':').map(Number);
  return Math.floor((Date.UTC(y, mo - 1, d, h, mi) - TZ * 3600e3) / 1000);
};

db.exec(`
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  date TEXT,
  time TEXT,
  place TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'set',
  rem_day INTEGER NOT NULL DEFAULT 0,
  rem_2h INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_members (
  meeting_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  rsvp TEXT,
  PRIMARY KEY (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mm_user ON meeting_members(user_id);
CREATE TABLE IF NOT EXISTS meeting_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT
);
CREATE TABLE IF NOT EXISTS meeting_votes (
  option_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  vote TEXT NOT NULL,
  PRIMARY KEY (option_id, user_id)
);
`);
if (!q("SELECT 1 FROM pragma_table_info('users') WHERE name = 'status'").get()) {
  db.exec('ALTER TABLE users ADD COLUMN status TEXT');
}

export function registerMeetings(api, { botToken, webAppUrl }) {
  const canInvite = (me, id) =>
    !!q('SELECT 1 FROM friendships WHERE a = ? AND b = ?').get(me.id, id) ||
    !!(me.couple_id && q('SELECT 1 FROM users WHERE id = ? AND couple_id = ?').get(id, me.couple_id));

  const member = (mid, uid) => q('SELECT * FROM meeting_members WHERE meeting_id = ? AND user_id = ?').get(mid, uid);
  const getMeeting = (id, me) => {
    const m = q('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!m || !member(m.id, me.id)) throw bad('not_found', 404);
    return m;
  };

  function view(m, me) {
    const members = q(
      'SELECT u.id, u.name, u.photo_url, mm.rsvp FROM meeting_members mm JOIN users u ON u.id = mm.user_id WHERE mm.meeting_id = ? ORDER BY u.name',
    ).all(m.id).map((u) => ({ id: u.id, name: u.name, first_name: first(u), photo_url: u.photo_url, rsvp: u.rsvp }));
    const options = q('SELECT * FROM meeting_options WHERE meeting_id = ? ORDER BY date, COALESCE(time, \'\')').all(m.id).map((o) => {
      const votes = q('SELECT user_id, vote FROM meeting_votes WHERE option_id = ?').all(o.id);
      const score = votes.reduce((s, v) => s + (v.vote === 'yes' ? 2 : v.vote === 'maybe' ? 1 : 0), 0);
      return {
        id: o.id, date: o.date, time: o.time, votes: Object.fromEntries(votes.map((v) => [v.user_id, v.vote])), score,
        yes: votes.filter((v) => v.vote === 'yes').length, maybe: votes.filter((v) => v.vote === 'maybe').length, no: votes.filter((v) => v.vote === 'no').length,
      };
    });
    const count = (r) => members.filter((u) => u.rsvp === r).length;
    return {
      id: m.id, title: m.title, date: m.date, time: m.time, place: m.place, note: m.note, status: m.status,
      owner_id: m.owner_id, mine: m.owner_id === me.id, my_rsvp: members.find((u) => u.id === me.id)?.rsvp ?? null,
      members, options, counts: { yes: count('yes'), maybe: count('maybe'), no: count('no') },
    };
  }

  const counts = (mid) => {
    const r = q('SELECT rsvp, COUNT(*) AS n FROM meeting_members WHERE meeting_id = ? GROUP BY rsvp').all(mid);
    const g = (k) => r.find((x) => x.rsvp === k)?.n || 0;
    return { yes: g('yes'), maybe: g('maybe'), no: g('no') };
  };

  const openBtn = [{ text: 'Открыть в приложении', web_app: { url: webAppUrl } }];
  const mapLink = (place) => `https://yandex.by/maps/?text=${encodeURIComponent(place)}`;

  function meetingText(m, ownerName, mine) {
    const c = counts(m.id);
    const lines = [`📅 <b>${esc(m.title)}</b>`];
    lines.push(m.date ? `🗓 ${esc(human(m.date, m.time))}` : '🗳 Дата пока не выбрана');
    if (m.place) lines.push(`📍 <a href="${mapLink(m.place)}">${esc(m.place)}</a>`);
    if (m.note) lines.push(`📝 ${esc(m.note)}`);
    lines.push(`\n👤 ${esc(ownerName)}`);
    lines.push(`Идут: <b>${c.yes}</b> · Может быть: <b>${c.maybe}</b> · Не идут: <b>${c.no}</b>`);
    if (mine) lines.push(`\nВаш ответ: <b>${esc(RSVP[mine])}</b>`);
    return lines.join('\n');
  }
  const rsvpKeyboard = (m) => ({
    inline_keyboard: [
      [{ text: 'Иду', callback_data: `mr:${m.id}:yes` }, { text: 'Может быть', callback_data: `mr:${m.id}:maybe` }, { text: 'Не иду', callback_data: `mr:${m.id}:no` }],
      openBtn,
    ],
  });
  const VOTE_ICON = { yes: '✅', maybe: '🤔', no: '🚫' };
  const pollText = (m, ownerName) => `🗳 <b>${esc(m.title)}</b>\nКогда удобно? Нажимайте на дату: ✅ подходит, 🤔 могу, 🚫 нет.\n\n👤 ${esc(ownerName)}${m.place ? `\n📍 ${esc(m.place)}` : ''}`;
  function pollKeyboard(m, uid) {
    const rows = q('SELECT * FROM meeting_options WHERE meeting_id = ? ORDER BY date, COALESCE(time, \'\')').all(m.id).map((o) => {
      const v = q('SELECT vote FROM meeting_votes WHERE option_id = ? AND user_id = ?').get(o.id, uid)?.vote;
      return [{ text: `${v ? VOTE_ICON[v] : '▫️'} ${human(o.date, o.time)}`, callback_data: `mv:${o.id}:next` }];
    });
    return { inline_keyboard: [...rows, openBtn] };
  }

  async function sendInvite(m, owner, uid) {
    const body = m.status === 'poll'
      ? { text: pollText(m, owner.name), reply_markup: pollKeyboard(m, uid) }
      : { text: meetingText(m, owner.name, null), reply_markup: rsvpKeyboard(m) };
    await tg(botToken, 'sendMessage', { chat_id: uid, parse_mode: 'HTML', disable_web_page_preview: true, ...body });
  }
  const others = (m, meId) => q('SELECT user_id FROM meeting_members WHERE meeting_id = ? AND user_id != ?').all(m.id, meId).map((r) => r.user_id);
  const say = (uid, text) => tg(botToken, 'sendMessage', { chat_id: uid, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [openBtn] } });

  // ---- API ----
  api.get('/api/meetings', async (req) => {
    const me = req.tgUser;
    const ids = q('SELECT meeting_id FROM meeting_members WHERE user_id = ?').all(me.id).map((r) => r.meeting_id);
    if (!ids.length) return [];
    const today = dateStr(-1);
    return ids
      .map((id) => q('SELECT * FROM meetings WHERE id = ?').get(id))
      .filter((m) => m && (m.status === 'poll' || (m.status === 'set' && m.date >= today)))
      .sort((a, b) => `${a.date || '9999'} ${a.time || ''}`.localeCompare(`${b.date || '9999'} ${b.time || ''}`))
      .map((m) => view(m, me));
  });

  api.get('/api/meetings/:id', async (req) => view(getMeeting(req.params.id, req.tgUser), req.tgUser));

  api.post('/api/meetings', async (req) => {
    const me = req.tgUser;
    const b = req.body || {};
    const title = clean(b.title, 120);
    if (!title) throw bad('need_title');
    const options = (Array.isArray(b.options) ? b.options : []).slice(0, 5)
      .map((o) => ({ date: clean(o?.date, 10), time: clean(o?.time, 5) || null }))
      .filter((o) => isDate(o.date) && isTime(o.time));
    const poll = options.length >= 2;
    const date = clean(b.date, 10), time = clean(b.time, 5) || null;
    if (!poll && (!isDate(date) || !isTime(time))) throw bad('bad_date');
    const invitees = [...new Set((Array.isArray(b.invitees) ? b.invitees : []).map(Number))].filter((id) => id && id !== me.id && canInvite(me, id)).slice(0, 30);
    const r = q('INSERT INTO meetings (owner_id, title, date, time, place, note, status, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(me.id, title, poll ? null : date, poll ? null : time, clean(b.place, 160) || null, clean(b.note, 400) || null, poll ? 'poll' : 'set', now());
    const id = Number(r.lastInsertRowid);
    q('INSERT INTO meeting_members (meeting_id, user_id, rsvp) VALUES (?,?,?)').run(id, me.id, poll ? null : 'yes');
    for (const uid of invitees) q('INSERT INTO meeting_members (meeting_id, user_id, rsvp) VALUES (?,?,NULL)').run(id, uid);
    if (poll) for (const o of options) q('INSERT INTO meeting_options (meeting_id, date, time) VALUES (?,?,?)').run(id, o.date, o.time);
    const m = q('SELECT * FROM meetings WHERE id = ?').get(id);
    for (const uid of invitees) sendInvite(m, me, uid);
    return view(m, me);
  });

  api.post('/api/meetings/:id/rsvp', async (req) => {
    const me = req.tgUser;
    const m = getMeeting(req.params.id, me);
    const rsvp = ['yes', 'maybe', 'no'].includes(req.body?.rsvp) ? req.body.rsvp : null;
    if (!rsvp) throw bad('bad_rsvp');
    q('UPDATE meeting_members SET rsvp = ? WHERE meeting_id = ? AND user_id = ?').run(rsvp, m.id, me.id);
    return view(m, me);
  });

  api.post('/api/meetings/:id/vote', async (req) => {
    const me = req.tgUser;
    const m = getMeeting(req.params.id, me);
    const o = q('SELECT * FROM meeting_options WHERE id = ? AND meeting_id = ?').get(Number(req.body?.option_id), m.id);
    if (!o || m.status !== 'poll') throw bad('bad_option');
    const vote = ['yes', 'maybe', 'no'].includes(req.body?.vote) ? req.body.vote : null;
    if (vote) q('INSERT INTO meeting_votes (option_id, user_id, vote) VALUES (?,?,?) ON CONFLICT(option_id, user_id) DO UPDATE SET vote = excluded.vote').run(o.id, me.id, vote);
    else q('DELETE FROM meeting_votes WHERE option_id = ? AND user_id = ?').run(o.id, me.id);
    return view(m, me);
  });

  api.post('/api/meetings/:id/finalize', async (req) => {
    const me = req.tgUser;
    const m = getMeeting(req.params.id, me);
    if (m.owner_id !== me.id) throw bad('forbidden', 403);
    const o = q('SELECT * FROM meeting_options WHERE id = ? AND meeting_id = ?').get(Number(req.body?.option_id), m.id);
    if (!o) throw bad('bad_option');
    q("UPDATE meetings SET status = 'set', date = ?, time = ?, rem_day = 0, rem_2h = 0 WHERE id = ?").run(o.date, o.time, m.id);
    q("UPDATE meeting_members SET rsvp = CASE WHEN user_id = ? THEN 'yes' ELSE NULL END WHERE meeting_id = ?").run(me.id, m.id);
    const nm = q('SELECT * FROM meetings WHERE id = ?').get(m.id);
    for (const uid of others(nm, me.id)) sendInvite(nm, me, uid);
    return view(nm, me);
  });

  api.patch('/api/meetings/:id', async (req) => {
    const me = req.tgUser;
    const m = getMeeting(req.params.id, me);
    if (m.owner_id !== me.id) throw bad('forbidden', 403);
    const b = req.body || {};
    const f = {};
    if (b.title !== undefined) f.title = clean(b.title, 120) || m.title;
    if (b.place !== undefined) f.place = clean(b.place, 160) || null;
    if (b.note !== undefined) f.note = clean(b.note, 400) || null;
    if (b.date !== undefined && m.status === 'set') { if (!isDate(b.date)) throw bad('bad_date'); f.date = b.date; }
    if (b.time !== undefined && m.status === 'set') { const t = clean(b.time, 5) || null; if (!isTime(t)) throw bad('bad_date'); f.time = t; }
    const cols = Object.keys(f);
    if (cols.length) {
      if ('date' in f || 'time' in f) { f.rem_day = 0; f.rem_2h = 0; }
      const keys = Object.keys(f);
      q(`UPDATE meetings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), m.id);
      const lines = [`✏️ <b>${esc(f.title ?? m.title)}</b>: встреча изменилась`];
      if (('date' in f && f.date !== m.date) || ('time' in f && f.time !== m.time)) lines.push(`🗓 было ${esc(human(m.date, m.time))} → стало ${esc(human(f.date ?? m.date, 'time' in f ? f.time : m.time))}`);
      if ('place' in f && f.place !== m.place) lines.push(`📍 было ${esc(m.place || 'не указано')} → стало ${f.place ? `<a href="${mapLink(f.place)}">${esc(f.place)}</a>` : 'не указано'}`);
      if (lines.length > 1) for (const uid of others(m, me.id)) say(uid, lines.join('\n'));
    }
    return view(q('SELECT * FROM meetings WHERE id = ?').get(m.id), me);
  });

  api.delete('/api/meetings/:id', async (req) => {
    const me = req.tgUser;
    const m = getMeeting(req.params.id, me);
    if (m.owner_id === me.id) {
      for (const uid of others(m, me.id)) say(uid, `❌ Встреча «${esc(m.title)}»${m.date ? `, ${esc(human(m.date, m.time))},` : ''} отменена`);
      q('DELETE FROM meeting_votes WHERE option_id IN (SELECT id FROM meeting_options WHERE meeting_id = ?)').run(m.id);
      q('DELETE FROM meeting_options WHERE meeting_id = ?').run(m.id);
      q('DELETE FROM meeting_members WHERE meeting_id = ?').run(m.id);
      q('DELETE FROM meetings WHERE id = ?').run(m.id);
    } else {
      q('DELETE FROM meeting_members WHERE meeting_id = ? AND user_id = ?').run(m.id, me.id);
    }
    return { ok: true };
  });

  api.patch('/api/me/status', async (req) => {
    const s = clean(req.body?.status, 60) || null;
    q('UPDATE users SET status = ? WHERE id = ?').run(s, req.tgUser.id);
    return { ok: true, status: s };
  });

  // Друзья с их статусом (для главной «Друзья»)
  api.get('/api/friends/status', async (req) => {
    const me = req.tgUser;
    const rows = q('SELECT u.id, u.name, u.photo_url, u.status, u.last_seen FROM friendships f JOIN users u ON u.id = f.b WHERE f.a = ?').all(me.id);
    return {
      me: { status: q('SELECT status FROM users WHERE id = ?').get(me.id)?.status ?? null },
      friends: rows.map((u) => ({ id: u.id, name: u.name, first_name: first(u), photo_url: u.photo_url, status: u.status, online: !!u.last_seen && now() - u.last_seen < 120 })),
    };
  });

  // Календарь месяца: личные записи, дела со сроком, события пары, мои встречи
  api.get('/api/calendar', async (req) => {
    const me = req.tgUser;
    const month = /^\d{4}-\d{2}$/.test(req.query?.month || '') ? req.query.month : dateStr().slice(0, 7);
    const from = `${month}-01`, to = `${month}-31`;
    const items = [];
    for (const c of q('SELECT * FROM cal WHERE owner_id = ? AND date BETWEEN ? AND ?').all(me.id, from, to))
      items.push({ src: 'cal', id: c.id, title: c.title, date: c.date, time: c.time, done: false });
    if (me.couple_id) {
      for (const c of q('SELECT * FROM chores WHERE couple_id = ? AND due_date BETWEEN ? AND ?').all(me.couple_id, from, to))
        items.push({ src: 'chore', id: c.id, title: c.title, date: c.due_date, time: null, done: !!c.done });
      for (const e of q('SELECT * FROM events WHERE couple_id = ? AND date BETWEEN ? AND ?').all(me.couple_id, from, to))
        items.push({ src: 'event', id: e.id, title: e.title, date: e.date, time: e.time, done: false });
    }
    const ms = q("SELECT m.*, mm.rsvp FROM meetings m JOIN meeting_members mm ON mm.meeting_id = m.id AND mm.user_id = ? WHERE m.status = 'set' AND m.date BETWEEN ? AND ?").all(me.id, from, to);
    for (const m of ms) if (m.rsvp !== 'no') items.push({ src: 'meeting', id: m.id, title: m.title, date: m.date, time: m.time, done: false, rsvp: m.rsvp });
    items.sort((a, b) => `${a.date} ${a.time || '99:99'}`.localeCompare(`${b.date} ${b.time || '99:99'}`));
    return { month, today: dateStr(), items };
  });

  // ---- кнопки в сообщениях бота ----
  hooks.meetingCb = async (token, url, cb) => {
    const [action, rawId, arg] = String(cb.data || '').split(':');
    const uid = cb.from?.id;
    const chatId = cb.message?.chat?.id;
    const answer = (text) => tg(token, 'answerCallbackQuery', { callback_query_id: cb.id, text });
    const user = q('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) return answer('Сначала откройте Us App');

    if (action === 'mr') {
      const m = q('SELECT * FROM meetings WHERE id = ?').get(Number(rawId));
      if (!m || !member(m.id, uid)) return answer('Встреча недоступна');
      if (!['yes', 'maybe', 'no'].includes(arg)) return answer('');
      q('UPDATE meeting_members SET rsvp = ? WHERE meeting_id = ? AND user_id = ?').run(arg, m.id, uid);
      const owner = q('SELECT * FROM users WHERE id = ?').get(m.owner_id);
      await answer(`Записал: ${RSVP[arg]}`);
      await tg(token, 'editMessageText', {
        chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true,
        text: meetingText(m, owner.name, arg), reply_markup: rsvpKeyboard(m),
      });
      if (m.owner_id !== uid) say(m.owner_id, `${esc(first(user))}: ${esc(RSVP[arg])} — «${esc(m.title)}»`);
      return;
    }
    if (action === 'mv') {
      const o = q('SELECT * FROM meeting_options WHERE id = ?').get(Number(rawId));
      const m = o && q('SELECT * FROM meetings WHERE id = ?').get(o.meeting_id);
      if (!m || !member(m.id, uid)) return answer('Опрос недоступен');
      if (m.status !== 'poll') return answer('Дата уже выбрана');
      const cur = q('SELECT vote FROM meeting_votes WHERE option_id = ? AND user_id = ?').get(o.id, uid)?.vote;
      const next = { undefined: 'yes', yes: 'maybe', maybe: 'no', no: null }[cur];
      if (next) q('INSERT INTO meeting_votes (option_id, user_id, vote) VALUES (?,?,?) ON CONFLICT(option_id, user_id) DO UPDATE SET vote = excluded.vote').run(o.id, uid, next);
      else q('DELETE FROM meeting_votes WHERE option_id = ? AND user_id = ?').run(o.id, uid);
      await answer(next ? `${VOTE_ICON[next]} ${human(o.date, o.time)}` : 'Голос снят');
      await tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: pollKeyboard(m, uid) });
      return;
    }
    return answer('');
  };

  // ---- напоминания: за день и за 2 часа ----
  setInterval(() => {
    try {
      const t = now();
      for (const m of q("SELECT * FROM meetings WHERE status = 'set' AND date >= ? AND (rem_day = 0 OR rem_2h = 0)").all(dateStr(-1))) {
        const left = startTs(m) - t;
        const kind = left <= 2 * 3600 && left > -1800 ? 'rem_2h' : left <= 24 * 3600 && left > 2 * 3600 ? 'rem_day' : null;
        if (!kind || m[kind]) continue;
        q(`UPDATE meetings SET ${kind} = 1${kind === 'rem_2h' ? ', rem_day = 1' : ''} WHERE id = ?`).run(m.id);
        const when = kind === 'rem_2h' ? 'через пару часов' : 'завтра';
        for (const r of q("SELECT user_id FROM meeting_members WHERE meeting_id = ? AND rsvp IN ('yes','maybe')").all(m.id))
          say(r.user_id, `⏰ ${when}: <b>${esc(m.title)}</b>\n🗓 ${esc(human(m.date, m.time))}${m.place ? `\n📍 <a href="${mapLink(m.place)}">${esc(m.place)}</a>` : ''}`);
      }
    } catch (e) { console.error('meeting reminders', e.message); }
  }, 60000).unref();
}
