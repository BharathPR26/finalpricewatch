const express   = require('express');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const db        = require('../db');
const { sendPasswordResetEmail } = require('../mailer');
const router    = express.Router();

// In-memory token store (token → { email, expires })
// For production use a DB table — fine for college project
const resetTokens = new Map();
const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing.length)
      return res.status(409).json({ error: 'Email already registered. Please log in.' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?) RETURNING user_id, name, email',
      [name, email, hash]
    );
    const user = result[0];
    req.session.user = { user_id: user.user_id, name: user.name, email: user.email };
    req.session.save(err => {
      if (err) { console.error('[Register] Session save:', err.message); return res.status(500).json({ error: 'Session error.' }); }
      res.json({ message: 'Registered.', user: req.session.user });
    });
  } catch (err) {
    console.error('[Register]', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required.' });

    const [rows] = await db.query(
      'SELECT user_id, name, email, password FROM users WHERE email = ?', [email]);
    if (!rows.length)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, rows[0].password);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const user = rows[0];
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      req.session.user = { user_id: user.user_id, name: user.name, email: user.email };
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ error: 'Session save error.' });
        res.json({ message: 'Login successful.', user: req.session.user });
      });
    });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('[Logout]', err.message);
    res.clearCookie('pw_session');
    res.json({ message: 'Logged out.' });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session?.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated.' });
});

// PUT /api/auth/notifications
router.put('/notifications', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    await db.query('UPDATE users SET notify_email = ? WHERE user_id = ?',
      [req.body.notify_email, req.session.user.user_id]);
    res.json({ message: 'Updated.' });
  } catch (err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── FORGOT PASSWORD ───────────────────────────────────────────
// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  try {
    const [rows] = await db.query('SELECT user_id, name, email FROM users WHERE email = ?', [email]);

    // Always return success (don't reveal if email exists — security best practice)
    if (!rows.length) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const user  = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + TOKEN_EXPIRY_MS;

    // Store token
    resetTokens.set(token, { email: user.email, userId: user.user_id, expires });

    // Clean up expired tokens
    for (const [k, v] of resetTokens) {
      if (Date.now() > v.expires) resetTokens.delete(k);
    }

    // Build reset URL
    const baseUrl  = process.env.APP_URL || `https://pricewatch-ernc.onrender.com`;
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Send email (non-blocking)
    sendPasswordResetEmail({
      toEmail:        user.email,
      userName:       user.name,
      resetUrl,
      expiresMinutes: 30,
    }).then(sent => {
      if (!sent) console.error('[ForgotPW] Email failed for:', user.email);
    });

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[ForgotPW]', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const entry = resetTokens.get(token);
  if (!entry)             return res.status(400).json({ error: 'Invalid or expired reset link.' });
  if (Date.now() > entry.expires) {
    resetTokens.delete(token);
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password = ? WHERE user_id = ?', [hash, entry.userId]);
    resetTokens.delete(token); // one-time use
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[ResetPW]', err.message);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// GET /api/auth/verify-reset-token?token=xxx
router.get('/verify-reset-token', (req, res) => {
  const { token } = req.query;
  const entry = resetTokens.get(token);
  if (!entry || Date.now() > entry.expires)
    return res.status(400).json({ valid: false, error: 'Invalid or expired token.' });
  res.json({ valid: true, email: entry.email });
});

module.exports = router;