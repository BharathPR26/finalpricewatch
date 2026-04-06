const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const db       = require('../db');
const { sendPasswordResetEmail } = require('../mailer');
const router   = express.Router();

// Token store: token → { userId, email, name, expires }
const resetTokens = new Map();
const EXPIRY_MS   = 30 * 60 * 1000; // 30 minutes

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const [existing] = await db.query(
      'SELECT user_id FROM users WHERE email = ?', [email]);
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
      if (err) {
        console.error('[Register] Session save error:', err.message);
        return res.status(500).json({ error: 'Session error. Try logging in.' });
      }
      res.json({ message: 'Registered.', user: req.session.user });
    });
  } catch (err) {
    console.error('[Register]', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
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

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('[Logout]', err.message);
    res.clearCookie('pw_session');
    res.json({ message: 'Logged out.' });
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', (req, res) => {
  if (req.session?.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated.' });
});

// ── PUT /api/auth/notifications ───────────────────────────────
router.put('/notifications', async (req, res) => {
  if (!req.session?.user)
    return res.status(401).json({ error: 'Not authenticated.' });
  try {
    await db.query('UPDATE users SET notify_email = ? WHERE user_id = ?',
      [req.body.notify_email, req.session.user.user_id]);
    res.json({ message: 'Updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update.' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const [rows] = await db.query(
      'SELECT user_id, name, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);

    // Always return success — never reveal if email exists (security)
    if (!rows.length) {
      console.log('[ForgotPW] Email not found:', email);
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }

    const user  = rows[0];
    const token = crypto.randomBytes(32).toString('hex');

    // Save token (clean up old ones first)
    for (const [k, v] of resetTokens) {
      if (Date.now() > v.expires) resetTokens.delete(k);
    }
    resetTokens.set(token, {
      userId:  user.user_id,
      email:   user.email,
      name:    user.name,
      expires: Date.now() + EXPIRY_MS,
    });

    // Build reset URL
    const appUrl   = process.env.APP_URL || 'https://pricewatch-ernc.onrender.com';
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    console.log('[ForgotPW] Sending reset email to:', user.email);
    console.log('[ForgotPW] Reset URL:', resetUrl);

    // Send email (await it — we want to know if it failed)
    const sent = await sendPasswordResetEmail({
      toEmail:        user.email,
      userName:       user.name,
      resetUrl,
      expiresMinutes: 30,
    });

    if (!sent) {
      console.error('[ForgotPW] Email send failed for:', user.email);
      // Still return success to user (don't reveal email issues)
    }

    res.json({ message: 'If that email is registered, a reset link has been sent.' });

  } catch (err) {
    console.error('[ForgotPW]', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /api/auth/verify-reset-token ─────────────────────────
router.get('/verify-reset-token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false, error: 'Token required.' });

  const entry = resetTokens.get(token);
  if (!entry)                    return res.status(400).json({ valid: false, error: 'Invalid token.' });
  if (Date.now() > entry.expires) {
    resetTokens.delete(token);
    return res.status(400).json({ valid: false, error: 'Token expired. Please request a new link.' });
  }
  res.json({ valid: true, email: entry.email });
});

// ── POST /api/auth/reset-password ────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: 'Token and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const entry = resetTokens.get(token);
  if (!entry)
    return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
  if (Date.now() > entry.expires) {
    resetTokens.delete(token);
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password = ? WHERE user_id = ?', [hash, entry.userId]);
    resetTokens.delete(token); // one-time use
    console.log('[ResetPW] Password reset for user_id:', entry.userId);
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[ResetPW]', err.message);
    res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

module.exports = router;