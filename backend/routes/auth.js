const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const router  = express.Router();

// POST /api/auth/register
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
      return res.status(409).json({ error: 'Email already registered.' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?) RETURNING user_id, name, email',
      [name, email, hash]
    );
    const user = result[0];

    req.session.user = { user_id: user.user_id, name: user.name, email: user.email };
    req.session.save((err) => {
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

    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password.' });

    // Regenerate session ID on login to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('[Login] Session regenerate error:', err.message);
        return res.status(500).json({ error: 'Session error. Please try again.' });
      }

      req.session.user = {
        user_id: user.user_id,
        name:    user.name,
        email:   user.email,
      };

      req.session.save((err2) => {
        if (err2) {
          console.error('[Login] Session save error:', err2.message);
          return res.status(500).json({ error: 'Session save failed. Please try again.' });
        }
        console.log('[Login] ✓', email);
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
  req.session.destroy((err) => {
    if (err) console.error('[Logout]', err.message);
    res.clearCookie('pw_session');
    res.json({ message: 'Logged out.' });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session?.user)
    return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated.' });
});

// PUT /api/auth/notifications
router.put('/notifications', async (req, res) => {
  try {
    if (!req.session?.user)
      return res.status(401).json({ error: 'Not authenticated.' });
    const { notify_email } = req.body;
    await db.query(
      'UPDATE users SET notify_email = ? WHERE user_id = ?',
      [notify_email, req.session.user.user_id]
    );
    res.json({ message: 'Updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update.' });
  }
});

module.exports = router;