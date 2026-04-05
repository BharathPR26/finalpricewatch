/**
 * PriceWatch AI Shopping Assistant
 * POST /api/ai-chat
 *
 * Architecture:
 *   1. User sends message
 *   2. Intent detector classifies query type
 *   3. Data fetcher pulls relevant product data from DB
 *   4. Prompt builder constructs context-rich prompt
 *   5. LLM (Claude/OpenAI) generates smart response
 *   6. Response returned with data sources used
 *
 * Works WITHOUT any API key using rule-based fallback.
 * With ANTHROPIC_API_KEY → uses Claude claude-sonnet-4-20250514
 * With OPENAI_API_KEY    → uses GPT-4o-mini
 */

const express         = require('express');
const db              = require('../db');
const { requireAuth } = require('../middleware/auth');
const router          = express.Router();

// ── In-memory chat history (per session) ─────────────────────
// Key = session user_id, Value = array of messages
const chatHistory = new Map();
const MAX_HISTORY = 10; // keep last 10 turns

// ── Intent Types ──────────────────────────────────────────────
const INTENTS = {
  SHOULD_BUY:    'should_buy',
  PRICE_TREND:   'price_trend',
  COMPARE:       'compare',
  BEST_UNDER:    'best_under',
  PROS_CONS:     'pros_cons',
  MY_PRODUCTS:   'my_products',
  MY_WATCHLIST:  'my_watchlist',
  GENERAL:       'general',
};

// ── POST /api/ai-chat ─────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { message, product_id } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });

  const userId = req.session.user.user_id;

  // Get or init chat history for this user
  if (!chatHistory.has(userId)) chatHistory.set(userId, []);
  const history = chatHistory.get(userId);

  // Add user message to history
  history.push({ role: 'user', content: message.trim() });

  try {
    // Step 1: Detect intent
    const intent = detectIntent(message);

    // Step 2: Fetch relevant data from DB
    const data = await fetchContextData(intent, message, userId, product_id);

    // Step 3: Build context prompt
    const systemPrompt = buildSystemPrompt(data, intent);

    // Step 4: Generate AI response
    const aiReply = await generateAIResponse(systemPrompt, history, message);

    // Step 5: Add assistant reply to history
    history.push({ role: 'assistant', content: aiReply.reply });

    // Trim history to last MAX_HISTORY messages
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY * 2);
    }

    res.json({
      reply:      aiReply.reply,
      data_used:  data.sources,
      intent,
      structured: data.structured || null,
    });

  } catch (err) {
    console.error('[AI Chat]', err.message);
    res.status(500).json({ error: 'AI assistant unavailable. Try again.', reply: getFallbackReply(message) });
  }
});

// ── DELETE /api/ai-chat/clear ─────────────────────────────────
router.delete('/clear', requireAuth, (req, res) => {
  chatHistory.delete(req.session.user.user_id);
  res.json({ message: 'Chat history cleared.' });
});

// ═════════════════════════════════════════════════════════════
// INTENT DETECTION — keyword-based classification
// ═════════════════════════════════════════════════════════════
function detectIntent(message) {
  const msg = message.toLowerCase();
  if (/should i buy|worth buying|good time to buy|buy now|buy or wait/.test(msg)) return INTENTS.SHOULD_BUY;
  if (/compare|vs\b|versus|difference between|which is better/.test(msg))          return INTENTS.COMPARE;
  if (/best.*under|cheap.*under|under ₹|budget.*phone|recommend.*budget/.test(msg))return INTENTS.BEST_UNDER;
  if (/pros.*cons|advantage|disadvantage|good.*bad|positive.*negative/.test(msg))  return INTENTS.PROS_CONS;
  if (/price trend|price drop|price history|price change/.test(msg))               return INTENTS.PRICE_TREND;
  if (/my products?|what.*tracking|what.*added|my list/.test(msg))                 return INTENTS.MY_PRODUCTS;
  if (/my watchlist|watching|my targets?/.test(msg))                               return INTENTS.MY_WATCHLIST;
  return INTENTS.GENERAL;
}

// ═════════════════════════════════════════════════════════════
// DATA FETCHER — pulls relevant DB data based on intent
// ═════════════════════════════════════════════════════════════
async function fetchContextData(intent, message, userId, productId) {
  const data    = { sources: [], structured: null };
  const context = {};

  // Always fetch user's products as context
  try {
    const [products] = await db.query(`
      SELECT p.product_id, p.name, p.category, p.url,
        (SELECT ph.price FROM price_history ph WHERE ph.product_id=p.product_id ORDER BY ph.recorded_at DESC LIMIT 1) AS current_price,
        (SELECT ph2.price FROM price_history ph2 WHERE ph2.product_id=p.product_id ORDER BY ph2.recorded_at ASC LIMIT 1) AS first_price,
        MIN(ph3.price) AS all_time_low,
        COUNT(ph3.ph_id) AS data_points
      FROM products p
      LEFT JOIN price_history ph3 ON ph3.product_id=p.product_id
      WHERE p.added_by=?
      GROUP BY p.product_id, p.name, p.category, p.url
      ORDER BY p.created_at DESC
      LIMIT 20
    `, [userId]);
    context.products = products;
    data.sources.push('user_products');
  } catch { context.products = []; }

  // Specific product context
  if (productId) {
    try {
      const [history] = await db.query(
        `SELECT price::float AS price, recorded_at FROM price_history WHERE product_id=? ORDER BY recorded_at ASC`,
        [productId]
      );
      context.priceHistory = history;
      data.sources.push('price_history');
    } catch { context.priceHistory = []; }
  }

  // Watchlist context
  if ([INTENTS.MY_WATCHLIST, INTENTS.SHOULD_BUY, INTENTS.GENERAL].includes(intent)) {
    try {
      const [watchlist] = await db.query(`
        SELECT w.target_price, p.name, p.category,
          (SELECT ph.price FROM price_history ph WHERE ph.product_id=p.product_id ORDER BY ph.recorded_at DESC LIMIT 1) AS current_price,
          (SELECT MIN(ph2.price) FROM price_history ph2 WHERE ph2.product_id=p.product_id) AS all_time_low
        FROM watchlist w JOIN products p ON p.product_id=w.product_id
        WHERE w.user_id=? AND w.is_active=TRUE
      `, [userId]);
      context.watchlist = watchlist;
      data.sources.push('watchlist');
    } catch { context.watchlist = []; }
  }

  // Comparison: extract product names from message
  if (intent === INTENTS.COMPARE) {
    const compData = await buildComparisonData(message, context.products);
    context.comparison = compData;
    data.structured    = compData;
    data.sources.push('comparison_engine');
  }

  // Budget search
  if (intent === INTENTS.BEST_UNDER) {
    const budget    = extractBudget(message);
    const matching  = context.products.filter(p => p.current_price && p.current_price <= budget);
    context.budget  = budget;
    context.matching = matching;
    data.sources.push('budget_filter');
  }

  // Price trend analysis for specific product
  if ((intent === INTENTS.PRICE_TREND || intent === INTENTS.SHOULD_BUY) && productId) {
    const trend = analyzePriceTrend(context.priceHistory || []);
    context.trend = trend;
    data.sources.push('trend_analysis');
  }

  data.context = context;
  return data;
}

// ═════════════════════════════════════════════════════════════
// COMPARISON ENGINE
// ═════════════════════════════════════════════════════════════
async function buildComparisonData(message, userProducts) {
  // Find products mentioned in message
  const mentioned = userProducts.filter(p => {
    const name = p.name.toLowerCase();
    const msg  = message.toLowerCase();
    // Match if any word of product name (>3 chars) appears in message
    return name.split(' ').some(word => word.length > 3 && msg.includes(word));
  });

  if (mentioned.length < 2) return null;

  return {
    comparison: mentioned.slice(0, 3).map(p => {
      const priceChange = p.first_price && p.current_price
        ? ((p.first_price - p.current_price) / p.first_price * 100).toFixed(1)
        : 0;
      return {
        product:       p.name,
        product_id:    p.product_id,
        category:      p.category,
        current_price: p.current_price,
        all_time_low:  p.all_time_low,
        price_drop_pct: parseFloat(priceChange),
        data_points:   p.data_points,
      };
    }),
    verdict: null, // filled by LLM
  };
}

// ═════════════════════════════════════════════════════════════
// TREND ANALYSIS
// ═════════════════════════════════════════════════════════════
function analyzePriceTrend(history) {
  if (history.length < 2) return { trend: 'insufficient_data' };
  const prices = history.map(h => parseFloat(h.price));
  const first  = prices[0];
  const last   = prices[prices.length - 1];
  const min    = Math.min(...prices);
  const max    = Math.max(...prices);
  const change = ((last - first) / first * 100).toFixed(1);

  // Simple linear regression for slope
  const n    = prices.length;
  const xs   = prices.map((_, i) => i);
  const xBar = xs.reduce((a,b) => a+b,0) / n;
  const yBar = prices.reduce((a,b) => a+b,0) / n;
  const slope = xs.reduce((s,x,i) => s + (x-xBar)*(prices[i]-yBar), 0) /
                xs.reduce((s,x) => s + (x-xBar)**2, 0);

  return {
    trend:       slope < -50 ? 'falling' : slope > 50 ? 'rising' : 'stable',
    slope:       Math.round(slope),
    change_pct:  parseFloat(change),
    current:     last,
    first_price: first,
    all_time_low: min,
    all_time_high: max,
    data_points: n,
  };
}

// ═════════════════════════════════════════════════════════════
// BUDGET EXTRACTOR
// ═════════════════════════════════════════════════════════════
function extractBudget(message) {
  const patterns = [
    /₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/,
    /rs\.?\s*(\d+(?:,\d+)*)/i,
    /under\s+(\d+(?:,\d+)*)/i,
    /(\d+)k\b/i,
    /(\d{4,6})/,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g,''));
      if (message.match(/(\d+)k\b/i)) val *= 1000;
      return val;
    }
  }
  return 20000; // default budget
}

// ═════════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ═════════════════════════════════════════════════════════════
function buildSystemPrompt(data, intent) {
  const { context } = data;

  let systemPrompt = `You are PriceWatch AI — an intelligent shopping assistant built into a price tracking app.
You help users make smart buying decisions using their real product price data.

PERSONALITY:
- Concise, friendly, and data-driven
- Give specific numbers and dates, not vague advice
- Use ₹ for Indian Rupee
- Format responses with emojis for readability
- Maximum 3-4 short paragraphs

YOUR CAPABILITIES:
- Analyze price trends from historical data
- Compare products the user is tracking
- Recommend best time to buy
- Suggest budget-friendly alternatives from user's list

`;

  // Add user's product data as context
  if (context.products?.length) {
    systemPrompt += `\nUSER'S TRACKED PRODUCTS (${context.products.length} total):\n`;
    context.products.slice(0, 10).forEach(p => {
      const drop = p.first_price && p.current_price
        ? ((p.first_price - p.current_price) / p.first_price * 100).toFixed(1)
        : '0';
      systemPrompt += `- ${p.name} (${p.category}): Current ₹${p.current_price || 'N/A'} | ATL ₹${p.all_time_low || 'N/A'} | Drop ${drop}% | ${p.data_points} price records\n`;
    });
  }

  // Add watchlist data
  if (context.watchlist?.length) {
    systemPrompt += `\nUSER'S WATCHLIST (target prices set):\n`;
    context.watchlist.forEach(w => {
      const diff    = w.current_price && w.target_price ? w.current_price - w.target_price : null;
      const status  = diff != null ? (diff <= 0 ? 'TARGET HIT ✅' : `₹${Math.round(diff)} above target`) : 'unknown';
      systemPrompt += `- ${w.name}: Target ₹${w.target_price} | Current ₹${w.current_price || 'N/A'} | ${status}\n`;
    });
  }

  // Add price trend for specific product
  if (context.trend && context.trend.trend !== 'insufficient_data') {
    const t = context.trend;
    systemPrompt += `\nPRICE TREND ANALYSIS:
- Trend: ${t.trend.toUpperCase()}
- Change since tracking: ${t.change_pct}%
- All-time low: ₹${t.all_time_low}
- All-time high: ₹${t.all_time_high}
- Based on ${t.data_points} price records\n`;
  }

  // Add comparison data
  if (context.comparison?.comparison) {
    systemPrompt += `\nPRODUCT COMPARISON DATA:\n`;
    context.comparison.comparison.forEach(c => {
      systemPrompt += `- ${c.product}: ₹${c.current_price} | ATL ₹${c.all_time_low} | Drop ${c.price_drop_pct}%\n`;
    });
    systemPrompt += `Give a clear verdict on which product to buy and why.\n`;
  }

  // Add budget context
  if (context.budget && context.matching) {
    systemPrompt += `\nBUDGET: ₹${context.budget}. Matching products in user's list: ${context.matching.length}\n`;
    context.matching.forEach(m => {
      systemPrompt += `- ${m.name}: ₹${m.current_price}\n`;
    });
  }

  // Intent-specific instructions
  const intentInstructions = {
    [INTENTS.SHOULD_BUY]:   'Give a clear BUY / WAIT / MONITOR recommendation with specific reasoning based on the price trend data above.',
    [INTENTS.COMPARE]:      'Compare the products side by side. Give a clear winner recommendation with pros/cons for each.',
    [INTENTS.BEST_UNDER]:   'Recommend the best product under the budget from the user\'s tracked products. Explain why.',
    [INTENTS.PROS_CONS]:    'List clear pros and cons based on the price data available. Be specific.',
    [INTENTS.PRICE_TREND]:  'Explain the price trend clearly. Tell the user if now is a good time to buy.',
    [INTENTS.MY_PRODUCTS]:  'Summarize the user\'s tracked products. Highlight the best deals and biggest price drops.',
    [INTENTS.MY_WATCHLIST]: 'Summarize watchlist status. Tell which products are close to or have hit their target price.',
    [INTENTS.GENERAL]:      'Answer helpfully using the product data available. Be specific and actionable.',
  };

  systemPrompt += `\nINSTRUCTION: ${intentInstructions[intent] || intentInstructions[INTENTS.GENERAL]}`;
  systemPrompt += `\nIMPORTANT: Only discuss products the user is actually tracking (listed above). Don't make up product data.`;

  return systemPrompt;
}

// ═════════════════════════════════════════════════════════════
// AI RESPONSE GENERATOR
// Priority: Claude → OpenAI → Rule-based fallback
// ═════════════════════════════════════════════════════════════
async function generateAIResponse(systemPrompt, history, userMessage) {
  // Try Claude (Anthropic)
  if (process.env.ANTHROPIC_API_KEY) {
    return await callClaude(systemPrompt, history, userMessage);
  }

  // Try OpenAI
  if (process.env.OPENAI_API_KEY) {
    return await callOpenAI(systemPrompt, history, userMessage);
  }

  // Rule-based fallback (no API key needed)
  return ruleBasedResponse(systemPrompt, userMessage, history);
}

// ── Claude Integration ────────────────────────────────────────
async function callClaude(systemPrompt, history, userMessage) {
  const fetch = require('node-fetch');

  // Build messages array (last 6 turns for context)
  const recentHistory = history.slice(-6);
  const messages = recentHistory.map(h => ({ role: h.role, content: h.content }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001', // fast + cheap
      max_tokens: 600,
      system:     systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data  = await response.json();
  const reply = data.content?.[0]?.text || 'Unable to generate response.';
  return { reply, model: 'claude-haiku' };
}

// ── OpenAI Integration ────────────────────────────────────────
async function callOpenAI(systemPrompt, history, userMessage) {
  const fetch = require('node-fetch');

  const recentHistory = history.slice(-6);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory.map(h => ({ role: h.role, content: h.content })),
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'gpt-4o-mini',
      messages,
      max_tokens:  600,
      temperature: 0.7,
    }),
  });

  if (!response.ok) throw new Error('OpenAI API error');
  const data  = await response.json();
  const reply = data.choices?.[0]?.message?.content || 'Unable to generate response.';
  return { reply, model: 'gpt-4o-mini' };
}

// ── Rule-Based Fallback (no API key needed) ───────────────────
function ruleBasedResponse(systemPrompt, message, history) {
  const msg = message.toLowerCase();

  // Extract product names from systemPrompt context
  const productLines = systemPrompt.match(/- (.+?) \(.+?\): Current ₹(\S+)/g) || [];
  const products     = productLines.map(line => {
    const m = line.match(/- (.+?) \((.+?)\): Current ₹(\S+)/);
    return m ? { name: m[1], category: m[2], price: m[3] } : null;
  }).filter(Boolean);

  // Best deals detection from context
  const drops = systemPrompt.match(/Drop (.+?)%/g) || [];

  if (/should i buy|buy now|good time/.test(msg)) {
    const trendMatch = systemPrompt.match(/Trend: (FALLING|RISING|STABLE)/);
    const trend      = trendMatch?.[1] || 'STABLE';
    if (trend === 'FALLING') {
      return { reply: `📉 **Wait a bit!** The price is currently trending downward. Based on your price history, there's a good chance of a further drop in the next few days.\n\n🎯 **Recommendation:** Set a target price alert and wait. The all-time low in your data suggests more savings are possible.\n\n💡 Use the "Update Price" button to keep tracking and you'll get a Gmail alert automatically when your target is hit.`, model: 'rule-based' };
    } else if (trend === 'RISING') {
      return { reply: `📈 **Buy Now!** The price is trending upward. Waiting may cost you more.\n\n🎯 **Recommendation:** The current price is likely near the best you'll see soon. If it's within your budget, now is a good time.\n\n💡 Check the price chart on the product page for the full trend history.`, model: 'rule-based' };
    } else {
      return { reply: `➡️ **Price is stable.** No strong signal to buy immediately or wait.\n\n🎯 **Recommendation:** Monitor for a week. Set your target price in the watchlist — you'll get an automatic Gmail alert when it drops.\n\n💡 More price updates will improve prediction accuracy.`, model: 'rule-based' };
    }
  }

  if (/compare|vs\b|versus/.test(msg)) {
    if (products.length >= 2) {
      const p1 = products[0];
      const p2 = products[1];
      const cheaper = parseFloat(p1.price) < parseFloat(p2.price) ? p1 : p2;
      return { reply: `⚖️ **Comparison: ${p1.name} vs ${p2.name}**\n\n📊 **${p1.name}**: ₹${p1.price}\n📊 **${p2.name}**: ₹${p2.price}\n\n💰 **${cheaper.name}** is currently cheaper by ₹${Math.abs(parseFloat(p1.price) - parseFloat(p2.price)).toFixed(0)}.\n\n🎯 For a full AI comparison with trend analysis, add your **ANTHROPIC_API_KEY** or **OPENAI_API_KEY** to the server environment variables.`, model: 'rule-based' };
    }
    return { reply: `⚖️ To compare products, make sure both are in your tracked products list. Then ask something like "Compare Sony headphones vs JBL speaker".\n\n🔑 For advanced AI comparisons, add an API key to your server.`, model: 'rule-based' };
  }

  if (/my products|what.*tracking/.test(msg)) {
    if (products.length > 0) {
      const list = products.slice(0, 5).map(p => `• ${p.name} — ₹${p.price}`).join('\n');
      return { reply: `🛍️ **You're tracking ${products.length} product(s):**\n\n${list}\n\nClick any product card to see the full price history and AI prediction.`, model: 'rule-based' };
    }
    return { reply: `📭 You haven't added any products yet. Click **+ Add Product** to start tracking prices!`, model: 'rule-based' };
  }

  if (/best.*under|budget|cheap/.test(msg)) {
    if (products.length > 0) {
      const budget  = extractBudget(message);
      const matches = products.filter(p => parseFloat(p.price) <= budget);
      if (matches.length > 0) {
        return { reply: `💰 **Under ₹${budget.toLocaleString('en-IN')}:**\n\n${matches.map(p => `• ${p.name} — ₹${p.price}`).join('\n')}\n\n🎯 All of these are in your tracked list. Check their price history to find the best deal!`, model: 'rule-based' };
      }
      return { reply: `💰 None of your currently tracked products are under ₹${budget.toLocaleString('en-IN')}. You can add new products using the **+ Add Product** button.`, model: 'rule-based' };
    }
  }

  if (/watchlist|watching|target/.test(msg)) {
    return { reply: `👁️ Your watchlist shows products where you've set a target price. When any product drops to your target, you get an automatic Gmail alert!\n\nGo to **Watchlist** tab to see all your watching items and their current status.`, model: 'rule-based' };
  }

  // Generic helpful response
  const tips = [
    `I can help you with:\n\n• "Should I buy [product] now?"\n• "Compare [product A] vs [product B]"\n• "What's the price trend for my products?"\n• "Best product under ₹20,000"\n• "Show my watchlist status"\n\n🔑 For advanced AI responses, add **ANTHROPIC_API_KEY** to your Render environment variables.`,
    `💡 **Quick tip:** To get better predictions, update the price of your products regularly using the "✏️ Update Price" button. More data = more accurate AI predictions!`,
    `🤖 I'm your shopping assistant! I can analyze the price data from all your tracked products.\n\nTry asking: "Which of my products has dropped the most?" or "Is now a good time to buy any of my watchlist items?"`,
  ];

  const randomTip = tips[Math.floor(Math.random() * tips.length)];
  return { reply: randomTip, model: 'rule-based' };
}

function getFallbackReply(message) {
  return `I encountered an issue processing your request. Please try again or rephrase your question. You can ask me things like "Should I buy now?" or "Compare my products".`;
}

module.exports = router;