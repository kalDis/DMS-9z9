// TikTok Ads spend sync engine (Phase 2 — TikTok).
// Mirrors ad-sync-meta.js: pulls campaign-level daily reporting from the TikTok Business API
// (Marketing API v1.3), resolves each campaign to a product (SKU) via manual mapping or the
// campaign name, converts spend to LKR, and writes the result into ad_data (platform='tiktok',
// source='tiktok_sync') so it shows up in the Ad ROI report by product + date.
const { query } = require('../config/db');
// Reuse the exact SKU normalisation + name→SKU resolution + FX rate from the Meta engine so
// TikTok synced SKUs line up with the same product master, report and USD→LKR conversion.
const { baseKey, skuFromName, USD_LKR_RATE } = require('./ad-sync-meta');

const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3';

// Call a TikTok Business API endpoint. All responses are { code, message, data }; code 0 = OK.
async function tiktokGet(path, token, params) {
  const qs = params ? ('?' + new URLSearchParams(params).toString()) : '';
  const r = await fetch(`${TIKTOK_API}${path}${qs}`, { headers: { 'Access-Token': token } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.code !== 0) throw new Error(d.message || `TikTok API HTTP ${r.status}`);
  return d.data;
}

// Advertiser currency (TikTok returns each advertiser account's own currency, e.g. USD or LKR).
async function getAdvertiserCurrency(advId, token) {
  const data = await tiktokGet('/advertiser/info/', token, {
    advertiser_ids: JSON.stringify([String(advId)]),
    fields: JSON.stringify(['currency', 'name']),
  });
  const info = data?.list?.[0] || {};
  return { currency: info.currency || 'LKR', name: info.name || '' };
}

function toLkr(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === 'LKR') return n;
  if (currency === 'USD') return n * USD_LKR_RATE;
  return n; // unknown currency: store as-is (flagged in the result)
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(ymdStr, n) { return ymd(new Date(new Date(ymdStr + 'T00:00:00Z').getTime() + n * 86400000)); }

// Fetch every page of campaign-level daily report rows for one date window.
async function fetchReportWindow(advId, token, start, end) {
  const rows = [];
  let page = 1;
  let guard = 0;
  while (guard++ < 200) {
    const data = await tiktokGet('/report/integrated/get/', token, {
      advertiser_id: String(advId),
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'campaign_name']),
      start_date: start,
      end_date: end,
      page: String(page),
      page_size: '1000',
    });
    for (const row of data?.list || []) rows.push(row);
    const totalPage = Number(data?.page_info?.total_page || 1);
    if (page >= totalPage) break;
    page++;
  }
  return rows;
}

// TikTok limits a report request's date span, so split long backfills into ~30-day windows.
async function fetchReport(advId, token, since, until) {
  const WINDOW = 30;
  const all = [];
  let winStart = since;
  let guard = 0;
  while (winStart <= until && guard++ < 60) {
    let winEnd = addDays(winStart, WINDOW - 1);
    if (winEnd > until) winEnd = until;
    const part = await fetchReportWindow(advId, token, winStart, winEnd);
    for (const row of part) all.push(row);
    winStart = addDays(winEnd, 1);
  }
  return all;
}

// Look up (or create) the campaign→SKU mapping. Spend is only attributed once a mapping is
// CONFIRMED by the user — identical rule to the Meta engine, on platform='tiktok'.
async function resolveCampaign(businessId, campaignId, campaignName, masterByKey, lastSpend) {
  const existing = (await query('SELECT * FROM ad_campaign_map WHERE business_id=$1 AND platform=$2 AND campaign_id=$3', [businessId, 'tiktok', campaignId])).rows[0];
  const suggested = skuFromName(campaignName, masterByKey);
  if (existing) {
    if (existing.confirmed || existing.auto === false) {
      await query('UPDATE ad_campaign_map SET campaign_name=$1, last_spend=$2, last_synced_at=NOW() WHERE id=$3', [campaignName, lastSpend, existing.id]);
      return { sku: existing.product_sku || null, confirmed: !!existing.confirmed, suggested };
    }
    await query('UPDATE ad_campaign_map SET campaign_name=$1, product_sku=$2, last_spend=$3, last_synced_at=NOW() WHERE id=$4', [campaignName, suggested, lastSpend, existing.id]);
    return { sku: suggested, confirmed: false, suggested };
  }
  await query('INSERT INTO ad_campaign_map (business_id, platform, campaign_id, campaign_name, product_sku, auto, confirmed, last_spend, last_synced_at) VALUES ($1,$2,$3,$4,$5,TRUE,FALSE,$6,NOW())', [businessId, 'tiktok', campaignId, campaignName, suggested, lastSpend]);
  return { sku: suggested, confirmed: false, suggested };
}

// Main entry: sync TikTok spend for one business over [date_from, date_to] (YYYY-MM-DD).
async function syncTiktokForBusiness(biz, opts = {}) {
  if (!biz.tiktok_access_token) throw new Error('Not connected to TikTok');
  const advId = String(biz.tiktok_advertiser_id || '').trim();
  if (!advId) throw new Error('No TikTok Advertiser ID set');

  const until = opts.date_to || ymd(new Date());
  const since = opts.date_from || ymd(new Date(Date.now() - 30 * 86400000));

  const { currency } = await getAdvertiserCurrency(advId, biz.tiktok_access_token);
  const report = await fetchReport(advId, biz.tiktok_access_token, since, until);

  // Product master (baseKey → canonical SKU) for name→SKU resolution.
  const masterByKey = new Map();
  for (const m of (await query('SELECT product_sku FROM products WHERE business_id=$1', [biz.id])).rows) {
    const k = baseKey(m.product_sku); if (k && !masterByKey.has(k)) masterByKey.set(k, m.product_sku);
  }

  // Flatten report rows into { campaignId, campaignName, day, spend, impressions, clicks }.
  const flat = [];
  const campSpend = new Map();
  const campName = new Map();
  for (const row of report) {
    const dim = row.dimensions || {};
    const met = row.metrics || {};
    const cid = String(dim.campaign_id || '');
    if (!cid) continue;
    const day = String(dim.stat_time_day || '').slice(0, 10);
    const name = met.campaign_name || campName.get(cid) || '';
    campName.set(cid, name);
    const spend = Number(met.spend) || 0;
    flat.push({ cid, day, spend, impressions: Number(met.impressions) || 0, clicks: Number(met.clicks) || 0 });
    campSpend.set(cid, (campSpend.get(cid) || 0) + spend);
  }

  // Resolve each distinct campaign once.
  const campInfo = new Map(); // campaign_id → { sku, confirmed, suggested }
  for (const [cid] of campSpend) {
    campInfo.set(cid, await resolveCampaign(biz.id, cid, campName.get(cid) || '', masterByKey, toLkr(campSpend.get(cid), currency)));
  }

  // Aggregate CONFIRMED-mapped spend per (sku, day). Unconfirmed campaigns are held as "pending".
  const byKey = new Map();
  const pending = new Map();
  let mappedSpend = 0, pendingSpend = 0, ignoredSpend = 0;
  for (const r of flat) {
    const info = campInfo.get(r.cid);
    const spend = toLkr(r.spend, currency);
    if (!info.confirmed) {
      const u = pending.get(r.cid) || { name: campName.get(r.cid), suggested_sku: info.suggested || null, spend: 0 };
      u.spend += spend; pending.set(r.cid, u); pendingSpend += spend;
      continue;
    }
    if (!info.sku) { ignoredSpend += spend; continue; }
    const key = `${info.sku}|${r.day}`;
    const e = byKey.get(key) || { sku: info.sku, day: r.day, spend: 0, impressions: 0, clicks: 0 };
    e.spend += spend;
    e.impressions += toLkr(r.impressions, 'LKR');
    e.clicks += r.clicks;
    byKey.set(key, e);
    mappedSpend += spend;
  }

  // Replace this sync's own rows for the range, then insert fresh (idempotent re-sync).
  await query("DELETE FROM ad_data WHERE business_id=$1 AND platform='tiktok' AND source='tiktok_sync' AND period_start>=$2 AND period_start<=$3", [biz.id, since, until]);
  let written = 0;
  for (const e of byKey.values()) {
    await query(
      `INSERT INTO ad_data (business_id, product_sku, platform, period_start, period_end, spend, impressions, clicks, leads, messages, source)
       VALUES ($1,$2,'tiktok',$3,$3,$4,$5,$6,0,0,'tiktok_sync')`,
      [biz.id, e.sku, e.day, Math.round(e.spend * 100) / 100, Math.round(e.impressions), Math.round(e.clicks)]
    );
    written++;
  }

  const status = `TikTok: synced ${written} rows for ${campSpend.size} campaigns (${pending.size} pending confirmation). ${currency}→LKR${currency !== 'LKR' ? ' @' + USD_LKR_RATE : ''}.`;
  await query('UPDATE businesses SET ad_last_sync_at=NOW(), ad_last_sync_status=$1 WHERE id=$2', [status, biz.id]);

  return {
    success: true,
    platform: 'tiktok',
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

module.exports = { syncTiktokForBusiness, getAdvertiserCurrency };
