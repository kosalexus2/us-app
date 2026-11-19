import dns from 'node:dns/promises';
import net from 'node:net';
import { db, now } from './db.js';
import { hooks, notify } from './bot.js';

// Люди и их календари: карточка человека (партнёр/друг/я), вишлист по ссылкам с превью,
// личный календарь, предложения изменений с подтверждением, права и напоминания от бота.

const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 3);
const q = (sql) => db.prepare(sql);

db.exec(`
CREATE TABLE IF NOT EXISTS cal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  note TEXT,
  remind_min INTEGER,
  reminded INTEGER NOT NULL DEFAULT 0,
  with_id INTEGER,
  private INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_owner ON cal(owner_id, date);
CREATE TABLE IF NOT EXISTS cal_prop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  from_id INTEGER NOT NULL,
  cal_id INTEGER,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prop_owner ON cal_prop(owner_id, status);
CREATE TABLE IF NOT EXISTS perm (
  owner_id INTEGER NOT NULL,
  viewer_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (owner_id, viewer_id)
);
CREATE TABLE IF NOT EXISTS friendships (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
`);

for (const col of ['url', 'image_url']) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('recipes') WHERE name = ?").get(col)) {
    db.exec(`ALTER TABLE recipes ADD COLUMN ${col} TEXT`);
  }
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEVELS = ['view', 'propose', 'edit'];
const bad = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code, appError: true });
/** Оборачивает обработчик: наши ошибки отдаём как {error: '...'}, понятные интерфейсу. */
const h = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply);
  } catch (e) {
    if (e.appError) return reply.code(e.statusCode).send({ error: e.message });
    throw e;
  }
};

const dateStr = (offDays = 0) => new Date(Date.now() + TZ * 3600e3 + offDays * 86400e3).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const human = (date, time) => {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${time ? `, ${time}` : ''}`;
};
const eventTs = (c) => {
  const [y, m, d] = c.date.split('-').map(Number);
  const [h, mi] = (c.time || '09:00').split(':').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d, h, mi) - TZ * 3600e3) / 1000);
};

const first = (u) => u.name.split(' ')[0];
const pub = (u) => ({
  id: u.id,
  name: u.name,
  first_name: first(u),
  username: u.username,
  photo_url: u.photo_url,
  online: !!u.last_seen && now() - u.last_seen < 120,
});

/** self | partner | friend | null (нет связи: чужой профиль недоступен). */
function relation(me, otherId) {
  if (me.id === otherId) return 'self';
  const other = q('SELECT * FROM users WHERE id = ?').get(otherId);
  if (!other) return null;
  if (me.couple_id && other.couple_id === me.couple_id) return 'partner';
  if (q('SELECT 1 FROM friendships WHERE a = ? AND b = ?').get(me.id, otherId)) return 'friend';
  return null;
}
/** Что viewer может делать в календаре owner: view | propose | edit. По умолчанию propose. */
function level(ownerId, viewerId) {
  if (ownerId === viewerId) return 'edit';
  return q('SELECT level FROM perm WHERE owner_id = ? AND viewer_id = ?').get(ownerId, viewerId)?.level || 'propose';
}

// ---------- превью ссылок (og-теги) с защитой от обращений во внутреннюю сеть ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:') && net.isIPv4(l.slice(7))) return isPrivateIp(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
  }
  return true;
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw bad('bad_url');
  if (u.port && !['80', '443'].includes(u.port)) throw bad('bad_url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw bad('bad_url');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw bad('bad_url');
    return;
  }
  const r = await dns.lookup(host, { all: true });
  if (!r.length || r.some((x) => isPrivateIp(x.address))) throw bad('bad_url');
}
const BOT_UA = 'TelegramBot (like TwitterBot)';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
async function fetchHtml(url, ua = BOT_UA) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    const res = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': ua, accept: 'text/html,*/*;q=0.8', 'accept-language': 'ru,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location'), u);
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/html|xml/i.test(type)) return { html: '', url: u.href };
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < 600_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    return { html: Buffer.concat(chunks).toString('utf8'), url: u.href };
  }
  return { html: '', url: u.href };
}
const unescapeHtml = (s) =>
  s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
function metaOf(html, names) {
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !names.includes(key)) continue;
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = content && (content[1] ?? content[2]);
    if (v) return unescapeHtml(v).trim();
  }
  return '';
}
// Картинка из разметки schema.org (JSON-LD): у многих магазинов нет og:image, зато есть Product.image.
function jsonLdImage(html) {
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const pick = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) { for (const x of v) { const r = pick(x); if (r) return r; } return ''; }
    if (typeof v === 'object') return pick(v.url || v.contentUrl || '');
    return '';
  };
  const walk = (n, depth = 0) => {
    if (!n || depth > 6) return '';
    if (Array.isArray(n)) { for (const x of n) { const r = walk(x, depth + 1); if (r) return r; } return ''; }
    if (typeof n !== 'object') return '';
    const r = pick(n.image);
    if (r) return r;
    return walk(n['@graph'], depth + 1) || walk(n.mainEntity, depth + 1) || walk(n.itemListElement, depth + 1);
  };
  while ((m = re.exec(html))) {
    try { const r = walk(JSON.parse(m[1].trim())); if (r) return r; } catch { /* битый JSON — идём дальше */ }
  }
  return '';
}
function linkRelImage(html) {
  const m = /<link[^>]+rel\s*=\s*["']image_src["'][^>]*>/i.exec(html);
  const h = m && /href\s*=\s*["']([^"']+)["']/i.exec(m[0]);
  return h ? unescapeHtml(h[1]).trim() : '';
}
const previewCache = new Map();
async function linkPreview(raw) {
  let url = clean(raw, 800);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) throw bad('bad_url');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u;
  try { u = new URL(url); } catch { throw bad('bad_url'); }
  if (previewCache.has(u.href)) return previewCache.get(u.href);
  let out = { url: u.href, title: '', image: '', site: u.hostname.replace(/^www\./, ''), price: '' };
  try {
    let { html, url: finalUrl } = await fetchHtml(u.href);
    const hasImage = (h) => !!(h && (metaOf(h, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) || jsonLdImage(h) || linkRelImage(h)));
    if (!hasImage(html)) {
      // некоторые магазины отдают превью только обычному браузеру, пробуем ещё раз так
      try { const r2 = await fetchHtml(u.href, BROWSER_UA); if (hasImage(r2.html) || (!html && r2.html)) { html = r2.html; finalUrl = r2.url; } } catch { /* оставляем первый ответ */ }
    }
    if (html) {
      const base = new URL(finalUrl);
      const title = metaOf(html, ['og:title', 'twitter:title']) || unescapeHtml(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '').trim();
      let image = metaOf(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) || jsonLdImage(html) || linkRelImage(html);
      if (image) {
        try {
          const iu = new URL(image, base);
          if (iu.protocol === 'http:') iu.protocol = 'https:';
          image = iu.href;
        } catch { image = ''; }
      }
      const amount = metaOf(html, ['product:price:amount', 'og:price:amount']);
      const cur = metaOf(html, ['product:price:currency', 'og:price:currency']);
      out = {
        url: base.href,
        title: title.slice(0, 160),
        image: image.slice(0, 600),
        site: (metaOf(html, ['og:site_name']) || base.hostname.replace(/^www\./, '')).slice(0, 60),
        price: amount ? `${amount}${cur ? ' ' + cur : ''}`.slice(0, 40) : '',
      };
    }
  } catch (e) {
    if (e.statusCode) throw e;
  }
  if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(u.href, out);
  return out;
}

hooks.linkPreview = linkPreview; // бот берёт отсюда разбор присланных ссылок

// ---------- модуль ----------
export function registerSocial(api, { botToken, webAppUrl }) {
  const push = (userId, text) => notify(botToken, userId, text, webAppUrl);

  const calOut = (c, extra = {}) => ({
    id: c.id, title: c.title, date: c.date, time: c.time, note: c.note, remind_min: c.remind_min, private: c.private,
    with_name: c.with_id ? q('SELECT name FROM users WHERE id = ?').get(c.with_id)?.name?.split(' ')[0] || null : null,
    pending: q("SELECT COUNT(*) AS n FROM cal_prop WHERE cal_id = ? AND status = 'pending'").get(c.id).n,
    ...extra,
  });

  function readFields(body, { partial = false } = {}) {
    const f = {};
    if (!partial || body.title !== undefined) {
      f.title = clean(body.title, 140);
      if (!f.title) throw bad('title_required');
    }
    if (!partial || body.date !== undefined) {
      f.date = clean(body.date, 10);
      if (!DATE_RE.test(f.date)) throw bad('bad_date');
    }
    if (!partial || body.time !== undefined) {
      const t = clean(body.time, 5);
      if (t && !TIME_RE.test(t)) throw bad('bad_time');
      f.time = t || null;
    }
    if (body.note !== undefined) f.note = clean(body.note, 500) || null;
    if (body.remind_min !== undefined) {
      const r = body.remind_min === null || body.remind_min === '' ? null : Number(body.remind_min);
      if (r !== null && !(r >= 0 && r <= 10080)) throw bad('bad_remind');
      f.remind_min = r;
    }
    if (body.private !== undefined) f.private = body.private ? 1 : 0;
    return f;
  }

  function insertCal(ownerId, createdBy, f, withId = null) {
    return q('INSERT INTO cal (owner_id, title, date, time, note, remind_min, with_id, private, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(ownerId, f.title, f.date, f.time ?? null, f.note ?? null, f.remind_min ?? null, withId, f.private ?? 0, createdBy, now()).lastInsertRowid;
  }
  function updateCal(id, f) {
    const cols = Object.keys(f);
    if (!cols.length) return;
    const reset = 'date' in f || 'time' in f || 'remind_min' in f ? ', reminded = 0' : '';
    q(`UPDATE cal SET ${cols.map((c) => `${c} = ?`).join(', ')}${reset} WHERE id = ?`).run(...cols.map((c) => f[c]), id);
  }

  // Карточка человека
  api.get('/api/people/:id', h(async (req, reply) => {
    const me = req.tgUser;
    const id = Number(req.params.id);
    const rel = relation(me, id);
    if (!rel) return reply.code(404).send({ error: 'not_found' });
    const u = q('SELECT * FROM users WHERE id = ?').get(id);
    const self = rel === 'self';
    const wishes = q('SELECT * FROM wishes WHERE owner_id = ? ORDER BY id DESC').all(id).map((w) => ({
      id: w.id, kind: w.kind, title: w.title, price: w.price, url: w.url, image_url: w.image_url,
      claimed_by_me: !self && w.claimed_by === me.id,
      taken: !self && !!w.claimed_by && w.claimed_by !== me.id,
    }));
    const cal = q('SELECT * FROM cal WHERE owner_id = ? AND date >= ? ORDER BY date, COALESCE(time, \'99:99\'), id').all(id, dateStr(-1))
      .filter((c) => self || !c.private)
      .map((c) => calOut(c));
    return {
      user: pub(u), relation: rel, today: dateStr(0), wishes, cal,
      grant: self ? 'edit' : level(me.id, id), // что я разрешил этому человеку в моём календаре
      can: self ? 'edit' : level(id, me.id), //   что он разрешил мне в своём
    };
  }));

  api.post('/api/link-preview', h(async (req) => linkPreview(req.body?.url)));

  api.post('/api/people/:id/wishes/:wid/claim', h(async (req, reply) => {
    const me = req.tgUser;
    const id = Number(req.params.id);
    const rel = relation(me, id);
    if (!rel || rel === 'self') return reply.code(400).send({ error: 'own_wish' });
    const w = q('SELECT * FROM wishes WHERE id = ? AND owner_id = ?').get(req.params.wid, id);
    if (!w) return reply.code(404).send({ error: 'not_found' });
    if (w.claimed_by && w.claimed_by !== me.id) return reply.code(409).send({ error: 'already_taken' });
    q('UPDATE wishes SET claimed_by = ? WHERE id = ?').run(w.claimed_by === me.id ? null : me.id, w.id);
    return { ok: true };
  }));

  // Права: что я разрешаю человеку в своём календаре
  api.post('/api/perm', h(async (req, reply) => {
    const me = req.tgUser;
    const viewer = Number(req.body?.viewer_id);
    const lvl = String(req.body?.level || '');
    if (!LEVELS.includes(lvl)) throw bad('bad_level');
    const rel = relation(me, viewer);
    if (!rel || rel === 'self') return reply.code(404).send({ error: 'not_found' });
    q('INSERT INTO perm (owner_id, viewer_id, level) VALUES (?,?,?) ON CONFLICT(owner_id, viewer_id) DO UPDATE SET level = excluded.level').run(me.id, viewer, lvl);
    return { ok: true };
  }));

  // Календарь: своё добавляется сразу, в чужое по правам либо сразу, либо предложением
  function applyOrPropose(me, ownerId, fields, calId) {
    const rel = relation(me, ownerId);
    if (!rel) throw bad('not_found', 404);
    let item = null;
    if (calId) {
      item = q('SELECT * FROM cal WHERE id = ? AND owner_id = ?').get(calId, ownerId);
      if (!item || (ownerId !== me.id && item.private)) throw bad('not_found', 404);
    }
    if (ownerId === me.id) {
      if (item) updateCal(item.id, fields);
      else insertCal(me.id, me.id, fields);
      return { ok: true, direct: true };
    }
    const lvl = level(ownerId, me.id);
    if (lvl === 'view') throw bad('view_only', 403);
    if (lvl === 'edit') {
      if (item) updateCal(item.id, fields);
      else insertCal(ownerId, me.id, fields, me.id);
      push(ownerId, `${first(me)} ${item ? 'изменил(а)' : 'добавил(а)'} в вашем календаре: «${fields.title ?? item.title}», ${human(fields.date ?? item.date, fields.time === undefined ? item.time : fields.time)}`);
      return { ok: true, direct: true };
    }
    const merged = { title: item?.title, date: item?.date, time: item?.time, note: item?.note, ...fields };
    q('INSERT INTO cal_prop (owner_id, from_id, cal_id, title, date, time, note, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(ownerId, me.id, item?.id ?? null, merged.title, merged.date, merged.time ?? null, merged.note ?? null, now());
    push(ownerId, `${first(me)} предлагает${item ? ` вместо «${item.title}»` : ''}: «${merged.title}», ${human(merged.date, merged.time)}. Откройте приложение, чтобы принять или отклонить.`);
    return { ok: true, proposed: true };
  }

  api.post('/api/cal', h(async (req, reply) => {
    const me = req.tgUser;
    const ownerId = Number(req.body?.owner_id || me.id);
    const calId = req.body?.replace_id ? Number(req.body.replace_id) : null;
    return applyOrPropose(me, ownerId, readFields(req.body || {}), calId);
  }));
  api.patch('/api/cal/:id', h(async (req, reply) => {
    const me = req.tgUser;
    const item = q('SELECT * FROM cal WHERE id = ?').get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return applyOrPropose(me, item.owner_id, readFields(req.body || {}, { partial: true }), item.id);
  }));
  api.delete('/api/cal/:id', h(async (req, reply) => {
    const me = req.tgUser;
    const item = q('SELECT * FROM cal WHERE id = ?').get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.owner_id !== me.id) {
      if (!relation(me, item.owner_id) || level(item.owner_id, me.id) !== 'edit') return reply.code(403).send({ error: 'view_only' });
      push(item.owner_id, `${first(me)} удалил(а) из вашего календаря «${item.title}»`);
    }
    q('DELETE FROM cal WHERE id = ?').run(item.id);
    q("UPDATE cal_prop SET status = 'declined' WHERE cal_id = ? AND status = 'pending'").run(item.id);
    return { ok: true };
  }));

  // Входящие предложения
  api.get('/api/inbox', h(async (req, reply) => {
    const me = req.tgUser;
    const rows = q("SELECT * FROM cal_prop WHERE owner_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 50").all(me.id);
    const proposals = rows.map((p) => {
      const from = q('SELECT * FROM users WHERE id = ?').get(p.from_id);
      const old = p.cal_id ? q('SELECT * FROM cal WHERE id = ?').get(p.cal_id) : null;
      return {
        id: p.id, from: from && pub(from), kind: old ? 'change' : 'new',
        old_title: old?.title ?? null, old_date: old?.date ?? null, old_time: old?.time ?? null,
        title: p.title, date: p.date, time: p.time, note: p.note, created_at: p.created_at,
      };
    });
    return { count: proposals.length, proposals };
  }));
  api.post('/api/proposals/:id/:action', h(async (req, reply) => {
    const me = req.tgUser;
    const action = req.params.action;
    if (!['accept', 'decline'].includes(action)) return reply.code(404).send({ error: 'not_found' });
    const p = q("SELECT * FROM cal_prop WHERE id = ? AND owner_id = ? AND status = 'pending'").get(req.params.id, me.id);
    if (!p) return reply.code(404).send({ error: 'not_found' });
    if (action === 'decline') {
      q("UPDATE cal_prop SET status = 'declined' WHERE id = ?").run(p.id);
      push(p.from_id, `${first(me)} отклонил(а) ваше предложение «${p.title}»`);
      return { ok: true };
    }
    const f = { title: p.title, date: p.date, time: p.time, note: p.note };
    const old = p.cal_id ? q('SELECT * FROM cal WHERE id = ?').get(p.cal_id) : null;
    if (old) {
      updateCal(old.id, f);
    } else {
      insertCal(me.id, p.from_id, f, p.from_id);
      insertCal(p.from_id, p.from_id, f, me.id); // у предложившего встреча тоже появляется
    }
    q("UPDATE cal_prop SET status = 'accepted' WHERE id = ?").run(p.id);
    push(p.from_id, `${first(me)} принял(а) ваше предложение: «${p.title}», ${human(p.date, p.time)} 🎉`);
    return { ok: true };
  }));

  // Ближайшее из календарей (мой и партнёра) добавляем в «Сегодня», фронтенд менять не нужно
  api.addHook('onSend', async (req, reply, payload) => {
    if (req.method !== 'GET' || req.routeOptions?.url !== '/api/today' || typeof payload !== 'string') return payload;
    try {
      const me = req.tgUser;
      if (!me) return payload;
      const data = JSON.parse(payload);
      if (!Array.isArray(data.upcoming)) return payload;
      const partner = me.couple_id ? q('SELECT * FROM users WHERE couple_id = ? AND id != ?').get(me.couple_id, me.id) : null;
      const ids = [me.id, ...(partner ? [partner.id] : [])];
      const today = dateStr(0);
      const rows = q(`SELECT * FROM cal WHERE owner_id IN (${ids.map(() => '?').join(',')}) AND date >= ? AND date <= ?`).all(...ids, today, dateStr(30))
        .filter((c) => c.owner_id === me.id || !c.private);
      const seen = new Set();
      const extra = [];
      for (const c of rows) {
        const key = `${c.title}|${c.date}|${c.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        extra.push({
          title: c.owner_id === me.id ? c.title : `${first(partner)}: ${c.title}`,
          date: c.date, time: c.time, kind: 'cal', in_days: dayDiff(today, c.date),
        });
      }
      data.upcoming = [...data.upcoming, ...extra]
        .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))
        .slice(0, 10);
      return JSON.stringify(data);
    } catch {
      return payload;
    }
  });

  // Напоминания: раз в 30 секунд проверяем, кому пора напомнить
  const timer = setInterval(() => {
    try {
      const rows = q('SELECT * FROM cal WHERE remind_min IS NOT NULL AND reminded = 0 AND date >= ?').all(dateStr(-1));
      for (const c of rows) {
        const ts = eventTs(c);
        if (now() < ts - c.remind_min * 60) continue;
        q('UPDATE cal SET reminded = 1 WHERE id = ?').run(c.id);
        if (now() - ts > 6 * 3600) continue; // давно прошло, не беспокоим
        const when = c.remind_min === 0 ? 'сейчас' : c.date === dateStr(0) ? `сегодня${c.time ? ` в ${c.time}` : ''}` : human(c.date, c.time);
        push(c.owner_id, `⏰ Напоминание: «${c.title}», ${when}`);
      }
    } catch (e) {
      console.error('reminder loop', e.message);
    }
  }, 30000);
  timer.unref?.();
}
