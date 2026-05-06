require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

if (!process.env.ADMIN_PASSWORD_HASH) {
  throw new Error('ADMIN_PASSWORD_HASH is required');
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'js')));
app.use('/components', express.static(path.join(__dirname, '..', 'public', 'components')));

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.TOKEN_EXPIRES_IN || '7d'
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

function ensurePublicProfileUserId() {
  const setting = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('public_profile_user_id');
  if (setting?.value) {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(setting.value));
    if (existing) return existing.id;
  }

  let profileUser = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('public_profile');
  if (!profileUser) {
    const placeholderPassword = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
    const result = db
      .prepare(
        `INSERT INTO users
          (username, email, password_hash, full_name, role, status)
         VALUES (?, ?, ?, ?, 'user', 'active')`
      )
      .run('public_profile', 'public@ashar.nfc', placeholderPassword, 'Ashar NFC');
    profileUser = { id: result.lastInsertRowid };
  }

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('public_profile_user_id', String(profileUser.id));
  return profileUser.id;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { username, email, password, fullName, phone, city, nfcProduct } = req.body || {};

  if (!username || !email || !password || !fullName) {
    return res.status(400).json({ error: 'username, email, password, and fullName are required' });
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(username, email);
  if (existing) {
    return res.status(409).json({ error: 'Username or email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = db
    .prepare(
      `INSERT INTO users
        (username, email, password_hash, full_name, phone, city, nfc_product, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'pending')`
    )
    .run(username, email, passwordHash, fullName, phone || null, city || null, nfcProduct || null);

  const token = signToken({ id: result.lastInsertRowid, role: 'user' });
  return res.status(201).json({ token });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  const user = db
    .prepare('SELECT id, username, email, password_hash, status FROM users WHERE username = ? OR email = ?')
    .get(identifier, identifier);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ id: user.id, role: 'user' });
  return res.json({ token });
});

app.post('/api/auth/admin/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  if (username !== adminUsername) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordValid = await bcrypt.compare(password, adminPasswordHash);

  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ role: 'admin', username: adminUsername });
  return res.json({ token });
});

app.post('/api/applications', (req, res) => {
  const { fullName, phone, email, whatsapp, city, nfcProduct } = req.body || {};
  if (!fullName || !phone || !email || !nfcProduct) {
    return res.status(400).json({ error: 'fullName, phone, email, and nfcProduct are required' });
  }

  const result = db
    .prepare(
      `INSERT INTO applications
        (full_name, phone, email, whatsapp, city, nfc_product, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(fullName, phone, email, whatsapp || null, city || null, nfcProduct);

  return res.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, username, email, full_name, phone, city, status FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json(user);
});

app.get('/api/profile', (req, res) => {
  const profileUserId = ensurePublicProfileUserId();
  const profile = db
    .prepare('SELECT full_name, bio, job_title, company FROM users WHERE id = ?')
    .get(profileUserId);

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const socialLinks = db
    .prepare('SELECT type, url FROM social_links WHERE user_id = ? ORDER BY id')
    .all(profileUserId);

  return res.json({
    fullName: profile.full_name,
    bio: profile.bio,
    jobTitle: profile.job_title,
    company: profile.company,
    socialLinks,
  });
});

app.get('/api/admin/profile', requireAdmin, (req, res) => {
  const profileUserId = ensurePublicProfileUserId();
  const profile = db
    .prepare('SELECT full_name, bio, job_title, company FROM users WHERE id = ?')
    .get(profileUserId);

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const socialLinks = db
    .prepare('SELECT type, url FROM social_links WHERE user_id = ? ORDER BY id')
    .all(profileUserId);

  return res.json({
    fullName: profile.full_name,
    bio: profile.bio,
    jobTitle: profile.job_title,
    company: profile.company,
    socialLinks,
  });
});

app.put('/api/admin/profile', requireAdmin, (req, res) => {
  const { fullName, bio, jobTitle, company, socialLinks } = req.body || {};

  if (!fullName) {
    return res.status(400).json({ error: 'fullName is required' });
  }

  const profileUserId = ensurePublicProfileUserId();
  const updateProfile = db.prepare(
    `UPDATE users
     SET full_name = ?, bio = ?, job_title = ?, company = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  );
  const deleteLinks = db.prepare('DELETE FROM social_links WHERE user_id = ?');
  const insertLink = db.prepare(
    'INSERT INTO social_links (user_id, type, url) VALUES (?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    updateProfile.run(fullName, bio || null, jobTitle || null, company || null, profileUserId);
    deleteLinks.run(profileUserId);

    if (Array.isArray(socialLinks)) {
      socialLinks.forEach((link) => {
        if (!link?.type || !link?.url) return;
        insertLink.run(profileUserId, String(link.type), String(link.url));
      });
    }
  });

  transaction();
  return res.json({ status: 'ok' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Ashar.nfc backend running on port ${PORT}`);
});
