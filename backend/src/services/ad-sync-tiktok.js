// TikTok Ads spend sync engine. Mirrors ad-sync-meta.js: pulls campaign-level DAILY reports from
// the TikTok Marketing (Business) API, resolves each campaign to a product SKU through the shared
// ad_campaign_map (platform='tiktok', confirm-before-attribute), converts spend to LKR, and writes
// rows into ad_data with source='tiktok_sync' (idempotent — manual TikTok entries are never touched).
const { query } = require('../config/db');
const { baseKey, resolveCampaign, toLkr, addDays, ymd, USD_LKR_RATE } = require('./ad-sync-meta');

const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3';
// Daily-granularity reports are limited to a 30-day span per request.
const WINDOW_DAYS = 30;
const PAGE_SIZE = 1000;

// Authenticated GET against the Marketing API. TikTok replies HTTP 200 with {code, message, data};
// code 0 = ok, anything else is an error (40100/40105 = bad/expired token, 40002 = bad param).
async function ttGet(path, params, token) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const r = await fetch(`${TIKTOK_API}${path}?${qs.toString()}`, { headers: { 'Access-Token': token } });
  let d;
  try { d = await r.json(); } catch { throw new Error(`TikTok HTTP ${r.status} (non-JSON reply)`); }
  if (!r.ok || d.code !== 0) {
    const hint = [40100, 40101, 40102, 40104, 40105].includes(d.code) ? ' (token invalid/expired — reconnect TikTok)' : '';
    throw new Error(`${d.message || `TikTok HTTP ${r.status}`}${hint}`);
  }
  return d.data || {};
}

// Advertiser's name + billing currency.
async function getAdvertiserInfo(advertiserId, token) {
  const data = await ttGet('/advertiser/info/', { advertiser_ids: [String(advertiserId)], fields: ['name', 'currency'] }, token);
  const a = (data.list || [])[0];
  if (!a) throw new Error('Advertiser not found for this token — check the Advertiser ID');
  return { name: a.name || '', currency: a.currency || 'USD' };
}

// Every page of campaign×day rows for one ≤30-day window.
async function fetchReportWindow(advertiserId, token, start, end) {
  const rows = [];
  let page = 1, totalPages = 1;
  do {
    const data = await ttGet('/report/integrated/get/', {
      advertiser_id: String(advertiserId),
      service_type: 'AUCTION',
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id', 'stat_time_day'],
      metrics: ['campaign_name', 'spend', 'impressions', 'clicks', 'conversion'],
      start_date: start,
      end_date: end,
      page,
      page_size: PAGE_SIZE,
    }, token);
    for (const row of data.list || []) rows.push(row);
    totalPages = Number(data.page_info?.total_page) || 1;
    page++;
  } while (page <= totalPages && page < 100);
  return rows;
}

async function fetchReport(advertiserId, token, since, until) {
  const all = [];
  let winStart = since, guard = 0;
  while (winStart <= until && guard++ < 120) {
    let winEnd = addDays(winStart, WINDOW_DAYS - 1);
    if (winEnd > until) winEnd = until;
    for (const row of await fetchReportWindow(advertiserId, token, winStart, winEnd)) all.push(row);
    winStart = addDays(winEnd, 1);
  }
  return all;
}

// Main entry: sync TikTok spend for one business over [date_from, date_to] (YYYY-MM-DD).
async function syncTiktokForBusiness(biz, opts = {}) {
  if (!biz.tiktok_access_token) throw new Error('Not connected to TikTok');
  const advertiserId = String(biz.tiktok_advertiser_id || '').replace(/\D/g, '');
  if (!advertiserId) throw new Error('No TikTok Advertiser ID set');

  const until = opts.date_to || ymd(new Date());
  const since = opts.date_from || ymd(new Date(Date.now() - 30 * 86400000));

  const { currency } = await getAdvertiserInfo(advertiserId, biz.tiktok_access_token);
  const raw = await fetchReport(advertiserId, biz.tiktok_access_token, since, until);

  // Normalise: { campaign_id, campaign_name, day, spend, impressions, clicks, leads }
  const insights = raw.map(r => ({
    campaign_id: String(r.dimensions?.campaign_id),
    campaign_name: r.metrics?.campaign_name || '',
    day: String(r.dimensions?.stat_time_day || '').slice(0, 10),
    spend: Number(r.metrics?.spend) || 0,
    impressions: Number(r.metrics?.impressions) || 0,
    clicks: Number(r.metrics?.clicks) || 0,
    leads: Number(r.metrics?.conversion) || 0,
  })).filter(r => r.campaign_id && r.day);

  const masterByKey = new Map();
  for (const m of (await query('SELECT product_sku FROM products WHERE business_id=$1', [biz.id])).rows) {
    const k = baseKey(m.product_sku); if (k && !masterByKey.has(k)) masterByKey.set(k, m.product_sku);
  }

  const campSpend = new Map(), campName = new Map();
  for (const r of insights) {
    campSpend.set(r.campaign_id, (campSpend.get(r.campaign_id) || 0) + r.spend);
    if (r.campaign_name) campName.set(r.campaign_id, r.campaign_name);
  }
  const campInfo = new Map();
  for (const [cid, spend] of campSpend) {
    campInfo.set(cid, await resolveCampaign(biz.id, cid, campName.get(cid) || '', masterByKey, toLkr(spend, currency), 'tiktok'));
  }

  const byKey = new Map();
  const pending = new Map();
  let mappedSpend = 0, pendingSpend = 0, ignoredSpend = 0;
  for (const r of insights) {
    const info = campInfo.get(r.campaign_id);
    const spend = toLkr(r.spend, currency);
    if (!info.confirmed) {
      const u = pending.get(r.campaign_id) || { name: campName.get(r.campaign_id), suggested_sku: info.suggested || null, spend: 0 };
      u.spend += spend; pending.set(r.campaign_id, u); pendingSpend += spend;
      continue;
    }
    if (!info.sku) { ignoredSpend += spend; continue; }
    const key = `${info.sku}|${r.day}`;
    const e = byKey.get(key) || { sku: info.sku, day: r.day, spend: 0, impressions: 0, clicks: 0, leads: 0 };
    e.spend += spend; e.impressions += r.impressions; e.clicks += r.clicks; e.leads += r.leads;
    byKey.set(key, e);
    mappedSpend += spend;
  }

  await query("DELETE FROM ad_data WHERE business_id=$1 AND platform='tiktok' AND source='tiktok_sync' AND period_start>=$2 AND period_start<=$3", [biz.id, since, until]);
  let written = 0;
  for (const e of byKey.values()) {
    await query(
      `INSERT INTO ad_data (business_id, product_sku, platform, period_start, period_end, spend, impressions, clicks, leads, messages, source)
       VALUES ($1,$2,'tiktok',$3,$3,$4,$5,$6,$7,0,'tiktok_sync')`,
      [biz.id, e.sku, e.day, Math.round(e.spend * 100) / 100, e.impressions, e.clicks, Math.round(e.leads)]
    );
    written++;
  }

  const status = `TikTok: synced ${written} rows for ${campSpend.size} campaigns (${pending.size} pending confirmation). ${currency}→LKR${currency !== 'LKR' ? ' @' + USD_LKR_RATE : ''}.`;
  await query('UPDATE businesses SET ad_last_sync_at=NOW(), ad_last_sync_status=$1 WHERE id=$2', [status, biz.id]);

  return {
    success: true, platform: 'tiktok',
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

module.exports = { syncTiktokForBusiness, ttGet, getAdvertiserInfo, TIKTOK_API };
