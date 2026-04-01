const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db                      = require('./db');
const { sendPriceAlertEmail } = require('./mailer');
const { scrapeProduct }       = require('./scraper');
const authRoutes              = require('./routes/auth');
const productRoutes           = require('./routes/products');
const watchRoutes             = require('./routes/watchlist');
const alertRoutes             = require('./routes/alerts');
const scrapeRoutes            = require('./routes/scrape');

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── CRITICAL: Trust Render's proxy (fixes secure cookies) ──────
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────
// Allow requests from the same Render domain
const FRONTEND_URL = process.env.FRONTEND_URL || '';
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);
    // Allow any render.com domain and localhost
    if (
      origin.includes('onrender.com') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      (FRONTEND_URL && origin === FRONTEND_URL)
    ) {
      return callback(null, true);
    }
    callback(null, true); // allow all for now — tighten later
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── SESSION ────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'pricewatch_secret_change_me',
  resave:            true,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    maxAge:   1000 * 60 * 60 * 24 * 7, // 7 days
    secure:   isProd,   // HTTPS only on Render
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax', // 'none' needed for cross-origin on Render
  },
}));

// ── Debug middleware (remove after confirming it works) ────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${req.method}] ${req.path} | session user: ${req.session?.user?.email || 'none'}`);
  }
  next();
});

// ── Static frontend ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/products',  productRoutes);
app.use('/api/watchlist', watchRoutes);
app.use('/api/alerts',    alertRoutes);
app.use('/api/scrape',    scrapeRoutes);

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date(), version: '2.0', env: process.env.NODE_ENV }));

// ── Cron endpoint — called by cron-job.org every 6 hours ───────
app.get('/api/cron/check-prices', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (key !== (process.env.CRON_SECRET || 'pricewatch_cron')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ message: 'Price check started', time: new Date() });
  runAutoScrape().catch(console.error);
});

// ── Auto price scraping ────────────────────────────────────────
async function runAutoScrape() {
  console.log('\n[AutoScrape] Starting price check...');
  try {
    const [products] = await db.query(`
      SELECT DISTINCT p.product_id, p.name, p.url,
        p.image_url, p.category,
        (SELECT ph.price FROM price_history ph
         WHERE ph.product_id = p.product_id
         ORDER BY ph.recorded_at DESC LIMIT 1) AS last_price
      FROM products p
      JOIN watchlist w ON w.product_id = p.product_id
      WHERE w.is_active = TRUE
    `);

    if (!products.length) {
      console.log('[AutoScrape] No watched products found.');
      return;
    }

    console.log(`[AutoScrape] Checking ${products.length} product(s)...`);

    for (const product of products) {
      try {
        const result = await scrapeProduct(product.url);
        if (!result.success || !result.price) {
          console.log(`[AutoScrape] ✗ No price: ${product.name}`);
          continue;
        }

        const newPrice  = parseFloat(result.price);
        const lastPrice = parseFloat(product.last_price);

        if (lastPrice && Math.abs(newPrice - lastPrice) < 0.01) {
          console.log(`[AutoScrape] = Unchanged ₹${newPrice}: ${product.name}`);
          continue;
        }

        await db.query(
          'INSERT INTO price_history (product_id, price) VALUES (?, ?)',
          [product.product_id, newPrice]
        );

        const { checkAndCreateAlerts } = require('./routes/products');
        const alertsCreated = await checkAndCreateAlerts(product.product_id, newPrice);

        for (const alert of alertsCreated) {
          if (!alert.notify_email) continue;
          const sent = await sendPriceAlertEmail({
            toEmail:      alert.user_email,
            userName:     alert.user_name,
            productName:  alert.product_name,
            productUrl:   alert.url,
            productImage: alert.image_url,
            currentPrice: newPrice,
            targetPrice:  alert.target_price,
            allTimeLow:   alert.all_time_low,
            dropPct:      alert.drop_pct,
            category:     alert.category,
          });
          if (sent) await db.query(
            'UPDATE alerts SET email_sent = TRUE WHERE alert_id = ?',
            [alert.alert_id]
          );
        }

        console.log(`[AutoScrape] ✓ ₹${newPrice}: ${product.name}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.log(`[AutoScrape] ✗ ${product.name}: ${err.message}`);
      }
    }
    console.log('[AutoScrape] Done.\n');
  } catch (err) {
    console.error('[AutoScrape] Fatal:', err.message);
  }
}

// ── Send pending emails ────────────────────────────────────────
async function sendPendingEmails() {
  try {
    const [pending] = await db.query(`
      SELECT a.alert_id, a.triggered_price, w.target_price,
        p.name AS product_name, p.url, p.image_url, p.category,
        u.email AS user_email, u.name AS user_name, u.notify_email,
        (SELECT MIN(ph.price) FROM price_history ph WHERE ph.product_id = p.product_id) AS all_time_low,
        (SELECT ph2.price FROM price_history ph2 WHERE ph2.product_id = p.product_id
         ORDER BY ph2.recorded_at ASC LIMIT 1) AS first_price
      FROM alerts a
      JOIN watchlist w ON w.watch_id   = a.watch_id
      JOIN products  p ON p.product_id = w.product_id
      JOIN users     u ON u.user_id    = w.user_id
      WHERE a.email_sent = FALSE AND u.notify_email = TRUE
      LIMIT 20
    `);

    for (const alert of pending) {
      const dropPct = alert.first_price > 0
        ? ((alert.first_price - alert.triggered_price) / alert.first_price * 100).toFixed(1)
        : '0';
      const sent = await sendPriceAlertEmail({
        toEmail:      alert.user_email,
        userName:     alert.user_name,
        productName:  alert.product_name,
        productUrl:   alert.url,
        productImage: alert.image_url,
        currentPrice: alert.triggered_price,
        targetPrice:  alert.target_price,
        allTimeLow:   alert.all_time_low,
        dropPct,
        category:     alert.category,
      });
      if (sent) await db.query(
        'UPDATE alerts SET email_sent = TRUE WHERE alert_id = ?',
        [alert.alert_id]
      );
    }
  } catch (err) {
    console.error('[Email]', err.message);
  }
}

// ── SPA Fallback ───────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔔 PriceWatch v2 → http://localhost:${PORT}`);
  console.log(`   DB    : Supabase PostgreSQL`);
  console.log(`   Email : ${process.env.GMAIL_USER || 'not configured'}`);
  console.log(`   Cron  : External via cron-job.org`);
  console.log(`   Env   : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { runAutoScrape, sendPendingEmails };