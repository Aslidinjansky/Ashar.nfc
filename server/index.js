require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');
const { requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = 12;
const PUBLIC_PROFILE_USERNAME = 'public_profile';
const PUBLIC_PROFILE_EMAIL = 'public@ashar.nfc';

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
  const expiresIn = process.env.TOKEN_EXPIRES_IN || '7d';
  try {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
  } catch (error) {
    console.error('Invalid TOKEN_EXPIRES_IN value', error);
    throw error;
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function ensurePublicProfileUserId() {
  const db = await getDb();
  const setting = await db.get('SELECT value FROM settings WHERE key = ?', 'public_profile_user_id');
  if (setting?.value) {
    const existing = await db.get('SELECT id FROM users WHERE id = ?', Number(setting.value));
    if (existing) return existing.id;
  }

  let profileUser = await db.get(
    'SELECT id FROM users WHERE username = ?',
    PUBLIC_PROFILE_USERNAME
  );
  if (!profileUser) {
    const placeholderPassword = await bcrypt.hash(
      crypto.randomBytes(32).toString('hex'),
      BCRYPT_ROUNDS
    );
    const result = await db.run(
      `INSERT INTO users
        (username, email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, ?, 'user', 'active')`,
      PUBLIC_PROFILE_USERNAME,
      PUBLIC_PROFILE_EMAIL,
      placeholderPassword,
      'Ashar NFC'
    );
    profileUser = { id: result.lastID };
  }

  await db.run(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    'public_profile_user_id',
    String(profileUser.id)
  );
  return profileUser.id;
}

function isValidSocialUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', authLimiter, asyncHandler(async (req, res) => {
  const { username, email, password, fullName, phone, city, nfcProduct } = req.body || {};

  if (!username || !email || !password || !fullName) {
    return res.status(400).json({ error: 'username, email, password, and fullName are required' });
  }

  const db = await getDb();
  const existing = await db.get(
    'SELECT id FROM users WHERE username = ? OR email = ?',
    username,
    email
  );
  if (existing) {
    return res.status(409).json({ error: 'Username or email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await db.run(
    `INSERT INTO users
      (username, email, password_hash, full_name, phone, city, nfc_product, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'pending')`,
    username,
    email,
    passwordHash,
    fullName,
    phone || null,
    city || null,
    nfcProduct || null
  );

  const token = signToken({ id: result.lastID, role: 'user' });
  return res.status(201).json({ token });
}));

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  const db = await getDb();
  const user = await db.get(
    'SELECT id, username, email, password_hash, status FROM users WHERE username = ? OR email = ?',
    identifier,
    identifier
  );

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
}));

app.post('/api/auth/admin/login', authLimiter, asyncHandler(async (req, res) => {
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
}));

app.post('/api/applications', apiLimiter, asyncHandler(async (req, res) => {
  const { fullName, phone, email, whatsapp, city, nfcProduct } = req.body || {};
  if (!fullName || !phone || !email || !nfcProduct) {
    return res.status(400).json({ error: 'fullName, phone, email, and nfcProduct are required' });
  }

  const db = await getDb();
  const result = await db.run(
    `INSERT INTO applications
      (full_name, phone, email, whatsapp, city, nfc_product, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    fullName,
    phone,
    email,
    whatsapp || null,
    city || null,
    nfcProduct
  );

  return res.status(201).json({ id: result.lastID, status: 'pending' });
}));

app.get('/api/me', apiLimiter, requireAuth, asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await db.get(
    'SELECT id, username, email, full_name, phone, city, status FROM users WHERE id = ?',
    req.user.id
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json(user);
}));

app.get('/api/profile', apiLimiter, asyncHandler(async (req, res) => {
  const profileUserId = await ensurePublicProfileUserId();
  const db = await getDb();
  const profile = await db.get(
    'SELECT full_name, bio, job_title, company FROM users WHERE id = ?',
    profileUserId
  );

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const socialLinks = await db.all(
    'SELECT type, url FROM social_links WHERE user_id = ? ORDER BY id',
    profileUserId
  );

  return res.json({
    fullName: profile.full_name,
    bio: profile.bio,
    jobTitle: profile.job_title,
    company: profile.company,
    socialLinks,
  });
}));

app.get('/api/admin/profile', apiLimiter, requireAdmin, asyncHandler(async (req, res) => {
  const profileUserId = await ensurePublicProfileUserId();
  const db = await getDb();
  const profile = await db.get(
    'SELECT full_name, bio, job_title, company FROM users WHERE id = ?',
    profileUserId
  );

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const socialLinks = await db.all(
    'SELECT type, url FROM social_links WHERE user_id = ? ORDER BY id',
    profileUserId
  );

  return res.json({
    fullName: profile.full_name,
    bio: profile.bio,
    jobTitle: profile.job_title,
    company: profile.company,
    socialLinks,
  });
}));

app.put('/api/admin/profile', apiLimiter, requireAdmin, asyncHandler(async (req, res) => {
  const { fullName, bio, jobTitle, company, socialLinks } = req.body || {};

  if (!fullName) {
    return res.status(400).json({ error: 'fullName is required' });
  }

  const profileUserId = await ensurePublicProfileUserId();
  const db = await getDb();

  try {
    await db.exec('BEGIN');
    await db.run(
      `UPDATE users
       SET full_name = ?, bio = ?, job_title = ?, company = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      fullName,
      bio || null,
      jobTitle || null,
      company || null,
      profileUserId
    );
    await db.run('DELETE FROM social_links WHERE user_id = ?', profileUserId);

    if (Array.isArray(socialLinks)) {
      for (const link of socialLinks) {
        if (!link?.type || !link?.url) continue;
        const url = String(link.url).trim();
        if (!isValidSocialUrl(url)) continue;
        await db.run(
          'INSERT INTO social_links (user_id, type, url) VALUES (?, ?, ?)',
          profileUserId,
          String(link.type),
          url
        );
      }
    }

    await db.exec('COMMIT');
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback profile update', rollbackError);
    }
    throw error;
  }

  return res.json({ status: 'ok' });
}));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

async function startServer() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`Ashar.nfc backend running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to initialize database', error);
  process.exit(1);
});
