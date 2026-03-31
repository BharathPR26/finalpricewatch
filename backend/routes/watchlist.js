const express         = require('express');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT w.watch_id, w.target_price, w.is_active, w.created_at,
        p.product_id, p.name, p.url, p.category, p.image_url,
        (SELECT ph.price FROM price_history ph WHERE ph.product_id=p.product_id
         ORDER BY ph.recorded_at DESC LIMIT 1) AS current_price,
        (SELECT MIN(ph2.price) FROM price_history ph2 WHERE ph2.product_id=p.product_id) AS all_time_low,
        (SELECT ph3.price FROM price_history ph3 WHERE ph3.product_id=p.product_id
         ORDER BY ph3.recorded_at ASC LIMIT 1) AS first_price,
        ROUND(100*(
          (SELECT ph4.price FROM price_history ph4 WHERE ph4.product_id=p.product_id ORDER BY ph4.recorded_at ASC LIMIT 1) -
          (SELECT ph5.price FROM price_history ph5 WHERE ph5.product_id=p.product_id ORDER BY ph5.recorded_at DESC LIMIT 1)
        ) / NULLIF((SELECT ph6.price FROM price_history ph6 WHERE ph6.product_id=p.product_id ORDER BY ph6.recorded_at ASC LIMIT 1),0),1) AS drop_pct
      FROM watchlist w JOIN products p ON p.product_id=w.product_id
      WHERE w.user_id=?
      ORDER BY w.created_at DESC
    `, [req.session.user.user_id]);
    res.json({ watchlist: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch watchlist.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { product_id, target_price } = req.body;
    if (!product_id || !target_price)
      return res.status(400).json({ error: 'product_id and target_price required.' });
    await db.query(
      `INSERT INTO watchlist (user_id,product_id,target_price)
       VALUES (?,?,?) ON DUPLICATE KEY UPDATE target_price=VALUES(target_price), is_active=TRUE`,
      [req.session.user.user_id, product_id, target_price]
    );
    res.json({ message: 'Added to watchlist.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add to watchlist.' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { target_price } = req.body;
    await db.query('UPDATE watchlist SET target_price=? WHERE watch_id=? AND user_id=?',
      [target_price, req.params.id, req.session.user.user_id]);
    res.json({ message: 'Target updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update target.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM watchlist WHERE watch_id=? AND user_id=?',
      [req.params.id, req.session.user.user_id]);
    res.json({ message: 'Removed from watchlist.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove.' });
  }
});

module.exports = router;