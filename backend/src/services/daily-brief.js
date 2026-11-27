// Daily business brief — a read-only, server-to-server rollup that Cal (Kalum's
// assistant) pulls on demand and each morning. DMS does the deterministic
// number-crunching here; Cal turns `problems` into a ranked, plain-language brief.
//
// Window: defaults to month-to-date (MTD); callers can pick today / yesterday /
// this_week (7d) / last_month, or pass explicit from/to. Profit/delivery/return
// signals need a few delivered orders to mean anything, so short windows mostly
// show activity, not problems (guarded by the thresholds below).
//
// NOTE: the per-product delivered-basis profit formula and the 9zFlow lead-stats
// call MIRROR routes/ads.js (its source of truth). If those change, update here too.
const { query } = require('../config/db');

const AD_SERVICE_CHARGE_PCT = Number(process.env.AD_SERVICE_CHARGE_PCT) || 10;

// Thresholds — kept together so they're easy to find and tune per business reality.
const T = {
  minUnitsToJudge: 10,     // don't flag a product's loss until this many delivered units
  lowDeliveryRate: 50,     // % — delivery rate below this is flagged
  minOrdersForRate: 50,    // ...only once there are at least this many orders in the window
  highReturnRate: 30,      // % (settled basis) — a branch above this is flagged
  minBranchOrders: 10,     // ...with at least this many orders
  wastedSpendMin: 20000,   // Rs ad spend on a product...
  wastedDeliveredMax: 5,   // ...with this few delivered → wasted spend
  lowConfirmationRate: 30, // % — confirmation (confirmed/leads) below this is flagged
  minLeadsToJudge: 20,     // ...only once there are at least this many leads
  slowDeliveryDays: 7,     // avg order->delivered days above this is flagged
  minDeliveredForSpeed: 20,// ...only once this many delivered orders have dates
  deliveryDropPt: 10,      // delivery-rate drop (pt) vs the previous period that's flagged
  minOrdersForTrend: 30,   // ...only once both periods have this many orders
  syncStaleHours: 6,       // sync_status older than this (or not success) is flagged
};

// mirrors ads.js / orders.js baseKey — normalize any code to PREFIX+NUMBER (no leading zeros)
function baseKey(code) {
  const m = /([A-Za-z]+)\W*0*(\d+)/.exec(String(code || ''));
  return m ? (m[1].toUpperCase() + m[2]) : null;
}

const round = n => Math.round(Number(n) || 0);
const fmt = n => round(n).toLocaleString('en-US');
const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0); // 1-dp %

// Full per-product record — every field DMS has for a product over the window.
const productOut = p => ({
  sku: p.sku, name: p.name, price: p.price, cost: p.cost, gross_margin: p.gross_margin,
  orders: p.orders, delivered: p.delivered, returned: p.returned,
  delivery_rate: rate(p.delivered, p.orders), return_rate: rate(p.returned, p.delivered + p.returned),
  ad_spend: round(p.spend), meta_spend: round(p.meta_spend), tiktok_spend: round(p.tiktok_spend),
  ad_per_delivered: p.ad_per_delivered != null ? round(p.ad_per_delivered) : null,
  revenue: round(p.revenue), cogs: round(p.cogs), true_profit: round(p.true_profit), roas: p.roas,
  leads: p.leads, confirmed: p.confirmed, confirmation_rate: p.confirmation_rate,
});

// Sri Lanka (Asia/Colombo, UTC+5:30) calendar date 'YYYY-MM-DD'.
function slToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function monthStart(dateStr) { return dateStr.slice(0, 8) + '01'; }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Resolve the reporting window from a keyword (or explicit from/to override).
function resolveWindow(anchor, { window, from, to } = {}) {
  if (from && to) return { from, to, label: `${from} to ${to}` };
  switch (window) {
    case 'today': return { from: anchor, to: anchor, label: 'today' };
    case 'yesterday': { const y = addDays(anchor, -1); return { from: y, to: y, label: 'yesterday' }; }
    case 'this_week': return { from: addDays(anchor, -6), to: anchor, label: 'last 7 days' };
    case 'last_month': {
      const firstThis = monthStart(anchor);
      const lastPrev = addDays(firstThis, -1);
      return { from: monthStart(lastPrev), to: lastPrev, label: 'last month' };
    }
    case 'this_month':
    default: return { from: monthStart(anchor), to: anchor, label: 'this month' };
  }
}

// The equal-length window immediately before `win` — for trend comparison.
function previousWindow({ from, to }) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(days - 1)), to: prevTo, days };
}

// Order status counts for a window → {orders, delivered, returned, delivery_rate, return_rate}.
async function statusTotals(businessId, from, to) {
  let orders = 0, delivered = 0, returned = 0;
  for (const r of (await query('SELECT status, COUNT(*) AS c FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY status', [businessId, from, to])).rows) {
    const c = Number(r.c) || 0; orders += c;
    if (r.status === 'Delivered') delivered = c; else if (r.status === 'Returned') returned = c;
  }
  return { orders, delivered, returned, delivery_rate: rate(delivered, orders), return_rate: rate(returned, delivered + returned) };
}

// 9zFlow lead + confirmed-order counts per product (the CRM funnel). Mirrors ads.js
// fetchFlowLeadStats. Returns a Map baseKey → { leads, confirmed, call_leads }, or an
// empty Map if 9zFlow isn't configured or the call fails (never breaks the brief).
async function crmLeadsMap(businessId, from, to) {
  const out = new Map();
  if (!process.env.FLOW_API_URL || !process.env.INTEGRATION_KEY) return out;
  try {
    const p = new URLSearchParams({ dms_business_id: String(businessId), date_from: from, date_to: to });
    const res = await fetch(`${process.env.FLOW_API_URL.replace(/\/$/, '')}/integration/lead-stats?${p}`, {
      headers: { 'x-integration-key': process.env.INTEGRATION_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return out;
    const body = await res.json().catch(() => ({}));
    for (const c of body.rows || []) {
      const k = c.sku ? baseKey(c.sku) : null;
      if (!k) continue;
      const e = out.get(k) || { leads: 0, confirmed: 0, call_leads: 0 };
      e.leads += Number(c.leads) || 0;
      e.confirmed += Number(c.confirmed) || 0;
      e.call_leads += Number(c.call_leads) || 0;
      out.set(k, e);
    }
  } catch { /* 9zFlow down — confirmation data just absent */ }
  return out;
}

// ───────────────────────── per-product economics (incl. platform + CRM) ─────────────────────────
async function productEconomics(businessId, from, to, crm) {
  const master = new Map();
  for (const m of (await query('SELECT product_sku, product_name, price FROM products WHERE business_id = $1', [businessId])).rows) {
    const k = baseKey(m.product_sku);
    if (k && !master.has(k)) master.set(k, { sku: m.product_sku, name: m.product_name, price: Number(m.price) || 0 });
  }
  const costMap = new Map();
  for (const c of (await query('SELECT code, cost FROM product_costs WHERE business_id = $1', [businessId])).rows) {
    const k = baseKey(c.code);
    if (k && !costMap.has(k) && c.cost != null) costMap.set(k, Number(c.cost) || 0);
  }

  const agg = new Map();
  const getE = k => {
    let e = agg.get(k);
    if (!e) { const m = master.get(k); e = { key: k, sku: m ? m.sku : k, name: m ? m.name : '(not in master)', price: m ? m.price : 0, cost: costMap.get(k) || 0, spend: 0, meta_spend: 0, tiktok_spend: 0, orders: 0, delivered: 0, returned: 0 }; agg.set(k, e); }
    return e;
  };

  // Ad spend per product + platform (entries whose period OVERLAPS the window).
  for (const a of (await query('SELECT product_sku, platform, SUM(spend) AS spend FROM ad_data WHERE business_id = $1 AND period_start <= $2 AND period_end >= $3 GROUP BY product_sku, platform', [businessId, to, from])).rows) {
    const k = baseKey(a.product_sku);
    if (!k) continue;
    const e = getE(k);
    const spend = Number(a.spend) || 0;
    e.spend += spend;
    if (a.platform === 'tiktok') e.tiktok_spend += spend; else e.meta_spend += spend;
  }
  // Orders placed in the window, counted per base SKU found in item_codes.
  for (const o of (await query('SELECT item_codes, status FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3', [businessId, from, to])).rows) {
    const raw = String(o.item_codes || '').trim();
    if (!raw) continue;
    const skus = new Set();
    for (const ln of raw.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) { const k = baseKey(ln); if (k) skus.add(k); }
    for (const k of skus) { const e = getE(k); e.orders++; if (o.status === 'Delivered') e.delivered++; else if (o.status === 'Returned') e.returned++; }
  }

  return [...agg.values()].map(e => {
    const unit = e.delivered;                              // delivered basis (cash reality for COD)
    const revenue = unit * e.price;
    const cogs = unit * e.cost;
    const svc = e.spend * (AD_SERVICE_CHARGE_PCT / 100);
    const true_profit = revenue - e.spend - svc - cogs;    // mirrors ads.js computeAdReport
    const c = crm.get(e.key) || { leads: 0, confirmed: 0, call_leads: 0 };
    return {
      ...e, unit, revenue, cogs, true_profit,
      gross_margin: e.price - e.cost,
      ad_per_delivered: e.delivered ? e.spend / e.delivered : null,
      roas: e.spend ? Math.round((revenue / e.spend) * 10) / 10 : null,
      leads: c.leads, confirmed: c.confirmed,
      confirmation_rate: rate(c.confirmed, c.leads),
    };
  });
}

// ───────────────────────── one business ─────────────────────────
async function briefForBusiness(biz, win, anchor) {
  const { from, to } = win;
  const yesterday = addDays(anchor, -1);
  const problems = [];

  // Order volume today vs yesterday (always, regardless of window)
  const vol = {};
  for (const r of (await query('SELECT date(order_date) AS d, COUNT(*) AS c FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY date(order_date)', [biz.id, yesterday, anchor])).rows) {
    vol[String(r.d).slice(0, 10)] = Number(r.c) || 0;
  }

  // Window delivery / return + status pipeline
  const statusRows = (await query('SELECT status, COUNT(*) AS c FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY status', [biz.id, from, to])).rows;
  const pipeline = {};
  let winOrders = 0, winDelivered = 0, winReturned = 0;
  for (const r of statusRows) {
    const c = Number(r.c) || 0;
    pipeline[r.status || 'Unknown'] = c;
    winOrders += c;
    if (r.status === 'Delivered') winDelivered = c;
    else if (r.status === 'Returned') winReturned = c;
  }
  const deliveryRate = rate(winDelivered, winOrders);
  const returnRate = rate(winReturned, winDelivered + winReturned);
  if (winOrders >= T.minOrdersForRate && deliveryRate < T.lowDeliveryRate) {
    problems.push({ sev: 'med', type: 'low_delivery', msg: `Delivery rate ${deliveryRate}% (${winDelivered}/${winOrders}) — below ${T.lowDeliveryRate}%` });
  }

  // Ad ROI + CRM confirmation (over the window)
  const crm = await crmLeadsMap(biz.id, from, to);
  const products = await productEconomics(biz.id, from, to, crm);
  const tracked = products.filter(p => p.spend > 0);
  const totals = tracked.reduce((t, p) => ({
    spend: t.spend + p.spend, meta_spend: t.meta_spend + p.meta_spend, tiktok_spend: t.tiktok_spend + p.tiktok_spend,
    revenue: t.revenue + p.revenue, true_profit: t.true_profit + p.true_profit,
    leads: t.leads + p.leads, confirmed: t.confirmed + p.confirmed,
  }), { spend: 0, meta_spend: 0, tiktok_spend: 0, revenue: 0, true_profit: 0, leads: 0, confirmed: 0 });

  const losses = tracked.filter(p => p.delivered >= T.minUnitsToJudge && p.true_profit < 0).sort((a, b) => a.true_profit - b.true_profit);
  for (const p of losses) {
    problems.push({
      sev: 'high', type: 'product_loss', sku: p.sku, impact_lkr: round(p.true_profit),
      msg: `${p.name} (${p.sku}) — losing Rs ${fmt(-p.true_profit)}: ad/delivered Rs ${fmt(p.ad_per_delivered)} vs margin Rs ${fmt(p.gross_margin)}, delivery ${rate(p.delivered, p.orders)}% (${p.delivered}/${p.orders})`,
    });
  }
  for (const p of tracked.filter(p => p.spend >= T.wastedSpendMin && p.delivered < T.wastedDeliveredMax)) {
    problems.push({ sev: 'med', type: 'wasted_spend', sku: p.sku, impact_lkr: -round(p.spend), msg: `${p.name} (${p.sku}) — Rs ${fmt(p.spend)} ad spend but only ${p.delivered} delivered` });
  }
  const lowConf = tracked.filter(p => p.leads >= T.minLeadsToJudge && p.confirmation_rate < T.lowConfirmationRate).sort((a, b) => a.confirmation_rate - b.confirmation_rate);
  for (const p of lowConf) {
    problems.push({ sev: 'med', type: 'low_confirmation', sku: p.sku, msg: `${p.name} (${p.sku}) — confirmation ${p.confirmation_rate}% (${p.confirmed}/${p.leads} leads), ad spend Rs ${fmt(p.spend)}` });
  }

  const topProducts = tracked.filter(p => p.true_profit > 0).sort((a, b) => b.true_profit - a.true_profit).slice(0, 5).map(productOut);

  // Branch returns (over the window). delivery_branch is absent in some older/dev schemas — skip if so.
  let branchRows = [];
  try {
    branchRows = (await query("SELECT delivery_branch AS branch, COUNT(*) AS total, SUM(CASE WHEN status='Delivered' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status='Returned' THEN 1 ELSE 0 END) AS returned FROM orders WHERE business_id = $1 AND COALESCE(delivery_branch,'') <> '' AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY delivery_branch", [biz.id, from, to])).rows;
  } catch (e) { console.error('[daily-brief] branch query skipped:', e.message); }
  const branches = branchRows.map(r => {
    const total = Number(r.total) || 0, delivered = Number(r.delivered) || 0, returned = Number(r.returned) || 0;
    return { branch: r.branch, total, returned, return_rate: rate(returned, delivered + returned) };
  }).filter(b => b.total >= T.minBranchOrders).sort((a, b) => b.return_rate - a.return_rate);
  for (const b of branches.filter(b => b.return_rate >= T.highReturnRate).slice(0, 3)) {
    problems.push({ sev: 'med', type: 'high_returns_branch', msg: `${b.branch} — return rate ${b.return_rate}% (${b.returned}/${b.total})` });
  }

  // Courier split (Domex vs XMILE) over the window
  const couriers = (await query("SELECT COALESCE(NULLIF(courier,''),'unknown') AS courier, COUNT(*) AS total, SUM(CASE WHEN status='Delivered' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status='Returned' THEN 1 ELSE 0 END) AS returned FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY COALESCE(NULLIF(courier,''),'unknown')", [biz.id, from, to])).rows
    .map(r => { const total = Number(r.total) || 0, delivered = Number(r.delivered) || 0, returned = Number(r.returned) || 0; return { courier: r.courier, total, delivered, returned, delivery_rate: rate(delivered, total), return_rate: rate(returned, delivered + returned) }; })
    .filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // Delivery speed: avg order→delivered days (computed in JS for DB portability)
  let deliveryDays = { avg: null, count: 0 };
  try {
    const diffs = [];
    for (const r of (await query("SELECT order_date, delivered_date FROM orders WHERE business_id = $1 AND status = 'Delivered' AND delivered_date IS NOT NULL AND date(order_date) >= $2 AND date(order_date) <= $3", [biz.id, from, to])).rows) {
      const od = Date.parse(String(r.order_date)), dd = Date.parse(String(r.delivered_date));
      if (!isNaN(od) && !isNaN(dd)) { const d = (dd - od) / 86400000; if (d >= 0 && d <= 90) diffs.push(d); }
    }
    if (diffs.length) deliveryDays = { avg: Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10, count: diffs.length };
  } catch (e) { console.error('[daily-brief] delivery-speed skipped:', e.message); }
  if (deliveryDays.avg != null && deliveryDays.avg > T.slowDeliveryDays && deliveryDays.count >= T.minDeliveredForSpeed) {
    problems.push({ sev: 'low', type: 'slow_delivery', msg: `Avg delivery time ${deliveryDays.avg} days (over ${T.slowDeliveryDays})` });
  }

  // Open issues + reason breakdown
  const issOpen = Number((await query("SELECT COUNT(*) AS c FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE o.business_id = $1 AND i.status IN ('open','in_progress')", [biz.id])).rows[0].c) || 0;
  const issNew = Number((await query('SELECT COUNT(*) AS c FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE o.business_id = $1 AND date(i.created_at) = $2', [biz.id, anchor])).rows[0].c) || 0;
  const issueReasons = (await query("SELECT COALESCE(NULLIF(i.reason,''),'(no reason)') AS reason, COUNT(*) AS c FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE o.business_id = $1 AND i.status IN ('open','in_progress') GROUP BY COALESCE(NULLIF(i.reason,''),'(no reason)') ORDER BY c DESC LIMIT 6", [biz.id])).rows
    .map(r => ({ reason: r.reason, count: Number(r.c) || 0 }));

  // Trend vs the previous equal-length window
  const prevWin = previousWindow(win);
  const prev = await statusTotals(biz.id, prevWin.from, prevWin.to);
  const trend = {
    prev_label: `${prevWin.from}..${prevWin.to}`,
    orders_prev: prev.orders,
    orders_delta_pct: prev.orders ? Math.round(((winOrders - prev.orders) / prev.orders) * 100) : null,
    delivery_rate_prev: prev.delivery_rate, delivery_rate_delta: Math.round((deliveryRate - prev.delivery_rate) * 10) / 10,
    return_rate_prev: prev.return_rate, return_rate_delta: Math.round((returnRate - prev.return_rate) * 10) / 10,
  };
  if (winOrders >= T.minOrdersForTrend && prev.orders >= T.minOrdersForTrend && trend.delivery_rate_delta <= -T.deliveryDropPt) {
    problems.push({ sev: 'med', type: 'delivery_drop', msg: `Delivery rate down ${Math.abs(trend.delivery_rate_delta)}pt vs previous period (${prev.delivery_rate}% → ${deliveryRate}%)` });
  }

  return {
    id: biz.id, name: biz.name,
    today: { orders: vol[anchor] || 0, orders_yesterday: vol[yesterday] || 0 },
    totals: {
      orders: winOrders, delivered: winDelivered, returned: winReturned,
      delivery_rate: deliveryRate, return_rate: returnRate,
      ad_spend: round(totals.spend), meta_spend: round(totals.meta_spend), tiktok_spend: round(totals.tiktok_spend),
      revenue: round(totals.revenue), true_profit: round(totals.true_profit),
      roas: totals.spend ? Math.round((totals.revenue / totals.spend) * 10) / 10 : null,
      leads: totals.leads, confirmed: totals.confirmed, confirmation_rate: rate(totals.confirmed, totals.leads),
      trend,
    },
    pipeline,
    couriers,
    delivery_days: deliveryDays,
    top_products: topProducts,
    top_losses: losses.slice(0, 5).map(productOut),
    low_confirmation: lowConf.slice(0, 5).map(p => ({ sku: p.sku, name: p.name, confirmation_rate: p.confirmation_rate, leads: p.leads, confirmed: p.confirmed })),
    worst_branches: branches.slice(0, 3),
    issues: { open: issOpen, new_today: issNew, by_reason: issueReasons },
    problems,
  };
}

// ───────────────────────── entry point ─────────────────────────
async function buildDailyBrief({ businessIds = null, date = null, window = null, from = null, to = null } = {}) {
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : slToday();
  const win = resolveWindow(anchor, {
    window,
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : null,
  });

  // Sync health (single global row id=1)
  let sync = { status: 'unknown', last_sync: null, stale_hours: null, note: null };
  try {
    const s = (await query('SELECT last_sync, status, note FROM sync_status WHERE id = 1')).rows[0];
    if (s) {
      const staleH = s.last_sync ? Math.round((Date.now() - new Date(s.last_sync).getTime()) / 36e5 * 10) / 10 : null;
      sync = { status: s.status || 'unknown', last_sync: s.last_sync || null, stale_hours: staleH, note: s.note || null };
    }
  } catch { /* sync_status may not exist in some envs */ }

  let bizRows;
  if (businessIds && businessIds.length) {
    const ph = businessIds.map((_, i) => `$${i + 1}`).join(',');
    bizRows = (await query(`SELECT id, name FROM businesses WHERE id IN (${ph}) ORDER BY name`, businessIds)).rows;
  } else {
    bizRows = (await query("SELECT id, name FROM businesses WHERE status = 'active' ORDER BY name")).rows;
  }

  const businesses = [];
  for (const biz of bizRows) businesses.push(await briefForBusiness(biz, win, anchor));

  const globalProblems = [];
  const syncBad = sync.status !== 'success' && sync.status !== 'idle';
  const syncStale = sync.stale_hours != null && sync.stale_hours > T.syncStaleHours;
  if (syncBad || syncStale) {
    globalProblems.push({ sev: 'high', type: 'sync', msg: `Domex/courier sync status "${sync.status}"${sync.stale_hours != null ? `, last ${sync.stale_hours}h ago` : ''}${sync.note ? ` — ${sync.note}` : ''}` });
  }

  const problemCount = businesses.reduce((n, b) => n + b.problems.length, 0) + globalProblems.length;
  return {
    date: anchor,
    window: win,
    generated_at: new Date().toISOString(),
    sync,
    global_problems: globalProblems,
    problem_count: problemCount,
    businesses,
  };
}

module.exports = { buildDailyBrief, productEconomics, crmLeadsMap, resolveWindow, slToday, baseKey, productOut, rate, round };
