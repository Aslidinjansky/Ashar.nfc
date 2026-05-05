require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const db = require('./db');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type'), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const imageOnly = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Images only'), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });

  const token = jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: 'user' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, email: user.email, status: user.status } });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, full_name, phone, city, nfc_product } = req.body;
  if (!username || !email || !password || !full_name) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(409).json({ error: 'Email or username already taken' });

  const hash = await bcrypt.hash(password, 10);
  const stmt = db.prepare(
    'INSERT INTO users (username, email, password_hash, full_name, phone, city, nfc_product, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(username, email, hash, full_name, phone || null, city || null, nfc_product || null, 'active');

  const token = jwt.sign(
    { id: result.lastInsertRowid, username, email, role: 'user' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: { id: result.lastInsertRowid, username, full_name, email } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, email, full_name, phone, city, avatar, background_color, background_image, bio, nfc_product, status, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ─── PUBLIC PROFILE ──────────────────────────────────────────────────────────

app.get('/api/profile/:username', (req, res) => {
  const user = db.prepare(
    'SELECT id, username, full_name, bio, avatar, background_color, background_image, city FROM users WHERE username = ? AND status = ?'
  ).get(req.params.username, 'active');

  if (!user) return res.status(404).json({ error: 'Profile not found' });

  const socialLinks = db.prepare('SELECT type, url FROM social_links WHERE user_id = ?').all(user.id);
  const bankCard = db.prepare('SELECT cardholder_name, last4 FROM bank_cards WHERE user_id = ?').get(user.id);

  res.json({ ...user, social_links: socialLinks, bank_card: bankCard || null });
});

// ─── APPLICATIONS ────────────────────────────────────────────────────────────

app.post('/api/applications', (req, res) => {
  const { full_name, phone, email, whatsapp, city, nfc_product } = req.body;
  if (!full_name || !phone || !email || !nfc_product) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  const stmt = db.prepare(
    'INSERT INTO applications (full_name, phone, email, whatsapp, city, nfc_product) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(full_name, phone, email, whatsapp || null, city || null, nfc_product);
  res.json({ id: result.lastInsertRowid, message: 'Application submitted successfully' });
});

// ─── DASHBOARD ROUTES ────────────────────────────────────────────────────────

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, full_name, phone, city, avatar, background_color, background_image, bio, nfc_product, status, created_at FROM users WHERE id = ?'
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: 'Not found' });

  const socialLinks = db.prepare('SELECT id, type, url FROM social_links WHERE user_id = ?').all(req.user.id);
  const bankCard = db.prepare('SELECT id, cardholder_name, last4 FROM bank_cards WHERE user_id = ?').get(req.user.id);
  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND read = 0').get(req.user.id);

  res.json({ ...user, social_links: socialLinks, bank_card: bankCard || null, unread_notifications: unreadCount.count });
});

app.put('/api/dashboard/profile', authMiddleware, (req, res) => {
  const { full_name, bio, background_color } = req.body;
  db.prepare('UPDATE users SET full_name = ?, bio = ?, background_color = ? WHERE id = ?')
    .run(full_name, bio, background_color, req.user.id);
  res.json({ message: 'Profile updated' });
});

app.post('/api/dashboard/avatar', authMiddleware, imageOnly.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.id);
  res.json({ avatar: avatarUrl });
});

app.post('/api/dashboard/background', authMiddleware, imageOnly.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const bgUrl = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET background_image = ? WHERE id = ?').run(bgUrl, req.user.id);
  res.json({ background_image: bgUrl });
});

app.put('/api/dashboard/social-links', authMiddleware, (req, res) => {
  const { links } = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ error: 'Links must be an array' });

  db.prepare('DELETE FROM social_links WHERE user_id = ?').run(req.user.id);
  const insert = db.prepare('INSERT INTO social_links (user_id, type, url) VALUES (?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(req.user.id, row.type, row.url);
  });
  insertMany(links.filter(l => l.type && l.url));
  res.json({ message: 'Links updated' });
});

app.put('/api/dashboard/bank-card', authMiddleware, (req, res) => {
  const { cardholder_name, last4 } = req.body;
  if (!cardholder_name || !last4) return res.status(400).json({ error: 'Required fields missing' });
  if (!/^\d{4}$/.test(last4)) return res.status(400).json({ error: 'last4 must be 4 digits' });

  const existing = db.prepare('SELECT id FROM bank_cards WHERE user_id = ?').get(req.user.id);
  if (existing) {
    db.prepare('UPDATE bank_cards SET cardholder_name = ?, last4 = ? WHERE user_id = ?').run(cardholder_name, last4, req.user.id);
  } else {
    db.prepare('INSERT INTO bank_cards (user_id, cardholder_name, last4) VALUES (?, ?, ?)').run(req.user.id, cardholder_name, last4);
  }
  res.json({ message: 'Bank card updated' });
});

app.get('/api/dashboard/notifications', authMiddleware, (req, res) => {
  const notifications = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json(notifications);
});

app.put('/api/dashboard/notifications/:id/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .run(req.params.id, req.user.id);
  res.json({ message: 'Marked as read' });
});

app.get('/api/dashboard/messages', authMiddleware, (req, res) => {
  const messages = db.prepare(
    'SELECT * FROM support_messages WHERE user_id = ? ORDER BY created_at ASC'
  ).all(req.user.id);
  res.json(messages);
});

app.post('/api/dashboard/messages', authMiddleware, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const result = db.prepare('INSERT INTO support_messages (user_id, sender, message) VALUES (?, ?, ?)')
    .run(req.user.id, 'user', message);
  res.json({ id: result.lastInsertRowid, message: 'Message sent' });
});

app.get('/api/dashboard/ads', authMiddleware, (req, res) => {
  const ads = db.prepare(
    'SELECT * FROM ads WHERE (user_id = ? OR user_id IS NULL) AND active = 1 ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json(ads);
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPassRaw = process.env.ADMIN_PASSWORD || 'admin123';
  const adminHashEnv = process.env.ADMIN_PASSWORD_HASH;

  if (username !== adminUser) return res.status(401).json({ error: 'Invalid credentials' });

  let valid = false;
  if (adminHashEnv) {
    valid = await bcrypt.compare(password, adminHashEnv);
  } else {
    valid = password === adminPassRaw;
  }

  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ role: 'admin', username }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const pendingApps = db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'pending'").get();
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get();
  const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get();
  const unreadMessages = db.prepare("SELECT COUNT(DISTINCT user_id) as count FROM support_messages WHERE sender = 'user'").get();
  const totalAds = db.prepare("SELECT COUNT(*) as count FROM ads WHERE active = 1").get();
  res.json({
    pending_applications: pendingApps.count,
    total_users: totalUsers.count,
    active_users: activeUsers.count,
    unread_messages: unreadMessages.count,
    total_ads: totalAds.count
  });
});

app.get('/api/admin/applications', adminMiddleware, (req, res) => {
  const apps = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  res.json(apps);
});

app.put('/api/admin/applications/:id', adminMiddleware, (req, res) => {
  const { status, notes } = req.body;
  db.prepare('UPDATE applications SET status = ?, notes = ? WHERE id = ?').run(status, notes || null, req.params.id);
  res.json({ message: 'Application updated' });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, email, full_name, phone, city, nfc_product, status, created_at FROM users ORDER BY created_at DESC'
  ).all();
  res.json(users);
});

app.get('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, full_name, phone, city, avatar, background_color, bio, nfc_product, status, created_at FROM users WHERE id = ?'
  ).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const socialLinks = db.prepare('SELECT type, url FROM social_links WHERE user_id = ?').all(req.params.id);
  const bankCard = db.prepare('SELECT cardholder_name, last4 FROM bank_cards WHERE user_id = ?').get(req.params.id);
  res.json({ ...user, social_links: socialLinks, bank_card: bankCard || null });
});

app.put('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const { full_name, email, phone, city, nfc_product, status } = req.body;
  db.prepare('UPDATE users SET full_name = ?, email = ?, phone = ?, city = ?, nfc_product = ?, status = ? WHERE id = ?')
    .run(full_name, email, phone, city, nfc_product, status, req.params.id);
  res.json({ message: 'User updated' });
});

app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(req.params.id);
  res.json({ message: 'User suspended' });
});

app.post('/api/admin/notifications', adminMiddleware, upload.single('media'), (req, res) => {
  const { title, message, user_id } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Title and message required' });

  const mediaUrl = req.file ? '/uploads/' + req.file.filename : null;
  const mediaType = req.file ? req.file.mimetype.split('/')[0] : null;
  const uid = user_id ? parseInt(user_id) : null;

  if (uid) {
    db.prepare('INSERT INTO notifications (user_id, title, message, media_url, media_type) VALUES (?, ?, ?, ?, ?)')
      .run(uid, title, message, mediaUrl, mediaType);
  } else {
    // Broadcast: one row per user
    const users = db.prepare('SELECT id FROM users WHERE status = ?').all('active');
    const insert = db.prepare('INSERT INTO notifications (user_id, title, message, media_url, media_type) VALUES (?, ?, ?, ?, ?)');
    const insertAll = db.transaction(() => {
      for (const u of users) insert.run(u.id, title, message, mediaUrl, mediaType);
    });
    insertAll();
  }
  res.json({ message: 'Notification sent' });
});

app.get('/api/admin/ads', adminMiddleware, (req, res) => {
  const ads = db.prepare('SELECT ads.*, users.username FROM ads LEFT JOIN users ON ads.user_id = users.id ORDER BY ads.created_at DESC').all();
  res.json(ads);
});

app.post('/api/admin/ads', adminMiddleware, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Media file required' });
  const { caption, user_id } = req.body;
  const mediaUrl = '/uploads/' + req.file.filename;
  const mediaType = req.file.mimetype.split('/')[0];
  const uid = user_id ? parseInt(user_id) : null;

  const result = db.prepare('INSERT INTO ads (user_id, media_url, media_type, caption, active) VALUES (?, ?, ?, ?, 1)')
    .run(uid, mediaUrl, mediaType, caption || null);
  res.json({ id: result.lastInsertRowid, message: 'Ad created' });
});

app.put('/api/admin/ads/:id', adminMiddleware, (req, res) => {
  const { caption, active } = req.body;
  db.prepare('UPDATE ads SET caption = ?, active = ? WHERE id = ?').run(caption, active ? 1 : 0, req.params.id);
  res.json({ message: 'Ad updated' });
});

app.delete('/api/admin/ads/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM ads WHERE id = ?').run(req.params.id);
  res.json({ message: 'Ad deleted' });
});

app.get('/api/admin/messages', adminMiddleware, (req, res) => {
  const threads = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.avatar,
           (SELECT COUNT(*) FROM support_messages sm WHERE sm.user_id = u.id AND sm.sender = 'user') as msg_count,
           (SELECT sm2.message FROM support_messages sm2 WHERE sm2.user_id = u.id ORDER BY sm2.created_at DESC LIMIT 1) as last_message,
           (SELECT sm3.created_at FROM support_messages sm3 WHERE sm3.user_id = u.id ORDER BY sm3.created_at DESC LIMIT 1) as last_at
    FROM users u
    WHERE EXISTS (SELECT 1 FROM support_messages sm WHERE sm.user_id = u.id)
    ORDER BY last_at DESC
  `).all();
  res.json(threads);
});

app.get('/api/admin/messages/:userId', adminMiddleware, (req, res) => {
  const messages = db.prepare('SELECT * FROM support_messages WHERE user_id = ? ORDER BY created_at ASC').all(req.params.userId);
  res.json(messages);
});

app.post('/api/admin/messages/:userId', adminMiddleware, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const result = db.prepare('INSERT INTO support_messages (user_id, sender, message) VALUES (?, ?, ?)').run(req.params.userId, 'admin', message);
  res.json({ id: result.lastInsertRowid, message: 'Reply sent' });
});

// ─── PROFILE PAGE (SSR) ───────────────────────────────────────────────────────

app.get('/p/:username', (req, res) => {
  const user = db.prepare(
    'SELECT id, username, full_name, bio, avatar, background_color, background_image, city FROM users WHERE username = ? AND status = ?'
  ).get(req.params.username, 'active');

  if (!user) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>Not Found</title></head><body style="background:#0a0a0f;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;"><h2>Profile not found</h2></body></html>`);
  }

  const socialLinks = db.prepare('SELECT type, url FROM social_links WHERE user_id = ?').all(user.id);
  const bankCard = db.prepare('SELECT cardholder_name, last4 FROM bank_cards WHERE user_id = ?').get(user.id);

  const bgStyle = user.background_image
    ? `background-image:url('${user.background_image}');background-size:cover;background-position:center;`
    : `background-color:${user.background_color || '#0a0a0f'};`;

  const socialIconsSVG = {
    phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 .18h3a2 2 0 012 1.72c.13.96.36 1.9.69 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.09-1.09a2 2 0 012.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0122 16.92z"/></svg>`,
    whatsapp: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
    telegram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`,
    facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>`,
    tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
    website: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
    email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    linkedin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>`
  };

  const linksHtml = socialLinks.map(link => {
    const icon = socialIconsSVG[link.type] || socialIconsSVG.website;
    const href = link.type === 'phone' ? `tel:${link.url}` :
                 link.type === 'email' ? `mailto:${link.url}` :
                 link.type === 'whatsapp' ? `https://wa.me/${link.url.replace(/\D/g,'')}` : link.url;
    return `<a href="${href}" class="social-btn" target="_blank" rel="noopener" title="${link.type}">${icon}</a>`;
  }).join('');

  const bankCardHtml = bankCard ? `
    <div class="card-section">
      <button class="btn-show-card" onclick="flipCard(this)" id="showCardBtn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        Show Card
      </button>
      <div class="flip-card" id="flipCard">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="card-pattern"></div>
            <div class="card-number">•••• •••• •••• ${bankCard.last4}</div>
            <div class="card-chip"></div>
          </div>
          <div class="flip-card-back">
            <div class="card-stripe"></div>
            <div class="card-holder">${bankCard.cardholder_name}</div>
            <div class="card-label">CARDHOLDER</div>
          </div>
        </div>
      </div>
    </div>` : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${user.full_name} | Ashar.nfc</title>
<meta property="og:title" content="${user.full_name}">
<meta property="og:description" content="${user.bio || 'NFC Business Card'}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{background:#000;display:flex;justify-content:center}
.app{max-width:430px;width:100%;min-height:100vh;${bgStyle}position:relative;overflow:hidden}
.app::before{content:'';position:absolute;inset:0;background:rgba(0,0,0,0.45);z-index:0}
.content{position:relative;z-index:1;padding:40px 24px 100px;display:flex;flex-direction:column;align-items:center;gap:16px}
.avatar-wrap{position:relative;margin-bottom:8px}
.avatar{width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid #f0a500;box-shadow:0 0 30px rgba(240,165,0,0.4)}
.avatar-placeholder{width:110px;height:110px;border-radius:50%;background:linear-gradient(135deg,#1a1a2e,#16213e);border:3px solid #f0a500;display:flex;align-items:center;justify-content:center;font-size:42px;color:#f0a500;font-weight:700}
.name{font-size:26px;font-weight:700;color:#fff;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,0.5)}
.bio{font-size:14px;color:rgba(255,255,255,0.8);text-align:center;line-height:1.6;max-width:320px}
.city{font-size:13px;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:6px}
.social-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;width:100%}
.social-btn{width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;color:#fff;text-decoration:none;transition:all 0.3s}
.social-btn:hover{background:rgba(240,165,0,0.2);border-color:#f0a500;transform:scale(1.1)}
.social-btn svg{width:24px;height:24px}
.card-section{width:100%;display:flex;flex-direction:column;align-items:center;gap:16px}
.btn-show-card{background:linear-gradient(135deg,#f0a500,#ffd700);color:#000;font-weight:700;border:none;border-radius:50px;padding:14px 28px;cursor:pointer;font-size:15px;display:flex;align-items:center;gap:8px;transition:transform 0.2s}
.btn-show-card:hover{transform:scale(1.03)}
.flip-card{width:300px;height:180px;perspective:1000px;display:none}
.flip-card.show{display:block}
.flip-card-inner{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform 0.6s}
.flip-card-inner.flipped{transform:rotateY(180deg)}
.flip-card-front,.flip-card-back{position:absolute;inset:0;border-radius:16px;backface-visibility:hidden;overflow:hidden}
.flip-card-front{background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);border:1px solid rgba(240,165,0,0.3);display:flex;flex-direction:column;justify-content:flex-end;padding:20px}
.card-pattern{position:absolute;inset:0;background:radial-gradient(circle at 30% 50%,rgba(240,165,0,0.1) 0%,transparent 60%),radial-gradient(circle at 80% 20%,rgba(255,255,255,0.05) 0%,transparent 50%)}
.card-chip{width:40px;height:30px;background:linear-gradient(135deg,#d4af37,#ffd700);border-radius:5px;position:absolute;top:30px;left:20px}
.card-number{color:#fff;font-size:18px;letter-spacing:4px;font-family:monospace;text-shadow:0 1px 3px rgba(0,0,0,0.5)}
.flip-card-back{background:linear-gradient(135deg,#1a1a2e,#0f3460);transform:rotateY(180deg);border:1px solid rgba(240,165,0,0.3);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:20px}
.card-stripe{position:absolute;top:30px;left:0;right:0;height:40px;background:#333}
.card-holder{color:#fff;font-size:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-top:30px}
.card-label{color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:1px}
.footer{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:430px;padding:12px 0;background:rgba(10,10,15,0.9);backdrop-filter:blur(10px);border-top:1px solid rgba(255,255,255,0.08);text-align:center;z-index:100}
.footer a{color:#f0a500;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1px}
.footer span{color:rgba(255,255,255,0.4);font-size:12px}
</style>
</head>
<body>
<div class="app">
  <div class="content">
    <div class="avatar-wrap">
      ${user.avatar ? `<img src="${user.avatar}" class="avatar" alt="${user.full_name}">` : `<div class="avatar-placeholder">${user.full_name.charAt(0).toUpperCase()}</div>`}
    </div>
    <div class="name">${user.full_name}</div>
    ${user.bio ? `<div class="bio">${user.bio}</div>` : ''}
    ${user.city ? `<div class="city"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${user.city}</div>` : ''}
    ${linksHtml ? `<div class="social-grid">${linksHtml}</div>` : ''}
    ${bankCardHtml}
  </div>
</div>
<footer class="footer">
  <span>Powered by </span><a href="/">ashar.nfc</a>
</footer>
<script>
function flipCard(btn) {
  const card = document.getElementById('flipCard');
  const inner = card.querySelector('.flip-card-inner');
  if (!card.classList.contains('show')) {
    card.classList.add('show');
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Hide Card';
    setTimeout(() => inner.classList.add('flipped'), 50);
  } else {
    inner.classList.remove('flipped');
    setTimeout(() => { card.classList.remove('show'); btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Show Card'; }, 400);
  }
}
</script>
</body>
</html>`);
});

// ─── SPA FALLBACK ──────────────────────────────────────────────────────────────

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
app.get('/apply', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'apply.html')));
app.get('/ashr-admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'ashr-admin.html')));

app.listen(PORT, () => {
  console.log(`Ashar.nfc server running on port ${PORT}`);
});
