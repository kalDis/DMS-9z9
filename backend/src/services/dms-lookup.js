// Per-item drill-down for Cal — the specifics the aggregate daily-brief can't hold:
// a single product's full economics, an order by tracking number (with scan history),
// a filtered order list, a branch, or an issue list. Read-only. Reuses the brief's
// product-economics + window helpers so the numbers stay consistent.
const { query } = require('../config/db');
const { productEconomics, crmLeadsMap, resolveWindow, slToday, baseKey, productOut, rate } = require('./daily-brief');
const { mergeKey } = require('./../lib/sku-merge');

async function activeBusinessIds(businessIds) {
  if (businessIds && businessIds.length) return businessIds;
  return (await query("SELECT id FROM businesses WHERE status = 'active' ORDER BY name")).rows.map(r => r.id);
}
const inClause = (ids, start) => ids.map((_, i) => `$${start + i}`).join(',');

// A specific product's full economics (searches the given businesses, SKU then name).
async function lookupProduct(businessIds, value, win) {
  const v = String(value || '').toLowerCase().trim();
  for (const bid of businessIds) {
    const key = mergeKey(bid, baseKey(value)); // fold a merged variant code to its canonical
    const crm = await crmLeadsMap(bid, win.from, win.to);
    const products = await productEconomics(bid, win.from, win.to, crm);
    const p = (key && products.find(x => x.key === key)) || (v && products.find(x => (x.name || '').toLowerCase().includes(v) || (x.sku || '').toLowerCase().includes(v)));
    if (p) {
      const biz = (await query('SELECT name FROM businesses WHERE id = $1', [bid])).rows[0];
      return { found: true, business: biz ? biz.name : bid, window: win, product: productOut(p) };
    }
  }
  return { found: false, value, window: win, note: 'No product with that code/name had activity in this period.' };
}

// A single order by tracking number, with its courier scan history and any issue.
async function lookupOrder(businessIds, tracking) {
  const o = (await query(`SELECT id, tracking_number, customer_name, phone, city, product, item_names, status, courier, order_date, pickup_date, delivered_date, amount FROM orders WHERE tracking_number = $1 AND business_id IN (${inClause(businessIds, 2)}) ORDER BY id DESC LIMIT 1`, [tracking, ...businessIds])).rows[0];
  if (!o) return { found: false, tracking };
  let delivery_branch = null;
  try { delivery_branch = (await query('SELECT delivery_branch FROM orders WHERE id = $1', [o.id])).rows[0]?.delivery_branch || null; } catch { /* column absent */ }
  const scans = (await query('SELECT status_code, status_text, location, status_date FROM delivery_statuses WHERE order_id = $1 ORDER BY status_date', [o.id])).rows
    .map(s => ({ code: s.status_code, status: s.status_text, location: s.location, date: s.status_date }));
  const issue = (await query("SELECT reason, status, created_at FROM delivery_issues WHERE order_id = $1 ORDER BY id DESC LIMIT 1", [o.id])).rows[0] || null;
  return {
    found: true,
    order: { tracking: o.tracking_number, status: o.status, courier: o.courier, customer: o.customer_name, phone: o.phone, city: o.city, product: o.product || o.item_names, delivery_branch, order_date: o.order_date, pickup_date: o.pickup_date, delivered_date: o.delivered_date, amount: o.amount },
    scans, issue,
  };
}

// A filtered list of orders (count + a sample).
async function lookupOrders(businessIds, { status, courier, branch, from, to }, limit) {
  const conds = [`o.business_id IN (${inClause(businessIds, 1)})`]; const params = [...businessIds]; let i = businessIds.length;
  if (status) { conds.push(`o.status = $${++i}`); params.push(status); }
  if (courier) { conds.push(`LOWER(COALESCE(o.courier,'')) = $${++i}`); params.push(String(courier).toLowerCase()); }
  if (from) { conds.push(`date(o.order_date) >= $${++i}`); params.push(from); }
  if (to) { conds.push(`date(o.order_date) <= $${++i}`); params.push(to); }
  if (branch) { conds.push(`o.delivery_branch = $${++i}`); params.push(branch); }
  const where = conds.join(' AND ');
  try {
    const total = Number((await query(`SELECT COUNT(*) AS c FROM orders o WHERE ${where}`, params)).rows[0].c) || 0;
    const rows = (await query(`SELECT o.tracking_number, o.status, o.customer_name, o.city, o.courier, o.order_date FROM orders o WHERE ${where} ORDER BY o.order_date DESC LIMIT ${limit}`, params)).rows
      .map(r => ({ tracking: r.tracking_number, status: r.status, customer: r.customer_name, city: r.city, courier: r.courier, order_date: r.order_date }));
    return { total, showing: rows.length, orders: rows };
  } catch (e) { return { error: e.message }; }
}

// One branch's performance over the window.
async function lookupBranch(businessIds, value, win) {
  try {
    const params = [...businessIds, value, win.from, win.to];
    const b = businessIds.length;
    const r = (await query(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='Delivered' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status='Returned' THEN 1 ELSE 0 END) AS returned FROM orders WHERE business_id IN (${inClause(businessIds, 1)}) AND delivery_branch = $${b + 1} AND date(order_date) >= $${b + 2} AND date(order_date) <= $${b + 3}`, params)).rows[0];
    const total = Number(r.total) || 0, delivered = Number(r.delivered) || 0, returned = Number(r.returned) || 0;
    if (!total) return { found: false, branch: value, window: win };
    return { found: true, branch: value, window: win, total, delivered, returned, delivery_rate: rate(delivered, total), return_rate: rate(returned, delivered + returned) };
  } catch (e) { return { error: 'branch data unavailable: ' + e.message }; }
}

// A filtered list of issues (count + a sample). Defaults to active issues.
async function lookupIssues(businessIds, { status, reason }, limit) {
  const conds = [`o.business_id IN (${inClause(businessIds, 1)})`]; const params = [...businessIds]; let i = businessIds.length;
  if (status) { conds.push(`i.status = $${++i}`); params.push(status); }
  else conds.push(`i.status IN ('open','in_progress')`);
  if (reason) { conds.push(`i.reason = $${++i}`); params.push(reason); }
  const where = conds.join(' AND ');
  const total = Number((await query(`SELECT COUNT(*) AS c FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE ${where}`, params)).rows[0].c) || 0;
  const rows = (await query(`SELECT o.tracking_number, i.reason, i.status, i.created_at FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE ${where} ORDER BY i.created_at DESC LIMIT ${limit}`, params)).rows
    .map(r => ({ tracking: r.tracking_number, reason: r.reason, status: r.status, created: r.created_at }));
  return { total, showing: rows.length, issues: rows };
}

async function dmsLookup({ businessIds = null, kind, value = null, status = null, courier = null, branch = null, reason = null, from = null, to = null, window = null, date = null, limit = 20 } = {}) {
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : slToday();
  const win = resolveWindow(anchor, {
    window,
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : null,
  });
  const ids = await activeBusinessIds(businessIds);
  if (!ids.length) return { error: 'no businesses' };
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  switch (kind) {
    case 'product': return lookupProduct(ids, value, win);
    case 'order': return lookupOrder(ids, String(value || '').trim());
    case 'orders': return lookupOrders(ids, { status, courier, branch, from: win.from, to: win.to }, lim);
    case 'branch': return lookupBranch(ids, value, win);
    case 'issues': return lookupIssues(ids, { status, reason: reason || value }, lim);
    default: return { error: `unknown kind "${kind}" (use product|order|orders|branch|issues)` };
  }
}

module.exports = { dmsLookup };
