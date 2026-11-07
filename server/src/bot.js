const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

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

/** Handle a Telegram webhook update. */
export async function handleUpdate(token, webAppUrl, update) {
  const msg = update?.message;
  if (!msg?.text) return;
  const text = msg.text.trim();
  if (text.startsWith('/start')) {
    const payload = text.split(' ')[1] || '';
    const url = payload ? `${webAppUrl}?p=${encodeURIComponent(payload)}` : webAppUrl;
    await tg(token, 'sendMessage', {
      chat_id: msg.chat.id,
      text: 'Привет! Это Us App — ваше общее пространство на двоих.',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Us App', web_app: { url } }]] },
    });
    return;
  }
  await tg(token, 'sendMessage', {
    chat_id: msg.chat.id,
    text: 'Открой приложение кнопкой ниже, там всё самое важное.',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть Us App', web_app: { url: webAppUrl } }]] },
  });
}
