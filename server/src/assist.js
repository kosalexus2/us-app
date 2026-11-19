import { db, now } from './db.js';
import { hooks, notify } from './bot.js';

// Помощник и правки: свободные слоты в календаре, отметка «сделано» голосом,
// редактирование рецептов/желаний/событий/записок, порядок списков и расширенные напоминания.

const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 3);
const q = (sql) => db.prepare(sql);

// Миграции: порядок в списках, напоминания у дел и событий.
const hasCol = (table, col) => !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, col);
for (const [table, col, type] of [
  ['shopping', 'pos', 'INTEGER'],
  ['chores', 'pos', 'INTEGER'],
  ['wishes', 'pos', 'INTEGER'],
  ['places', 'pos', 'INTEGER'],
  ['chores', 'remind_rule', 'TEXT'],
  ['chores', 'reminded_on', 'TEXT'],
  ['events', 'remind_rule', 'TEXT'],
  ['events', 'reminded_on', 'TEXT'],
  ['notes', 'opened_sent', 'INTEGER'],
]) {
  if (!hasCol(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const bad = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code, appError: true });
const h = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply);
  } catch (e) {
    if (e.appError) return reply.code(e.statusCode).send({ error: e.message });
    throw e;
  }
};

const RULES = ['morning', 'day_before', 'week_before', 'two_hours'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, '0');
/** Сегодняшняя дата в нашем часовом поясе. */
const todayStr = () => new Date(Date.now() + TZ * 3600e3).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const weekday = (date) => new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay(); // 0 = воскресенье
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
/** Unix-время момента «дата + время» в нашем поясе. */
const tsOf = (date, time) => Math.floor((Date.parse(`${date}T${time || '09:00'}:00Z`) - TZ * 3600e3) / 1000);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const human = (date, time) => {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${time ? `, ${time}` : ''}`;
};
const first = (u) => (u?.name || '').split(' ')[0];

/** Слова к нижнему регистру без окончаний — для нестрогого поиска «отметь, что купил молоко». */
const norm = (s) =>
  String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
const stem = (w) => w.replace(/(ами|ями|ов|ей|ие|ые|ая|ое|ую|ю|и|ы|а|о|е|у)$/i, '');
function matchScore(query, title) {
  const a = norm(query).map(stem);
  const b = norm(title).map(stem);
  if (!a.length || !b.length) return 0;
  let hit = 0;
  for (const w of b) if (a.some((x) => x === w || (x.length > 3 && w.startsWith(x)) || (w.length > 3 && x.startsWith(w)))) hit++;
  return hit / b.length;
}

export function registerAssist(api, { botToken, webAppUrl }) {
  const push = (userId, text) => notify(botToken, userId, text, webAppUrl);
  const needCouple = async (req, reply) => {
    if (!req.tgUser?.couple_id) return reply.code(403).send({ error: 'no_couple' });
  };
  const guarded = { preHandler: needCouple };

  // ---------- свободное время ----------
  // Окна, в которые вообще предлагаем встречи: будни — вечер, выходные — день.
  const WINDOW = { work: [17 * 60, 22 * 60 + 30], free: [10 * 60, 22 * 60 + 30], wide: [9 * 60, 22 * 60 + 30] };
  const EVENT_LEN = 90; // сколько минут считаем занятыми, если длительность не указана

  api.post('/api/free-slots', { ...guarded }, h(async (req) => {
    const me = req.tgUser;
    const duration = Math.min(Math.max(Number(req.body?.duration_min) || 120, 30), 600);
    const from = DATE_RE.test(clean(req.body?.from, 10)) ? req.body.from : todayStr();
    const to = DATE_RE.test(clean(req.body?.to, 10)) ? req.body.to : addDays(from, 13);
    if (Date.parse(to) < Date.parse(from)) throw bad('bad_range');
    const withId = Number(req.body?.with_id) || null;
    const people = [me.id];
    let withUser = null;
    if (withId && withId !== me.id) {
      withUser = q('SELECT * FROM users WHERE id = ?').get(withId);
      const linked =
        withUser && ((me.couple_id && withUser.couple_id === me.couple_id) || q('SELECT 1 FROM friendships WHERE a = ? AND b = ?').get(me.id, withId));
      if (!linked) throw bad('not_found', 404);
      people.push(withId);
    }

    // Чем заняты дни: личные встречи обоих + общие события пары.
    const busy = {}; // date -> [[начало, конец] в минутах]
    const dayItems = {}; // date -> названия, чтобы показать контекст
    const mark = (date, time, title, lenMin) => {
      if (Date.parse(date) < Date.parse(from) || Date.parse(date) > Date.parse(to)) return;
      (dayItems[date] ||= []).push(time ? `${time} ${title}` : title);
      if (!time) return; // без времени ничего не блокируем, просто показываем
      const s = minutesOf(time);
      (busy[date] ||= []).push([s, s + (lenMin || EVENT_LEN)]);
    };
    const marks = q(`SELECT * FROM cal WHERE owner_id IN (${people.map(() => '?').join(',')}) AND date >= ? AND date <= ?`).all(...people, from, to);
    for (const c of marks) {
      if (c.owner_id !== me.id && c.private) continue;
      mark(c.date, c.time, c.title, EVENT_LEN);
    }
    if (me.couple_id) {
      for (const e of q('SELECT * FROM events WHERE couple_id = ? AND date >= ? AND date <= ?').all(me.couple_id, from, to)) {
        mark(e.date, e.time, e.title, 120);
      }
    }

    const nowTs = now();
    const slots = [];
    for (let date = from; Date.parse(date) <= Date.parse(to); date = addDays(date, 1)) {
      const wd = weekday(date);
      let [winStart, winEnd] = wd === 0 || wd === 6 ? WINDOW.free : WINDOW.work;
      if (winEnd - winStart < duration) [winStart, winEnd] = WINDOW.wide;
      const taken = (busy[date] || []).sort((a, b) => a[0] - b[0]);
      const perDay = [];
      for (let start = winStart; start + duration <= winEnd; start += 30) {
        const end = start + duration;
        if (taken.some(([bs, be]) => start < be && end > bs)) continue;
        if (tsOf(date, hhmm(start)) < nowTs + 3600) continue; // не предлагаем то, что уже сейчас
        perDay.push({ date, start: hhmm(start), end: hhmm(end), weekend: wd === 0 || wd === 6 });
        if (perDay.length >= 2) break;
        start += 90; // разносим варианты внутри дня
      }
      slots.push(...perDay);
    }
    // Сначала выходные и ближайшие дни, но не больше 6 вариантов.
    slots.sort((a, b) => (b.weekend ? 1 : 0) - (a.weekend ? 1 : 0) || a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    return {
      duration_min: duration,
      with: withUser ? { id: withUser.id, first_name: first(withUser) } : null,
      from,
      to,
      slots: slots.slice(0, 6).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
      day_items: dayItems,
    };
  }));

  // ---------- «отметь, что купил молоко» ----------
  api.post('/api/assist/complete', { ...guarded }, h(async (req) => {
    const me = req.tgUser;
    const text = clean(req.body?.text, 200);
    if (!text) throw bad('empty');
    const candidates = [
      ...q('SELECT id, title FROM shopping WHERE couple_id = ? AND done = 0').all(me.couple_id).map((r) => ({ ...r, type: 'shopping' })),
      ...q('SELECT id, title FROM chores WHERE couple_id = ? AND done = 0').all(me.couple_id).map((r) => ({ ...r, type: 'chore' })),
    ];
    let best = null;
    for (const c of candidates) {
      const score = matchScore(text, c.title);
      if (score > 0 && (!best || score > best.score)) best = { ...c, score };
    }
    if (!best || best.score < 0.5) throw bad('not_found', 404);
    if (best.type === 'shopping') {
      q('UPDATE shopping SET done = 1, done_by = ? WHERE id = ?').run(me.id, best.id);
    } else {
      const c = q('SELECT * FROM chores WHERE id = ?').get(best.id);
      if (c.repeat_days) {
        const base = c.due_date && c.due_date > todayStr() ? c.due_date : todayStr();
        q('UPDATE chores SET due_date = ?, done = 0, done_by = NULL, reminded_on = NULL WHERE id = ?').run(addDays(base, c.repeat_days), c.id);
      } else {
        q('UPDATE chores SET done = 1, done_by = ? WHERE id = ?').run(me.id, best.id);
      }
    }
    return { ok: true, type: best.type, title: best.title };
  }));

  // ---------- правки того, что раньше нельзя было изменить ----------
  const ownCouple = (table, id, me) => {
    const row = q(`SELECT * FROM ${table} WHERE id = ? AND couple_id = ?`).get(id, me.couple_id);
    if (!row) throw bad('not_found', 404);
    return row;
  };
  const apply = (table, id, fields) => {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    q(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
  };

  api.patch('/api/recipes/:id', { ...guarded }, h(async (req) => {
    const me = req.tgUser;
    ownCouple('recipes', req.params.id, me);
    const f = {};
    if (req.body?.title !== undefined) {
      f.title = clean(req.body.title, 120);
      if (!f.title) throw bad('title_required');
    }
    if (req.body?.note !== undefined) f.note = clean(req.body.note, 600) || null;
    if (req.body?.url !== undefined) f.url = clean(req.body.url, 500) || null;
    if (req.body?.image_url !== undefined) f.image_url = clean(req.body.image_url, 600) || null;
    apply('recipes', req.params.id, f);
    return { ok: true };
  }));

  api.patch('/api/wishes/:id', { ...guarded }, h(async (req) => {
    const me = req.tgUser;
    const w = ownCouple('wishes', req.params.id, me);
    if (w.owner_id !== me.id) throw bad('not_mine', 403);
    const f = {};
    if (req.body?.title !== undefined) {
      f.title = clean(req.body.title, 160);
      if (!f.title) throw bad('title_required');
    }
    if (req.body?.kind !== undefined && ['gift', 'watch', 'dream'].includes(req.body.kind)) f.kind = req.body.kind;
    if (req.body?.price !== undefined) f.price = clean(req.body.price, 60) || null;
    if (req.body?.url !== undefined) f.url = clean(req.body.url, 500) || null;
    if (req.body?.image_url !== undefined) f.image_url = clean(req.body.image_url, 600) || null;
    // Ссылку добавили или заменили, а картинки нет: берём её со страницы. Если картинку убрали при той же ссылке, не трогаем.
    const imageNow = f.image_url !== undefined ? f.image_url : w.image_url;
    if (f.url && !imageNow && !w.image_url && hooks.linkPreview) {
      try {
        const p = await Promise.race([hooks.linkPreview(f.url), new Promise((r) => setTimeout(() => r(null), 8000))]);
        if (p?.image) f.image_url = String(p.image).slice(0, 600);
      } catch { /* ничего страшного */ }
    }
    apply('wishes', req.params.id, f);
    return { ok: true };
  }));

  api.patch('/api/events/:id', { ...guarded }, h(async (req) => {
    const me = req.tgUser;
    ownCouple('events', req.params.id, me);
    const f = {};
    if (req.body?.title !== undefined) {
      f.title = clean(req.body.title, 120);
      if (!f.title) throw bad('title_required');
    }
    if (req.body?.date !== undefined) {
      f.date = clean(req.body.date, 10);
      if (!DATE_RE.test(f.date)) throw bad('bad_date');
      f.reminded_on = null;
    }
    if (req.body?.time !== undefined) {
      const t = clean(req.body.time, 5);
      if (t && !TIME_RE.test(t)) throw bad('bad_time');
      f.time = t || null;
    }
    if (req.body?.kind !== undefined) f.kind = clean(req.body.kind, 20) || null;
    if (req.body?.yearly !== undefined) f.yearly = req.body.yearly ? 1 : 0;
    if (req.body?.remind_rule !== undefined) f.remind_rule = RULES.includes(req.body.remind_rule) ? req.body.remind_rule : null;
    apply('events', req.params.id, f);
    return { ok: true };
  }));

  api.patch('/api/notes/:id', { ...guarded }, h(async (req) => {
    const me = req.tgUser;
    const n = q('SELECT * FROM notes WHERE id = ? AND couple_id = ?').get(req.params.id, me.couple_id);
    if (!n) throw bad('not_found', 404);
    if (n.from_user !== me.id) throw bad('not_mine', 403);
    const f = {};
    if (req.body?.text !== undefined) {
      f.text = clean(req.body.text, 1000);
      if (!f.text) throw bad('title_required');
    }
    if (req.body?.open_at !== undefined) {
      f.open_at = req.body.open_at ? Math.floor(Number(req.body.open_at)) : null;
      f.opened_sent = null;
    }
    apply('notes', req.params.id, f);
    return { ok: true };
  }));

  // ---------- порядок списков ----------
  api.post('/api/reorder', { ...guarded }, h(async (req) => {
    const list = String(req.body?.list || '');
    if (!['shopping', 'chores', 'wishes', 'places'].includes(list)) throw bad('bad_list');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 300).map(Number).filter(Boolean) : [];
    if (!ids.length) throw bad('empty');
    const upd = q(`UPDATE ${list} SET pos = ? WHERE id = ? AND couple_id = ?`);
    const tx = db.transaction(() => ids.forEach((id, i) => upd.run(i + 1, id, req.tgUser.couple_id)));
    tx();
    return { ok: true };
  }));

  // ---------- напоминания о делах, событиях и записках ----------
  /** На какую дату приходится напоминание для правила. */
  const remindDate = (date, rule) =>
    rule === 'day_before' ? addDays(date, -1) : rule === 'week_before' ? addDays(date, -7) : date;

  const timer = setInterval(() => {
    try {
      const today = todayStr();
      const nowTs = now();
      const nowMin = Math.floor(((nowTs + TZ * 3600) % 86400) / 60);

      // Дела с датой: напоминаем утром (с 9:00) по выбранному правилу.
      for (const c of q("SELECT * FROM chores WHERE done = 0 AND due_date IS NOT NULL AND remind_rule IS NOT NULL AND (reminded_on IS NULL OR reminded_on != ?)").all(today)) {
        if (remindDate(c.due_date, c.remind_rule) !== today || nowMin < 9 * 60) continue;
        q('UPDATE chores SET reminded_on = ? WHERE id = ?').run(today, c.id);
        const when = c.due_date === today ? 'сегодня' : `до ${human(c.due_date)}`;
        for (const u of q('SELECT id FROM users WHERE couple_id = ?').all(c.couple_id)) {
          push(u.id, `✅ Дело: «${c.title}» — ${when}`);
        }
      }

      // События пары: годовщины, поездки.
      for (const e of q("SELECT * FROM events WHERE remind_rule IS NOT NULL AND (reminded_on IS NULL OR reminded_on != ?)").all(today)) {
        let date = e.date;
        if (e.yearly) {
          const [, m, d] = e.date.split('-');
          const thisYear = `${today.slice(0, 4)}-${m}-${d}`;
          date = thisYear >= today ? thisYear : `${Number(today.slice(0, 4)) + 1}-${m}-${d}`;
        }
        if (remindDate(date, e.remind_rule) !== today) continue;
        if (e.remind_rule === 'two_hours' && e.time) {
          if (nowMin < minutesOf(e.time) - 120) continue;
        } else if (nowMin < 9 * 60) continue;
        q('UPDATE events SET reminded_on = ? WHERE id = ?').run(today, e.id);
        const when = date === today ? `сегодня${e.time ? ` в ${e.time}` : ''}` : human(date, e.time);
        for (const u of q('SELECT id FROM users WHERE couple_id = ?').all(e.couple_id)) {
          push(u.id, `📅 ${e.title} — ${when}`);
        }
      }

      // Записки с отложенным открытием: как только время пришло, зовём партнёра.
      for (const n of q('SELECT * FROM notes WHERE open_at IS NOT NULL AND open_at <= ? AND opened_sent IS NULL').all(nowTs)) {
        q('UPDATE notes SET opened_sent = 1 WHERE id = ?').run(n.id);
        if (nowTs - n.open_at > 6 * 3600) continue; // слишком старая, не тревожим
        const from = q('SELECT * FROM users WHERE id = ?').get(n.from_user);
        for (const u of q('SELECT id FROM users WHERE couple_id = ? AND id != ?').all(n.couple_id, n.from_user)) {
          push(u.id, `💌 Записка от ${first(from)} открылась — загляните в Us App`);
        }
      }
    } catch (e) {
      console.error('assist reminders', e.message);
    }
  }, 60000);
  timer.unref?.();
}
