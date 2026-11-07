// Run once after deploy:  npm run set-webhook
// Registers the webhook and the bot's menu button to open the Mini App.
import { tg } from './bot.js';

const token = process.env.BOT_TOKEN;
const url = process.env.WEBAPP_URL;
const secret = process.env.WEBHOOK_SECRET;
if (!token || !url || !secret) {
  console.error('Set BOT_TOKEN, WEBAPP_URL and WEBHOOK_SECRET in .env first');
  process.exit(1);
}

console.log('setWebhook', await tg(token, 'setWebhook', {
  url: `${url}/api/tg/webhook/${secret}`,
  allowed_updates: ['message'],
  drop_pending_updates: true,
}));
console.log('menu button', await tg(token, 'setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Us App', web_app: { url } },
}));
console.log('commands', await tg(token, 'setMyCommands', {
  commands: [{ command: 'start', description: 'Открыть Us App' }],
}));
