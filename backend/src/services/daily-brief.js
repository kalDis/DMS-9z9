// Daily business brief — a read-only, server-to-server rollup that Cal (Kalum's
// assistant) pulls each morning. DMS does the deterministic number-crunching here;
// Cal turns `problems` into a ranked, plain-language brief.
//
// Window: month-to-date (MTD) for profit / delivery / return signals (a day alone
// has too few delivered orders to judge), plus today-vs-yesterday order volume.
//
// NOTE: the per-product delivered-basis profit formula MIRRORS the Ad ROI report in
// routes/ads.js (its source of truth). If that formula changes, update it here too.
const { query } = require('../config/db');

const AD_SERVICE_CHARGE_PCT = Number(process.env.AD_SERVICE_CHARGE_PCT) || 10;

// Thresholds — kept together so they're easy to find and tune per business reality.
const T = {
  minUnitsToJudge: 10,    // don't flag a product's loss until this many delivered units
  lowDeliveryRate: 50,    // % — MTD delivery rate below this is flagged
  minOrdersForRate: 50,   // ...only once there are at least this many MTD orders
  highReturnRate: 30,     // % (settled basis) — a branch above this is flagged
  minBranchOrders: 10,    // ...with at least this many orders
  wastedSpendMin: 20000,  // Rs ad spend on a product...
  wastedDeliveredMax: 5,  // ...with this few delivered → wasted spend
  syncStaleHours: 6,      // sync_status older than this (or not success) is flagged
};

// mirrors ads.js / orders.js baseKey — normalize any code to PREFIX+NUMBER (no leading zeros)
function baseKey(code) {
  const m = /([A-Za-z]+)\W*0*(\d+)/.exec(String(code || ''));
  return m ? (m[1].toUpperCase() + m[2]) : null;
}

const round = n => Math.round(Number(n) || 0);
const fmt = n => round(n).toLocaleString('en-US');
const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0); // 1-dp %

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

// ───────────────────────── per-product Ad ROI (MTD) ─────────────────────────
async function productEconomics(businessId, from, to) {
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
    if (!e) { const m = master.get(k); e = { key: k, sku: m ? m.sku : k, name: m ? m.name : '(not in master)', price: m ? m.price : 0, cost: costMap.get(k) || 0, spend: 0, orders: 0, delivered: 0, returned: 0 }; agg.set(k, e); }
    return e;
  };

  // Ad spend per product: entries whose period OVERLAPS the window (same selection the report uses).
  for (const a of (await query('SELECT product_sku, SUM(spend) AS spend FROM ad_data WHERE business_id = $1 AND period_start <= $2 AND period_end >= $3 GROUP BY product_sku', [businessId, to, from])).rows) {
    const k = baseKey(a.product_sku);
    if (k) getE(k).spend += Number(a.spend) || 0;
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
    return {
      ...e, unit, revenue, cogs, true_profit,
      gross_margin: e.price - e.cost,
      ad_per_delivered: e.delivered ? e.spend / e.delivered : null,
    };
  });
}

// ───────────────────────── one business ─────────────────────────
async function briefForBusiness(biz, today) {
  const from = monthStart(today);
  const yesterday = addDays(today, -1);
  const problems = [];

  // Order volume today vs yesterday
  const vol = {};
  for (const r of (await query('SELECT date(order_date) AS d, COUNT(*) AS c FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY date(order_date)', [biz.id, yesterday, today])).rows) {
    vol[String(r.d).slice(0, 10)] = Number(r.c) || 0;
  }
  const ordersToday = vol[today] || 0;
  const ordersYesterday = vol[yesterday] || 0;

  // MTD delivery / return rates
  const m = (await query("SELECT COUNT(*) AS orders, SUM(CASE WHEN status='Delivered' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status='Returned' THEN 1 ELSE 0 END) AS returned FROM orders WHERE business_id = $1 AND date(order_date) >= $2 AND date(order_date) <= $3", [biz.id, from, today])).rows[0];
  const mtdOrders = Number(m.orders) || 0, mtdDelivered = Number(m.delivered) || 0, mtdReturned = Number(m.returned) || 0;
  const deliveryRate = rate(mtdDelivered, mtdOrders);
  const returnRate = rate(mtdReturned, mtdDelivered + mtdReturned);
  if (mtdOrders >= T.minOrdersForRate && deliveryRate < T.lowDeliveryRate) {
    problems.push({ sev: 'med', type: 'low_delivery', msg: `Delivery rate ${deliveryRate}% this month (${mtdDelivered}/${mtdOrders}) — below ${T.lowDeliveryRate}%` });
  }

  // Ad ROI (MTD) + product losses
  const products = await productEconomics(biz.id, from, today);
  const tracked = products.filter(p => p.spend > 0);
  const adTotals = tracked.reduce((t, p) => ({ spend: t.spend + p.spend, revenue: t.revenue + p.revenue, true_profit: t.true_profit + p.true_profit }), { spend: 0, revenue: 0, true_profit: 0 });

  const losses = tracked.filter(p => p.delivered >= T.minUnitsToJudge && p.true_profit < 0).sort((a, b) => a.true_profit - b.true_profit);
  for (const p of losses) {
    problems.push({
      sev: 'high', type: 'product_loss', sku: p.sku, impact_lkr: round(p.true_profit),
      msg: `${p.name} (${p.sku}) — losing Rs ${fmt(-p.true_profit)} this month: ad/delivered Rs ${fmt(p.ad_per_delivered)} vs margin Rs ${fmt(p.gross_margin)}, delivery ${rate(p.delivered, p.orders)}% (${p.delivered}/${p.orders})`,
    });
  }
  for (const p of tracked.filter(p => p.spend >= T.wastedSpendMin && p.delivered < T.wastedDeliveredMax)) {
    problems.push({ sev: 'med', type: 'wasted_spend', sku: p.sku, impact_lkr: -round(p.spend), msg: `${p.name} (${p.sku}) — Rs ${fmt(p.spend)} ad spend but only ${p.delivered} delivered` });
  }

  // Branch returns (MTD). delivery_branch is absent in some older/dev schemas — skip if so.
  let branchRows = [];
  try {
    branchRows = (await query("SELECT delivery_branch AS branch, COUNT(*) AS total, SUM(CASE WHEN status='Delivered' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status='Returned' THEN 1 ELSE 0 END) AS returned FROM orders WHERE business_id = $1 AND COALESCE(delivery_branch,'') <> '' AND date(order_date) >= $2 AND date(order_date) <= $3 GROUP BY delivery_branch", [biz.id, from, today])).rows;
  } catch (e) { console.error('[daily-brief] branch query skipped:', e.message); }
  const branches = branchRows.map(r => {
    const total = Number(r.total) || 0, delivered = Number(r.delivered) || 0, returned = Number(r.returned) || 0;
    return { branch: r.branch, total, returned, return_rate: rate(returned, delivered + returned) };
  }).filter(b => b.total >= T.minBranchOrders).sort((a, b) => b.return_rate - a.return_rate);
  for (const b of branches.filter(b => b.return_rate >= T.highReturnRate).slice(0, 3)) {
    problems.push({ sev: 'med', type: 'high_returns_branch', msg: `${b.branch} — return rate ${b.return_rate}% (${b.returned}/${b.total}) this month` });
  }

  // Open issues
  const issOpen = Number((await query("SELECT COUNT(*) AS c FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE o.business_id = $1 AND i.status IN ('open','in_progress')", [biz.id])).rows[0].c) || 0;
  const issNew = Number((await query('SELECT COUNT(*) AS c FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE o.business_id = $1 AND date(i.created_at) = $2', [biz.id, today])).rows[0].c) || 0;

  return {
    id: biz.id, name: biz.name,
    today: { orders: ordersToday, orders_yesterday: ordersYesterday },
    mtd: {
      orders: mtdOrders, delivered: mtdDelivered, returned: mtdReturned,
      delivery_rate: deliveryRate, return_rate: returnRate,
      ad_spend: round(adTotals.spend), revenue: round(adTotals.revenue), true_profit: round(adTotals.true_profit),
      roas: adTotals.spend ? Math.round((adTotals.revenue / adTotals.spend) * 10) / 10 : null,
    },
    top_losses: losses.slice(0, 5).map(p => ({ sku: p.sku, name: p.name, true_profit: round(p.true_profit), delivery_rate: rate(p.delivered, p.orders) })),
    worst_branches: branches.slice(0, 3),
    issues: { open: issOpen, new_today: issNew },
    problems,
  };
}

// ───────────────────────── entry point ─────────────────────────
async function buildDailyBrief({ businessIds = null, date = null } = {}) {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : slToday();

  // Sync health (single global row id=1)
  let sync = { status: 'unknown', last_sync: null, stale_hours: null, note: null };
  try {
    const s = (await query('SELECT last_sync, status, note FROM sync_status WHERE id = 1')).rows[0];
    if (s) {
      const staleH = s.last_sync ? Math.round((Date.now() - new Date(s.last_sync).getTime()) / 36e5 * 10) / 10 : null;
      sync = { status: s.status || 'unknown', last_sync: s.last_sync || null, stale_hours: staleH, note: s.note || null };
    }
  } catch { /* sync_status may not exist in some envs */ }

  // Businesses: the requested ids, else all active ones.
  let bizRows;
  if (businessIds && businessIds.length) {
    const ph = businessIds.map((_, i) => `$${i + 1}`).join(',');
    bizRows = (await query(`SELECT id, name FROM businesses WHERE id IN (${ph}) ORDER BY name`, businessIds)).rows;
  } else {
    bizRows = (await query("SELECT id, name FROM businesses WHERE status = 'active' ORDER BY name")).rows;
  }

  const businesses = [];
  for (const biz of bizRows) businesses.push(await briefForBusiness(biz, today));

  const problemCount = businesses.reduce((n, b) => n + b.problems.length, 0);
  const globalProblems = [];
  const syncBad = sync.status !== 'success' && sync.status !== 'idle';
  const syncStale = sync.stale_hours != null && sync.stale_hours > T.syncStaleHours;
  if (syncBad || syncStale) {
    globalProblems.push({ sev: 'high', type: 'sync', msg: `Domex/courier sync status "${sync.status}"${sync.stale_hours != null ? `, last ${sync.stale_hours}h ago` : ''}${sync.note ? ` — ${sync.note}` : ''}` });
  }

  return {
    date: today,
    generated_at: new Date().toISOString(),
    sync,
    global_problems: globalProblems,
    problem_count: problemCount + globalProblems.length,
    businesses,
  };
}

module.exports = { buildDailyBrief };
