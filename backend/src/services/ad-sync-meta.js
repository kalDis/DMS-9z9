// Meta Ads spend sync engine (Phase 2).
// Pulls campaign-level daily insights from the Meta Marketing API, resolves each campaign to a
// product (SKU) via manual mapping or the campaign name, converts spend to LKR, and writes the
// result into ad_data (source='meta_sync') so it shows up in the Ad ROI report by product + date.
const { query } = require('../config/db');

const META_API_VERSION = 'v21.0';
const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
// Report figures are in LKR. Meta returns each ad account's own currency, so non-LKR spend
// (e.g. Kyshoo in USD) is converted. Rate is configurable; default is a sensible LKR peg.
const USD_LKR_RATE = Number(process.env.USD_LKR_RATE) || 350;

// Match baseKey() in routes/ads.js so synced SKUs line up with the product master + report.
function baseKey(code) {
  const m = /([A-Za-z]+)\W*0*(\d+)/.exec(String(code || ''));
  return m ? (m[1].toUpperCase() + m[2]) : null;
}

// Pull candidate "AA123" style tokens out of a campaign name, most-specific first.
function skuTokens(name) {
  const out = [];
  const re = /([A-Za-z]{2,4})[\s\-_]*0*(\d{1,5})/g;
  let m;
  while ((m = re.exec(String(name || '')))) out.push(m[1].toUpperCase() + m[2]);
  return out;
}

// Resolve a campaign name to a canonical product SKU using the product master. Returns the
// master's SKU (so it matches the report) or null when nothing in the name maps to a product.
function skuFromName(name, masterByKey) {
  for (const tok of skuTokens(name)) {
    const k = baseKey(tok);
    if (k && masterByKey.has(k)) return masterByKey.get(k);
  }
  // No product master? fall back to a strict 2-letter + digits token so sync still works.
  if (masterByKey.size === 0) {
    const m = /\b([A-Za-z]{2})[\s\-_]*0*(\d{2,5})\b/.exec(String(name || ''));
    if (m) return (m[1].toUpperCase() + m[2]);
  }
  return null;
}

// Sum Meta "actions" into lead / message counts (best-effort across common action types).
function countActions(actions) {
  let leads = 0, messages = 0;
  for (const a of actions || []) {
    const t = String(a.action_type || '');
    const v = Number(a.value) || 0;
    if (t === 'lead' || t.endsWith('.lead') || t.includes('lead_grouped') || t === 'leadgen_grouped') leads += v;
    if (t.includes('messaging_conversation_started') || t.includes('messaging_first_reply')) messages += v;
  }
  return { leads: Math.round(leads), messages: Math.round(messages) };
}

function normalizeAdAccountId(raw) {
  if (!raw) return null;
  const digits = String(raw).trim().replace(/^act_/i, '').replace(/\D/g, '');
  return digits ? `act_${digits}` : null;
}

function ymd(d) { return d.toISOString().slice(0, 10); }

// Fetch every page of campaign-level daily insights for the range.
async function fetchInsights(acct, token, since, until) {
  const rows = [];
  let url = `${META_GRAPH}/${acct}/insights?` + new URLSearchParams({
    level: 'campaign',
    time_increment: '1',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_range: JSON.stringify({ since, until }),
    limit: '200',
    access_token: token,
  });
  let guard = 0;
  while (url && guard++ < 50) {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || `Meta insights HTTP ${r.status}`);
    for (const row of d.data || []) rows.push(row);
    url = d.paging?.next || null;
  }
  return rows;
}

async function getAccountCurrency(acct, token) {
  const r = await fetch(`${META_GRAPH}/${acct}?` + new URLSearchParams({ fields: 'currency', access_token: token }));
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error?.message || 'Could not read account currency');
  return d.currency || 'LKR';
}

function toLkr(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === 'LKR') return n;
  if (currency === 'USD') return n * USD_LKR_RATE;
  return n; // unknown currency: store as-is (flagged in the result)
}

// Look up (or create) the campaign→SKU mapping. Spend is only attributed once a mapping is
// CONFIRMED by the user. New/auto campaigns start unconfirmed: we record a suggested SKU from the
// name but hold the spend aside until the user confirms. A manual mapping (auto=false, set via the
// UI) is already confirmed. Returns { sku, confirmed, suggested }.
async function resolveCampaign(businessId, campaignId, campaignName, masterByKey, lastSpend) {
  const existing = (await query('SELECT * FROM ad_campaign_map WHERE business_id=$1 AND platform=$2 AND campaign_id=$3', [businessId, 'meta', campaignId])).rows[0];
  const suggested = skuFromName(campaignName, masterByKey);
  if (existing) {
    // Confirmed (manual or confirmed-auto): keep the user's decision; just refresh name/spend.
    if (existing.confirmed || existing.auto === false) {
      await query('UPDATE ad_campaign_map SET campaign_name=$1, last_spend=$2, last_synced_at=NOW() WHERE id=$3', [campaignName, lastSpend, existing.id]);
      return { sku: existing.product_sku || null, confirmed: !!existing.confirmed, suggested };
    }
    // Unconfirmed auto row: refresh the suggestion from the (possibly renamed) campaign.
    await query('UPDATE ad_campaign_map SET campaign_name=$1, product_sku=$2, last_spend=$3, last_synced_at=NOW() WHERE id=$4', [campaignName, suggested, lastSpend, existing.id]);
    return { sku: suggested, confirmed: false, suggested };
  }
  // Brand-new campaign → record it unconfirmed with the suggested SKU for the user to confirm.
  await query('INSERT INTO ad_campaign_map (business_id, platform, campaign_id, campaign_name, product_sku, auto, confirmed, last_spend, last_synced_at) VALUES ($1,$2,$3,$4,$5,TRUE,FALSE,$6,NOW())', [businessId, 'meta', campaignId, campaignName, suggested, lastSpend]);
  return { sku: suggested, confirmed: false, suggested };
}

// Main entry: sync Meta spend for one business over [date_from, date_to] (YYYY-MM-DD).
async function syncMetaForBusiness(biz, opts = {}) {
  if (!biz.meta_access_token) throw new Error('Not connected to Meta');
  const acct = normalizeAdAccountId(biz.meta_ad_account_id);
  if (!acct) throw new Error('No Meta Ad Account ID set');

  const until = opts.date_to || ymd(new Date());
  const since = opts.date_from || ymd(new Date(Date.now() - 30 * 86400000));

  const currency = await getAccountCurrency(acct, biz.meta_access_token);
  const insights = await fetchInsights(acct, biz.meta_access_token, since, until);

  // Product master (baseKey → canonical SKU) for name→SKU resolution.
  const masterByKey = new Map();
  for (const m of (await query('SELECT product_sku FROM products WHERE business_id=$1', [biz.id])).rows) {
    const k = baseKey(m.product_sku); if (k && !masterByKey.has(k)) masterByKey.set(k, m.product_sku);
  }

  // Total spend per campaign (for the mapping table display).
  const campSpend = new Map();
  for (const row of insights) {
    campSpend.set(row.campaign_id, (campSpend.get(row.campaign_id) || 0) + (Number(row.spend) || 0));
  }

  // Resolve each distinct campaign once.
  const campInfo = new Map(); // campaign_id → { sku, confirmed, suggested }
  const campName = new Map();
  for (const [cid] of campSpend) {
    const name = insights.find(r => r.campaign_id === cid)?.campaign_name || '';
    campName.set(cid, name);
    campInfo.set(cid, await resolveCampaign(biz.id, cid, name, masterByKey, toLkr(campSpend.get(cid), currency)));
  }

  // Aggregate CONFIRMED-mapped spend per (sku, day). Unconfirmed campaigns are held as "pending"
  // (user must confirm), and confirmed-with-no-product are intentionally ignored.
  const byKey = new Map(); // `${sku}|${day}` → {spend,impr,clicks,leads,messages}
  const pending = new Map(); // campaign_id → {name, suggested_sku, spend}
  let mappedSpend = 0, pendingSpend = 0, ignoredSpend = 0;
  for (const row of insights) {
    const info = campInfo.get(row.campaign_id);
    const day = row.date_start; // daily rows: date_start === date_stop
    const spend = toLkr(row.spend, currency);
    if (!info.confirmed) {
      const u = pending.get(row.campaign_id) || { name: campName.get(row.campaign_id), suggested_sku: info.suggested || null, spend: 0 };
      u.spend += spend; pending.set(row.campaign_id, u); pendingSpend += spend;
      continue;
    }
    if (!info.sku) { ignoredSpend += spend; continue; } // confirmed as "no product"
    const { leads, messages } = countActions(row.actions);
    const key = `${info.sku}|${day}`;
    const e = byKey.get(key) || { sku: info.sku, day, spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0 };
    e.spend += spend;
    e.impressions += Number(row.impressions) || 0;
    e.clicks += Number(row.clicks) || 0;
    e.leads += leads;
    e.messages += messages;
    byKey.set(key, e);
    mappedSpend += spend;
  }

  // Replace this sync's own rows for the range, then insert fresh (idempotent re-sync).
  await query("DELETE FROM ad_data WHERE business_id=$1 AND platform='meta' AND source='meta_sync' AND period_start>=$2 AND period_start<=$3", [biz.id, since, until]);
  let written = 0;
  for (const e of byKey.values()) {
    await query(
      `INSERT INTO ad_data (business_id, product_sku, platform, period_start, period_end, spend, impressions, clicks, leads, messages, source)
       VALUES ($1,$2,'meta',$3,$3,$4,$5,$6,$7,$8,'meta_sync')`,
      [biz.id, e.sku, e.day, Math.round(e.spend * 100) / 100, e.impressions, e.clicks, e.leads, e.messages]
    );
    written++;
  }

  const status = `Synced ${written} rows for ${campSpend.size} campaigns (${pending.size} pending confirmation). ${currency}→LKR${currency !== 'LKR' ? ' @' + USD_LKR_RATE : ''}.`;
  await query('UPDATE businesses SET ad_last_sync_at=NOW(), ad_last_sync_status=$1 WHERE id=$2', [status, biz.id]);

  return {
    success: true,
    date_from: since, date_to: until,
    currency, usd_lkr_rate: currency === 'USD' ? USD_LKR_RATE : null,
    campaigns: campSpend.size,
    rows_written: written,
    mapped_spend_lkr: Math.round(mappedSpend),
    pending_spend_lkr: Math.round(pendingSpend),
    ignored_spend_lkr: Math.round(ignoredSpend),
    pending: [...pending.entries()].map(([id, u]) => ({ campaign_id: id, campaign_name: u.name, suggested_sku: u.suggested_sku, spend_lkr: Math.round(u.spend) })).sort((a, b) => b.spend_lkr - a.spend_lkr),
    status,
  };
}

module.exports = { syncMetaForBusiness, skuFromName, baseKey, USD_LKR_RATE };
