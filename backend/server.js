const express        = require('express');
const cors           = require('cors');
const session        = require('express-session');
const pgSession      = require('connect-pg-simple')(session);
const path           = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db                      = require('./db');
const { sendPriceAlertEmail } = require('./mailer');
const { scrapeProduct }       = require('./scraper');
const authRoutes              = require('./routes/auth');
const productRoutes           = require('./routes/products');
const watchRoutes             = require('./routes/watchlist');
const alertRoutes             = require('./routes/alerts');
const scrapeRoutes            = require('./routes/scrape');
const predictRoutes           = require('./routes/predict');
const aiChatRoutes            = require('./routes/ai-chat');

const app    = express();
const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Trust Render proxy (required for HTTPS cookies) ───────────
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session (stored in Supabase PostgreSQL) ────────────────────
app.use(session({
  store: new pgSession({
    pool:                 db.pool,
    tableName:            'session',
    createTableIfMissing: false,
    pruneSessionInterval: 3600,
    errorLog:             console.error,
  }),
  secret:            process.env.SESSION_SECRET || 'pricewatch_secret',
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
app.use('/api/predict',   predictRoutes);
app.use('/api/ai-chat',   aiChatRoutes);

// ── Health check (used by cron-job.org keep-alive) ─────────────
app.get('/api/health', (req, res) =>
  res.json({ status:'ok', time:new Date(), env:process.env.NODE_ENV }));

// ── Auto Price Check — called by cron-job.org every 6 hours ───
// URL: GET /api/cron/check-prices?key=YOUR_CRON_SECRET
app.get('/api/cron/check-prices', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  const expected = process.env.CRON_SECRET || 'pricewatch_cron_2024';
  if (key !== expected) {
    console.log('[Cron] Unauthorized attempt — wrong key');
    return res.status(401).json({ error:'Unauthorized' });
  }
  // Respond immediately so cron-job.org doesn't timeout
  res.json({ message:'Price check started', time:new Date() });
  // Run in background
  runAutoScrape().catch(err => console.error('[Cron Fatal]', err.message));
});

// ── SPA URL Routes ─────────────────────────────────────────────
// Each URL serves index.html — JS handles routing client-side
[
  '/', '/login', '/register', '/dashboard',
  '/products', '/watchlist', '/alerts',
  '/settings', '/predict', '/reset-password',
].forEach(r => app.get(r, (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/index.html'))));

// /products/:id → serve index.html
app.get('/products/:id', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Catch-all fallback
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ══════════════════════════════════════════════════════════════
// AUTO PRICE SCRAPER — runs every 6 hours via cron-job.org
// ══════════════════════════════════════════════════════════════
async function runAutoScrape() {
  console.log('\n[AutoScrape] ─── Starting scheduled price check ───');

  let updated = 0, unchanged = 0, failed = 0;

  try {
    // Get all products that are actively being watched
    const [products] = await db.query(`
      SELECT DISTINCT
        p.product_id, p.name, p.url, p.image_url, p.category,
        (SELECT ph.price::float FROM price_history ph
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
          console.log(`[AutoScrape] ✗ ${product.name} — ${result.error || 'no price'}`);
          failed++;
          // Delay between requests
          await delay(3000);
          continue;
        }

        const newPrice  = parseFloat(result.price);
        const lastPrice = parseFloat(product.last_price || 0);

        // Skip if price hasn't changed (avoid duplicate entries)
        if (lastPrice && Math.abs(newPrice - lastPrice) < 0.01) {
          console.log(`[AutoScrape] = ${product.name} — ₹${newPrice} (unchanged)`);
          unchanged++;
          await delay(2000);
          continue;
        }

        // Save new price to DB
        await db.query(
          'INSERT INTO price_history (product_id, price) VALUES (?, ?)',
          [product.product_id, newPrice]
        );

        const direction = lastPrice
          ? (newPrice < lastPrice ? `↓ dropped ₹${(lastPrice-newPrice).toFixed(0)}` : `↑ rose ₹${(newPrice-lastPrice).toFixed(0)}`)
          : 'first record';
        console.log(`[AutoScrape] ✓ ${product.name} — ₹${newPrice} (${direction})`);

        // Check watchlist targets and fire alerts
        const { checkAndCreateAlerts } = require('./routes/products');
        const alerts = await checkAndCreateAlerts(product.product_id, newPrice);

        // Send emails for triggered alerts
        for (const alert of alerts) {
          if (!alert.notify_email) continue;
          const sent = await sendPriceAlertEmail({
            toEmail:      alert.user_email,
            userName:     alert.user_name,
            productName:  alert.product_name,
            productUrl:   alert.url,
            productImage: alert.image_url,
            currentPrice: newPrice,
            targetPrice:  parseFloat(alert.target_price),
            allTimeLow:   parseFloat(alert.all_time_low || newPrice),
            dropPct:      alert.drop_pct || '0',
            category:     alert.category || 'Other',
          });
          if (sent) {
            await db.query('UPDATE alerts SET email_sent = TRUE WHERE alert_id = ?', [alert.alert_id]);
          }
        }

        if (alerts.length) console.log(`[AutoScrape] 🔔 ${alerts.length} alert(s) fired for ${product.name}`);
        updated++;

      } catch (err) {
        console.log(`[AutoScrape] ✗ Error for ${product.name}: ${err.message}`);
        failed++;
      }

      // Polite delay between requests (avoids rate limiting)
      await delay(4000);
    }

    console.log(`[AutoScrape] ─── Done: Updated=${updated} Unchanged=${unchanged} Failed=${failed} ───\n`);

  } catch (err) {
    console.error('[AutoScrape] Fatal error:', err.message);
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔔 PriceWatch v2 → http://localhost:${PORT}`);
  console.log(`   Session : Supabase PostgreSQL`);
  console.log(`   Email   : ${process.env.GMAIL_USER || '⚠️  not configured'}`);
  console.log(`   Cron    : External via cron-job.org (every 6h)`);
  console.log(`   Mode    : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { runAutoScrape };