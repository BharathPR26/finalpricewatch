const express        = require('express');
const cors           = require('cors');
const session        = require('express-session');
const pgSession      = require('connect-pg-simple')(session);
const path           = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Import db first — it creates the single shared pool
const db                      = require('./db');
const { sendPriceAlertEmail } = require('./mailer');
const { scrapeProduct }       = require('./scraper');
const authRoutes              = require('./routes/auth');
const productRoutes           = require('./routes/products');
const watchRoutes             = require('./routes/watchlist');
const alertRoutes             = require('./routes/alerts');
const scrapeRoutes            = require('./routes/scrape');
const aiChatRoutes            = require('./routes/ai-chat');
const predictRoutes           = require('./routes/predict');

const app    = express();
const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Trust Render's proxy (required for secure HTTPS cookies) ──
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session — reuse db.pool (no second connection pool!) ───────
app.use(session({
  store: new pgSession({
    pool:                 db.pool,   // ← shared pool from db.js
    tableName:            'session',
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 60,
    errorLog:             console.error,
  }),
  secret:            process.env.SESSION_SECRET || 'pricewatch_secret_change_me',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  name:              'pw_session',
  cookie: {
    maxAge:   1000 * 60 * 60 * 24 * 7,
    secure:   isProd,
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
  },
}));

// ── Static frontend ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/products',  productRoutes);
app.use('/api/watchlist', watchRoutes);
app.use('/api/alerts',    alertRoutes);
app.use('/api/scrape',    scrapeRoutes);
app.use('/api/ai-chat',   aiChatRoutes);
app.use('/api/predict',   predictRoutes);

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date(), env: process.env.NODE_ENV }));

// ── Cron endpoint — called by cron-job.org every 6 hours ───────
app.get('/api/cron/check-prices', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (key !== (process.env.CRON_SECRET || 'pricewatch_cron')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Respond immediately — don't make cron-job.org wait
  res.json({ message: 'Price check started', time: new Date() });
  // Run in background
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
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        console.log(`[AutoScrape] ✗ ${product.name}: ${err.message}`);
      }
    }
    console.log('[AutoScrape] Done.\n');
  } catch (err) {
    console.error('[AutoScrape] Fatal:', err.message);
  }
}

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error. Please try again.' });
});

// ── URL Route Handler ─────────────────────────────────────────
// All these URLs serve index.html — JS router handles the rest
// This makes https://pricewatch.onrender.com/login work properly
const SPA_ROUTES = [
  '/', '/login', '/register', '/dashboard',
  '/products', '/watchlist', '/alerts', '/settings', '/predict',
];
SPA_ROUTES.forEach(r => {
  app.get(r, (req, res) =>
    res.sendFile(path.join(__dirname, '../frontend/index.html')));
});

// /products/:id → serve index.html, JS picks up the ID
app.get('/products/:id', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Catch-all SPA fallback
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔔 PriceWatch v2 → http://localhost:${PORT}`);
  console.log(`   Session : Supabase PostgreSQL (shared pool)`);
  console.log(`   Email   : ${process.env.GMAIL_USER || 'not configured'}`);
  console.log(`   Mode    : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { runAutoScrape };