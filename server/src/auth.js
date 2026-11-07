import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, now } from './db.js';

const MAX_AGE = 7 * 24 * 3600;

/** Validate Telegram WebApp initData. Returns {user, startParam} or null. */
export function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now() - authDate > MAX_AGE) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user?.id) return null;
    return { user, startParam: params.get('start_param') || null };
  } catch {
    return null;
  }
}

const upsertUser = db.prepare(`
  INSERT INTO users (id, name, username, photo_url, last_seen)
  VALUES (@id, @name, @username, @photo_url, @now)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, username = excluded.username,
    photo_url = COALESCE(excluded.photo_url, users.photo_url),
    last_seen = excluded.last_seen
`);

export function authHook(botToken, devMode) {
  return async function auth(req, reply) {
    let tg = null;
    const initData = req.headers['x-init-data'];
    if (initData) tg = validateInitData(String(initData), botToken);
    if (!tg && devMode && req.headers['x-dev-user']) {
      // Local development only (DEV_MODE=1). Never enable in production.
      const [id, name] = String(req.headers['x-dev-user']).split(':');
      tg = { user: { id: Number(id), first_name: name || `Dev${id}` }, startParam: null };
    }
    if (!tg) return reply.code(401).send({ error: 'unauthorized' });
    const u = tg.user;
    upsertUser.run({
      id: u.id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id),
      username: u.username || null,
      photo_url: u.photo_url || null,
      now: now(),
    });
    req.tgUser = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    req.startParam = tg.startParam;
  };
}
