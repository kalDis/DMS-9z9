const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Normalize any item/product code to its base key (matches orders.js logic).
function baseKey(code) {
  const m = /([A-Za-z]+)\W*0*(\d+)/.exec(String(code || ''));
  return m ? (m[1].toUpperCase() + m[2]) : null;
}

// --- Weekly ad-data entries (per product · platform · week) ---
router.get('/:businessId', authenticate, async (req, res) => {
  try {
    const rows = (await query(
      'SELECT * FROM ad_data WHERE business_id = $1 ORDER BY week_start DESC, product_sku, platform',
      [req.params.businessId]
    )).rows;
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Upsert one weekly entry (by product+platform+week)
router.post('/:businessId', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);
    const { product_sku, platform, week_start, spend, impressions, clicks, leads, messages } = req.body;
    if (!product_sku || !platform || !week_start) return res.status(400).json({ error: 'product, platform and week are required' });
    const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
    const vals = [num(spend), Math.round(num(impressions)), Math.round(num(clicks)), Math.round(num(leads)), Math.round(num(messages))];

    const existing = (await query('SELECT id FROM ad_data WHERE business_id=$1 AND product_sku=$2 AND platform=$3 AND week_start=$4', [businessId, product_sku, platform, week_start])).rows[0];
    if (existing) {
      await query('UPDATE ad_data SET spend=$1, impressions=$2, clicks=$3, leads=$4, messages=$5, updated_at=NOW() WHERE id=$6', [...vals, existing.id]);
      return res.json({ id: existing.id, updated: true });
    }
    const ins = await query('INSERT INTO ad_data (business_id, product_sku, platform, week_start, spend, impressions, clicks, leads, messages) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [businessId, product_sku, platform, week_start, ...vals]);
    res.json({ id: ins.rows[0]?.id || ins.lastId, created: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/entry/:id', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    await query('DELETE FROM ad_data WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// --- ROI report: ad data + order performance, per product, with platform split ---
router.get('/:businessId/report', authenticate, async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);
    const { date_from, date_to } = req.query;

    // Product master: baseKey → { sku, name, price }
    const master = new Map();
    const mrows = (await query('SELECT product_sku, product_name, price FROM products WHERE business_id = $1', [businessId])).rows;
    for (const m of mrows) { const k = baseKey(m.product_sku); if (k && !master.has(k)) master.set(k, { sku: m.product_sku, name: m.product_name, price: Number(m.price) || 0 }); }

    const blank = () => ({ spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0 });
    // key → { item_code, product_name, price, orders, delivered, returned, revenue, ad:{...}, platforms:{tiktok,meta} }
    const agg = new Map();
    const get = (key, sku, name, price) => {
      let e = agg.get(key);
      if (!e) { e = { item_code: sku, product_name: name, price, orders: 0, delivered: 0, returned: 0, revenue: 0, ad: blank(), platforms: { tiktok: blank(), meta: blank() } }; agg.set(key, e); }
      return e;
    };

    // Ad data (filter by week within range)
    const adConds = ['business_id = $1']; const adParams = [businessId]; let ai = 1;
    if (date_from) { adConds.push(`week_start >= $${++ai}`); adParams.push(date_from); }
    if (date_to) { adConds.push(`week_start <= $${++ai}`); adParams.push(date_to); }
    const ads = (await query(`SELECT product_sku, platform, spend, impressions, clicks, leads, messages FROM ad_data WHERE ${adConds.join(' AND ')}`, adParams)).rows;
    for (const a of ads) {
      const k = baseKey(a.product_sku); if (!k) continue;
      const m = master.get(k);
      const e = get(k, m ? m.sku : a.product_sku, m ? m.name : '(not in master)', m ? m.price : 0);
      const plat = (a.platform === 'tiktok' || a.platform === 'meta') ? a.platform : 'meta';
      for (const f of ['spend', 'impressions', 'clicks', 'leads', 'messages']) {
        e.ad[f] += Number(a[f]) || 0;
        e.platforms[plat][f] += Number(a[f]) || 0;
      }
    }

    // Order performance (by order_date within range)
    const oConds = ['o.business_id = $1']; const oParams = [businessId]; let oi = 1;
    if (date_from) { oConds.push(`date(o.order_date) >= $${++oi}`); oParams.push(date_from); }
    if (date_to) { oConds.push(`date(o.order_date) <= $${++oi}`); oParams.push(date_to); }
    const orders = (await query(`SELECT item_codes, status FROM orders o WHERE ${oConds.join(' AND ')}`, oParams)).rows;
    for (const o of orders) {
      const raw = String(o.item_codes || '').trim(); if (!raw) continue;
      const skus = new Set();
      for (const ln of raw.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) { const k = baseKey(ln); if (k) skus.add(k); }
      for (const k of skus) {
        const m = master.get(k);
        const e = get(k, m ? m.sku : k, m ? m.name : '(not in master)', m ? m.price : 0);
        e.orders++;
        if (o.status === 'Delivered') { e.delivered++; e.revenue += e.price; }
        else if (o.status === 'Returned') e.returned++;
      }
    }

    const rows = [...agg.values()].sort((a, b) => b.ad.spend - a.ad.spend || b.delivered - a.delivered);
    // Totals cover only tracked products (spend > 0) so overall ROAS is meaningful
    const totals = rows.filter(r => r.ad.spend > 0).reduce((t, r) => ({
      spend: t.spend + r.ad.spend, revenue: t.revenue + r.revenue,
      delivered: t.delivered + r.delivered, returned: t.returned + r.returned,
      leads: t.leads + r.ad.leads, messages: t.messages + r.ad.messages, tracked: t.tracked + 1,
    }), { spend: 0, revenue: 0, delivered: 0, returned: 0, leads: 0, messages: 0, tracked: 0 });

    res.json({ rows, totals, has_master: master.size > 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
