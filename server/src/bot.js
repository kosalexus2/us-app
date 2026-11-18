import { db, now } from './db.js';

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

/** Сюда другие модули кладут общие функции (например, разбор ссылки), чтобы не было круговых импортов. */
export const hooks = {};

export async function tg(token, method, body) {
  if (!token) return null;
  try {
    const res = await fetch(API(token, method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(8000),
    });
    return await res.json();
  } catch (e) {
    console.error('telegram error', method, e.message);
    return null;
  }
}

/** Fire-and-forget push to the partner. Failures never break the request. */
export function notify(token, chatId, text, webAppUrl) {
  if (!token || !chatId) return;
  const body = { chat_id: chatId, text, disable_notification: false };
  if (webAppUrl) {
    body.reply_markup = { inline_keyboard: [[{ text: 'Открыть Us App', web_app: { url: webAppUrl } }]] };
  }
  tg(token, 'sendMessage', body);
}

// Присланное боту ждёт здесь, пока человек не выберет раздел кнопкой.
db.exec(`
CREATE TABLE IF NOT EXISTS bot_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  url TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
const q = (sql) => db.prepare(sql);

const URL_RE = /https?:\/\/[^\s]+/i;
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

// Куда можно положить присланное. Для ссылок и для простого текста наборы разные.
const TARGETS = {
  wish: { label: '🎁 В вишлист', done: 'в вишлист' },
  recipe: { label: '🍝 В рецепты', done: 'в рецепты' },
  place: { label: '📍 В места', done: 'в места' },
  shopping: { label: '🛒 В покупки', done: 'в покупки' },
  chore: { label: '✅ В дела', done: 'в дела' },
  note: { label: '💌 Записка', done: 'в записки' },
};
const LINK_TARGETS = ['wish', 'recipe', 'place'];
const TEXT_TARGETS = ['shopping', 'chore', 'wish', 'note'];

const keyboard = (pendingId, targets, webAppUrl) => ({
  inline_keyboard: [
    ...chunk(targets.map((t) => ({ text: TARGETS[t].label, callback_data: `save:${pendingId}:${t}` })), 2),
    [{ text: '✖️ Не надо', callback_data: `drop:${pendingId}:x` }, { text: 'Открыть Us App', web_app: { url: webAppUrl } }],
  ],
});
const chunk = (arr, n) => arr.reduce((acc, x, i) => (i % n ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);

/** Сохраняет отложенную запись в нужный раздел. Возвращает название или null. */
async function save(target, pending, user) {
  const url = pending.url || null;
  let title = clean(pending.text.replace(URL_RE, '').replace(/\s+/g, ' '), 160);
  let image = null;
  let price = null;

  if (url && hooks.linkPreview) {
    try {
      const p = await hooks.linkPreview(url);
      if (!title && p.title) title = p.title.slice(0, 160);
      image = p.image || null;
      price = p.price || null;
    } catch { /* превью необязательно */ }
  }
  if (!title && url) {
    try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = 'Ссылка'; }
  }
  if (!title) return null;

  const couple = user.couple_id;
  switch (target) {
    case 'wish':
      q('INSERT INTO wishes (couple_id, owner_id, kind, title, price, url, image_url, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(couple, user.id, 'gift', title, price, url, image, now());
      break;
    case 'recipe':
      q('INSERT INTO recipes (couple_id, title, note, url, image_url, added_by, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(couple, title, null, url, image, user.id, now());
      break;
    case 'place':
      q('INSERT INTO places (couple_id, title, category, note, added_by, created_at) VALUES (?,?,?,?,?,?)')
        .run(couple, title, null, url, user.id, now());
      break;
    case 'shopping':
      q('INSERT INTO shopping (couple_id, title, category, added_by, created_at) VALUES (?,?,?,?,?)')
        .run(couple, title.slice(0, 120), null, user.id, now());
      break;
    case 'chore':
      q('INSERT INTO chores (couple_id, title, due_date, repeat_days, added_by, created_at) VALUES (?,?,?,?,?,?)')
        .run(couple, title, null, null, user.id, now());
      break;
    case 'note':
      q('INSERT INTO notes (couple_id, from_user, text, open_at, created_at) VALUES (?,?,?,?,?)')
        .run(couple, user.id, clean(pending.text, 1000), null, now());
      break;
    default:
      return null;
  }
  return title;
}

const openBtn = (webAppUrl) => ({ inline_keyboard: [[{ text: 'Открыть Us App', web_app: { url: webAppUrl } }]] });

/** Handle a Telegram webhook update. */
export async function handleUpdate(token, webAppUrl, update) {
  const cb = update?.callback_query;
  if (cb) return handleCallback(token, webAppUrl, cb);

  const msg = update?.message;
  if (!msg) return;
  const chatId = msg.chat?.id;
  const text = clean(msg.text || msg.caption, 1000);
  if (!text) return;

  if (text.startsWith('/start')) {
    const payload = text.split(' ')[1] || '';
    const url = payload ? `${webAppUrl}?p=${encodeURIComponent(payload)}` : webAppUrl;
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: 'Привет! Это Us App — ваше общее пространство.\n\nСюда можно пересылать ссылки из любого приложения: нажмите «Поделиться» → Telegram → этот чат, и я спрошу, куда их положить.',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Us App', web_app: { url } }]] },
    });
    return;
  }

  const user = q('SELECT * FROM users WHERE id = ?').get(msg.from?.id);
  if (!user?.couple_id) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: 'Сначала откройте приложение — после этого я смогу сохранять сюда ссылки и заметки.',
      reply_markup: openBtn(webAppUrl),
    });
    return;
  }

  const url = (text.match(URL_RE) || [null])[0];
  const id = q('INSERT INTO bot_pending (user_id, url, text, created_at) VALUES (?,?,?,?)').run(user.id, url, text, now()).lastInsertRowid;
  q('DELETE FROM bot_pending WHERE created_at < ?').run(now() - 7 * 86400);

  await tg(token, 'sendMessage', {
    chat_id: chatId,
    text: url ? 'Куда сохранить эту ссылку?' : 'Куда это записать?',
    reply_to_message_id: msg.message_id,
    allow_sending_without_reply: true,
    reply_markup: keyboard(id, url ? LINK_TARGETS : TEXT_TARGETS, webAppUrl),
  });
}

async function handleCallback(token, webAppUrl, cb) {
  const [action, pendingId, target] = String(cb.data || '').split(':');
  const chatId = cb.message?.chat?.id;
  const answer = (text) => tg(token, 'answerCallbackQuery', { callback_query_id: cb.id, text });

  if (action === 'drop') {
    q('DELETE FROM bot_pending WHERE id = ?').run(pendingId);
    await answer('Не сохраняю');
    await tg(token, 'editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: 'Хорошо, ничего не сохранил.' });
    return;
  }
  if (action !== 'save') return answer('');

  const pending = q('SELECT * FROM bot_pending WHERE id = ?').get(pendingId);
  const user = q('SELECT * FROM users WHERE id = ?').get(cb.from?.id);
  if (!pending || !user?.couple_id || pending.user_id !== user.id) {
    await answer('Не нашёл, что сохранять');
    return;
  }

  let title = null;
  try {
    title = await save(target, pending, user);
  } catch (e) {
    console.error('bot save', e.message);
  }
  q('DELETE FROM bot_pending WHERE id = ?').run(pendingId);

  if (!title) {
    await answer('Не получилось сохранить');
    return;
  }
  await answer('Готово');
  await tg(token, 'editMessageText', {
    chat_id: chatId,
    message_id: cb.message.message_id,
    text: `Добавил ${TARGETS[target].done}: «${title}»`,
    reply_markup: openBtn(webAppUrl),
  });
}
