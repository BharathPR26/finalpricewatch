/**
 * GET /api/predict/:product_id
 *
 * Calls the Python ML service and returns price predictions.
 * Falls back to a simple JS-based prediction if Python is unavailable.
 *
 * The Python service URL is set via ML_SERVICE_URL env variable.
 * Default: http://localhost:5001  (local dev)
 * Render:  https://your-ml-service.onrender.com
 */
const express         = require('express');
const fetch           = require('node-fetch');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

const ML_URL          = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const CACHE           = new Map();   // simple in-memory cache
const CACHE_TTL_MS    = 30 * 60 * 1000; // 30 minutes

// ── GET /api/predict/:product_id ──────────────────────────────
router.get('/:product_id', requireAuth, async (req, res) => {
  const productId = parseInt(req.params.product_id);
  if (isNaN(productId)) return res.status(400).json({ error: 'Invalid product ID.' });

  // Check cache first
  const cacheKey = `pred_${productId}`;
  const cached   = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(`[Predict] Cache hit for product ${productId}`);
    return res.json({ ...cached.data, from_cache: true });
  }

  // Verify product belongs to this user
  try {
    const [prod] = await db.query(
      'SELECT product_id, name FROM products WHERE product_id = ? AND added_by = ?',
      [productId, req.session.user.user_id]
    );
    if (!prod.length) return res.status(404).json({ error: 'Product not found.' });
  } catch (err) {
    return res.status(500).json({ error: 'Database error.' });
  }

  // Try Python ML service first
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const mlRes = await fetch(`${ML_URL}/predict/${productId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (mlRes.ok) {
      const data = await mlRes.json();
      // Cache the result
      CACHE.set(cacheKey, { data, ts: Date.now() });
      console.log(`[Predict] ML service OK for product ${productId}`);
      return res.json({ ...data, from_cache: false });
    }
  } catch (err) {
    console.log(`[Predict] ML service unavailable (${err.message}), using JS fallback`);
  }

  // ── JS Fallback — simple linear regression ──────────────────
  // Used when Python service is not running
  try {
    const result = await jsFallbackPredict(productId);
    CACHE.set(cacheKey, { data: result, ts: Date.now() });
    return res.json({ ...result, from_cache: false });
  } catch (err) {
    console.error('[Predict] JS fallback error:', err.message);
    return res.status(500).json({ error: 'Prediction failed: ' + err.message });
  }
});

// ── JavaScript Fallback Predictor ─────────────────────────────
// Simple linear regression built in Node.js — no Python needed
// Less accurate than Python ML but always available
async function jsFallbackPredict(productId) {
  const [history] = await db.query(
    `SELECT price::float AS price, recorded_at
     FROM   price_history
     WHERE  product_id = ?
     ORDER  BY recorded_at ASC`,
    [productId]
  );

  const [product] = await db.query(
    'SELECT name, category FROM products WHERE product_id = ?',
    [productId]
  );

  if (history.length < 3) {
    return {
      product_id:   productId,
      product_name: product[0]?.name || '',
      error:        `Need at least 3 price records (have ${history.length}).`,
      prediction:   [],
      insight:      'Update the price a few more times to enable predictions.',
      confidence:   0,
      trend:        'unknown',
    };
  }

  // Convert to arrays
  const prices = history.map(r => parseFloat(r.price));
  const n      = prices.length;

  // Simple linear regression: y = m*x + b
  const xs  = prices.map((_, i) => i);
  const xBar = xs.reduce((a,b) => a+b, 0) / n;
  const yBar = prices.reduce((a,b) => a+b, 0) / n;
  const num  = xs.reduce((s, x, i) => s + (x - xBar) * (prices[i] - yBar), 0);
  const den  = xs.reduce((s, x) => s + (x - xBar)**2, 0);
  const m    = den !== 0 ? num / den : 0;
  const b    = yBar - m * xBar;

  // R² score
  const ssTot = prices.reduce((s, p) => s + (p - yBar)**2, 0);
  const ssRes = prices.reduce((s, p, i) => s + (p - (m*i+b))**2, 0);
  const r2    = ssTot > 0 ? Math.max(0, 1 - ssRes/ssTot) : 0;

  // Predict next 7 days
  const lastDate   = new Date(history[history.length-1].recorded_at);
  const prediction = [];
  const predPrices = [];

  for (let i = 1; i <= 7; i++) {
    const futureDate = new Date(lastDate);
    futureDate.setDate(futureDate.getDate() + i);
    const predPrice  = Math.max(1, m * (n - 1 + i) + b);
    predPrices.push(predPrice);
    prediction.push({
      date:  futureDate.toISOString().split('T')[0],
      price: Math.round(predPrice * 100) / 100,
    });
  }

  // Insight
  const current    = prices[prices.length - 1];
  const lastPred   = predPrices[6];
  const pctChange  = ((lastPred - current) / current) * 100;
  const minPred    = Math.min(...predPrices);
  const minIdx     = predPrices.indexOf(minPred);
  const bestDay    = prediction[minIdx].date;
  const confidence = Math.round(Math.min(100, r2 * Math.min(1, n/10) * 100) * 10) / 10;

  let trend, insight;
  if (pctChange < -3) {
    trend   = 'falling';
    insight = `📉 Price trending down ${Math.abs(pctChange).toFixed(1)}% over next 7 days. Best price expected on ${bestDay} (₹${Math.round(minPred).toLocaleString('en-IN')}).`;
  } else if (pctChange > 3) {
    trend   = 'rising';
    insight = `📈 Price likely to rise ${Math.abs(pctChange).toFixed(1)}% over next 7 days. Consider buying now.`;
  } else {
    trend   = 'stable';
    insight = `➡️ Price looks stable over next 7 days. Lowest predicted: ₹${Math.round(minPred).toLocaleString('en-IN')} on ${bestDay}.`;
  }
  if (confidence < 40) insight += ` ⚠️ Low confidence — only ${n} price points available.`;

  // History for graph
  const historyGraph = history.slice(-14).map(r => ({
    date:  new Date(r.recorded_at).toISOString().split('T')[0],
    price: parseFloat(r.price),
  }));

  return {
    product_id:            productId,
    product_name:          product[0]?.name || '',
    current_price:         current,
    data_points:           n,
    r2_score:              Math.round(r2 * 10000) / 10000,
    prediction,
    history:               historyGraph,
    insight,
    trend,
    confidence,
    drop_detected:         pctChange < -5,
    best_buy_day:          bestDay,
    min_predicted:         Math.round(minPred * 100) / 100,
    max_predicted:         Math.round(Math.max(...predPrices) * 100) / 100,
    expected_change_pct:   Math.round(pctChange * 100) / 100,
    method:                'js_linear_regression',
  };
}

module.exports = router;