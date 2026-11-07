import { randomBytes } from 'node:crypto';
import { db, now } from './db.js';
import { questionForDay } from './questions.js';
import { notify } from './bot.js';

const TZ_OFFSET = Number(process.env.TZ_OFFSET_HOURS ?? 3); // Europe/Minsk
const todayStr = () => new Date(Date.now() + TZ_OFFSET * 3600e3).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const CATEGORIES = [
  [/хлеб|багет|булк|батон|тартин|круассан/i, 'Пекарня'],
  [/сыр|пармезан|оливк|прошутто|вино|шоколад/i, 'Деликатесы'],
  [/молок|яйц|кофе|чай|сахар|масл|мяс|кур|рыб|овощ|фрукт|банан|яблок|картоф|круп|рис|макарон|вод/i, 'Продукты'],
  [/мыл|порош|шампун|паст|салфет|губк|бумаг|пакет/i, 'Дом'],
];
const guessCategory = (t) => CATEGORIES.find(([re]) => re.test(t))?.[1] ?? null;

const clean = (s, max = 300) => String(s ?? '').trim().slice(0, max);
const need = (v, msg = 'bad_request') => {
  if (!v) throw Object.assign(new Error(msg), { statusCode: 400 });
  return v;
};

export function registerRoutes(app, { botToken, webAppUrl, botUsername }) {
  const q = (sql) => db.prepare(sql);

  const getCouple = (cid) => q('SELECT * FROM couples WHERE id = ?').get(cid);
  const getPartner = (me) =>
    me.couple_id ? q('SELECT * FROM users WHERE couple_id = ? AND id != ?').get(me.couple_id, me.id) : null;
  const pub = (u) =>
    u && {
      id: u.id,
      name: u.name,
      first_name: u.name.split(' ')[0],
      username: u.username,
      photo_url: u.photo_url,
      online: !!u.last_seen && now() - u.last_seen < 120,
    };

  const firstName = (u) => u.name.split(' ')[0];

  /** Log to the feed and (optionally) ping the partner in Telegram. */
  function log(req, kind, text, { push = true } = {}) {
    const me = req.tgUser;
    q('INSERT INTO activity (couple_id, user_id, kind, text, created_at) VALUES (?,?,?,?,?)').run(
      me.couple_id, me.id, kind, text, now(),
    );
    if (push) {
      const p = getPartner(me);
      if (p) notify(botToken, p.id, `${firstName(me)} ${text}`, webAppUrl);
    }
  }

  const needCouple = async (req, reply) => {
    if (!req.tgUser.couple_id) return reply.code(403).send({ error: 'no_couple' });
  };
  const guarded = { preHandler: needCouple };

  // ---------- bootstrap / couple ----------
  app.get('/api/bootstrap', async (req) => {
    const me = req.tgUser;
    const couple = me.couple_id ? getCouple(me.couple_id) : null;
    return {
      me: pub(me),
      partner: pub(getPartner(me)),
      couple: couple && { id: couple.id, invite_code: couple.invite_code, start_date: couple.start_date },
      start_param: req.startParam,
      bot_username: botUsername || null,
      today: todayStr(),
    };
  });

  app.post('/api/couple/create', async (req) => {
    const me = req.tgUser;
    if (me.couple_id) return { code: getCouple(me.couple_id).invite_code };
    const code = randomBytes(6).toString('hex');
    const info = q('INSERT INTO couples (invite_code, created_at) VALUES (?, ?)').run(code, now());
    q('UPDATE users SET couple_id = ? WHERE id = ?').run(info.lastInsertRowid, me.id);
    return { code };
  });

  app.post('/api/couple/join', async (req, reply) => {
    const me = req.tgUser;
    const code = clean(req.body?.code, 40).replace(/^invite_/, '');
    const couple = q('SELECT * FROM couples WHERE invite_code = ?').get(code);
    if (!couple) return reply.code(404).send({ error: 'invalid_code' });
    if (me.couple_id === couple.id) return { ok: true };
    const members = q('SELECT COUNT(*) AS n FROM users WHERE couple_id = ?').get(couple.id).n;
    if (members >= 2) return reply.code(409).send({ error: 'couple_full' });
    // Leaving an empty own couple is fine; joining while already in another one is not.
    if (me.couple_id) {
      const own = q('SELECT COUNT(*) AS n FROM users WHERE couple_id = ?').get(me.couple_id).n;
      if (own > 1) return reply.code(409).send({ error: 'already_in_couple' });
    }
    q('UPDATE users SET couple_id = ? WHERE id = ?').run(couple.id, me.id);
    const partner = getPartner({ ...me, couple_id: couple.id });
    if (partner) notify(botToken, partner.id, `${firstName(me)} присоединился(ась) к вашему пространству 💛`, webAppUrl);
    return { ok: true };
  });

  app.post('/api/couple/start-date', guarded, async (req) => {
    const d = clean(req.body?.date, 10);
    need(/^\d{4}-\d{2}-\d{2}$/.test(d), 'bad_date');
    q('UPDATE couples SET start_date = ? WHERE id = ?').run(d, req.tgUser.couple_id);
    return { ok: true };
  });

  // ---------- today ----------
  app.get('/api/today', guarded, async (req) => {
    const me = req.tgUser;
    const cid = me.couple_id;
    const partner = getPartner(me);
    const day = todayStr();
    const couple = getCouple(cid);

    const moods = Object.fromEntries(
      q('SELECT user_id, mood FROM moods WHERE couple_id = ? AND day = ?').all(cid, day).map((r) => [r.user_id, r.mood]),
    );
    const answers = Object.fromEntries(
      q('SELECT user_id, text FROM answers WHERE couple_id = ? AND day = ?').all(cid, day).map((r) => [r.user_id, r.text]),
    );
    const mineAnswered = answers[me.id] != null;
    const partnerAnswered = partner ? answers[partner.id] != null : false;

    // upcoming events (yearly ones are projected onto the next occurrence)
    const upcoming = [];
    const consider = (title, date, time, kind, yearly) => {
      let d = date;
      if (yearly) {
        const [, m, dd] = date.split('-');
        d = `${day.slice(0, 4)}-${m}-${dd}`;
        if (d < day) d = `${Number(day.slice(0, 4)) + 1}-${m}-${dd}`;
      }
      const inDays = dayDiff(day, d);
      if (inDays >= 0 && inDays <= 90) upcoming.push({ title, date: d, time, kind, in_days: inDays });
    };
    for (const e of q('SELECT * FROM events WHERE couple_id = ?').all(cid)) consider(e.title, e.date, e.time, e.kind, e.yearly);
    if (couple.start_date) consider('Годовщина', couple.start_date, null, 'anniversary', 1);
    upcoming.sort((a, b) => a.in_days - b.in_days);

    const activity = q(
      'SELECT a.id, a.kind, a.text, a.created_at, u.name, u.id AS user_id, u.photo_url FROM activity a JOIN users u ON u.id = a.user_id WHERE a.couple_id = ? ORDER BY a.id DESC LIMIT 8',
    ).all(cid);

    return {
      day,
      days_together: couple.start_date ? Math.max(0, dayDiff(couple.start_date, day)) : null,
      start_date: couple.start_date,
      mood: { me: moods[me.id] ?? null, partner: partner ? moods[partner.id] ?? null : null },
      question: {
        text: questionForDay(day),
        my_answer: answers[me.id] ?? null,
        partner_answered: partnerAnswered,
        partner_answer: mineAnswered && partnerAnswered ? answers[partner.id] : null,
      },
      upcoming: upcoming.slice(0, 6),
      activity: activity.map((a) => ({ ...a, mine: a.user_id === me.id })),
    };
  });

  app.post('/api/mood', guarded, async (req) => {
    const mood = clean(req.body?.mood, 10);
    need(['great', 'ok', 'sad'].includes(mood), 'bad_mood');
    q('INSERT INTO moods (couple_id, user_id, day, mood) VALUES (?,?,?,?) ON CONFLICT(couple_id,user_id,day) DO UPDATE SET mood = excluded.mood')
      .run(req.tgUser.couple_id, req.tgUser.id, todayStr(), mood);
    return { ok: true };
  });

  app.post('/api/answer', guarded, async (req) => {
    const text = need(clean(req.body?.text, 600));
    const me = req.tgUser;
    q('INSERT INTO answers (couple_id, user_id, day, text) VALUES (?,?,?,?) ON CONFLICT(couple_id,user_id,day) DO UPDATE SET text = excluded.text')
      .run(me.couple_id, me.id, todayStr(), text);
    const partner = getPartner(me);
    if (partner) {
      const both = q('SELECT COUNT(*) AS n FROM answers WHERE couple_id = ? AND day = ?').get(me.couple_id, todayStr()).n === 2;
      notify(botToken, partner.id, both ? 'Вы оба ответили на вопрос дня — можно читать 💛' : `${firstName(me)} ответил(а) на вопрос дня. Теперь твой ход.`, webAppUrl);
    }
    return { ok: true };
  });

  // ---------- places ----------
  app.get('/api/places', guarded, async (req) =>
    q('SELECT p.*, u.name AS added_by_name FROM places p JOIN users u ON u.id = p.added_by WHERE p.couple_id = ? ORDER BY p.status = \'want\' DESC, p.id DESC')
      .all(req.tgUser.couple_id)
      .map((p) => ({ ...p, mine: p.added_by === req.tgUser.id })),
  );
  app.post('/api/places', guarded, async (req) => {
    const me = req.tgUser;
    const title = need(clean(req.body?.title, 120));
    const r = q('INSERT INTO places (couple_id, title, category, note, added_by, created_at) VALUES (?,?,?,?,?,?)')
      .run(me.couple_id, title, clean(req.body?.category, 40) || null, clean(req.body?.note, 300) || null, me.id, now());
    log(req, 'place', `добавил(а) место «${title}»`);
    return { id: r.lastInsertRowid };
  });
  app.post('/api/places/:id/visit', guarded, async (req) => {
    const b = req.body || {};
    const rating = b.rating ? Math.min(5, Math.max(1, Number(b.rating))) : null;
    q('UPDATE places SET status = \'visited\', rating = ?, want_return = ?, review = ?, visited_at = ? WHERE id = ? AND couple_id = ?')
      .run(rating, b.want_return ? 1 : 0, clean(b.review, 500) || null, clean(b.date, 10) || todayStr(), req.params.id, req.tgUser.couple_id);
    const p = q('SELECT title FROM places WHERE id = ?').get(req.params.id);
    if (p) log(req, 'visit', `отметил(а) посещение: «${p.title}»`, { push: false });
    return { ok: true };
  });
  app.patch('/api/places/:id', guarded, async (req) => {
    const b = req.body || {};
    q('UPDATE places SET title = COALESCE(?, title), category = COALESCE(?, category), note = COALESCE(?, note), status = COALESCE(?, status) WHERE id = ? AND couple_id = ?')
      .run(b.title ? clean(b.title, 120) : null, b.category ? clean(b.category, 40) : null, b.note != null ? clean(b.note, 300) : null, ['want', 'visited'].includes(b.status) ? b.status : null, req.params.id, req.tgUser.couple_id);
    return { ok: true };
  });
  app.delete('/api/places/:id', guarded, async (req) => {
    q('DELETE FROM places WHERE id = ? AND couple_id = ?').run(req.params.id, req.tgUser.couple_id);
    return { ok: true };
  });

  // ---------- shopping ----------
  app.get('/api/shopping', guarded, async (req) =>
    q('SELECT s.*, u.name AS done_by_name FROM shopping s LEFT JOIN users u ON u.id = s.done_by WHERE s.couple_id = ? ORDER BY s.done ASC, s.id DESC')
      .all(req.tgUser.couple_id),
  );
  app.post('/api/shopping', guarded, async (req) => {
    const me = req.tgUser;
    // allow "молоко, хлеб, яйца" in one go
    const items = clean(req.body?.title, 400).split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    need(items.length);
    const ins = q('INSERT INTO shopping (couple_id, title, category, added_by, created_at) VALUES (?,?,?,?,?)');
    for (const t of items) ins.run(me.couple_id, t.slice(0, 120), guessCategory(t), me.id, now());
    log(req, 'shopping', `добавил(а) в покупки: ${items.join(', ')}`, { push: false });
    return { ok: true, added: items.length };
  });
  app.patch('/api/shopping/:id', guarded, async (req) => {
    const me = req.tgUser;
    const done = req.body?.done ? 1 : 0;
    q('UPDATE shopping SET done = ?, done_by = ? WHERE id = ? AND couple_id = ?').run(done, done ? me.id : null, req.params.id, me.couple_id);
    return { ok: true };
  });
  app.delete('/api/shopping/:id', guarded, async (req) => {
    q('DELETE FROM shopping WHERE id = ? AND couple_id = ?').run(req.params.id, req.tgUser.couple_id);
    return { ok: true };
  });
  app.delete('/api/shopping', guarded, async (req) => {
    q('DELETE FROM shopping WHERE done = 1 AND couple_id = ?').run(req.tgUser.couple_id);
    return { ok: true };
  });

  // ---------- chores ----------
  app.get('/api/chores', guarded, async (req) =>
    q('SELECT * FROM chores WHERE couple_id = ? ORDER BY done ASC, id DESC').all(req.tgUser.couple_id),
  );
  app.post('/api/chores', guarded, async (req) => {
    const me = req.tgUser;
    const title = need(clean(req.body?.title, 160));
    const repeat = Number(req.body?.repeat_days) || null;
    q('INSERT INTO chores (couple_id, title, due_date, repeat_days, added_by, created_at) VALUES (?,?,?,?,?,?)')
      .run(me.couple_id, title, clean(req.body?.due_date, 10) || null, repeat, me.id, now());
    log(req, 'chore', `добавил(а) дело «${title}»`, { push: false });
    return { ok: true };
  });
  app.patch('/api/chores/:id', guarded, async (req) => {
    const me = req.tgUser;
    const done = req.body?.done ? 1 : 0;
    const c = q('SELECT * FROM chores WHERE id = ? AND couple_id = ?').get(req.params.id, me.couple_id);
    if (!c) return { ok: false };
    if (done && c.repeat_days) {
      // recurring: roll the due date forward instead of closing
      const base = c.due_date && c.due_date > todayStr() ? c.due_date : todayStr();
      const next = new Date(Date.parse(base + 'T00:00:00Z') + c.repeat_days * 86400000).toISOString().slice(0, 10);
      q('UPDATE chores SET due_date = ?, done = 0, done_by = NULL WHERE id = ?').run(next, c.id);
    } else {
      q('UPDATE chores SET done = ?, done_by = ? WHERE id = ?').run(done, done ? me.id : null, c.id);
    }
    return { ok: true };
  });
  app.delete('/api/chores/:id', guarded, async (req) => {
    q('DELETE FROM chores WHERE id = ? AND couple_id = ?').run(req.params.id, req.tgUser.couple_id);
    return { ok: true };
  });

  // ---------- recipes ----------
  app.get('/api/recipes', guarded, async (req) =>
    q('SELECT * FROM recipes WHERE couple_id = ? ORDER BY id DESC').all(req.tgUser.couple_id),
  );
  app.post('/api/recipes', guarded, async (req) => {
    const me = req.tgUser;
    const title = need(clean(req.body?.title, 120));
    q('INSERT INTO recipes (couple_id, title, note, added_by, created_at) VALUES (?,?,?,?,?)')
      .run(me.couple_id, title, clean(req.body?.note, 600) || null, me.id, now());
    log(req, 'recipe', `сохранил(а) рецепт «${title}»`, { push: false });
    return { ok: true };
  });
  app.delete('/api/recipes/:id', guarded, async (req) => {
    q('DELETE FROM recipes WHERE id = ? AND couple_id = ?').run(req.params.id, req.tgUser.couple_id);
    return { ok: true };
  });

  // ---------- wishlist (gifts are secret from the owner) ----------
  app.get('/api/wishes', guarded, async (req) => {
    const me = req.tgUser;
    return q('SELECT * FROM wishes WHERE couple_id = ? ORDER BY id DESC').all(me.couple_id).map((w) => {
      const mine = w.owner_id === me.id;
      return {
        id: w.id, kind: w.kind, title: w.title, price: w.price, url: w.url, image_url: w.image_url,
        mine,
        // the owner never learns about a claim; only the giver sees their own claim
        claimed_by_me: !mine && w.claimed_by === me.id,
      };
    });
  });
  app.post('/api/wishes', guarded, async (req) => {
    const me = req.tgUser;
    const title = need(clean(req.body?.title, 140));
    const kind = ['gift', 'watch', 'dream'].includes(req.body?.kind) ? req.body.kind : 'gift';
    q('INSERT INTO wishes (couple_id, owner_id, kind, title, price, url, image_url, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(me.couple_id, me.id, kind, title, clean(req.body?.price, 40) || null, clean(req.body?.url, 500) || null, clean(req.body?.image_url, 500) || null, now());
    log(req, 'wish', kind === 'gift' ? 'добавил(а) что-то в вишлист' : `добавил(а) в вишлист «${title}»`, { push: kind !== 'gift' });
    return { ok: true };
  });
  app.post('/api/wishes/:id/claim', guarded, async (req, reply) => {
    const me = req.tgUser;
    const w = q('SELECT * FROM wishes WHERE id = ? AND couple_id = ?').get(req.params.id, me.couple_id);
    if (!w) return reply.code(404).send({ error: 'not_found' });
    if (w.owner_id === me.id) return reply.code(400).send({ error: 'own_wish' });
    q('UPDATE wishes SET claimed_by = ? WHERE id = ?').run(w.claimed_by === me.id ? null : me.id, w.id);
    return { ok: true };
  });
  app.delete('/api/wishes/:id', guarded, async (req) => {
    q('DELETE FROM wishes WHERE id = ? AND owner_id = ?').run(req.params.id, req.tgUser.id);
    return { ok: true };
  });

  // ---------- notes (love notes, can be time-locked) ----------
  app.get('/api/notes', guarded, async (req) => {
    const me = req.tgUser;
    return q('SELECT n.*, u.name AS from_name FROM notes n JOIN users u ON u.id = n.from_user WHERE n.couple_id = ? ORDER BY n.id DESC LIMIT 100')
      .all(me.couple_id)
      .map((n) => {
        const mine = n.from_user === me.id;
        const locked = !mine && n.open_at && n.open_at > now();
        return { id: n.id, mine, from_name: n.from_name, text: locked ? null : n.text, locked, open_at: n.open_at, created_at: n.created_at };
      });
  });
  app.post('/api/notes', guarded, async (req) => {
    const me = req.tgUser;
    const text = need(clean(req.body?.text, 1000));
    const openAt = req.body?.open_at ? Math.floor(Number(req.body.open_at)) : null;
    q('INSERT INTO notes (couple_id, from_user, text, open_at, created_at) VALUES (?,?,?,?,?)').run(me.couple_id, me.id, text, openAt, now());
    const p = getPartner(me);
    if (p) notify(botToken, p.id, openAt && openAt > now() ? `${firstName(me)} оставил(а) для тебя записку-сюрприз. Откроется в своё время 💌` : `${firstName(me)} оставил(а) для тебя записку 💌`, webAppUrl);
    return { ok: true };
  });
  app.delete('/api/notes/:id', guarded, async (req) => {
    q('DELETE FROM notes WHERE id = ? AND from_user = ?').run(req.params.id, req.tgUser.id);
    return { ok: true };
  });

  // ---------- events / calendar ----------
  app.get('/api/events', guarded, async (req) =>
    q('SELECT * FROM events WHERE couple_id = ? ORDER BY date ASC').all(req.tgUser.couple_id),
  );
  app.post('/api/events', guarded, async (req) => {
    const me = req.tgUser;
    const title = need(clean(req.body?.title, 120));
    const date = clean(req.body?.date, 10);
    need(/^\d{4}-\d{2}-\d{2}$/.test(date), 'bad_date');
    q('INSERT INTO events (couple_id, title, date, time, kind, yearly, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(me.couple_id, title, date, clean(req.body?.time, 5) || null, clean(req.body?.kind, 20) || null, req.body?.yearly ? 1 : 0, me.id);
    log(req, 'event', `добавил(а) событие «${title}»`);
    return { ok: true };
  });
  app.delete('/api/events/:id', guarded, async (req) => {
    q('DELETE FROM events WHERE id = ? AND couple_id = ?').run(req.params.id, req.tgUser.couple_id);
    return { ok: true };
  });
}
