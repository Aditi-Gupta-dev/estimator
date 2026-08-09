import bcrypt from 'bcrypt';
import express from 'express';
import { signToken } from './jwt.js';
import { AUTH_COOKIE_NAME, requireAuth, requireRole } from './middleware.js';
import {
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsers,
  toPublicUser,
  touchLastActive,
  updateUser,
} from './users.js';

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  // Secure cookies are silently dropped over plain http://localhost — only
  // require it once this is actually served over HTTPS.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8h, matches JWT_EXPIRY default

// ── Login / logout / session ────────────────────────────────────────────────

router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const user = getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ success: false, error: `This account is ${user.status}. Contact your Admin / COE.` });
  }

  touchLastActive(user.id);
  const token = signToken(user);
  res.cookie(AUTH_COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: COOKIE_MAX_AGE_MS });
  res.json({ success: true, user: toPublicUser(getUserById(user.id)) });
});

router.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, COOKIE_OPTIONS);
  res.json({ success: true });
});

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ── Admin-only user management (backs ManageUsersPanel.jsx) ────────────────

router.get('/api/auth/users', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ success: true, users: listUsers().map(toPublicUser) });
});

router.post('/api/auth/users', requireAuth, requireRole('admin'), (req, res) => {
  const { name, email, password, role, unit, department, status } = req.body || {};
  if (!name || !email || !password || !role || !department) {
    return res.status(400).json({
      success: false,
      error: 'name, email, password, role, and department are required.',
    });
  }
  if (getUserByEmail(email)) {
    return res.status(409).json({ success: false, error: 'A user with this email already exists.' });
  }

  const user = createUser({ name, email, password, role, unit, department, status: status || 'active' });
  res.status(201).json({ success: true, user: toPublicUser(user) });
});

router.patch('/api/auth/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = getUserById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const updated = updateUser(req.params.id, req.body || {});
  res.json({ success: true, user: toPublicUser(updated) });
});

router.delete('/api/auth/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = getUserById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  deleteUser(req.params.id);
  res.json({ success: true });
});

export default router;
