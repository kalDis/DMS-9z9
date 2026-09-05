const express = require('express');
const ExcelJS = require('exceljs');
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
      'SELECT * FROM ad_data WHERE business_id = $1 ORDER BY period_start DESC, product_sku, platform',
      [req.params.businessId]
    )).rows;
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Add ad data for a product+platform over a date range. If an entry already
// exists for the same product+platform+range, warn (unless force=true → overwrite).
router.post('/:businessId', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);
    const { product_sku, platform, period_start, period_end, spend, impressions, clicks, leads, messages, force } = req.body;
    if (!product_sku || !platform || !period_start || !period_end) return res.status(400).json({ error: 'product, platform and date range are required' });
    if (period_end < period_start) return res.status(400).json({ error: 'End date is before start date' });
    const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
    const vals = [num(spend), Math.round(num(impressions)), Math.round(num(clicks)), Math.round(num(leads)), Math.round(num(messages))];

    const existing = (await query('SELECT id FROM ad_data WHERE business_id=$1 AND product_sku=$2 AND platform=$3 AND period_start=$4 AND period_end=$5', [businessId, product_sku, platform, period_start, period_end])).rows[0];
    if (existing && !force) {
      return res.json({ duplicate: true, existing_id: existing.id });
    }
    if (existing) {
      await query('UPDATE ad_data SET spend=$1, impressions=$2, clicks=$3, leads=$4, messages=$5, updated_at=NOW() WHERE id=$6', [...vals, existing.id]);
      return res.json({ id: existing.id, updated: true });
    }
    const ins = await query('INSERT INTO ad_data (business_id, product_sku, platform, period_start, period_end, spend, impressions, clicks, leads, messages) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [businessId, product_sku, platform, period_start, period_end, ...vals]);
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
    const { date_from, date_to, format } = req.query;

    // Product master: baseKey → { sku, name, price }
    const master = new Map();
    const mrows = (await query('SELECT product_sku, product_name, price FROM products WHERE business_id = $1', [businessId])).rows;
    for (const m of mrows) { const k = baseKey(m.product_sku); if (k && !master.has(k)) master.set(k, { sku: m.product_sku, name: m.product_name, price: Number(m.price) || 0 }); }

    // Avg cost per product: baseKey → cost
    const costMap = new Map();
    const crows = (await query('SELECT code, cost FROM product_costs WHERE business_id = $1', [businessId])).rows;
    for (const c of crows) { const k = baseKey(c.code); if (k && !costMap.has(k) && c.cost != null) costMap.set(k, Number(c.cost) || 0); }

    const blank = () => ({ spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0 });
    // key → { item_code, product_name, price, orders, delivered, returned, revenue, ad:{...}, platforms:{tiktok,meta} }
    const agg = new Map();
    const get = (key, sku, name, price) => {
      let e = agg.get(key);
      if (!e) { e = { item_code: sku, product_name: name, price, cost: costMap.get(key) || 0, orders: 0, delivered: 0, returned: 0, revenue: 0, ad: blank(), platforms: { tiktok: blank(), meta: blank() } }; agg.set(key, e); }
      return e;
    };

    // Ad data (include entries whose period overlaps the selected range)
    const adConds = ['business_id = $1']; const adParams = [businessId]; let ai = 1;
    if (date_to) { adConds.push(`period_start <= $${++ai}`); adParams.push(date_to); }
    if (date_from) { adConds.push(`period_end >= $${++ai}`); adParams.push(date_from); }
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

    // Derived: cost of goods (delivered × avg cost) and true profit = revenue − ad spend − COGS
    for (const e of agg.values()) {
      e.cogs = e.delivered * e.cost;
      e.true_profit = e.revenue - e.ad.spend - e.cogs;
    }

    const rows = [...agg.values()].sort((a, b) => b.ad.spend - a.ad.spend || b.delivered - a.delivered);
    // Totals cover only tracked products (spend > 0) so overall ROAS is meaningful
    const totals = rows.filter(r => r.ad.spend > 0).reduce((t, r) => ({
      spend: t.spend + r.ad.spend, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs, true_profit: t.true_profit + r.true_profit,
      delivered: t.delivered + r.delivered, returned: t.returned + r.returned,
      leads: t.leads + r.ad.leads, messages: t.messages + r.ad.messages, tracked: t.tracked + 1,
    }), { spend: 0, revenue: 0, cogs: 0, true_profit: 0, delivered: 0, returned: 0, leads: 0, messages: 0, tracked: 0 });

    if (format === 'xlsx') {
      const round = n => Math.round((Number(n) || 0) * 100) / 100;
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Ad ROI');
      sheet.columns = [
        { header: 'Product Code', key: 'code', width: 14 },
        { header: 'Product', key: 'name', width: 34 },
        { header: 'Retail Price', key: 'price', width: 12 },
        { header: 'Product Cost', key: 'cost', width: 12 },
        { header: 'Total Orders', key: 'orders', width: 12 },
        { header: 'Delivered', key: 'delivered', width: 10 },
        { header: 'Returned', key: 'returned', width: 10 },
        { header: 'Revenue', key: 'revenue', width: 14 },
        { header: 'COGS', key: 'cogs', width: 14 },
        { header: 'Ad Spend', key: 'spend', width: 12 },
        { header: 'True Profit', key: 'true_profit', width: 14 },
        { header: 'Margin %', key: 'margin', width: 10 },
        { header: 'ROAS', key: 'roas', width: 8 },
        { header: 'POAS', key: 'poas', width: 8 },
        { header: 'Ad Cost / Unit', key: 'ad_per_unit', width: 12 },
        { header: 'Profit / Unit', key: 'profit_per_unit', width: 12 },
        { header: 'Impressions', key: 'impr', width: 12 },
        { header: 'Clicks', key: 'clicks', width: 10 },
        { header: 'Leads', key: 'leads', width: 10 },
        { header: 'Messages', key: 'messages', width: 10 },
        { header: 'TikTok Spend', key: 'tt_spend', width: 12 },
        { header: 'TikTok Impr', key: 'tt_impr', width: 12 },
        { header: 'TikTok Clicks', key: 'tt_clicks', width: 12 },
        { header: 'TikTok Leads', key: 'tt_leads', width: 12 },
        { header: 'TikTok Msgs', key: 'tt_msg', width: 12 },
        { header: 'Meta Spend', key: 'm_spend', width: 12 },
        { header: 'Meta Impr', key: 'm_impr', width: 12 },
        { header: 'Meta Clicks', key: 'm_clicks', width: 12 },
        { header: 'Meta Leads', key: 'm_leads', width: 12 },
        { header: 'Meta Msgs', key: 'm_msg', width: 12 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const r of rows) {
        const profit = r.true_profit;
        sheet.addRow({
          code: r.item_code, name: r.product_name, price: round(r.price), cost: round(r.cost),
          orders: r.orders, delivered: r.delivered, returned: r.returned,
          revenue: round(r.revenue), cogs: round(r.cogs), spend: round(r.ad.spend),
          true_profit: round(profit),
          margin: r.revenue ? round((profit / r.revenue) * 100) : 0,
          roas: r.ad.spend ? round(r.revenue / r.ad.spend) : 0,
          poas: r.ad.spend ? round(profit / r.ad.spend) : 0,
          ad_per_unit: r.delivered ? round(r.ad.spend / r.delivered) : 0,
          profit_per_unit: r.delivered ? round(profit / r.delivered) : 0,
          impr: r.ad.impressions, clicks: r.ad.clicks, leads: r.ad.leads, messages: r.ad.messages,
          tt_spend: round(r.platforms.tiktok.spend), tt_impr: r.platforms.tiktok.impressions, tt_clicks: r.platforms.tiktok.clicks, tt_leads: r.platforms.tiktok.leads, tt_msg: r.platforms.tiktok.messages,
          m_spend: round(r.platforms.meta.spend), m_impr: r.platforms.meta.impressions, m_clicks: r.platforms.meta.clicks, m_leads: r.platforms.meta.leads, m_msg: r.platforms.meta.messages,
        });
      }
      const dateStr = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=DMS_Ad_ROI_${dateStr}.xlsx`);
      await wb.xlsx.write(res);
      return res.end();
    }

    res.json({ rows, totals, has_master: master.size > 0, has_costs: costMap.size > 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
