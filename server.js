require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// === Папка для фото ===
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// === Multer ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = Date.now() + '-' + Math.random().toString(36).substring(2, 8) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|gif)/.test(file.mimetype);
    cb(ok ? null : new Error('Только изображения'), ok);
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Неверный токен' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Заполни всё' });

  const hash = await bcrypt.hash(password, 10);
  const inviteCode = generateInviteCode();

  try {
    const stmt = db.prepare('INSERT INTO users (username, password, invite_code) VALUES (?, ?, ?)');
    const result = stmt.run(username, hash, inviteCode);
    const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET);
    res.json({ token, inviteCode, username });
  } catch (e) {
    res.status(400).json({ error: 'Юзер уже существует' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(400).json({ error: 'Нет такого юзера' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Неверный пароль' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, inviteCode: user.invite_code, username: user.username });
});

app.post('/api/friends/add', auth, (req, res) => {
  const { inviteCode } = req.body;
  const friend = db.prepare('SELECT id, username FROM users WHERE invite_code = ?').get(inviteCode);
  if (!friend) return res.status(404).json({ error: 'Код не найден' });
  if (friend.id === req.user.id) return res.status(400).json({ error: 'Это ты сам' });

  try {
    db.prepare('INSERT INTO friendships (user_id, friend_id) VALUES (?, ?)').run(req.user.id, friend.id);
    db.prepare('INSERT INTO friendships (user_id, friend_id) VALUES (?, ?)').run(friend.id, req.user.id);
    res.json({ ok: true, friend });
  } catch {
    res.status(400).json({ error: 'Уже друзья' });
  }
});

app.get('/api/friends', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username FROM users u
    JOIN friendships f ON f.friend_id = u.id
    WHERE f.user_id = ?
  `).all(req.user.id);
  res.json(friends);
});

app.post('/api/checkin', auth, upload.single('photo'), (req, res) => {
  const { drink, lat, lng } = req.body;
  if (!drink) return res.status(400).json({ error: 'Что пьёшь?' });

  const photo_url = req.file ? '/uploads/' + req.file.filename : null;

  const stmt = db.prepare('INSERT INTO checkins (user_id, drink, lat, lng, photo_url) VALUES (?, ?, ?, ?, ?)');
  stmt.run(
    req.user.id,
    drink,
    lat ? parseFloat(lat) : null,
    lng ? parseFloat(lng) : null,
    photo_url
  );

  const friends = db.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').all(req.user.id);
  friends.forEach(f => {
    console.log(`🔔 PUSH → user ${f.friend_id}: ${req.user.username} пьёт ${drink}!`);
  });

  res.json({ ok: true, photo_url });
});

app.get('/api/feed', auth, (req, res) => {
  const feed = db.prepare(`
    SELECT c.id, c.drink, c.lat, c.lng, c.photo_url, c.created_at, u.username
    FROM checkins c
    JOIN users u ON u.id = c.user_id
    WHERE c.user_id IN (
      SELECT friend_id FROM friendships WHERE user_id = ?
    ) OR c.user_id = ?
    ORDER BY c.created_at DESC
    LIMIT 50
  `).all(req.user.id, req.user.id);
  res.json(feed);
});

app.get('/api/stats', auth, (req, res) => {
  const stats = db.prepare(`
    SELECT u.username, COUNT(c.id) as total
    FROM users u
    LEFT JOIN checkins c ON c.user_id = u.id
    WHERE u.id IN (
      SELECT friend_id FROM friendships WHERE user_id = ?
    ) OR u.id = ?
    GROUP BY u.id
    ORDER BY total DESC
  `).all(req.user.id, req.user.id);
  res.json(stats);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🍻 Бирбар запущен: http://localhost:${process.env.PORT || 3000}`);
});