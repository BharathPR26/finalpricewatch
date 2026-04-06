/**
 * PriceWatch AI Shopping Assistant
 * POST /api/ai-chat
 *
 * Free AI tier priority:
 *   1. Google Gemini (GEMINI_API_KEY) — FREE, 1500 requests/day
 *   2. Rule-based fallback             — always works, no key needed
 *
 * How to get free Gemini key:
 *   → aistudio.google.com → Get API Key → free forever
 */

const express         = require('express');
const fetch           = require('node-fetch');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

// Per-user chat history (in memory, last 8 turns)
const chatHistory = new Map();
const MAX_TURNS   = 8;

// ── Intent detector ───────────────────────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (/should i buy|buy now|buy or wait|worth buying|good time/.test(m)) return 'should_buy';
  if (/compare|vs\.?\s|versus|which is better|difference/.test(m))        return 'compare';
  if (/best.*under|budget|cheap|under ₹|under rs/.test(m))                return 'best_under';
  if (/pros.*cons|advantages?|disadvantages?|good.*bad/.test(m))          return 'pros_cons';
  if (/price.*trend|price.*drop|price.*history|price.*change/.test(m))    return 'price_trend';
  if (/my products?|what.*tracking|my list|i.*tracking/.test(m))          return 'my_products';
  if (/watchlist|watching|my target/.test(m))                              return 'my_watchlist';
  if (/hello|hi\b|hey\b|help|what can you/.test(m))                       return 'greeting';
  return 'general';
}

// ── Budget extractor ──────────────────────────────────────────
function extractBudget(msg) {
  const m = msg.toLowerCase();
  let match;
  if ((match = m.match(/(\d+)\s*k\b/)))         return parseInt(match[1]) * 1000;
  if ((match = m.match(/₹\s*(\d[\d,]*)/)))       return parseInt(match[1].replace(/,/g,''));
  if ((match = m.match(/rs\.?\s*(\d[\d,]*)/i)))  return parseInt(match[1].replace(/,/g,''));
  if ((match = m.match(/under\s+(\d[\d,]*)/)))   return parseInt(match[1].replace(/,/g,''));
  if ((match = m.match(/(\d{4,6})/)))            return parseInt(match[1]);
  return 25000;
}

// ── Fetch user context from DB ────────────────────────────────
async function fetchContext(userId, productId, intent) {
  const ctx = { products:[], watchlist:[], priceHistory:[], trend:null };
  const sources = [];

  // User's products with price stats
  try {
    const [rows] = await db.query(`
      SELECT p.product_id, p.name, p.category, p.url,
        (SELECT ph.price FROM price_history ph WHERE ph.product_id=p.product_id
         ORDER BY ph.recorded_at DESC LIMIT 1)::float AS current_price,
        (SELECT ph2.price FROM price_history ph2 WHERE ph2.product_id=p.product_id
         ORDER BY ph2.recorded_at ASC LIMIT 1)::float AS first_price,
        MIN(ph3.price::float) AS all_time_low,
        COUNT(ph3.ph_id) AS data_points
      FROM products p
      LEFT JOIN price_history ph3 ON ph3.product_id=p.product_id
      WHERE p.added_by=?
      GROUP BY p.product_id,p.name,p.category,p.url
      ORDER BY p.created_at DESC LIMIT 15
    `, [userId]);
    ctx.products = rows;
    sources.push('products');
  } catch(e) { console.error('[AI ctx products]', e.message); }

  // Watchlist
  try {
    const [rows] = await db.query(`
      SELECT w.target_price::float, w.watch_id, p.name, p.category,
        (SELECT ph.price FROM price_history ph WHERE ph.product_id=p.product_id
         ORDER BY ph.recorded_at DESC LIMIT 1)::float AS current_price,
        (SELECT MIN(ph2.price) FROM price_history ph2 WHERE ph2.product_id=p.product_id)::float AS all_time_low
      FROM watchlist w JOIN products p ON p.product_id=w.product_id
      WHERE w.user_id=? AND w.is_active=TRUE
    `, [userId]);
    ctx.watchlist = rows;
    sources.push('watchlist');
  } catch(e) { console.error('[AI ctx watchlist]', e.message); }

  // Price history for current product
  if (productId) {
    try {
      const [rows] = await db.query(
        `SELECT price::float AS price, recorded_at FROM price_history WHERE product_id=? ORDER BY recorded_at ASC`,
        [productId]
      );
      ctx.priceHistory = rows;
      if (rows.length >= 2) ctx.trend = calcTrend(rows);
      sources.push('price_history');
    } catch(e) { console.error('[AI ctx history]', e.message); }
  }

  return { ctx, sources };
}

// ── Trend calculator ──────────────────────────────────────────
function calcTrend(history) {
  const prices = history.map(h => parseFloat(h.price));
  const first  = prices[0], last = prices[prices.length-1];
  const min    = Math.min(...prices), max = Math.max(...prices);
  const pct    = ((last - first) / first * 100).toFixed(1);
  const n      = prices.length;
  const xBar   = (n-1)/2;
  const yBar   = prices.reduce((a,b)=>a+b,0)/n;
  const slope  = prices.reduce((s,p,i)=>s+(i-xBar)*(p-yBar),0) /
                 prices.reduce((s,_,i)=>s+(i-xBar)**2,0);
  return {
    trend:     slope < -30 ? 'falling' : slope > 30 ? 'rising' : 'stable',
    change_pct: parseFloat(pct),
    current:   last, first, all_time_low: min, all_time_high: max,
    data_points: n,
  };
}

// ── Build system prompt with real user data ───────────────────
function buildPrompt(ctx, intent, userName) {
  let prompt = `You are PriceWatch AI — an intelligent shopping assistant built into a price tracking web app.
You help ${userName || 'the user'} make smart buying decisions using their REAL tracked product data shown below.

RULES:
- Be concise (max 3 short paragraphs)
- Use ₹ for Indian Rupee
- Give specific numbers from the data, not generic advice
- Use emojis for readability
- Only discuss products in the user's tracked list
- End with a clear recommendation (BUY NOW / WAIT / MONITOR)

`;

  if (ctx.products.length) {
    prompt += `USER'S ${ctx.products.length} TRACKED PRODUCTS:\n`;
    ctx.products.forEach(p => {
      const drop = p.first_price && p.current_price
        ? ((p.first_price - p.current_price)/p.first_price*100).toFixed(1) : '0';
      prompt += `• ${p.name} [${p.category}] — Current: ₹${p.current_price?.toLocaleString('en-IN')||'N/A'} | ATL: ₹${p.all_time_low?.toLocaleString('en-IN')||'N/A'} | Drop: ${drop}% | ${p.data_points} records\n`;
    });
    prompt += '\n';
  }

  if (ctx.watchlist.length) {
    prompt += `WATCHLIST (${ctx.watchlist.length} items with targets):\n`;
    ctx.watchlist.forEach(w => {
      const gap    = w.current_price && w.target_price ? w.current_price - w.target_price : null;
      const status = gap != null ? (gap <= 0 ? '✅ TARGET HIT' : `₹${Math.round(gap)} above target`) : '—';
      prompt += `• ${w.name}: Target ₹${w.target_price?.toLocaleString('en-IN')} | Current ₹${w.current_price?.toLocaleString('en-IN')||'N/A'} | ${status}\n`;
    });
    prompt += '\n';
  }

  if (ctx.trend) {
    const t = ctx.trend;
    prompt += `CURRENT PRODUCT PRICE TREND:\n`;
    prompt += `• Direction: ${t.trend.toUpperCase()} (slope ${t.change_pct > 0 ? '+' : ''}${t.change_pct}%)\n`;
    prompt += `• Range: ATL ₹${t.all_time_low?.toLocaleString('en-IN')} → ATH ₹${t.all_time_high?.toLocaleString('en-IN')}\n`;
    prompt += `• Data points: ${t.data_points}\n\n`;
  }

  const intentGuide = {
    should_buy:   'Give a clear BUY NOW / WAIT / MONITOR verdict based on trend and price position.',
    compare:      'Compare the mentioned products side-by-side. Give a clear winner.',
    best_under:   'Recommend the best option from user\'s products within their budget.',
    pros_cons:    'List specific pros and cons using the price data.',
    price_trend:  'Explain the price trend clearly. Predict near-future direction.',
    my_products:  'Summarize all tracked products. Highlight best deals.',
    my_watchlist: 'Report watchlist status. Identify which items are closest to targets.',
    greeting:     'Greet the user and explain what you can help with based on their product data.',
    general:      'Answer helpfully using available product data.',
  };

  prompt += `TASK: ${intentGuide[intent] || intentGuide.general}\n`;
  return prompt;
}

// ── Google Gemini API (FREE — 1500 req/day) ───────────────────
async function callGemini(systemPrompt, history, userMessage) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  // Build conversation history for Gemini
  const recentHistory = history.slice(-6);
  const contents = [];

  // Gemini doesn't have system role — prepend to first user message
  let firstUserMsg = `[CONTEXT]\n${systemPrompt}\n[END CONTEXT]\n\n${userMessage}`;

  if (recentHistory.length > 1) {
    // Add prior turns
    recentHistory.slice(0, -1).forEach(h => {
      contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts:[{text:h.content}] });
    });
    firstUserMsg = userMessage; // context already in history
  }
  contents.push({ role:'user', parts:[{text: recentHistory.length > 1 ? userMessage : firstUserMsg}] });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents,
        systemInstruction: recentHistory.length > 1 ? { parts:[{text:systemPrompt}] } : undefined,
        generationConfig:  { maxOutputTokens: 600, temperature: 0.7 },
        safetySettings: [
          { category:'HARM_CATEGORY_HARASSMENT',        threshold:'BLOCK_NONE' },
          { category:'HARM_CATEGORY_HATE_SPEECH',        threshold:'BLOCK_NONE' },
          { category:'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold:'BLOCK_NONE' },
          { category:'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold:'BLOCK_NONE' },
        ],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return { reply:text, model:'gemini-2.0-flash-lite' };
}

// ── Rule-based fallback (zero API key) ───────────────────────
function ruleBasedFallback(intent, ctx, message, userName) {
  const name = userName || 'there';

  if (intent === 'greeting') {
    const count = ctx.products.length;
    return `👋 Hi ${name}! I'm your AI Shopping Assistant.\n\nI can see you're tracking **${count} product${count!==1?'s':''}**. Here's what I can help you with:\n\n• 📉 "Should I buy [product] now?"\n• ⚖️ "Compare [product A] vs [product B]"\n• 💰 "Best product under ₹20,000"\n• 📊 "My watchlist status"\n\n🔑 For smarter AI responses, add a **free Gemini API key** — see Settings.`;
  }

  if (intent === 'should_buy' && ctx.trend) {
    const t = ctx.trend;
    if (t.trend === 'falling')
      return `📉 **Wait!** Price is trending down ${Math.abs(t.change_pct)}% since tracking started. All-time low is ₹${t.all_time_low?.toLocaleString('en-IN')}.\n\n🎯 **Recommendation: WAIT** — Set your target price and you'll get a Gmail alert automatically when it hits.`;
    if (t.trend === 'rising')
      return `📈 **Buy Now!** Price is rising ${t.change_pct}% since tracking. Current ₹${t.current?.toLocaleString('en-IN')} may be the best you'll see for a while.\n\n🎯 **Recommendation: BUY NOW** — Price looks like it'll keep going up.`;
    return `➡️ **Price is stable.** No strong signal either way.\n\n🎯 **Recommendation: MONITOR** — Set a target price in your watchlist. You'll get an automatic Gmail alert if it drops.`;
  }

  if (intent === 'my_watchlist') {
    if (!ctx.watchlist.length) return `👁️ Your watchlist is empty. Open any product and click "🎯 Set Target" to add it.`;
    const hit   = ctx.watchlist.filter(w => w.current_price <= w.target_price);
    const close = ctx.watchlist.filter(w => w.current_price > w.target_price && (w.current_price - w.target_price)/w.target_price < 0.1);
    let reply = `👁️ **Watchlist — ${ctx.watchlist.length} item${ctx.watchlist.length!==1?'s':''}**\n\n`;
    if (hit.length) reply += `✅ **TARGET HIT:** ${hit.map(w=>w.name).join(', ')}\n\n`;
    if (close.length) reply += `🔥 **Almost there:** ${close.map(w=>`${w.name} (₹${Math.round(w.current_price-w.target_price)} away)`).join(', ')}\n\n`;
    reply += `🤖 Gmail alerts fire automatically when any target is hit!`;
    return reply;
  }

  if (intent === 'my_products') {
    if (!ctx.products.length) return `📭 No products tracked yet. Click **+ Add Product** to start!`;
    const best = ctx.products.filter(p=>p.first_price&&p.current_price&&p.first_price>p.current_price)
      .sort((a,b)=>((b.first_price-b.current_price)/b.first_price)-((a.first_price-a.current_price)/a.first_price));
    let reply = `🛍️ **Tracking ${ctx.products.length} product${ctx.products.length!==1?'s':''}:**\n\n`;
    ctx.products.slice(0,5).forEach(p=>{
      const drop = p.first_price&&p.current_price ? ((p.first_price-p.current_price)/p.first_price*100).toFixed(1) : 0;
      reply += `• **${p.name}** — ₹${p.current_price?.toLocaleString('en-IN')||'N/A'}${drop>0?` ↓${drop}%`:''}\n`;
    });
    if (best.length) reply += `\n🏆 **Best deal:** ${best[0].name} dropped ${((best[0].first_price-best[0].current_price)/best[0].first_price*100).toFixed(1)}%`;
    return reply;
  }

  if (intent === 'best_under') {
    const budget  = extractBudget(message);
    const matches = ctx.products.filter(p => p.current_price && p.current_price <= budget)
      .sort((a,b) => {
        const aScore = a.first_price ? (a.first_price-a.current_price)/a.first_price : 0;
        const bScore = b.first_price ? (b.first_price-b.current_price)/b.first_price : 0;
        return bScore - aScore;
      });
    if (!matches.length) return `💰 None of your tracked products are under ₹${budget.toLocaleString('en-IN')}. Click **+ Add Product** to track more items!`;
    let reply = `💰 **Under ₹${budget.toLocaleString('en-IN')} — ${matches.length} option${matches.length!==1?'s':''}:**\n\n`;
    matches.slice(0,4).forEach(p=>{
      const drop = p.first_price&&p.current_price ? ((p.first_price-p.current_price)/p.first_price*100).toFixed(1) : 0;
      reply += `• **${p.name}** — ₹${p.current_price?.toLocaleString('en-IN')}${drop>0?` (↓${drop}% from original)`:''}\n`;
    });
    if (matches[0]) reply += `\n🏆 **Best pick:** ${matches[0].name}`;
    return reply;
  }

  if (intent === 'compare') {
    const words   = message.toLowerCase().split(/\s+/);
    const matched = ctx.products.filter(p =>
      words.some(w => w.length>3 && p.name.toLowerCase().includes(w)));
    if (matched.length < 2) return `⚖️ I found **${matched.length}** matching product${matched.length===1?'':'s'} in your list. Make sure both products are tracked. Try: "Compare Sony headphones vs JBL speaker"`;
    const [p1,p2] = matched;
    const winner = (!p1.current_price||!p2.current_price) ? null :
      p1.current_price < p2.current_price ? p1 : p2;
    const d1 = p1.first_price&&p1.current_price ? ((p1.first_price-p1.current_price)/p1.first_price*100).toFixed(1) : 0;
    const d2 = p2.first_price&&p2.current_price ? ((p2.first_price-p2.current_price)/p2.first_price*100).toFixed(1) : 0;
    return `⚖️ **${p1.name} vs ${p2.name}**\n\n📊 **${p1.name}**: ₹${p1.current_price?.toLocaleString('en-IN')||'N/A'} | Drop: ${d1}% | ${p1.data_points} records\n📊 **${p2.name}**: ₹${p2.current_price?.toLocaleString('en-IN')||'N/A'} | Drop: ${d2}% | ${p2.data_points} records\n\n${winner ? `🏆 **${winner.name}** is currently cheaper by ₹${Math.abs(p1.current_price-p2.current_price).toLocaleString('en-IN')}.` : ''}`;
  }

  // General
  return `🤖 I can help with your ${ctx.products.length} tracked products! Try:\n\n• "Should I buy [product] now?"\n• "Show my watchlist status"\n• "Best product under ₹20,000"\n• "Compare [A] vs [B]"\n\n💡 Add a **free Gemini API key** (aistudio.google.com) in your Render environment as GEMINI_API_KEY for smarter responses.`;
}

// ═════════════════════════════════════════════════════════════
// POST /api/ai-chat
// ═════════════════════════════════════════════════════════════
router.post('/', requireAuth, async (req, res) => {
  const { message, product_id } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required.' });

  const userId   = req.session.user.user_id;
  const userName = req.session.user.name;

  // Get/init history
  if (!chatHistory.has(userId)) chatHistory.set(userId, []);
  const history = chatHistory.get(userId);
  history.push({ role:'user', content:message.trim() });

  try {
    const intent           = detectIntent(message);
    const { ctx, sources } = await fetchContext(userId, product_id, intent);
    const systemPrompt     = buildPrompt(ctx, intent, userName);

    let result;

    // Try Gemini first (free)
    if (process.env.GEMINI_API_KEY) {
      try {
        result = await callGemini(systemPrompt, history, message);
      } catch(e) {
        console.warn('[AI] Gemini failed:', e.message, '— using fallback');
      }
    }

    // Rule-based fallback
    if (!result) {
      result = { reply: ruleBasedFallback(intent, ctx, message, userName), model:'rule-based' };
    }

    // Save assistant reply to history
    history.push({ role:'assistant', content: result.reply });
    if (history.length > MAX_TURNS * 2) history.splice(0, history.length - MAX_TURNS * 2);

    // Build comparison data if needed
    let structured = null;
    if (intent === 'compare' && ctx.products.length >= 2) {
      const words   = message.toLowerCase().split(/\s+/);
      const matched = ctx.products.filter(p => words.some(w => w.length>3 && p.name.toLowerCase().includes(w)));
      if (matched.length >= 2) structured = { comparison: matched.slice(0,3) };
    }

    res.json({ reply:result.reply, model:result.model, intent, data_used:sources, structured });

  } catch (err) {
    console.error('[AI Chat]', err.message);
    res.status(500).json({ reply:'Something went wrong. Please try again.', error:err.message });
  }
});

// DELETE /api/ai-chat/clear
router.delete('/clear', requireAuth, (req, res) => {
  chatHistory.delete(req.session.user.user_id);
  res.json({ message:'Cleared.' });
});

module.exports = router;