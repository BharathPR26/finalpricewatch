const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Transporter ───────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ── Verify connection on startup ──────────────────────────────
transporter.verify()
  .then(() => console.log('✅ Gmail mailer ready'))
  .catch(err => console.warn('⚠️  Gmail not configured:', err.message));

// ── HTML Email Template ───────────────────────────────────────
function buildEmailHTML({ userName, productName, productUrl, productImage,
                          currentPrice, targetPrice, allTimeLow, dropPct, category }) {
  const fmtPrice = n => '₹' + Number(n).toLocaleString('en-IN');
  const saved    = targetPrice - currentPrice;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Price Drop Alert</title>
</head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d0f;padding:40px 20px;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#111316;border-radius:16px 16px 0 0;padding:28px 32px;border-bottom:1px solid #2a2d35;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <span style="background:#f5a623;border-radius:8px;padding:6px 10px;font-size:18px;">🔔</span>
                <span style="color:#e8eaf0;font-size:20px;font-weight:700;letter-spacing:-0.3px;">PriceWatch</span>
              </div>
            </td>
            <td align="right">
              <span style="background:rgba(46,204,113,0.15);color:#2ecc71;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">
                PRICE DROP ALERT
              </span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Hero -->
      <tr><td style="background:#111316;padding:0;">
        <div style="background:linear-gradient(135deg,rgba(245,166,35,0.08),rgba(46,204,113,0.05));padding:32px 32px 24px;border-bottom:1px solid #1a1d23;">
          <p style="color:#7a7f8e;font-size:14px;margin:0 0 6px;">Hi ${userName},</p>
          <h1 style="color:#e8eaf0;font-size:24px;font-weight:700;margin:0 0 8px;line-height:1.3;">
            Great news — your target price was hit! 🎯
          </h1>
          <p style="color:#7a7f8e;font-size:14px;margin:0;">
            A product on your PriceWatch list just dropped to your target price.
          </p>
        </div>
      </td></tr>

      <!-- Product Card -->
      <tr><td style="background:#111316;padding:24px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#1a1d23;border:1px solid #2a2d35;border-radius:12px;overflow:hidden;">
          <tr>
            ${productImage ? `<td width="100" style="padding:0;vertical-align:top;">
              <img src="${productImage}" width="100" height="100"
                   style="display:block;object-fit:cover;border-radius:12px 0 0 12px;" alt=""/>
            </td>` : ''}
            <td style="padding:16px 20px;vertical-align:top;">
              <div style="color:#f5a623;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">
                ${category}
              </div>
              <div style="color:#e8eaf0;font-size:15px;font-weight:600;line-height:1.4;margin-bottom:12px;">
                ${productName}
              </div>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:20px;">
                    <div style="color:#7a7f8e;font-size:11px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">Current Price</div>
                    <div style="color:#2ecc71;font-size:26px;font-weight:700;font-family:monospace;">${fmtPrice(currentPrice)}</div>
                  </td>
                  <td style="padding-right:20px;">
                    <div style="color:#7a7f8e;font-size:11px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">Your Target</div>
                    <div style="color:#f5a623;font-size:22px;font-weight:600;font-family:monospace;">${fmtPrice(targetPrice)}</div>
                  </td>
                  <td>
                    <div style="color:#7a7f8e;font-size:11px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">All-Time Low</div>
                    <div style="color:#e8eaf0;font-size:18px;font-family:monospace;">${fmtPrice(allTimeLow)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Savings Banner -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
          <tr>
            <td style="background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.2);border-radius:10px;padding:14px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#2ecc71;font-size:14px;font-weight:600;">
                      ↓ ${dropPct}% drop since tracking started
                    </span>
                  </td>
                  <td align="right">
                    <span style="color:#7a7f8e;font-size:13px;">
                      You save <strong style="color:#2ecc71;">${fmtPrice(Math.max(0, saved))}</strong> vs your target
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- CTA Button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
          <tr>
            <td align="center">
              <a href="${productUrl}" target="_blank"
                 style="display:inline-block;background:#f5a623;color:#0c0d0f;font-size:15px;font-weight:700;
                        padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:0.2px;">
                View Product &amp; Buy Now →
              </a>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#0c0d0f;border-radius:0 0 16px 16px;padding:20px 32px;border-top:1px solid #1a1d23;">
        <p style="color:#4a5060;font-size:12px;margin:0;text-align:center;line-height:1.6;">
          You received this alert because you set a target price on PriceWatch.<br/>
          Log in to manage your watchlist and notification preferences.
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
  const fmtPrice = n => '₹' + Number(n).toLocaleString('en-IN');

  const mailOptions = {
    from:    `"PriceWatch 🔔" <${process.env.GMAIL_USER}>`,
    to:      toEmail,
    subject: `🎯 Price Drop! ${productName} is now ${fmtPrice(currentPrice)}`,
    html:    buildEmailHTML({
      userName, productName, productUrl, productImage,
      currentPrice, targetPrice, allTimeLow, dropPct, category,
    }),
    text: `Hi ${userName}, the price of "${productName}" dropped to ${fmtPrice(currentPrice)}, below your target of ${fmtPrice(targetPrice)}. Visit: ${productUrl}`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${toEmail} — ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`❌ Email failed for ${toEmail}:`, err.message);
    return false;
  }
}

module.exports = { sendPriceAlertEmail };