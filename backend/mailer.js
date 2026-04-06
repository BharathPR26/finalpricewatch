/**
 * PriceWatch Mailer — Gmail Price Drop Alerts + Password Reset
 * Fixed issues:
 *  - Pool-based transporter (handles concurrent sends)
 *  - Null-safe all values (prevents crashes)
 *  - Separate password reset email function
 *  - Better error logging
 */
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Single transporter instance ───────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('[Mailer] ⚠️  GMAIL_USER or GMAIL_APP_PASSWORD not set in environment');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,              // SSL — more reliable than service:'gmail'
    auth:   { user, pass },
    pool:   true,              // reuse connections
    maxConnections: 3,
    socketTimeout:  15000,
    greetingTimeout: 10000,
  });

  _transporter.verify((err) => {
    if (err) {
      console.error('[Mailer] ❌ Gmail verify failed:', err.message);
      console.error('[Mailer] Check: GMAIL_USER and GMAIL_APP_PASSWORD in Render environment variables');
      _transporter = null;  // reset so next call retries
    } else {
      console.log('[Mailer] ✅ Gmail ready —', user);
    }
  });

  return _transporter;
}

// Initialize on startup
getTransporter();

// ── Safe price formatter ──────────────────────────────────────
const fmt = n => {
  const v = parseFloat(n);
  return isNaN(v) ? '₹—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

// ═════════════════════════════════════════════════════════════
// PRICE DROP ALERT EMAIL
// ═════════════════════════════════════════════════════════════
function buildAlertHTML({ userName, productName, productUrl, productImage,
                          currentPrice, targetPrice, allTimeLow, dropPct, category }) {
  const saved   = Math.max(0, parseFloat(targetPrice || 0) - parseFloat(currentPrice || 0));
  const safeDrop = parseFloat(dropPct || 0).toFixed(1);
  const safeName = String(productName || 'Your Product').replace(/[<>"]/g, '');
  const safeUser = String(userName    || 'User').replace(/[<>"]/g, '');
  const safeCat  = String(category    || 'Product').replace(/[<>"]/g, '');
  const safeUrl  = String(productUrl  || '#');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Price Drop — PriceWatch</title></head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d0f;padding:28px 14px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#111316;border-radius:14px 14px 0 0;padding:20px 24px;border-bottom:1px solid #2a2d35;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-size:18px">🔔</span>
          <span style="color:#e8eaf0;font-size:18px;font-weight:700;vertical-align:middle;margin-left:7px;">PriceWatch</span></td>
      <td align="right"><span style="background:rgba(46,204,113,.15);color:#2ecc71;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:600;">🎯 PRICE DROP ALERT</span></td>
    </tr></table>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="background:#111316;padding:20px 24px 14px;border-bottom:1px solid #1a1d23;">
    <p style="color:#7a7f8e;font-size:13px;margin:0 0 5px;">Hi ${safeUser},</p>
    <h1 style="color:#e8eaf0;font-size:20px;font-weight:700;margin:0 0 5px;line-height:1.3;">Your target price was hit! 🎯</h1>
    <p style="color:#7a7f8e;font-size:13px;margin:0;"><strong style="color:#f5a623;">${safeName}</strong> dropped below your target.</p>
  </td></tr>

  <!-- Product card -->
  <tr><td style="background:#111316;padding:16px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d23;border:1px solid #2a2d35;border-radius:10px;overflow:hidden;">
      <tr>
        ${productImage ? `<td width="85" style="padding:0;vertical-align:top;"><img src="${productImage}" width="85" height="85" style="display:block;object-fit:cover;border-radius:10px 0 0 10px;" alt=""/></td>` : ''}
        <td style="padding:13px 15px;vertical-align:top;">
          <div style="color:#f5a623;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;">${safeCat}</div>
          <div style="color:#e8eaf0;font-size:13px;font-weight:600;line-height:1.35;margin-bottom:10px;">${safeName}</div>
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:16px;">
              <div style="color:#7a7f8e;font-size:9px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Now</div>
              <div style="color:#2ecc71;font-size:22px;font-weight:700;font-family:monospace;">${fmt(currentPrice)}</div>
            </td>
            <td style="padding-right:16px;">
              <div style="color:#7a7f8e;font-size:9px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Your Target</div>
              <div style="color:#f5a623;font-size:18px;font-weight:600;font-family:monospace;">${fmt(targetPrice)}</div>
            </td>
            <td>
              <div style="color:#7a7f8e;font-size:9px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">All-Time Low</div>
              <div style="color:#e8eaf0;font-size:15px;font-family:monospace;">${fmt(allTimeLow)}</div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    <!-- Drop stats -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
      <tr><td style="background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.2);border-radius:8px;padding:11px 15px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><span style="color:#2ecc71;font-size:13px;font-weight:600;">↓ ${safeDrop}% drop since tracking</span></td>
          ${saved > 0 ? `<td align="right"><span style="color:#7a7f8e;font-size:12px;">Save <strong style="color:#2ecc71;">${fmt(saved)}</strong> vs target</span></td>` : ''}
        </tr></table>
      </td></tr>
    </table>

    <!-- Buy button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr><td align="center">
        <a href="${safeUrl}" target="_blank"
           style="display:inline-block;background:#f5a623;color:#0c0d0f;font-size:14px;font-weight:700;padding:12px 30px;border-radius:9px;text-decoration:none;">
          View &amp; Buy Now →
        </a>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0c0d0f;border-radius:0 0 14px 14px;padding:14px 24px;border-top:1px solid #1a1d23;">
    <p style="color:#4a5060;font-size:11px;margin:0;text-align:center;line-height:1.6;">
      You received this because you set a target price on PriceWatch.<br/>
      Log in to manage your watchlist and notifications.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

async function sendPriceAlertEmail(opts) {
  const t = getTransporter();
  if (!t) { console.warn('[Mailer] No transporter — email skipped'); return false; }
  if (!opts.toEmail?.includes('@')) { console.warn('[Mailer] Invalid email:', opts.toEmail); return false; }

  try {
    const info = await t.sendMail({
      from:    `"PriceWatch 🔔" <${process.env.GMAIL_USER}>`,
      to:      opts.toEmail,
      subject: `🎯 Price Drop! ${opts.productName || 'Product'} is now ${fmt(opts.currentPrice)}`,
      html:    buildAlertHTML(opts),
      text:    `Hi ${opts.userName}, "${opts.productName}" dropped to ${fmt(opts.currentPrice)}, below your target of ${fmt(opts.targetPrice)}. Visit: ${opts.productUrl}`,
    });
    console.log(`[Mailer] ✅ Alert sent to ${opts.toEmail} — ID: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] ❌ Alert failed for ${opts.toEmail}:`, err.message);
    if (err.code === 'EAUTH') {
      _transporter = null;
      console.error('[Mailer] Auth error — reset transporter. Check GMAIL_APP_PASSWORD.');
    }
    return false;
  }
}

// ═════════════════════════════════════════════════════════════
// PASSWORD RESET EMAIL
// ═════════════════════════════════════════════════════════════
function buildResetHTML({ userName, resetUrl, expiresMinutes }) {
  const safeUser = String(userName || 'User').replace(/[<>"]/g, '');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Reset Password — PriceWatch</title></head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d0f;padding:28px 14px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">

  <tr><td style="background:#111316;border-radius:14px 14px 0 0;padding:20px 24px;border-bottom:1px solid #2a2d35;">
    <span style="font-size:18px">🔔</span>
    <span style="color:#e8eaf0;font-size:18px;font-weight:700;vertical-align:middle;margin-left:7px;">PriceWatch</span>
  </td></tr>

  <tr><td style="background:#111316;padding:28px 24px;">
    <h1 style="color:#e8eaf0;font-size:20px;font-weight:700;margin:0 0 10px;">Reset your password 🔑</h1>
    <p style="color:#7a7f8e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      Hi ${safeUser}, we received a request to reset your PriceWatch password.
      Click the button below. This link expires in <strong style="color:#f5a623;">${expiresMinutes} minutes</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td align="center">
        <a href="${resetUrl}" target="_blank"
           style="display:inline-block;background:#f5a623;color:#0c0d0f;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;text-decoration:none;">
          Reset Password →
        </a>
      </td></tr>
    </table>
    <p style="color:#4a5060;font-size:12px;margin:0;line-height:1.6;">
      If you didn't request this, ignore this email — your password will stay the same.<br/>
      Link: <a href="${resetUrl}" style="color:#7a7f8e;">${resetUrl}</a>
    </p>
  </td></tr>

  <tr><td style="background:#0c0d0f;border-radius:0 0 14px 14px;padding:14px 24px;border-top:1px solid #1a1d23;">
    <p style="color:#4a5060;font-size:11px;margin:0;text-align:center;">PriceWatch — Smart Price Drop Tracker</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

async function sendPasswordResetEmail({ toEmail, userName, resetUrl, expiresMinutes = 30 }) {
  const t = getTransporter();
  if (!t) return false;
  if (!toEmail?.includes('@')) return false;

  try {
    const info = await t.sendMail({
      from:    `"PriceWatch 🔔" <${process.env.GMAIL_USER}>`,
      to:      toEmail,
      subject: '🔑 Reset your PriceWatch password',
      html:    buildResetHTML({ userName, resetUrl, expiresMinutes }),
      text:    `Hi ${userName}, click this link to reset your password (expires in ${expiresMinutes} min): ${resetUrl}`,
    });
    console.log(`[Mailer] ✅ Reset email sent to ${toEmail} — ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] ❌ Reset email failed for ${toEmail}:`, err.message);
    return false;
  }
}

module.exports = { sendPriceAlertEmail, sendPasswordResetEmail };