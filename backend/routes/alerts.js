const express         = require('express');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.alert_id, a.triggered_price, a.triggered_at, a.is_read, a.email_sent,
        p.name AS product_name, p.category, p.image_url, p.url, p.product_id,
        w.target_price
      FROM alerts a
      JOIN watchlist w ON w.watch_id  = a.watch_id
      JOIN products  p ON p.product_id = w.product_id
      WHERE w.user_id = ?
      ORDER BY a.triggered_at DESC LIMIT 100
    `, [req.session.user.user_id]);
    const unread_count = rows.filter(r => !r.is_read).length;
    res.json({ alerts: rows, unread_count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts.' });
  }
});

router.put('/read-all', requireAuth, async (req, res) => {
  try {
    await db.query(`
      UPDATE alerts a JOIN watchlist w ON w.watch_id=a.watch_id
      SET a.is_read=TRUE WHERE w.user_id=?
    `, [req.session.user.user_id]);
    res.json({ message: 'All marked read.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed.' });
  }
});

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const uid = req.session.user.user_id;
    const [[{ total_products }]] = await db.query(
      'SELECT COUNT(*) AS total_products FROM products WHERE added_by=?', [uid]);
    const [[{ watching }]] = await db.query(
      'SELECT COUNT(*) AS watching FROM watchlist WHERE user_id=? AND is_active=TRUE', [uid]);
    const [[{ total_alerts }]] = await db.query(`
      SELECT COUNT(*) AS total_alerts FROM alerts a
      JOIN watchlist w ON w.watch_id=a.watch_id WHERE w.user_id=?`, [uid]);
    const [[{ unread }]] = await db.query(`
      SELECT COUNT(*) AS unread FROM alerts a
      JOIN watchlist w ON w.watch_id=a.watch_id
      WHERE w.user_id=? AND a.is_read=FALSE`, [uid]);
    const [bestDeals] = await db.query(`
      SELECT p.name, p.category, p.product_id,
        (SELECT ph1.price FROM price_history ph1 WHERE ph1.product_id=p.product_id ORDER BY ph1.recorded_at ASC LIMIT 1) AS first_price,
        (SELECT ph2.price FROM price_history ph2 WHERE ph2.product_id=p.product_id ORDER BY ph2.recorded_at DESC LIMIT 1) AS current_price
      FROM products p WHERE p.added_by=?
      HAVING first_price IS NOT NULL AND current_price IS NOT NULL AND first_price > current_price
      ORDER BY (first_price-current_price)/first_price DESC LIMIT 3
    `, [uid]);

    res.json({ total_products, watching, total_alerts, unread, best_deals: bestDeals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;