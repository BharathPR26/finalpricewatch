const express             = require('express');
const { requireAuth }     = require('../middleware/auth');
const { scrapeProduct }   = require('../scraper');
const router              = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url?.trim()) return res.status(400).json({ success: false, error: 'URL required.' });
  try {
    res.setTimeout(35000);
    const result = await scrapeProduct(url.trim());
    res.json(result);
  } catch (err) {
    console.error('[Scrape]', err.message);
    res.status(500).json({ success: false, error: 'Scraper error. Enter price manually.' });
  }
});

module.exports = router;