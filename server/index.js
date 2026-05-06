require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));
app.use('/components', express.static(path.join(__dirname, '..', 'public', 'components')));

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.TOKEN_EXPIRES_IN || '7d'
  });
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', async (req, res) => {
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

app.post('/api/auth/login', async (req, res) => {
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

app.post('/api/auth/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (username !== adminUsername) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordValid = adminPasswordHash
    ? await bcrypt.compare(password, adminPasswordHash)
    : password === adminPassword;

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

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Ashar.nfc backend running on port ${PORT}`);
});
