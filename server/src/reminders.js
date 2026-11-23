import { db, now } from './db.js';
import { tg } from './bot.js';

// Очередь напоминаний. Сами задачи лежат у человека в Telegram (CloudStorage), здесь только
// «когда, кому, короткий текст» (около 100 байт на запись). Приложение пересобирает очередь при каждом сохранении.
db.exec(`
CREATE TABLE IF NOT EXISTS reminders (
  user_id INTEGER NOT NULL,
  ref TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (user_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_rem_fire ON reminders(fire_at);
`);

export function registerReminders(api, { botToken, webAppUrl }) {
  const put = db.prepare('INSERT OR REPLACE INTO reminders (user_id, ref, fire_at, text) VALUES (?,?,?,?)');
  const sync = db.transaction((uid, items) => {
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(uid);
    for (const it of items) put.run(uid, it.ref, it.at, it.text);
  });
  const send = (uid, text) => tg(botToken, 'sendMessage', {
    chat_id: uid, text, parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Открыть задачи', web_app: { url: webAppUrl } }]] },
  });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  api.post('/api/reminders/sync', async (req) => {
    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    const t = now();
    const items = raw.slice(0, 500)
      .map((i) => ({ ref: String(i?.ref ?? '').slice(0, 40), at: Math.floor(Number(i?.at)), text: String(i?.text ?? '').slice(0, 200) }))
      .filter((i) => i.ref && i.text && Number.isFinite(i.at) && i.at > t - 3600 && i.at < t + 120 * 86400);
    sync(req.tgUser.id, items);
    return { ok: true, n: items.length };
  });
  api.post('/api/reminders/test', async (req) => {
    await send(req.tgUser.id, '🔔 Так будут приходить напоминания о задачах.');
    return { ok: true };
  });

  const due = db.prepare('SELECT user_id, ref, text FROM reminders WHERE fire_at <= ? AND fire_at > ?');
  const drop = db.prepare('DELETE FROM reminders WHERE user_id = ? AND ref = ?');
  setInterval(async () => {
    try {
      const t = now();
      for (const r of due.all(t, t - 6 * 3600)) {
        drop.run(r.user_id, r.ref);
        await send(r.user_id, `🔔 <b>${esc(r.text)}</b>`).catch(() => {});
      }
      db.prepare('DELETE FROM reminders WHERE fire_at <= ?').run(t - 6 * 3600);
    } catch (e) { console.error('reminders', e.message); }
  }, 30000).unref();
}
