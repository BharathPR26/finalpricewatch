const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const router  = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const [existing] = await db.query('SELECT user_id FROM users WHERE email=?', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered.' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name,email,password) VALUES (?,?,?)', [name, email, hash]
    );
    req.session.user = { user_id: result.insertId, name, email };
    res.json({ message: 'Registered successfully.', user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required.' });
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    req.session.user = { user_id: user.user_id, name: user.name, email: user.email };
    res.json({ message: 'Login successful.', user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

router.get('/me', (req, res) => {
  if (req.session?.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated.' });
});

router.put('/notifications', async (req, res) => {
  try {
    const { notify_email } = req.body;
    await db.query('UPDATE users SET notify_email=? WHERE user_id=?',
      [notify_email, req.session.user.user_id]);
    res.json({ message: 'Notification preference updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preference.' });
  }
});

module.exports = router;