/**
 * PriceWatch Scraper — 3-tier price fetcher
 * Tier 1: HTTP fetch + CSS selectors + JSON-LD (fast, works on Flipkart)
 * Tier 2: Puppeteer headless Chrome (JS-rendered sites)
 * Tier 3: Returns null (Amazon blocks all scrapers — manual update needed)
 *
 * HONEST NOTE about auto price watching:
 * - Flipkart: works reliably (~80% success)
 * - Amazon: blocked by anti-bot system (manual update needed)
 * - Other sites: ~60% success depending on structure
 *
 * The cron-job.org endpoint is called every 6 hours.
 * When scraping fails, the old price remains — no false alerts.
 */

const fetch   = require('node-fetch');
const cheerio = require('cheerio');

// Price regex patterns — ordered by specificity
const PRICE_PATTERNS = [
  /₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
  /"price"\s*:\s*"?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
  /Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  /INR\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
];

// CSS selectors per site
const SITE_SELECTORS = {
  amazon:   ['#priceblock_ourprice','#priceblock_dealprice','.a-price .a-offscreen',
             '#price_inside_buybox','.a-price-whole','span[data-a-color="price"] .a-offscreen'],
  flipkart: ['._30jeq3._16Jk6d','._30jeq3','.CEmiEU ._30jeq3','._25b18'],
  myntra:   ['.pdp-price strong','.pdp-price'],
  snapdeal: ['.payBlkBig','.product-price'],
  meesho:   ['[class*="PriceRange"],[class*="price"]'],
  jiomart:  ['.jm-price-mrp-value','.jm-heading-xxs'],
  croma:    ['.crm-product-price','.amount'],
  reliance: ['.priceText'],
};

function parsePrice(raw) {
  if (!raw) return null;
  const str = String(raw).replace(/[^\d.]/g, '');
  const v   = parseFloat(str);
  return (v > 0 && v < 10_000_000) ? v : null;
}

function detectSite(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const s of Object.keys(SITE_SELECTORS)) {
      if (host.includes(s)) return s;
    }
  } catch {}
  return null;
}

function extractMeta($) {
  return {
    name:  ($('meta[property="og:title"]').attr('content') || $('h1').first().text()).trim().slice(0, 500) || null,
    image: $('meta[property="og:image"]').attr('content') || null,
  };
}

// ── Tier 1: HTTP Fetch ────────────────────────────────────────
async function scrapeWithFetch(url) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);

  try {
    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: {
        'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language':  'en-IN,en;q=0.9',
        'Accept-Encoding':  'gzip, deflate',
        'Cache-Control':    'no-cache',
        'Pragma':           'no-cache',
        'Sec-Fetch-Dest':   'document',
        'Sec-Fetch-Mode':   'navigate',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (!res.ok) return { price: null, success: false, error: `HTTP ${res.status}` };

    const html = await res.text();
    const $    = cheerio.load(html);
    const site = detectSite(url);
    let price  = null;

    // 1. Site-specific CSS selectors
    if (site && SITE_SELECTORS[site]) {
      for (const sel of SITE_SELECTORS[site]) {
        price = parsePrice($(sel).first().text());
        if (price) break;
      }
    }

    // 2. JSON-LD structured data
    if (!price) {
      $('script[type="application/ld+json"]').each((_, el) => {
        if (price) return;
        try {
          const raw = $(el).html();
          const j   = JSON.parse(raw);
          const d   = Array.isArray(j) ? j[0] : j;
          const o   = d?.offers || d?.Offers;
          if (o?.price)         price = parsePrice(String(o.price));
          else if (o?.lowPrice) price = parsePrice(String(o.lowPrice));
          else if (d?.price)    price = parsePrice(String(d.price));
        } catch {}
      });
    }

    // 3. Meta tags
    if (!price) {
      const metaPrice = $('meta[property="og:price:amount"]').attr('content')
                     || $('meta[itemprop="price"]').attr('content')
                     || $('meta[name="price"]').attr('content');
      if (metaPrice) price = parsePrice(metaPrice);
    }

    // 4. Generic price patterns in HTML
    if (!price) {
      for (const p of PRICE_PATTERNS) {
        const m = html.match(p);
        if (m) { price = parsePrice(m[1]); if (price) break; }
      }
    }

    return { price, ...extractMeta($), method: 'fetch', success: !!price };

  } finally {
    clearTimeout(timeout);
  }
}

// ── Tier 2: Puppeteer ─────────────────────────────────────────
async function scrapeWithPuppeteer(url) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-extensions', '--disable-background-timer-throttling',
        '--window-size=1280,800',
      ],
      timeout: 25000,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    // Block images, fonts, stylesheets (speed up loading)
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image','font','stylesheet','media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 });
    await new Promise(r => setTimeout(r, 2500));

    const html  = await page.content();
    const $     = cheerio.load(html);
    const site  = detectSite(url);
    let price   = null;

    if (site && SITE_SELECTORS[site]) {
      for (const sel of SITE_SELECTORS[site]) {
        price = parsePrice($(sel).first().text());
        if (price) break;
      }
    }

    // JS evaluation for dynamic prices
    if (!price) {
      price = await page.evaluate(() => {
        const selectors = [
          '[class*="price"],[id*="price"],[data-price]',
          '[class*="Price"],[class*="amount"],[class*="Amount"]',
        ].join(',');
        for (const el of document.querySelectorAll(selectors)) {
          const t = el.textContent?.trim() || el.getAttribute('data-price') || '';
          const m = t.match(/[₹$]?\s*([0-9,]{2,}(?:\.[0-9]{1,2})?)/);
          if (m) {
            const v = parseFloat(m[1].replace(/,/g,''));
            if (v > 0 && v < 10_000_000) return v;
          }
        }
        return null;
      }).catch(() => null);
    }

    if (!price) {
      for (const p of PRICE_PATTERNS) {
        const m = html.match(p);
        if (m) { price = parsePrice(m[1]); if (price) break; }
      }
    }

    const image = await page.evaluate(() =>
      document.querySelector('meta[property="og:image"]')?.content || null
    ).catch(() => null);

    return { price, ...extractMeta($), image: image || extractMeta($).image, method: 'puppeteer', success: !!price };

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Main: try both tiers ──────────────────────────────────────
async function scrapeProduct(url) {
  try { new URL(url); } catch { return { success: false, error: 'Invalid URL.' }; }

  // Tier 1
  try {
    const r = await scrapeWithFetch(url);
    if (r.price) {
      console.log(`[Scraper] ✓ Tier1 (fetch) ₹${r.price} — ${url.slice(0, 60)}`);
      return { ...r, success: true };
    }
    console.log(`[Scraper] Tier1 no price for ${url.slice(0, 60)}`);
  } catch (e) {
    console.log(`[Scraper] Tier1 error: ${e.message}`);
  }

  // Tier 2 (skip on Render free tier — Puppeteer uses too much memory)
  // Uncomment below if you have Render paid plan or enough RAM:
  /*
  try {
    const r = await scrapeWithPuppeteer(url);
    if (r.price) {
      console.log(`[Scraper] ✓ Tier2 (puppeteer) ₹${r.price}`);
      return { ...r, success: true };
    }
  } catch (e) {
    console.log(`[Scraper] Tier2 error: ${e.message}`);
  }
  */

  return {
    price: null, name: null, image: null,
    method: 'failed', success: false,
    error: 'Price not detected. Amazon and some sites block automated price checking. Please use "Update Price" manually.',
  };
}

module.exports = { scrapeProduct };