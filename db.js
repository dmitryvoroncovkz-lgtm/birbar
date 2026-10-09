const Database = require('better-sqlite3');
const db = new Database('birbar.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friendships (
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    drink TEXT NOT NULL,
    lat REAL,
    lng REAL,
    photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Миграция: если колонки photo_url вдруг нет — добавим
const cols = db.prepare("PRAGMA table_info(checkins)").all();
if (!cols.some(c => c.name === 'photo_url')) {
  db.exec("ALTER TABLE checkins ADD COLUMN photo_url TEXT");
}

module.exports = db;