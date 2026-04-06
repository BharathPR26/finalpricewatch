/**
 * PriceWatch Mailer — Gmail Price Drop Alerts
 * Fixed: proper error handling, null-safe values, retry on transient errors
 */
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Build transporter once ────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('⚠️  Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD');
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
    // Connection pool for multiple emails
    pool:           true,
    maxConnections: 3,
    maxMessages:    10,
  });

  transporter.verify()
    .then(() => console.log('✅ Gmail mailer ready —', process.env.GMAIL_USER))
    .catch(err => {
      console.warn('⚠️  Gmail verify failed:', err.message);
      transporter = null; // reset so it retries on next call
    });

  return transporter;
}

// Initialize on startup
getTransporter();

// ── Safe number formatter ────────────────────────────────────
function fmtPrice(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '₹—';
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ── HTML Email Template ───────────────────────────────────────
function buildEmailHTML({ userName, productName, productUrl, productImage,
                          currentPrice, targetPrice, allTimeLow, dropPct, category }) {

  const saved       = Math.max(0, parseFloat(targetPrice || 0) - parseFloat(currentPrice || 0));
  const safeDropPct = parseFloat(dropPct || 0).toFixed(1);
  const safeName    = (productName || 'Your Product').replace(/</g, '&lt;');
  const safeUser    = (userName    || 'User').replace(/</g, '&lt;');
  const safeCat     = (category    || 'Product').replace(/</g, '&lt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Price Drop Alert — PriceWatch</title>
</head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d0f;padding:32px 16px;">
  <tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

    <!-- Header -->
    <tr><td style="background:#111316;border-radius:14px 14px 0 0;padding:22px 28px;border-bottom:1px solid #2a2d35;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <span style="background:#f5a623;border-radius:8px;padding:5px 9px;font-size:17px;vertical-align:middle;">🔔</span>
            <span style="color:#e8eaf0;font-size:19px;font-weight:700;vertical-align:middle;margin-left:8px;">PriceWatch</span>
          </td>
          <td align="right">
            <span style="background:rgba(46,204,113,.15);color:#2ecc71;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">PRICE DROP ALERT 🎯</span>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- Hero message -->
    <tr><td style="background:#111316;padding:24px 28px 18px;border-bottom:1px solid #1a1d23;">
      <p style="color:#7a7f8e;font-size:14px;margin:0 0 6px;">Hi ${safeUser},</p>
      <h1 style="color:#e8eaf0;font-size:21px;font-weight:700;margin:0 0 6px;line-height:1.3;">
        Your target price was hit! 🎯
      </h1>
      <p style="color:#7a7f8e;font-size:13px;margin:0;">
        <strong style="color:#f5a623;">${safeName}</strong> dropped below your target.
      </p>
    </td></tr>

    <!-- Product card -->
    <tr><td style="background:#111316;padding:18px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#1a1d23;border:1px solid #2a2d35;border-radius:10px;overflow:hidden;">
        <tr>
          ${productImage ? `<td width="90" style="padding:0;vertical-align:top;">
            <img src="${productImage}" width="90" height="90" style="display:block;object-fit:cover;border-radius:10px 0 0 10px;" alt=""/>
          </td>` : ''}
          <td style="padding:14px 16px;vertical-align:top;">
            <div style="color:#f5a623;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">
              ${safeCat}
            </div>
            <div style="color:#e8eaf0;font-size:14px;font-weight:600;line-height:1.35;margin-bottom:10px;">
              ${safeName}
            </div>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:18px;">
                  <div style="color:#7a7f8e;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Now</div>
                  <div style="color:#2ecc71;font-size:24px;font-weight:700;font-family:monospace;">${fmtPrice(currentPrice)}</div>
                </td>
                <td style="padding-right:18px;">
                  <div style="color:#7a7f8e;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Your Target</div>
                  <div style="color:#f5a623;font-size:20px;font-weight:600;font-family:monospace;">${fmtPrice(targetPrice)}</div>
                </td>
                <td>
                  <div style="color:#7a7f8e;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">All-Time Low</div>
                  <div style="color:#e8eaf0;font-size:16px;font-family:monospace;">${fmtPrice(allTimeLow)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Drop badge -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
        <tr>
          <td style="background:rgba(46,204,113,.1);border:1px solid rgba(46,204,113,.2);border-radius:8px;padding:12px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#2ecc71;font-size:13px;font-weight:600;">↓ ${safeDropPct}% drop since you started tracking</span>
                </td>
                <td align="right">
                  ${saved > 0 ? `<span style="color:#7a7f8e;font-size:12px;">You save <strong style="color:#2ecc71;">${fmtPrice(saved)}</strong> vs your target</span>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA button -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
        <tr>
          <td align="center">
            <a href="${productUrl || '#'}" target="_blank"
               style="display:inline-block;background:#f5a623;color:#0c0d0f;font-size:14px;font-weight:700;
                      padding:13px 32px;border-radius:9px;text-decoration:none;">
              View Product &amp; Buy Now →
            </a>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#0c0d0f;border-radius:0 0 14px 14px;padding:16px 28px;border-top:1px solid #1a1d23;">
      <p style="color:#4a5060;font-size:11px;margin:0;text-align:center;line-height:1.6;">
        You received this because you set a target price on PriceWatch.<br/>
        Log in to manage your alerts and notification settings.
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Send Alert Email ──────────────────────────────────────────
async function sendPriceAlertEmail({
  toEmail, userName, productName, productUrl, productImage,
  currentPrice, targetPrice, allTimeLow, dropPct, category,
}) {
  const t = getTransporter();
  if (!t) {
    console.warn('[Mailer] No transporter — Gmail not configured.');
    return false;
  }

  // Validate email
  if (!toEmail || !toEmail.includes('@')) {
    console.warn('[Mailer] Invalid email address:', toEmail);
    return false;
  }

  const mailOptions = {
    from:    `"PriceWatch 🔔" <${process.env.GMAIL_USER}>`,
    to:      toEmail,
    subject: `🎯 Price Drop! ${productName || 'Your product'} is now ${fmtPrice(currentPrice)}`,
    html:    buildEmailHTML({
      userName, productName, productUrl, productImage,
      currentPrice, targetPrice, allTimeLow, dropPct, category,
    }),
    text: `Hi ${userName}, "${productName}" dropped to ${fmtPrice(currentPrice)}, below your target of ${fmtPrice(targetPrice)}. Visit: ${productUrl}`,
  };

  try {
    const info = await t.sendMail(mailOptions);
    console.log(`[Mailer] ✓ Sent "${productName}" alert to ${toEmail} — ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] ✗ Failed for ${toEmail}: ${err.message}`);
    // Reset transporter on auth errors so it rebuilds
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      transporter = null;
      console.error('[Mailer] Auth failed — check GMAIL_APP_PASSWORD in environment variables');
    }
    return false;
  }
}

module.exports = { sendPriceAlertEmail };