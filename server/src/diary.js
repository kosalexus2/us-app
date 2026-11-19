import { db, now } from './db.js';
import { notify } from './bot.js';

// Личный дневник: запись видна только автору. Автор может открыть её партнёру переключателем «Показать».
// Чужие записи видны только если автор открыл их, и только в режиме чтения.

const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 3);
const q = (sql) => db.prepare(sql);

db.exec(`
CREATE TABLE IF NOT EXISTS diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  mood TEXT,
  body TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diary_user ON diary(user_id, day);
CREATE INDEX IF NOT EXISTS idx_diary_couple ON diary(couple_id, shared, day);
`);

const MOODS = ['love', 'great', 'ok', 'sad', 'angry'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayStr = () => new Date(Date.now() + TZ * 3600e3).toISOString().slice(0, 10);
const bad = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code, appError: true });
const h = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply);
  } catch (e) {
    if (e.appError) return reply.code(e.statusCode).send({ error: e.message });
    throw e;
  }
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

export function registerDiary(api, { botToken, webAppUrl }) {
  const needCouple = async (req, reply) => {
    if (!req.tgUser?.couple_id) return reply.code(403).send({ error: 'no_couple' });
  };
  const guarded = { preHandler: needCouple };

  const view = (row, me) => ({
    id: row.id,
    mine: row.user_id === me.id,
    from_name: row.from_name || null,
    day: row.day,
    mood: row.mood,
    body: row.body,
    shared: !!row.shared,
    created_at: row.created_at,
  });

  const partnerOf = (me) => q('SELECT * FROM users WHERE couple_id = ? AND id != ?').get(me.couple_id, me.id);
  const pushShared = (me) => {
    const p = partnerOf(me);
    if (p) notify(botToken, p.id, `${(me.name || '').split(' ')[0]} поделился(ась) записью из дневника`, webAppUrl);
  };

  api.get('/api/diary', guarded, h(async (req) => {
    const me = req.tgUser;
    const rows = q(
      `SELECT d.*, u.name AS from_name FROM diary d JOIN users u ON u.id = d.user_id
       WHERE d.user_id = ? OR (d.couple_id = ? AND d.shared = 1)
       ORDER BY d.day DESC, d.id DESC LIMIT 300`,
    ).all(me.id, me.couple_id);
    return rows.map((r) => view(r, me));
  }));

  api.post('/api/diary', guarded, h(async (req) => {
    const me = req.tgUser;
    const body = clean(req.body?.body, 4000);
    if (!body) throw bad('empty_entry');
    const mood = req.body?.mood ? clean(req.body.mood, 10) : null;
    if (mood && !MOODS.includes(mood)) throw bad('bad_mood');
    const day = req.body?.day ? clean(req.body.day, 10) : todayStr();
    if (!DATE_RE.test(day)) throw bad('bad_date');
    const shared = req.body?.shared ? 1 : 0;
    const t = now();
    const info = q('INSERT INTO diary (couple_id, user_id, day, mood, body, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(me.couple_id, me.id, day, mood, body, shared, t, t);
    if (shared) pushShared(me);
    return { ok: true, id: Number(info.lastInsertRowid) };
  }));

  api.patch('/api/diary/:id', guarded, h(async (req) => {
    const me = req.tgUser;
    const row = q('SELECT * FROM diary WHERE id = ? AND user_id = ?').get(Number(req.params.id), me.id);
    if (!row) throw bad('not_found', 404);
    const b = req.body || {};
    const body = b.body !== undefined ? clean(b.body, 4000) : row.body;
    if (!body) throw bad('empty_entry');
    let mood = row.mood;
    if (b.mood !== undefined) {
      mood = b.mood ? clean(b.mood, 10) : null;
      if (mood && !MOODS.includes(mood)) throw bad('bad_mood');
    }
    const shared = b.shared !== undefined ? (b.shared ? 1 : 0) : row.shared;
    q('UPDATE diary SET body = ?, mood = ?, shared = ?, updated_at = ? WHERE id = ?').run(body, mood, shared, now(), row.id);
    if (shared && !row.shared) pushShared(me);
    return { ok: true };
  }));

  api.delete('/api/diary/:id', guarded, h(async (req) => {
    const r = q('DELETE FROM diary WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.tgUser.id);
    if (!r.changes) throw bad('not_found', 404);
    return { ok: true };
  }));
}
