/**
 * PriceWatch Mailer
 * Uses smtp.gmail.com port 465 (SSL) — reliable on Render
 * Exports: sendPriceAlertEmail, sendPasswordResetEmail
 */
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Create transporter ────────────────────────────────────────
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.error('[Mailer] ❌ GMAIL_USER or GMAIL_APP_PASSWORD missing in environment!');
    return null;
  }

  const t = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,   // SSL — more reliable than service:'gmail' on cloud servers
    auth:   { user, pass },
  });

  t.verify((err) => {
    if (err) {
      console.error('[Mailer] ❌ Gmail connection failed:', err.message);
      console.error('[Mailer] Fix: Check GMAIL_USER and GMAIL_APP_PASSWORD in Render env vars');
    } else {
      console.log('[Mailer] ✅ Gmail connected —', user);
    }
  });

  return t;
}

const transporter = createTransporter();

// ── Safe number formatter ────────────────────────────────────
const rupee = n => {
  const v = parseFloat(n);
  return isNaN(v) ? '₹0' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

// ═════════════════════════════════════════════════════════════
// PRICE DROP ALERT EMAIL
// ═════════════════════════════════════════════════════════════
async function sendPriceAlertEmail({
  toEmail, userName, productName, productUrl, productImage,
  currentPrice, targetPrice, allTimeLow, dropPct, category
}) {
  if (!transporter) {
    console.error('[Mailer] No transporter — cannot send alert email');
    return false;
  }
  if (!toEmail || !toEmail.includes('@')) {
    console.error('[Mailer] Invalid email address:', toEmail);
    return false;
  }

  const saved    = Math.max(0, parseFloat(targetPrice || 0) - parseFloat(currentPrice || 0));
  const safeDrop = parseFloat(dropPct || 0).toFixed(1);
  const safeName = String(productName || 'Product').replace(/[<>]/g, '');
  const safeUser = String(userName    || 'User').replace(/[<>]/g, '');
  const safeCat  = String(category    || 'Product').replace(/[<>]/g, '');
  const safeUrl  = String(productUrl  || '#');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Price Drop Alert</title>
</head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d0f;padding:24px 12px;">
<tr><td align="center">
<table width="550" cellpadding="0" cellspacing="0" style="max-width:550px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#111316;border-radius:12px 12px 0 0;padding:18px 22px;border-bottom:1px solid #2a2d35;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-size:20px">🔔</span>
          <span style="color:#e8eaf0;font-size:17px;font-weight:700;vertical-align:middle;margin-left:7px;">PriceWatch</span></td>
      <td align="right">
        <span style="background:rgba(46,204,113,.15);color:#2ecc71;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;">🎯 PRICE DROP ALERT</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- Message -->
  <tr><td style="background:#111316;padding:18px 22px 14px;border-bottom:1px solid #1a1d23;">
    <p style="color:#7a7f8e;font-size:13px;margin:0 0 4px;">Hi ${safeUser},</p>
    <h1 style="color:#e8eaf0;font-size:18px;font-weight:700;margin:0 0 4px;">Your target price was hit! 🎯</h1>
    <p style="color:#7a7f8e;font-size:13px;margin:0;">
      <strong style="color:#f5a623;">${safeName}</strong> just dropped below your target.
    </p>
  </td></tr>

  <!-- Product prices -->
  <tr><td style="background:#111316;padding:16px 22px;">
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#1a1d23;border:1px solid #2a2d35;border-radius:10px;padding:14px 16px;">
      <tr>
        ${productImage ? `<td width="80" style="vertical-align:top;padding:0;">
          <img src="${productImage}" width="80" height="80"
               style="display:block;object-fit:cover;border-radius:8px 0 0 8px;" alt=""/>
        </td>` : ''}
        <td style="padding:${productImage ? '0 0 0 14px' : '0'};vertical-align:top;">
          <div style="color:#f5a623;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">${safeCat}</div>
          <div style="color:#e8eaf0;font-size:13px;font-weight:600;margin-bottom:12px;line-height:1.4;">${safeName}</div>
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:18px;">
              <div style="color:#7a7f8e;font-size:9px;text-transform:uppercase;margin-bottom:3px;">Current Price</div>
              <div style="color:#2ecc71;font-size:22px;font-weight:700;font-family:monospace;">${rupee(currentPrice)}</div>
            </td>
            <td style="padding-right:18px;">
              <div style="color:#7a7f8e;font-size:9px;text-transform:uppercase;margin-bottom:3px;">Your Target</div>
              <div style="color:#f5a623;font-size:18px;font-weight:600;font-family:monospace;">${rupee(targetPrice)}</div>
            </td>
            <td>
              <div style="color:#7a7f8e;font-size:9px;text-transform:uppercase;margin-bottom:3px;">All-Time Low</div>
              <div style="color:#e8eaf0;font-size:16px;font-family:monospace;">${rupee(allTimeLow)}</div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    <!-- Drop % banner -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
      <tr><td style="background:rgba(46,204,113,.07);border:1px solid rgba(46,204,113,.2);border-radius:8px;padding:10px 14px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><span style="color:#2ecc71;font-size:13px;font-weight:600;">↓ ${safeDrop}% drop since tracking started</span></td>
          ${saved > 0 ? `<td align="right"><span style="color:#7a7f8e;font-size:12px;">You save <strong style="color:#2ecc71;">${rupee(saved)}</strong></span></td>` : ''}
        </tr></table>
      </td></tr>
    </table>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr><td align="center">
        <a href="${safeUrl}" target="_blank"
           style="display:inline-block;background:#f5a623;color:#000;font-size:14px;font-weight:700;padding:12px 30px;border-radius:8px;text-decoration:none;">
          Buy Now →
        </a>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0c0d0f;border-radius:0 0 12px 12px;padding:14px 22px;border-top:1px solid #1a1d23;">
    <p style="color:#4a5060;font-size:11px;margin:0;text-align:center;line-height:1.6;">
      You received this because you set a target price on PriceWatch.<br/>
      Login to manage your watchlist and notifications.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  try {
    const info = await transporter.sendMail({
      from:    `"PriceWatch 🔔" <${process.env.GMAIL_USER}>`,
      to:      toEmail,
      subject: `🎯 Price Drop! ${safeName} is now ${rupee(currentPrice)}`,
      html,
      text: `Hi ${safeUser}, "${safeName}" dropped to ${rupee(currentPrice)}, below your target of ${rupee(targetPrice)}. Visit: ${safeUrl}`,
    });
    console.log(`[Mailer] ✅ Alert sent to ${toEmail} (${info.messageId})`);
    return true;
  } catch (err) {
    console.error(`[Mailer] ❌ Alert FAILED for ${toEmail}:`, err.message);
    return false;
  }
}

// ═════════════════════════════════════════════════════════════
// PASSWORD RESET EMAIL
// ═════════════════════════════════════════════════════════════
async function sendPasswordResetEmail({ toEmail, userName, resetUrl, expiresMinutes = 30 }) {
  if (!transporter) {
    console.error('[Mailer] No transporter — cannot send reset email');
    return false;
  }
  if (!toEmail || !toEmail.includes('@')) {
    console.error('[Mailer] Invalid email:', toEmail);
    return false;
  }

  const safeUser = String(userName || 'User').replace(/[<>]/g, '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Reset Password — PriceWatch</title>
</head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d0f;padding:24px 12px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">

  <tr><td style="background:#111316;border-radius:12px 12px 0 0;padding:18px 22px;border-bottom:1px solid #2a2d35;">
    <span style="font-size:20px">🔔</span>
    <span style="color:#e8eaf0;font-size:17px;font-weight:700;vertical-align:middle;margin-left:7px;">PriceWatch</span>
  </td></tr>

  <tr><td style="background:#111316;padding:24px 22px;">
    <h1 style="color:#e8eaf0;font-size:20px;font-weight:700;margin:0 0 8px;">Reset your password 🔑</h1>
    <p style="color:#7a7f8e;font-size:13px;margin:0 0 20px;line-height:1.65;">
      Hi ${safeUser}, we received a request to reset your PriceWatch password.
      Click the button below — this link expires in
      <strong style="color:#f5a623;">${expiresMinutes} minutes</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td align="center">
        <a href="${resetUrl}"
           style="display:inline-block;background:#f5a623;color:#000;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px;text-decoration:none;">
          Reset Password →
        </a>
      </td></tr>
    </table>
    <p style="color:#4a5060;font-size:12px;margin:0;line-height:1.65;">
      If you did not request this, simply ignore this email — your password will not change.<br/>
      Or copy this link: <a href="${resetUrl}" style="color:#7a7f8e;word-break:break-all;">${resetUrl}</a>
    </p>
  </td></tr>

  <tr><td style="background:#0c0d0f;border-radius:0 0 12px 12px;padding:14px 22px;border-top:1px solid #1a1d23;">
    <p style="color:#4a5060;font-size:11px;margin:0;text-align:center;">PriceWatch — Smart Price Drop Tracker</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  try {
    const info = await transporter.sendMail({
      from:    `"PriceWatch 🔔" <${process.env.GMAIL_USER}>`,
      to:      toEmail,
      subject: '🔑 Reset your PriceWatch password',
      html,
      text: `Hi ${safeUser}, click here to reset your PriceWatch password (expires in ${expiresMinutes} min): ${resetUrl}`,
    });
    console.log(`[Mailer] ✅ Reset email sent to ${toEmail} (${info.messageId})`);
    return true;
  } catch (err) {
    console.error(`[Mailer] ❌ Reset email FAILED for ${toEmail}:`, err.message);
    return false;
  }
}

module.exports = { sendPriceAlertEmail, sendPasswordResetEmail };