/**
 * GET /api/predict/:product_id
 * Pure JS Linear Regression predictor — no Python needed.
 * Works on Render free tier without any extra service.
 * Cached 30 minutes to avoid repeated computation.
 */
const express         = require('express');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

// 30-minute cache
const CACHE     = new Map();
const CACHE_TTL = 30 * 60 * 1000;

router.get('/:product_id', requireAuth, async (req, res) => {
  const pid = parseInt(req.params.product_id);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid product ID.' });

  // Cache hit
  const hit = CACHE.get(pid);
  if (hit && Date.now() - hit.ts < CACHE_TTL)
    return res.json({ ...hit.data, cached: true });

  // Verify ownership
  const [prod] = await db.query(
    'SELECT product_id, name, category FROM products WHERE product_id = ? AND added_by = ?',
    [pid, req.session.user.user_id]
  ).catch(() => [[]]);
  if (!prod.length) return res.status(404).json({ error: 'Product not found.' });

  // Fetch price history
  const [history] = await db.query(
    `SELECT price::float AS price, recorded_at
     FROM price_history WHERE product_id = ?
     ORDER BY recorded_at ASC`,
    [pid]
  ).catch(() => [[]]);

  if (history.length < 3) {
    return res.json({
      product_id:   pid,
      product_name: prod[0].name,
      error:        `Need at least 3 price records (currently ${history.length}). Update price ${3 - history.length} more time(s).`,
      prediction:   [],
      insight:      'Not enough data yet.',
      trend:        'unknown',
      confidence:   0,
    });
  }

  const result = buildPrediction(pid, prod[0].name, prod[0].category, history);
  CACHE.set(pid, { data: result, ts: Date.now() });
  res.json({ ...result, cached: false });
});

// ── Core prediction engine ─────────────────────────────────────
function buildPrediction(pid, name, category, history) {
  const prices = history.map(r => parseFloat(r.price));
  const n      = prices.length;

  // --- Linear regression: y = m*x + b ---
  const xs   = Array.from({ length: n }, (_, i) => i);
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = prices.reduce((a, b) => a + b, 0) / n;
  const num  = xs.reduce((s, x, i) => s + (x - xBar) * (prices[i] - yBar), 0);
  const den  = xs.reduce((s, x)    => s + (x - xBar) ** 2, 0);
  const m    = den !== 0 ? num / den : 0;
  const b    = yBar - m * xBar;

  // R² score (model accuracy)
  const ssTot = prices.reduce((s, p) => s + (p - yBar) ** 2, 0);
  const ssRes = prices.reduce((s, p, i) => s + (p - (m * i + b)) ** 2, 0);
  const r2    = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  // --- Predict next 7 days ---
  const lastDate   = new Date(history[history.length - 1].recorded_at);
  const prediction = [];
  for (let i = 1; i <= 7; i++) {
    const futureDate = new Date(lastDate);
    futureDate.setDate(futureDate.getDate() + i);
    const predPrice = Math.max(1, m * (n - 1 + i) + b);
    prediction.push({
      date:  futureDate.toISOString().split('T')[0],
      price: Math.round(predPrice * 100) / 100,
    });
  }

  // --- Analysis ---
  const current   = prices[prices.length - 1];
  const predPrices = prediction.map(p => p.price);
  const minPred   = Math.min(...predPrices);
  const maxPred   = Math.max(...predPrices);
  const minIdx    = predPrices.indexOf(minPred);
  const bestDay   = prediction[minIdx].date;
  const lastPred  = predPrices[6];
  const pctChange = ((lastPred - current) / current) * 100;
  const savings   = current - minPred;

  // Drop detection: any single day drop > 5%
  const dropDetected = predPrices.some((p, i) =>
    i > 0 && (p - predPrices[i - 1]) / predPrices[i - 1] * 100 < -5
  );

  // Confidence: R² × data factor (need 10 points for full confidence)
  const confidence = Math.round(Math.min(100, r2 * Math.min(1, n / 10) * 100) * 10) / 10;

  // Trend & insight
  let trend, insight, recommendation;
  if (pctChange < -3) {
    trend          = 'falling';
    recommendation = 'WAIT';
    insight = dropDetected
      ? `🚨 Sharp price drop predicted! Price expected to fall by ₹${Math.abs(savings).toFixed(0)} in ${minIdx + 1} day(s). Best time to buy: ${bestDay}.`
      : `📉 Price is trending down ${Math.abs(pctChange).toFixed(1)}% over next 7 days. Best time to buy: ${bestDay} at ₹${Math.round(minPred).toLocaleString('en-IN')}.`;
  } else if (pctChange > 3) {
    trend          = 'rising';
    recommendation = 'BUY NOW';
    insight        = `📈 Price likely to rise ${Math.abs(pctChange).toFixed(1)}% over 7 days. Buy now — current price ₹${Math.round(current).toLocaleString('en-IN')} is the best available.`;
  } else {
    trend          = 'stable';
    recommendation = 'MONITOR';
    insight        = `➡️ Price is stable (±${Math.abs(pctChange).toFixed(1)}%). No rush to buy. Lowest predicted: ₹${Math.round(minPred).toLocaleString('en-IN')} on ${bestDay}.`;
  }
  if (confidence < 40)
    insight += ` ⚠️ Low confidence — update price more often for better accuracy.`;

  // History for graph (last 14 entries)
  const historyGraph = history.slice(-14).map(r => ({
    date:  new Date(r.recorded_at).toISOString().split('T')[0],
    price: parseFloat(r.price),
  }));

  return {
    product_id:          pid,
    product_name:        name,
    product_category:    category,
    current_price:       current,
    data_points:         n,
    r2_score:            Math.round(r2 * 10000) / 10000,
    prediction,
    history:             historyGraph,
    insight,
    trend,
    recommendation,
    confidence,
    drop_detected:       dropDetected,
    best_buy_day:        bestDay,
    min_predicted:       Math.round(minPred * 100) / 100,
    max_predicted:       Math.round(maxPred * 100) / 100,
    expected_savings:    Math.max(0, Math.round(savings * 100) / 100),
    expected_change_pct: Math.round(pctChange * 100) / 100,
  };
}

module.exports = router;