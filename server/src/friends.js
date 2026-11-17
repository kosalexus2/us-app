import { randomBytes } from 'node:crypto';
import { db, now } from './db.js';
import { notify } from './bot.js';

// Друзья: у каждого человека свой код-приглашение, дружба взаимная. Не зависит от пары.
db.exec(`CREATE TABLE IF NOT EXISTS friendships (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
)`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'friend_code'").get()) {
  db.exec('ALTER TABLE users ADD COLUMN friend_code TEXT');
}

const pub = (u) => ({
  id: u.id,
  name: u.name,
  first_name: u.name.split(' ')[0],
  username: u.username,
  photo_url: u.photo_url,
  online: !!u.last_seen && now() - u.last_seen < 120,
});

export function registerFriends(api, { botToken, webAppUrl }) {
  const ensureCode = (me) => {
    if (me.friend_code) return me.friend_code;
    const code = randomBytes(6).toString('hex');
    db.prepare('UPDATE users SET friend_code = ? WHERE id = ?').run(code, me.id);
    return code;
  };

  api.get('/api/friends', async (req) => {
    const me = req.tgUser;
    const code = ensureCode(me);
    const friends = db
      .prepare('SELECT u.* FROM friendships f JOIN users u ON u.id = f.b WHERE f.a = ? ORDER BY f.created_at DESC')
      .all(me.id)
      .map(pub);
    return { code, friends };
  });

  api.post('/api/friends/join', async (req, reply) => {
    const me = req.tgUser;
    const code = String(req.body?.code ?? '').trim().replace(/^friend_/, '').slice(0, 40);
    const owner = code ? db.prepare('SELECT * FROM users WHERE friend_code = ?').get(code) : null;
    if (!owner) return reply.code(404).send({ error: 'invalid_code' });
    if (owner.id === me.id) return reply.code(400).send({ error: 'self' });
    const ins = db.prepare('INSERT OR IGNORE INTO friendships (a, b, created_at) VALUES (?, ?, ?)');
    const r1 = ins.run(me.id, owner.id, now());
    ins.run(owner.id, me.id, now());
    if (r1.changes > 0) {
      notify(botToken, owner.id, `${me.name.split(' ')[0]} теперь в ваших друзьях в Us App 💛`, webAppUrl);
    }
    return { ok: true, friend: pub(owner) };
  });

  // Кто приглашает: для экрана «Вас приглашают». Код вида friend_<код> или invite_<код>.
  api.get('/api/invite/:code', async (req, reply) => {
    const param = String(req.params.code || '').slice(0, 60);
    if (param.startsWith('friend_')) {
      const owner = db.prepare('SELECT * FROM users WHERE friend_code = ?').get(param.slice(7));
      if (!owner) return reply.code(404).send({ error: 'invalid_code' });
      return { kind: 'friend', from: pub(owner), full: false, self: owner.id === req.tgUser.id };
    }
    const couple = db.prepare('SELECT * FROM couples WHERE invite_code = ?').get(param.replace(/^invite_/, ''));
    const owner = couple ? db.prepare('SELECT * FROM users WHERE couple_id = ? ORDER BY id LIMIT 1').get(couple.id) : null;
    if (!owner) return reply.code(404).send({ error: 'invalid_code' });
    const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE couple_id = ?').get(couple.id).n;
    const mine = req.tgUser.couple_id === couple.id;
    return { kind: 'partner', from: pub(owner), full: n >= 2 && !mine, self: mine };
  });

  api.delete('/api/friends/:id', async (req) => {
    const me = req.tgUser;
    const id = Number(req.params.id);
    const del = db.prepare('DELETE FROM friendships WHERE a = ? AND b = ?');
    del.run(me.id, id);
    del.run(id, me.id);
    return { ok: true };
  });
}
