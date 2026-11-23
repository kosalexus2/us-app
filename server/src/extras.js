import { db, now } from './db.js';
import { tg } from './bot.js';

// Привычки, дни рождения и «давно не виделись», общие расходы друзей, оценка отношений, бэкап в чат бота.
// Хранится только текст и числа. Фото и файлы сюда не попадают (они живут в Telegram).

const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 3);
const q = (sql) => db.prepare(sql);
const dateStr = (off = 0) => new Date(Date.now() + TZ * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const bad = (code, status = 400) => Object.assign(new Error(code), { statusCode: status });
const first = (u) => String(u.name || '').split(' ')[0];
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const SCORE = { love: 5, great: 4, ok: 3, sad: 2, angry: 1 };

db.exec(`
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  icon TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_log (
  habit_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (habit_id, day)
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_by INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  share INTEGER NOT NULL,
  PRIMARY KEY (expense_id, user_id)
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exp_shares_u ON expense_shares(user_id);
`);
try { db.exec('ALTER TABLE users ADD COLUMN birthday TEXT'); } catch { /* уже есть */ }

export function registerExtras(api, { botToken, webAppUrl }) {
  const friendIds = (uid) => q('SELECT b FROM friendships WHERE a = ?').all(uid).map((r) => r.b);
  const circle = (me) => {
    const ids = new Set(friendIds(me.id));
    if (me.couple_id) for (const r of q('SELECT id FROM users WHERE couple_id = ? AND id != ?').all(me.couple_id, me.id)) ids.add(r.id);
    return ids;
  };
  const userRow = (id) => q('SELECT id, name, photo_url FROM users WHERE id = ?').get(id);
  const pub = (u) => u && { id: u.id, name: u.name, first_name: first(u), photo_url: u.photo_url };
  const say = (uid, text) => tg(botToken, 'sendMessage', {
    chat_id: uid, text, parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Открыть Us App', web_app: { url: webAppUrl } }]] },
  });

  // ---------- привычки ----------
  const streak = (hid) => {
    const days = new Set(q('SELECT day FROM habit_log WHERE habit_id = ? ORDER BY day DESC LIMIT 400').all(hid).map((r) => r.day));
    let n = 0, off = days.has(dateStr(0)) ? 0 : -1;
    while (days.has(dateStr(off))) { n++; off--; }
    return n;
  };
  api.get('/api/habits', async (req) => {
    const today = dateStr(0);
    return q('SELECT * FROM habits WHERE user_id = ? ORDER BY id').all(req.tgUser.id).map((h) => ({
      id: h.id, title: h.title, icon: h.icon, streak: streak(h.id),
      done: !!q('SELECT 1 FROM habit_log WHERE habit_id = ? AND day = ?').get(h.id, today),
    }));
  });
  api.post('/api/habits', async (req) => {
    const title = clean(req.body?.title, 40);
    if (!title) throw bad('title');
    const n = q('SELECT COUNT(*) AS n FROM habits WHERE user_id = ?').get(req.tgUser.id).n;
    if (n >= 12) throw bad('limit');
    q('INSERT INTO habits (user_id, title, icon, created_at) VALUES (?,?,?,?)').run(req.tgUser.id, title, clean(req.body?.icon, 4) || null, now());
    return { ok: true };
  });
  api.post('/api/habits/:id/toggle', async (req) => {
    const h = q('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(req.params.id, req.tgUser.id);
    if (!h) throw bad('not_found', 404);
    const today = dateStr(0);
    const has = q('SELECT 1 FROM habit_log WHERE habit_id = ? AND day = ?').get(h.id, today);
    if (has) q('DELETE FROM habit_log WHERE habit_id = ? AND day = ?').run(h.id, today);
    else q('INSERT INTO habit_log (habit_id, day) VALUES (?,?)').run(h.id, today);
    return { ok: true, done: !has, streak: streak(h.id) };
  });
  api.delete('/api/habits/:id', async (req) => {
    const h = q('SELECT id FROM habits WHERE id = ? AND user_id = ?').get(req.params.id, req.tgUser.id);
    if (h) { q('DELETE FROM habit_log WHERE habit_id = ?').run(h.id); q('DELETE FROM habits WHERE id = ?').run(h.id); }
    return { ok: true };
  });

  // ---------- дни рождения и «давно не виделись» ----------
  api.patch('/api/me/birthday', async (req) => {
    const b = clean(req.body?.birthday, 10);
    if (b && !/^\d{2}-\d{2}$/.test(b) && !/^\d{4}-\d{2}-\d{2}$/.test(b)) throw bad('bad_date');
    q('UPDATE users SET birthday = ? WHERE id = ?').run(b ? b.slice(-5) : null, req.tgUser.id);
    return { ok: true };
  });
  api.get('/api/friends/extra', async (req) => {
    const me = req.tgUser;
    const today = dateStr(0), year = Number(today.slice(0, 4));
    const ids = [...circle(me)];
    const lost = [], birthdays = [];
    for (const id of ids) {
      const u = q('SELECT id, name, photo_url, birthday FROM users WHERE id = ?').get(id);
      if (!u) continue;
      if (u.birthday) {
        let d = `${year}-${u.birthday}`;
        if (d < today) d = `${year + 1}-${u.birthday}`;
        const inDays = dayDiff(today, d);
        if (inDays <= 30) birthdays.push({ ...pub(u), date: d, in_days: inDays });
      }
      if (me.couple_id && u.couple_id === me.couple_id) continue; // партнёра не считаем «давно не виделись»
      const last = q(`SELECT MAX(m.date) AS d FROM meetings m
        JOIN meeting_members a ON a.meeting_id = m.id AND a.user_id = ? AND a.rsvp = 'yes'
        JOIN meeting_members b ON b.meeting_id = m.id AND b.user_id = ? AND b.rsvp = 'yes'
        WHERE m.status = 'set' AND m.date <= ?`).get(me.id, id, today)?.d;
      const since = last || new Date((q('SELECT created_at FROM friendships WHERE a = ? AND b = ?').get(me.id, id)?.created_at || now()) * 1000).toISOString().slice(0, 10);
      const gap = dayDiff(since, today);
      if (gap >= 30) lost.push({ ...pub(u), days: gap, met: !!last });
    }
    birthdays.sort((a, b) => a.in_days - b.in_days);
    lost.sort((a, b) => b.days - a.days);
    return { birthdays, lost: lost.slice(0, 5), my_birthday: q('SELECT birthday FROM users WHERE id = ?').get(me.id)?.birthday ?? null };
  });
  // ежедневно в 9:00 по Минску: напомнить о днях рождения друзей (за неделю и в день)
  let bdayDay = '';
  setInterval(() => {
    try {
      const h = new Date(Date.now() + TZ * 3600e3).getUTCHours();
      const today = dateStr(0);
      if (h !== 9 || bdayDay === today) return;
      bdayDay = today;
      const md = (off) => dateStr(off).slice(5);
      for (const u of q('SELECT id, name, birthday FROM users WHERE birthday IN (?, ?)').all(md(0), md(7))) {
        const when = u.birthday === md(0) ? 'сегодня день рождения' : 'через неделю день рождения';
        for (const r of q('SELECT a FROM friendships WHERE b = ?').all(u.id)) say(r.a, `🎂 У <b>${esc(first(u))}</b> ${when}. Загляните в вишлист, там могут быть идеи подарка.`);
      }
    } catch (e) { console.error('birthdays', e.message); }
  }, 600000).unref();

  // ---------- общие расходы ----------
  const bal = (uid) => {
    // net[other] > 0: мне должны; < 0: я должен
    const net = {};
    const add = (id, v) => { net[id] = (net[id] || 0) + v; };
    for (const r of q(`SELECT e.paid_by, s.user_id, s.share FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
      WHERE e.id IN (SELECT expense_id FROM expense_shares WHERE user_id = ?) OR e.paid_by = ?`).all(uid, uid)) {
      if (r.user_id === r.paid_by) continue;
      if (r.paid_by === uid) add(r.user_id, r.share);
      else if (r.user_id === uid) add(r.paid_by, -r.share);
    }
    for (const s of q('SELECT * FROM settlements WHERE from_id = ? OR to_id = ?').all(uid, uid)) {
      if (s.from_id === uid) add(s.to_id, s.amount);
      else add(s.from_id, -s.amount);
    }
    return net;
  };
  api.get('/api/expenses', async (req) => {
    const me = req.tgUser, net = bal(me.id);
    const people = Object.entries(net).filter(([, v]) => v !== 0).map(([id, v]) => ({ ...pub(userRow(Number(id))), amount: v })).filter((p) => p.id);
    const recent = q(`SELECT DISTINCT e.* FROM expenses e LEFT JOIN expense_shares s ON s.expense_id = e.id
      WHERE e.paid_by = ? OR s.user_id = ? ORDER BY e.id DESC LIMIT 15`).all(me.id, me.id).map((e) => ({
      id: e.id, title: e.title, amount: e.amount, day: e.day, paid_by: pub(userRow(e.paid_by)),
      with: q('SELECT user_id FROM expense_shares WHERE expense_id = ?').all(e.id).map((r) => r.user_id),
      mine: e.owner_id === me.id,
    }));
    return {
      owed_to_me: people.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0),
      i_owe: -people.filter((p) => p.amount < 0).reduce((s, p) => s + p.amount, 0),
      people, recent,
    };
  });
  api.post('/api/expenses', async (req) => {
    const me = req.tgUser, b = req.body || {};
    const amount = Math.round(Number(b.amount) * 100);
    const title = clean(b.title, 80);
    if (!title || !(amount > 0) || amount > 1e9) throw bad('bad_input');
    const ok = circle(me);
    const paidBy = Number(b.paid_by || me.id);
    const ids = [...new Set([me.id, paidBy, ...(Array.isArray(b.split) ? b.split.map(Number) : [])])];
    if (!ids.every((i) => i === me.id || ok.has(i))) throw bad('forbidden', 403);
    const split = ids.length;
    const base = Math.floor(amount / split);
    let rest = amount - base * split;
    const info = q('INSERT INTO expenses (owner_id, title, amount, paid_by, day, created_at) VALUES (?,?,?,?,?,?)').run(me.id, title, amount, paidBy, dateStr(0), now());
    for (const id of ids) { q('INSERT INTO expense_shares (expense_id, user_id, share) VALUES (?,?,?)').run(info.lastInsertRowid, id, base + (rest-- > 0 ? 1 : 0)); }
    for (const id of ids) if (id !== me.id) say(id, `💸 <b>${esc(first(me))}</b> добавил(а) расход «${esc(title)}»: ${(amount / 100).toFixed(2)}. Ваша доля ${((base) / 100).toFixed(2)}.`);
    return { ok: true };
  });
  api.delete('/api/expenses/:id', async (req) => {
    const e = q('SELECT id FROM expenses WHERE id = ? AND owner_id = ?').get(req.params.id, req.tgUser.id);
    if (e) { q('DELETE FROM expense_shares WHERE expense_id = ?').run(e.id); q('DELETE FROM expenses WHERE id = ?').run(e.id); }
    return { ok: true };
  });
  api.post('/api/expenses/settle', async (req) => {
    const me = req.tgUser, other = Number(req.body?.user_id);
    if (!circle(me).has(other)) throw bad('forbidden', 403);
    const net = bal(me.id)[other] || 0;
    if (!net) return { ok: true };
    const from = net < 0 ? me.id : other, to = net < 0 ? other : me.id;
    q('INSERT INTO settlements (from_id, to_id, amount, created_at) VALUES (?,?,?,?)').run(from, to, Math.abs(net), now());
    say(other, `✅ <b>${esc(first(me))}</b> отметил(а), что вы рассчитались (${(Math.abs(net) / 100).toFixed(2)}).`);
    return { ok: true };
  });
  api.post('/api/expenses/remind', async (req) => {
    const other = Number(req.body?.user_id);
    const net = bal(req.tgUser.id)[other] || 0;
    if (net > 0 && circle(req.tgUser).has(other)) say(other, `💸 <b>${esc(first(req.tgUser))}</b> напоминает: вы должны ${(net / 100).toFixed(2)}.`);
    return { ok: true };
  });

  // ---------- оценка отношений: тренд, тепловая карта, юбилеи ----------
  api.get('/api/relationship', async (req) => {
    const me = req.tgUser;
    if (!me.couple_id) return { days: [], avg7: null, avg30: null, anniversaries: [], dates: 0 };
    const partner = q('SELECT id FROM users WHERE couple_id = ? AND id != ?').get(me.couple_id, me.id);
    const since = dateStr(-59);
    const rows = q('SELECT user_id, day, mood FROM moods WHERE couple_id = ? AND day >= ?').all(me.couple_id, since);
    const my = {}, pr = {};
    for (const r of rows) (r.user_id === me.id ? my : pr)[r.day] = SCORE[r.mood];
    const today = dateStr(0);
    const days = [];
    for (let i = 59; i >= 0; i--) {
      const d = dateStr(-i);
      const mine = my[d] ?? null;
      // оценку партнёра показываем только после своей (или за прошедшие дни)
      const theirs = pr[d] != null && (mine != null || d < today) ? pr[d] : null;
      const vals = [mine, theirs].filter((v) => v != null);
      days.push({ day: d, me: mine, partner: theirs, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null });
    }
    const avg = (n) => {
      const v = days.slice(-n).map((d) => d.avg).filter((x) => x != null);
      return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
    };
    const couple = q('SELECT start_date FROM couples WHERE id = ?').get(me.couple_id);
    const anniversaries = [];
    if (couple?.start_date) {
      const total = dayDiff(couple.start_date, today);
      const marks = [100, 200, 300, 500, 700, 1000, 1500, 2000];
      for (const m of marks) if (m > total) { anniversaries.push({ label: `${m} дней вместе`, in_days: m - total }); break; }
      const [y, mo, dd] = couple.start_date.split('-').map(Number);
      const t = new Date(today + 'T00:00:00Z');
      for (let k = 0; k < 14; k++) {
        const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k, dd));
        const iso = d.toISOString().slice(0, 10);
        if (iso <= today) continue;
        const months = (d.getUTCFullYear() - y) * 12 + d.getUTCMonth() - (mo - 1);
        anniversaries.push({ label: months % 12 === 0 ? `${months / 12} ${months / 12 === 1 ? 'год' : months / 12 < 5 ? 'года' : 'лет'} вместе` : `${months} мес. вместе`, in_days: dayDiff(today, iso) });
        break;
      }
      anniversaries.sort((a, b) => a.in_days - b.in_days);
    }
    const dates = q("SELECT COUNT(*) AS n FROM places WHERE couple_id = ? AND status = 'visited'").get(me.couple_id).n;
    return { days, avg7: avg(7), avg30: avg(30), anniversaries, dates, has_partner: !!partner };
  });

  // ---------- бэкап: JSON приходит в чат с ботом (на диске сервера не хранится) ----------
  const TABLES_COUPLE = ['places', 'shopping', 'chores', 'recipes', 'wishes', 'notes', 'events', 'moods', 'answers'];
  function buildExport(u) {
    const out = { exported_at: new Date().toISOString(), user: { id: u.id, name: u.name } };
    if (u.couple_id) {
      out.couple = q('SELECT start_date FROM couples WHERE id = ?').get(u.couple_id);
      for (const t of TABLES_COUPLE) {
        try { out[t] = q(`SELECT * FROM ${t} WHERE couple_id = ?`).all(u.couple_id); } catch { /* таблицы может не быть */ }
      }
    }
    for (const [k, sql] of Object.entries({
      diary: 'SELECT * FROM diary WHERE user_id = ?',
      calendar: 'SELECT * FROM cal WHERE owner_id = ?',
      habits: 'SELECT * FROM habits WHERE user_id = ?',
    })) { try { out[k] = q(sql).all(u.id); } catch { /* пропускаем */ } }
    return out;
  }
  async function sendBackup(u) {
    const body = new FormData();
    body.set('chat_id', String(u.id));
    body.set('caption', '🗄 Резервная копия Us App. Храните этот файл: если приложение недоступно, здесь все ваши данные.');
    body.set('document', new Blob([JSON.stringify(buildExport(u), null, 1)], { type: 'application/json' }), `usapp-backup-${dateStr(0)}.json`);
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
    } catch (e) { console.error('backup', e.message); }
  }
  api.post('/api/backup/send', async (req) => { await sendBackup(req.tgUser); return { ok: true }; });
  // раз в неделю (воскресенье, 10:00 по Минску) и очистка: чистим WAL и старую ленту
  let backupDay = '';
  setInterval(async () => {
    try {
      const l = new Date(Date.now() + TZ * 3600e3);
      const today = dateStr(0);
      if (l.getUTCDay() !== 0 || l.getUTCHours() !== 10 || backupDay === today) return;
      backupDay = today;
      for (const u of q('SELECT * FROM users').all()) await sendBackup(u);
      q('DELETE FROM activity WHERE created_at < ?').run(now() - 120 * 86400);
      q('DELETE FROM habit_log WHERE day < ?').run(dateStr(-400));
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.pragma('optimize');
    } catch (e) { console.error('weekly', e.message); }
  }, 600000).unref();
}
