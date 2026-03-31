const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const PRICE_PATTERNS = [
  /₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
  /Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  /INR\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  /\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
  /"price"\s*:\s*"?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
];

const SITE_SELECTORS = {
  'amazon':   ['#priceblock_ourprice','#priceblock_dealprice','.a-price .a-offscreen','#price_inside_buybox','.a-price-whole'],
  'flipkart': ['._30jeq3._16Jk6d','._30jeq3','.CEmiEU ._30jeq3'],
  'myntra':   ['.pdp-price strong'],
  'snapdeal': ['.payBlkBig','.product-price'],
};

function parsePrice(raw) {
  if (!raw) return null;
  const v = parseFloat(raw.replace(/[^\d.]/g, ''));
  return (v > 0 && v < 10000000) ? v : null;
}

function detectSite(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const s of Object.keys(SITE_SELECTORS)) if (host.includes(s)) return s;
  } catch {}
  return null;
}

function extractMeta($) {
  return {
    name: $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || null,
    image: $('meta[property="og:image"]').attr('content') || null,
  };
}

async function scrapeWithFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res  = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' },
    });
    const html = await res.text();
    const $    = cheerio.load(html);
    const site = detectSite(url);
    let price  = null;

    if (site) for (const sel of (SITE_SELECTORS[site] || [])) {
      price = parsePrice($(sel).first().text()); if (price) break;
    }
    if (!price) $('script[type="application/ld+json"]').each((_, el) => {
      if (price) return;
      try {
        const j = JSON.parse($(el).html());
        const d = Array.isArray(j) ? j[0] : j;
        const o = d.offers || d.Offers;
        if (o?.price) price = parsePrice(String(o.price));
        if (!price && d.price) price = parsePrice(String(d.price));
      } catch {}
    });
    if (!price) {
      const mp = $('meta[property="og:price:amount"]').attr('content') || $('meta[itemprop="price"]').attr('content');
      if (mp) price = parsePrice(mp);
    }
    if (!price) for (const p of PRICE_PATTERNS) { const m = html.match(p); if (m) { price = parsePrice(m[1]); if (price) break; } }

    return { price, ...extractMeta($), method: 'fetch', success: !!price };
  } finally { clearTimeout(t); }
}

async function scrapeWithPuppeteer(url) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', r => ['image','font','stylesheet'].includes(r.resourceType()) ? r.abort() : r.continue());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 });
    await new Promise(r => setTimeout(r, 2000));
    const html  = await page.content();
    const $     = cheerio.load(html);
    const site  = detectSite(url);
    let price   = null;

    if (site) for (const sel of (SITE_SELECTORS[site] || [])) { price = parsePrice($(sel).first().text()); if (price) break; }
    if (!price) price = await page.evaluate(() => {
      for (const el of document.querySelectorAll('[class*="price"],[id*="price"],[data-price]')) {
        const t = el.textContent || el.getAttribute('data-price') || '';
        const m = t.match(/[₹$]?\s*([0-9,]{3,}(?:\.[0-9]{1,2})?)/);
        if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v>0&&v<10000000) return v; }
      }
      return null;
    }).catch(() => null);
    if (!price) for (const p of PRICE_PATTERNS) { const m = html.match(p); if (m) { price = parsePrice(m[1]); if (price) break; } }

    const image = await page.evaluate(() => document.querySelector('meta[property="og:image"]')?.content || null).catch(() => null);
    return { price, ...extractMeta($), image: image || extractMeta($).image, method: 'puppeteer', success: !!price };
  } finally { if (browser) await browser.close().catch(() => {}); }
}

async function scrapeProduct(url) {
  try { new URL(url); } catch { return { success: false, error: 'Invalid URL.' }; }
  try {
    const r = await scrapeWithFetch(url);
    if (r.price) { console.log(`[Scraper] Tier1 ₹${r.price}`); return { ...r, success: true }; }
  } catch (e) { console.log('[Scraper] Tier1 failed:', e.message); }
  try {
    const r = await scrapeWithPuppeteer(url);
    if (r.price) { console.log(`[Scraper] Tier2 ₹${r.price}`); return { ...r, success: true }; }
    return { ...r, success: false, error: 'Price not detected. Enter manually.' };
  } catch (e) { console.log('[Scraper] Tier2 failed:', e.message); }
  return { price: null, name: null, image: null, method: 'failed', success: false, error: 'Site blocks scraping. Enter price manually.' };
}

module.exports = { scrapeProduct };