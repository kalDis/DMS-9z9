// Ad spend sync — credential/connection management (Phase 1).
// Meta (Facebook/Instagram) Ads: the admin saves App ID + App Secret + Ad Account ID,
// then clicks "Connect Meta" which runs a Facebook Login OAuth (ads_read). We exchange the
// returned code for a long-lived (~60-day) user token, store it, and can auto-refresh it.
// TikTok credentials are saved manually for now (its app is still in review); the actual
// spend-pull engine is Phase 2.
const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const META_API_VERSION = 'v21.0';
const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
const META_DIALOG = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;
// Backend's own public base URL — the OAuth redirect_uri must EXACTLY match the one
// registered in the Meta app's "Valid OAuth Redirect URIs". Override with PUBLIC_API_URL.
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://dms-9z9-production.up.railway.app').replace(/\/$/, '');
const META_REDIRECT_URI = `${PUBLIC_API_URL}/api/ad-sync/meta/callback`;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://resilient-clarity-production-78b4.up.railway.app').split(',')[0].trim();

// act_<digits> is what the Graph API expects; accept either form from the admin.
function normalizeAdAccountId(raw) {
  if (!raw) return null;
  const digits = String(raw).trim().replace(/^act_/i, '').replace(/\D/g, '');
  return digits ? `act_${digits}` : null;
}

async function getBusiness(id) {
  const r = await query('SELECT * FROM businesses WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// --- Meta OAuth: step 1, build the authorization URL --------------------------------------
// Frontend (admin, authenticated) calls this; it returns a URL to open in a popup. The
// business id + user id travel in a short-lived signed `state` so the unauthenticated
// callback can trust them.
router.post('/meta/connect-url/:businessId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const biz = await getBusiness(req.params.businessId);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    if (!biz.meta_app_id || !biz.meta_app_secret) {
      return res.status(400).json({ error: 'Save the Meta App ID and App Secret first, then connect.' });
    }
    const state = jwt.sign({ businessId: Number(req.params.businessId), userId: req.user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const params = new URLSearchParams({
      client_id: biz.meta_app_id,
      redirect_uri: META_REDIRECT_URI,
      state,
      response_type: 'code',
      scope: 'ads_read',
    });
    res.json({ url: `${META_DIALOG}?${params.toString()}`, redirect_uri: META_REDIRECT_URI });
  } catch (err) {
    console.error('meta connect-url error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Small HTML that tells the opener window the result and closes the popup.
function popupResult(ok, message) {
  const payload = JSON.stringify({ source: 'dms-meta-oauth', ok, message });
  return `<!doctype html><html><body style="font-family:sans-serif;background:#040912;color:#C8D8E8;padding:40px;text-align:center">
    <p>${ok ? '✓ Meta connected. You can close this window.' : '✕ ' + message}</p>
    <script>
      try { if (window.opener) window.opener.postMessage(${payload}, '*'); } catch (e) {}
      setTimeout(function(){ window.close(); }, ${ok ? 1200 : 4000});
    </script>
  </body></html>`;
}

// --- Meta OAuth: step 2, the callback FB redirects to -------------------------------------
router.get('/meta/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  try {
    if (error) return res.status(400).send(popupResult(false, `Meta: ${error_description || error}`));
    if (!code || !state) return res.status(400).send(popupResult(false, 'Missing code/state from Meta.'));

    let decoded;
    try { decoded = jwt.verify(state, process.env.JWT_SECRET); }
    catch { return res.status(400).send(popupResult(false, 'Connection link expired — please try again.')); }

    const biz = await getBusiness(decoded.businessId);
    if (!biz || !biz.meta_app_id || !biz.meta_app_secret) {
      return res.status(400).send(popupResult(false, 'Business/app credentials missing.'));
    }

    // Exchange the code for a short-lived token.
    const shortRes = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: biz.meta_app_id,
      redirect_uri: META_REDIRECT_URI,
      client_secret: biz.meta_app_secret,
      code: String(code),
    }));
    const shortData = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) {
      return res.status(400).send(popupResult(false, shortData.error?.message || 'Token exchange failed.'));
    }

    // Exchange the short-lived token for a long-lived (~60-day) one.
    const longRes = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: biz.meta_app_id,
      client_secret: biz.meta_app_secret,
      fb_exchange_token: shortData.access_token,
    }));
    const longData = await longRes.json();
    const accessToken = longData.access_token || shortData.access_token;
    const expiresIn = Number(longData.expires_in || shortData.expires_in || 0); // seconds
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await query('UPDATE businesses SET meta_access_token=$1, meta_token_expires_at=$2, updated_at=NOW() WHERE id=$3', [accessToken, expiresAt, decoded.businessId]);
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [decoded.userId, 'admin', `Connected Meta Ads`, biz.name]).catch(() => {});

    res.send(popupResult(true, 'Connected'));
  } catch (err) {
    console.error('meta callback error:', err);
    res.status(500).send(popupResult(false, 'Server error during Meta connection.'));
  }
});

// Refresh a long-lived token (extends another ~60 days). Safe to call anytime a valid token
// exists; Meta re-issues from a still-valid fb_exchange_token. Returns the new expiry.
async function refreshMetaToken(biz) {
  if (!biz.meta_access_token || !biz.meta_app_id || !biz.meta_app_secret) return null;
  const r = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: biz.meta_app_id,
    client_secret: biz.meta_app_secret,
    fb_exchange_token: biz.meta_access_token,
  }));
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(d.error?.message || 'Refresh failed');
  const expiresIn = Number(d.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  await query('UPDATE businesses SET meta_access_token=$1, meta_token_expires_at=$2, updated_at=NOW() WHERE id=$3', [d.access_token, expiresAt, biz.id]);
  return { access_token: d.access_token, expires_at: expiresAt };
}

router.post('/:businessId/refresh-meta', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const biz = await getBusiness(req.params.businessId);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    if (!biz.meta_access_token) return res.status(400).json({ error: 'Not connected to Meta yet.' });
    const out = await refreshMetaToken(biz);
    res.json({ success: true, expires_at: out?.expires_at || null });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// --- Test the Meta connection: read a small spend sample ----------------------------------
router.post('/:businessId/test-meta', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const biz = await getBusiness(req.params.businessId);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    if (!biz.meta_access_token) return res.json({ success: false, message: 'Not connected to Meta yet — click Connect Meta first.' });
    const acct = normalizeAdAccountId(biz.meta_ad_account_id);
    if (!acct) return res.json({ success: false, message: 'Enter a valid Meta Ad Account ID first.' });

    // Pull last-7-days spend for the account as a liveness check.
    const url = `${META_GRAPH}/${acct}?` + new URLSearchParams({
      fields: 'name,account_status,currency,insights.date_preset(last_7d){spend,impressions,clicks}',
      access_token: biz.meta_access_token,
    });
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || d.error) {
      const code = d.error?.code;
      const hint = (code === 190) ? ' (token expired/invalid — reconnect Meta)' : '';
      return res.json({ success: false, message: (d.error?.message || 'Meta API error') + hint });
    }
    const ins = d.insights?.data?.[0];
    const spend = ins ? `${d.currency || ''} ${ins.spend}` : 'no spend in last 7 days';
    res.json({ success: true, message: `Connected to "${d.name}". Last 7 days spend: ${spend}.`, account: d.name, currency: d.currency, sample: ins || null });
  } catch (err) {
    console.error('test-meta error:', err);
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
module.exports.refreshMetaToken = refreshMetaToken;
module.exports.normalizeAdAccountId = normalizeAdAccountId;
