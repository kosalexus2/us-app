import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DB_PATH || './data/us-app.db';
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS couples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code TEXT UNIQUE NOT NULL,
  start_date TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,            -- Telegram user id
  name TEXT NOT NULL,
  username TEXT,
  photo_url TEXT,
  couple_id INTEGER REFERENCES couples(id),
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'want',   -- want | visited
  rating REAL,
  want_return INTEGER NOT NULL DEFAULT 0,
  visited_at TEXT,
  review TEXT,
  added_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shopping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER,
  added_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER,
  due_date TEXT,
  repeat_days INTEGER,
  added_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  added_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gift',     -- gift | watch | dream
  title TEXT NOT NULL,
  price TEXT,
  url TEXT,
  image_url TEXT,
  claimed_by INTEGER,                    -- the giver; never shown to owner
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  from_user INTEGER NOT NULL,
  text TEXT NOT NULL,
  open_at INTEGER,                       -- unix seconds; null = open now
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  time TEXT,
  kind TEXT,
  yearly INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS moods (
  couple_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  mood TEXT NOT NULL,
  PRIMARY KEY (couple_id, user_id, day)
);
CREATE TABLE IF NOT EXISTS answers (
  couple_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (couple_id, user_id, day)
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_c ON places(couple_id);
CREATE INDEX IF NOT EXISTS idx_shopping_c ON shopping(couple_id);
CREATE INDEX IF NOT EXISTS idx_chores_c ON chores(couple_id);
CREATE INDEX IF NOT EXISTS idx_wishes_c ON wishes(couple_id);
CREATE INDEX IF NOT EXISTS idx_activity_c ON activity(couple_id, id DESC);
`);

export const now = () => Math.floor(Date.now() / 1000);
