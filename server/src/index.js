import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authHook } from './auth.js';
import { registerRoutes } from './routes.js';
import { handleUpdate } from './bot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = process.env;
const botToken = env.BOT_TOKEN || '';
const devMode = env.DEV_MODE === '1';
const webAppUrl = env.WEBAPP_URL || 'https://usapp.kosalexus.by';
const botUsername = env.BOT_USERNAME || '';
const webhookSecret = env.WEBHOOK_SECRET || '';
const port = Number(env.PORT || 3100);
const host = env.HOST || '127.0.0.1';

if (devMode && env.NODE_ENV === 'production') {
  console.error('DEV_MODE=1 is forbidden when NODE_ENV=production (it bypasses Telegram signature checks)');
  process.exit(1);
}
if (!botToken && !devMode) {
  console.error('BOT_TOKEN is required (or DEV_MODE=1 for local development)');
  process.exit(1);
}

const app = Fastify({ logger: { level: env.LOG_LEVEL || 'info' }, trustProxy: true, bodyLimit: 256 * 1024 });

// Treat an empty JSON body as {} (some actions are body-less POSTs).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch {
    const err = new Error('bad_json');
    err.statusCode = 400;
    done(err);
  }
});

app.get('/api/health', async () => ({ ok: true }));

// Telegram webhook: path contains a secret so nobody else can post updates.
app.post('/api/tg/webhook/:secret', async (req, reply) => {
  if (!webhookSecret || req.params.secret !== webhookSecret) return reply.code(404).send();
  handleUpdate(botToken, webAppUrl, req.body).catch((e) => req.log.error(e));
  return { ok: true };
});

// Authenticated API
await app.register(async (api) => {
  api.addHook('preHandler', authHook(botToken, devMode));
  registerRoutes(api, { botToken, webAppUrl, botUsername });
});

app.setErrorHandler((err, req, reply) => {
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err);
  reply.code(500).send({ error: 'server_error' });
});

// Static frontend (built by `npm run build` in /web)
const dist = resolve(__dirname, '../../web/dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, {
    root: dist,
    cacheControl: false,
    // hashed assets can be cached; index.html must always be revalidated so updates show up at once
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port, host });
