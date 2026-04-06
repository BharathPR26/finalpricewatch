const express         = require('express');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

// GET /api/alerts
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.alert_id, a.triggered_price, a.triggered_at,
             a.is_read, a.email_sent,
             p.name AS product_name, p.category,
             p.image_url, p.url, p.product_id,
             w.target_price
      FROM   alerts a
      JOIN   watchlist w ON w.watch_id   = a.watch_id
      JOIN   products  p ON p.product_id = w.product_id
      WHERE  w.user_id = ?
      ORDER  BY a.triggered_at DESC
      LIMIT  100
    `, [req.session.user.user_id]);
    const unread_count = rows.filter(r => !r.is_read).length;
    res.json({ alerts: rows, unread_count });
  } catch (err) {
    console.error('[GET /alerts]', err.message);
    res.status(500).json({ error: 'Failed to fetch alerts.' });
  }
});

// PUT /api/alerts/read-all  — PostgreSQL subquery (no JOIN in UPDATE)
router.put('/read-all', requireAuth, async (req, res) => {
  try {
    await db.query(`
      UPDATE alerts
      SET    is_read = TRUE
      WHERE  watch_id IN (
        SELECT watch_id FROM watchlist WHERE user_id = ?
      )
    `, [req.session.user.user_id]);
    res.json({ message: 'All marked read.' });
  } catch (err) {
    console.error('[PUT /alerts/read-all]', err.message);
    res.status(500).json({ error: 'Failed to mark alerts as read.' });
  }
});

// GET /api/alerts/stats  — PostgreSQL safe (no HAVING alias, no JOIN in UPDATE)
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const uid = req.session.user.user_id;

    // Number() converts PostgreSQL COUNT bigint string to JS number
    const [rp] = await db.query(
      'SELECT COUNT(*) AS n FROM products WHERE added_by = ?', [uid]);
    const total_products = Number(rp[0]?.n || 0);

    const [rw] = await db.query(
      'SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ? AND is_active = TRUE', [uid]);
    const watching = Number(rw[0]?.n || 0);

    const [ra] = await db.query(`
      SELECT COUNT(*) AS n FROM alerts a
      JOIN   watchlist w ON w.watch_id = a.watch_id
      WHERE  w.user_id = ?
    `, [uid]);
    const total_alerts = Number(ra[0]?.n || 0);

    const [ru] = await db.query(`
      SELECT COUNT(*) AS n FROM alerts a
      JOIN   watchlist w ON w.watch_id = a.watch_id
      WHERE  w.user_id = ? AND a.is_read = FALSE
    `, [uid]);
    const unread = Number(ru[0]?.n || 0);

    // Best deals — subquery avoids PostgreSQL HAVING alias problem
    const [best_deals] = await db.query(`
      SELECT name, category, product_id, first_price, current_price
      FROM (
        SELECT
          p.name, p.category, p.product_id,
          (SELECT ph1.price FROM price_history ph1
           WHERE  ph1.product_id = p.product_id
           ORDER  BY ph1.recorded_at ASC  LIMIT 1) AS first_price,
          (SELECT ph2.price FROM price_history ph2
           WHERE  ph2.product_id = p.product_id
           ORDER  BY ph2.recorded_at DESC LIMIT 1) AS current_price
        FROM products p WHERE p.added_by = ?
      ) sub
      WHERE first_price   IS NOT NULL
        AND current_price IS NOT NULL
        AND first_price    > current_price
      ORDER BY (first_price - current_price) / first_price DESC
      LIMIT 3
    `, [uid]);

    res.json({ total_products, watching, total_alerts, unread, best_deals });
  } catch (err) {
    console.error('[GET /alerts/stats]', err.message);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;