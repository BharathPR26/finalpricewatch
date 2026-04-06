const express             = require('express');
const db                  = require('../db');
const { requireAuth }     = require('../middleware/auth');
const { sendPriceAlertEmail } = require('../mailer');
const router              = express.Router();

// GET /api/products
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.product_id, p.name, p.url, p.category, p.image_url, p.created_at,
        (SELECT ph.price FROM price_history ph
         WHERE ph.product_id = p.product_id
         ORDER BY ph.recorded_at DESC LIMIT 1) AS current_price,
        (SELECT ph2.price FROM price_history ph2
         WHERE ph2.product_id = p.product_id
         ORDER BY ph2.recorded_at ASC LIMIT 1) AS first_price,
        MIN(ph3.price) AS all_time_low,
        COUNT(ph3.ph_id) AS price_entries
      FROM products p
      LEFT JOIN price_history ph3 ON ph3.product_id = p.product_id
      WHERE p.added_by = ?
      GROUP BY p.product_id, p.name, p.url, p.category, p.image_url, p.created_at
      ORDER BY p.created_at DESC
    `, [req.session.user.user_id]);
    res.json({ products: rows });
  } catch (err) {
    console.error('[GET /products]', err.message);
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

// GET /api/products/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [prod] = await db.query(
      'SELECT * FROM products WHERE product_id = ? AND added_by = ?',
      [req.params.id, req.session.user.user_id]
    );
    if (!prod.length) return res.status(404).json({ error: 'Product not found.' });

    const [history] = await db.query(
      'SELECT price, recorded_at FROM price_history WHERE product_id = ? ORDER BY recorded_at ASC',
      [req.params.id]
    );
    const [watchInfo] = await db.query(`
      SELECT w.*,
        (SELECT MIN(ph.price) FROM price_history ph WHERE ph.product_id = w.product_id) AS all_time_low,
        (SELECT ph2.price FROM price_history ph2 WHERE ph2.product_id = w.product_id
         ORDER BY ph2.recorded_at DESC LIMIT 1) AS current_price
      FROM watchlist w
      WHERE w.user_id = ? AND w.product_id = ?
    `, [req.session.user.user_id, req.params.id]);

    res.json({ product: prod[0], history, watchInfo: watchInfo[0] || null });
  } catch (err) {
    console.error('[GET /products/:id]', err.message);
    res.status(500).json({ error: 'Failed to fetch product.' });
  }
});

// POST /api/products
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, url, category, image_url, initial_price } = req.body;
    if (!name || !url || !initial_price)
      return res.status(400).json({ error: 'Name, URL, and price are required.' });

    const [result] = await db.query(
      'INSERT INTO products (name, url, category, image_url, added_by) VALUES (?, ?, ?, ?, ?) RETURNING product_id',
      [name, url, category || 'Other', image_url || null, req.session.user.user_id]
    );
    const product_id = result[0].product_id;

    await db.query('INSERT INTO price_history (product_id, price) VALUES (?, ?)',
      [product_id, initial_price]);

    res.json({ message: 'Product added.', product_id });
  } catch (err) {
    console.error('[POST /products]', err.message);
    res.status(500).json({ error: 'Failed to add product.' });
  }
});

// POST /api/products/:id/price
// FIX: Respond IMMEDIATELY, send email in background (non-blocking)
router.post('/:id/price', requireAuth, async (req, res) => {
  try {
    const { price } = req.body;
    if (!price || isNaN(price))
      return res.status(400).json({ error: 'Valid price required.' });

    const [prod] = await db.query(
      'SELECT product_id FROM products WHERE product_id = ? AND added_by = ?',
      [req.params.id, req.session.user.user_id]
    );
    if (!prod.length) return res.status(404).json({ error: 'Product not found.' });

    // 1. Save price to DB immediately
    await db.query(
      'INSERT INTO price_history (product_id, price) VALUES (?, ?)',
      [req.params.id, price]
    );

    // 2. Check alerts (fast DB query — no email yet)
    const alertsCreated = await checkAndCreateAlerts(req.params.id, price);

    // 3. Respond IMMEDIATELY to user — don't wait for email
    res.json({
      message:           'Price updated.',
      new_price:         parseFloat(price),
      alerts_triggered:  alertsCreated.length,
      emails_dispatched: alertsCreated.length > 0 ? 'sending' : 0,
    });

    // 4. Send emails in BACKGROUND after response is sent
    // This prevents the "price update hangs" issue
    if (alertsCreated.length > 0) {
      sendEmailsInBackground(alertsCreated, price);
    }

  } catch (err) {
    console.error('[POST /products/:id/price]', err.message);
    res.status(500).json({ error: 'Failed to update price.' });
  }
});

// ── Background email sender (never blocks the response) ───────
async function sendEmailsInBackground(alertsCreated, price) {
  for (const alert of alertsCreated) {
    try {
      if (!alert.notify_email) continue;
      const sent = await sendPriceAlertEmail({
        toEmail:      alert.user_email,
        userName:     alert.user_name,
        productName:  alert.product_name,
        productUrl:   alert.url,
        productImage: alert.image_url,
        currentPrice: parseFloat(price),
        targetPrice:  parseFloat(alert.target_price),
        allTimeLow:   parseFloat(alert.all_time_low || price),
        dropPct:      alert.drop_pct || '0',
        category:     alert.category || 'Other',
      });
      if (sent) {
        await db.query('UPDATE alerts SET email_sent = TRUE WHERE alert_id = ?', [alert.alert_id]);
        console.log(`[Email] ✓ Sent to ${alert.user_email} for "${alert.product_name}"`);
      } else {
        console.log(`[Email] ✗ Failed for ${alert.user_email}`);
      }
    } catch (err) {
      console.error('[Email Background]', err.message);
    }
  }
}

// ── checkAndCreateAlerts — replaces SQL trigger ───────────────
async function checkAndCreateAlerts(productId, newPrice) {
  const created = [];
  try {
    const [matches] = await db.query(`
      SELECT w.watch_id, w.target_price, w.user_id,
        p.name AS product_name, p.url, p.image_url, p.category,
        u.email AS user_email, u.name AS user_name, u.notify_email,
        (SELECT MIN(ph.price) FROM price_history ph
         WHERE ph.product_id = p.product_id) AS all_time_low,
        (SELECT ph2.price FROM price_history ph2
         WHERE ph2.product_id = p.product_id
         ORDER BY ph2.recorded_at ASC LIMIT 1) AS first_price
      FROM watchlist w
      JOIN products p ON p.product_id = w.product_id
      JOIN users u    ON u.user_id    = w.user_id
      WHERE w.product_id = ?
        AND w.target_price >= ?
        AND w.is_active = TRUE
    `, [productId, newPrice]);

    for (const match of matches) {
      const [result] = await db.query(
        'INSERT INTO alerts (watch_id, triggered_price, triggered_at) VALUES (?, ?, NOW()) RETURNING alert_id',
        [match.watch_id, newPrice]
      );
      const dropPct = match.first_price > 0
        ? ((match.first_price - newPrice) / match.first_price * 100).toFixed(1)
        : '0';
      created.push({ ...match, alert_id: result[0].alert_id, drop_pct: dropPct });
    }
  } catch (err) {
    console.error('[checkAndCreateAlerts]', err.message);
  }
  return created;
}

// PUT /api/products/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, category, image_url } = req.body;
    await db.query(
      'UPDATE products SET name = ?, category = ?, image_url = ? WHERE product_id = ? AND added_by = ?',
      [name, category, image_url, req.params.id, req.session.user.user_id]
    );
    res.json({ message: 'Product updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM products WHERE product_id = ? AND added_by = ?',
      [req.params.id, req.session.user.user_id]
    );
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

module.exports = router;
module.exports.checkAndCreateAlerts = checkAndCreateAlerts;