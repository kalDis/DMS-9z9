const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Normalize any item code to its base product key, e.g. "TY-058-STANDARD",
// "TY058-STANDARD", "TY-058" all → "TY58". Used to match orders to the
// product master (whose Product SKU "TY-058" normalizes the same way).
function baseKey(code) {
  const m = /([A-Za-z]+)\W*0*(\d+)/.exec(String(code || ''));
  return m ? (m[1].toUpperCase() + m[2]) : null;
}
function prettyBase(key) { return key ? key.replace(/^([A-Z]+)(\d+)$/, (_, a, b) => `${a}-${b.padStart(3, '0')}`) : key; }

router.get('/', authenticate, async (req, res) => {
  try {
    const { business_id, status, search, date_from, date_to, pickup_from, pickup_to, courier, page = 1, limit = 50, sort_by, sort_dir } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];
    let pIdx = 0;
    const p = () => `$${++pIdx}`;

    if (req.user.role !== 'admin') {
      conditions.push(`o.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`);
      params.push(req.user.id);
    }
    if (business_id) { conditions.push(`o.business_id = ${p()}`); params.push(business_id); }
    if (status === 'Pending Delivery') {
      conditions.push("o.status IN ('Dispatched', 'In Transit', 'Out for Delivery', 'Waiting', 'Failed')");
    } else if (status === 'Has Issues') {
      conditions.push("o.id IN (SELECT order_id FROM delivery_issues WHERE status NOT IN ('resolved', 'auto_return'))");
    } else if (status === 'Exchange') {
      conditions.push("(o.exchange ILIKE 'yes' OR o.exchange = 'Y')");
    } else if (status && status !== 'All') { conditions.push(`o.status = ${p()}`); params.push(status); }
    if (date_from) { conditions.push(`date(o.created_at) >= ${p()}`); params.push(date_from); }
    if (date_to) { conditions.push(`date(o.created_at) <= ${p()}`); params.push(date_to); }
    if (pickup_from) { conditions.push(`date(o.pickup_date) >= ${p()}`); params.push(pickup_from); }
    if (pickup_to) { conditions.push(`date(o.pickup_date) <= ${p()}`); params.push(pickup_to); }
    if (courier) { conditions.push(`o.courier = ${p()}`); params.push(courier); }
    if (search) {
      const term = search.trim();
      if (term) {
        conditions.push(`(o.tracking_number ILIKE ${p()} OR o.customer_name ILIKE ${p()} OR o.phone ILIKE ${p()} OR o.order_id ILIKE ${p()} OR o.item_names ILIKE ${p()})`);
        params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const allowedSorts = ['order_id','tracking_number','customer_name','phone','product','branch','salesperson','status','created_at','amount','order_date','pickup_date'];
    const sortCol = allowedSorts.includes(sort_by) ? `o.${sort_by}` : 'o.order_id';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';

    const countRow = (await query(`SELECT COUNT(*) as cnt FROM orders o ${where}`, params)).rows[0];

    params.push(Number(limit), Number(offset));
    const rows = (await query(
      `SELECT o.*, b.name as business_name,
        (SELECT di.source FROM delivery_issues di WHERE di.order_id = o.id ORDER BY CASE WHEN di.status IN ('open','in_progress') THEN 0 ELSE 1 END, di.created_at DESC LIMIT 1) as issue_source,
        (SELECT di.status FROM delivery_issues di WHERE di.order_id = o.id ORDER BY CASE WHEN di.status IN ('open','in_progress') THEN 0 ELSE 1 END, di.created_at DESC LIMIT 1) as issue_status
       FROM orders o JOIN businesses b ON o.business_id = b.id ${where}
       ORDER BY CASE WHEN ${sortCol} IS NULL OR ${sortCol} = '' THEN 1 ELSE 0 END, ${sortCol} ${sortDirection} LIMIT ${p()} OFFSET ${p()}`,
      params
    )).rows;

    // Status counts
    const cParams = [];
    let cIdx = 0;
    const cp = () => `$${++cIdx}`;
    const cConds = [];
    if (req.user.role !== 'admin') { cConds.push(`business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${cp()})`); cParams.push(req.user.id); }
    if (business_id) { cConds.push(`business_id = ${cp()}`); cParams.push(business_id); }
    const cWhere = cConds.length ? 'WHERE ' + cConds.join(' AND ') : '';
    const statusCounts = (await query(`SELECT status, COUNT(*) as cnt FROM orders ${cWhere} GROUP BY status`, cParams)).rows;
    const countsMap = {};
    let allCount = 0, pendingCount = 0;
    const pendingStatuses = ['Dispatched','In Transit','Out for Delivery','Waiting','Failed'];
    for (const sc of statusCounts) { countsMap[sc.status] = Number(sc.cnt); allCount += Number(sc.cnt); if (pendingStatuses.includes(sc.status)) pendingCount += Number(sc.cnt); }
    countsMap['All'] = allCount;
    countsMap['Pending Delivery'] = pendingCount;

    const issueCountParams = [];
    let icIdx = 0;
    const icp = () => `$${++icIdx}`;
    const icConds = [];
    if (req.user.role !== 'admin') { icConds.push(`business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${icp()})`); issueCountParams.push(req.user.id); }
    if (business_id) { icConds.push(`business_id = ${icp()}`); issueCountParams.push(business_id); }
    const icWhere = icConds.length ? 'AND ' + icConds.join(' AND ') : '';
    const issueCount = (await query(`SELECT COUNT(*) as cnt FROM delivery_issues WHERE status NOT IN ('resolved','auto_return') ${icWhere}`, issueCountParams)).rows[0];
    countsMap['Has Issues'] = Number(issueCount?.cnt || 0);

    const exParams = [];
    let exIdx = 0;
    const exp = () => `$${++exIdx}`;
    const exConds = [];
    if (req.user.role !== 'admin') { exConds.push(`business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${exp()})`); exParams.push(req.user.id); }
    if (business_id) { exConds.push(`business_id = ${exp()}`); exParams.push(business_id); }
    exConds.push("(exchange ILIKE 'yes' OR exchange = 'Y')");
    const exWhere = 'WHERE ' + exConds.join(' AND ');
    const exchangeCount = (await query(`SELECT COUNT(*) as cnt FROM orders ${exWhere}`, exParams)).rows[0];
    countsMap['Exchange'] = Number(exchangeCount?.cnt || 0);

    res.json({ orders: rows, total: Number(countRow.cnt), status_counts: countsMap });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/ids', authenticate, async (req, res) => {
  try {
    const { business_id, status, search, date_from, date_to, pickup_from, pickup_to, courier } = req.query;
    const params = [];
    const conditions = [];
    let pIdx = 0;
    const p = () => `$${++pIdx}`;

    if (req.user.role !== 'admin') {
      conditions.push(`o.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`);
      params.push(req.user.id);
    }
    if (business_id) { conditions.push(`o.business_id = ${p()}`); params.push(business_id); }
    if (status === 'Pending Delivery') {
      conditions.push("o.status IN ('Dispatched', 'In Transit', 'Out for Delivery', 'Waiting', 'Failed')");
    } else if (status === 'Has Issues') {
      conditions.push("o.id IN (SELECT order_id FROM delivery_issues WHERE status NOT IN ('resolved', 'auto_return'))");
    } else if (status === 'Exchange') {
      conditions.push("(o.exchange ILIKE 'yes' OR o.exchange = 'Y')");
    } else if (status && status !== 'All') { conditions.push(`o.status = ${p()}`); params.push(status); }
    if (date_from) { conditions.push(`date(o.created_at) >= ${p()}`); params.push(date_from); }
    if (date_to) { conditions.push(`date(o.created_at) <= ${p()}`); params.push(date_to); }
    if (pickup_from) { conditions.push(`date(o.pickup_date) >= ${p()}`); params.push(pickup_from); }
    if (pickup_to) { conditions.push(`date(o.pickup_date) <= ${p()}`); params.push(pickup_to); }
    if (courier) { conditions.push(`o.courier = ${p()}`); params.push(courier); }
    if (search) {
      const term = search.trim();
      if (term) {
        conditions.push(`(o.tracking_number ILIKE ${p()} OR o.customer_name ILIKE ${p()} OR o.phone ILIKE ${p()} OR o.order_id ILIKE ${p()} OR o.item_names ILIKE ${p()})`);
        params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = (await query(`SELECT o.id FROM orders o ${where}`, params)).rows;
    res.json(rows.map(r => r.id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Export selected orders to an Excel delivery sheet
router.get('/export', authenticate, async (req, res) => {
  try {
    const { ids } = req.query;
    const idList = String(ids || '').split(',').map(Number).filter(Boolean);
    if (!idList.length) return res.status(400).json({ error: 'No orders selected' });

    const params = [];
    const conditions = [];
    let pIdx = 0;
    const p = () => `$${++pIdx}`;

    // Restrict to the user's businesses unless admin
    if (req.user.role !== 'admin') {
      conditions.push(`o.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`);
      params.push(req.user.id);
    }
    // idList is sanitized to integers above, safe to inline (works in SQLite + PG)
    conditions.push(`o.id IN (${idList.join(',')})`);

    const where = 'WHERE ' + conditions.join(' AND ');
    const rows = (await query(
      `SELECT o.tracking_number, o.customer_name, o.phone, o.address, o.city,
        COALESCE(NULLIF(o.product,''), o.item_names, '') as product,
        o.amount, o.pieces, o.weight
       FROM orders o ${where}
       ORDER BY o.city, o.customer_name`, params)).rows;

    if (!rows.length) return res.status(404).json({ error: 'No matching orders' });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Delivery List');
    sheet.columns = [
      { header: 'Tracking Number', key: 'tracking_number', width: 18 },
      { header: 'Customer Name', key: 'customer_name', width: 24 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'City', key: 'city', width: 18 },
      { header: 'Product', key: 'product', width: 30 },
      { header: 'Amount', key: 'amount', width: 12 },
      { header: 'Pieces', key: 'pieces', width: 8 },
      { header: 'Weight', key: 'weight', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach(r => sheet.addRow(r));

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DMS_Delivery_List_${dateStr}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Exported ${rows.length} orders to delivery list`, '']);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Export failed' }); }
});

// Product report — per product: total / delivered / returned order counts,
// mapped to the uploaded product master (clean SKU + name). Splits multi-product
// orders, normalizes messy codes to base SKU. Date range on order_date.
// ?format=xlsx streams Excel.
router.get('/product-report', authenticate, async (req, res) => {
  try {
    const { business_id, date_from, date_to, format } = req.query;

    // Master: baseKey → { sku, name }
    const master = new Map();
    if (business_id) {
      const mrows = (await query('SELECT product_sku, product_name FROM products WHERE business_id = $1', [business_id])).rows;
      for (const m of mrows) { const k = baseKey(m.product_sku); if (k && !master.has(k)) master.set(k, { sku: m.product_sku, name: m.product_name }); }
    }

    const params = []; const conds = []; let idx = 0; const p = () => `$${++idx}`;
    if (req.user.role !== 'admin') { conds.push(`o.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`); params.push(req.user.id); }
    if (business_id) { conds.push(`o.business_id = ${p()}`); params.push(business_id); }
    if (date_from) { conds.push(`date(o.order_date) >= ${p()}`); params.push(date_from); }
    if (date_to) { conds.push(`date(o.order_date) <= ${p()}`); params.push(date_to); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const orders = (await query(`SELECT item_codes, status FROM orders o ${where}`, params)).rows;

    // Per product (distinct within an order): total, delivered, returned
    const agg = new Map(); // key → { item_code, product_name, total, delivered, returned }
    const noCode = { item_code: '(no code)', product_name: 'Orders with no item code', total: 0, delivered: 0, returned: 0 };
    const bump = (e, st) => { e.total++; if (st === 'Delivered') e.delivered++; else if (st === 'Returned') e.returned++; };
    let totalOrders = 0, totalDelivered = 0, totalReturned = 0;

    for (const o of orders) {
      totalOrders++;
      const st = o.status;
      if (st === 'Delivered') totalDelivered++; else if (st === 'Returned') totalReturned++;
      const raw = String(o.item_codes || '').trim();
      if (!raw) { bump(noCode, st); continue; }
      const skus = new Set();
      for (const ln of raw.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) skus.add(baseKey(ln) || ('RAW:' + ln.toUpperCase()));
      for (const key of skus) {
        let e = agg.get(key);
        if (!e) {
          const k = key.startsWith('RAW:') ? null : key;
          const m = k && master.get(k);
          e = { item_code: m ? m.sku : (k ? prettyBase(k) : key.slice(4)), product_name: m ? m.name : (k ? '(not in master)' : key.slice(4)), total: 0, delivered: 0, returned: 0 };
          agg.set(key, e);
        }
        bump(e, st);
      }
    }

    const productRows = [...agg.values()].sort((a, b) => b.total - a.total || b.delivered - a.delivered);
    const rows = productRows.slice();
    if (noCode.total) rows.push(noCode);

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Products');
      sheet.columns = [
        { header: 'Product Code', key: 'item_code', width: 16 },
        { header: 'Product', key: 'product_name', width: 44 },
        { header: 'Total Orders', key: 'total', width: 14 },
        { header: 'Delivered', key: 'delivered', width: 12 },
        { header: 'Returned', key: 'returned', width: 12 },
      ];
      sheet.getRow(1).font = { bold: true };
      rows.forEach(r => sheet.addRow(r));
      const dateStr = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=DMS_Product_Report_${dateStr}.xlsx`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    res.json({
      rows,
      product_count: productRows.length,
      total_orders: totalOrders,
      total_delivered: totalDelivered,
      total_returned: totalReturned,
      has_master: master.size > 0,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/tracking', authenticate, async (req, res) => {
  try {
    const statuses = (await query('SELECT * FROM delivery_statuses WHERE order_id = $1 ORDER BY status_date ASC', [req.params.id])).rows;
    res.json(statuses);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Issue history for a specific order — the issue (if any) + its call attempts
router.get('/:id/issue-history', authenticate, async (req, res) => {
  try {
    const order = (await query('SELECT id, business_id FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.user.role !== 'admin') {
      const allowed = (await query('SELECT 1 FROM user_businesses WHERE user_id = $1 AND business_id = $2', [req.user.id, order.business_id])).rows[0];
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    }
    // An order can have several issues over time (a new one once the previous
    // is closed) — return them all, oldest first, each with its call attempts.
    const issues = (await query('SELECT * FROM delivery_issues WHERE order_id = $1 ORDER BY created_at ASC, id ASC', [order.id])).rows;
    for (const iss of issues) {
      iss.contacts = (await query('SELECT * FROM issue_contacts WHERE issue_id = $1 ORDER BY contacted_at ASC', [iss.id])).rows;
    }
    res.json({ issues });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Edit order
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { customer_name, phone, address, city, product, amount, salesperson, branch, item_names } = req.body;
    const order = (await query('SELECT id, tracking_number, business_id FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await query(`UPDATE orders SET
      customer_name = COALESCE(NULLIF($1,''), customer_name),
      phone = COALESCE(NULLIF($2,''), phone),
      address = COALESCE(NULLIF($3,''), address),
      city = COALESCE(NULLIF($4,''), city),
      product = COALESCE(NULLIF($5,''), product),
      amount = COALESCE($6, amount),
      salesperson = COALESCE(NULLIF($7,''), salesperson),
      branch = COALESCE(NULLIF($8,''), branch),
      item_names = COALESCE(NULLIF($9,''), item_names),
      updated_at = NOW() WHERE id = $10`,
      [customer_name, phone, address, city, product, amount || null, salesperson, branch, item_names, req.params.id]);

    const bizName = (await query('SELECT name FROM businesses WHERE id = $1', [order.business_id])).rows[0]?.name || '';
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Edited order ${order.tracking_number}`, bizName]);

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Bulk actions
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { action, order_ids, business_id, status, source } = req.body;
    if (!order_ids?.length) return res.status(400).json({ error: 'No orders selected' });

    let affected = 0, skippedActive = 0;
    const bizName = business_id ? (await query('SELECT name FROM businesses WHERE id = $1', [business_id])).rows[0]?.name || '' : '';

    if (action === 'delete') {
      for (const id of order_ids) {
        await query('DELETE FROM issue_contacts WHERE issue_id IN (SELECT id FROM delivery_issues WHERE order_id = $1)', [id]);
        await query('DELETE FROM delivery_issues WHERE order_id = $1', [id]);
        await query('DELETE FROM delivery_statuses WHERE order_id = $1', [id]);
        await query('DELETE FROM orders WHERE id = $1', [id]);
        affected++;
      }
      await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
        [req.user.id, req.user.name, `Bulk deleted ${affected} orders`, bizName]);
    } else if (action === 'add_issues') {
      for (const id of order_ids) {
        try {
          // Only an ACTIVE issue blocks a new one — once the previous issue is
          // closed (resolved/auto_return), the order can be raised again.
          const existing = (await query("SELECT id FROM delivery_issues WHERE order_id = $1 AND status IN ('open','in_progress')", [id])).rows[0];
          if (!existing) {
            await query("INSERT INTO delivery_issues (order_id, business_id, source, status, attempt) VALUES ($1,$2,$3,'open',0)", [id, business_id, source || 'internal']);
            affected++;
          } else { skippedActive++; }
        } catch {}
      }
      await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
        [req.user.id, req.user.name, `Bulk added ${affected} orders to issues`, bizName]);
    } else if (action === 'change_status') {
      if (!status) return res.status(400).json({ error: 'Status required' });
      for (const id of order_ids) {
        await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
        affected++;
      }
      await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
        [req.user.id, req.user.name, `Bulk changed ${affected} orders to ${status}`, bizName]);
    }

    res.json({ affected, skipped_active: skippedActive });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Delete order (and related issues, statuses)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const order = (await query('SELECT id, tracking_number, business_id FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Delete related data
    await query('DELETE FROM issue_contacts WHERE issue_id IN (SELECT id FROM delivery_issues WHERE order_id = $1)', [order.id]);
    await query('DELETE FROM delivery_issues WHERE order_id = $1', [order.id]);
    await query('DELETE FROM delivery_statuses WHERE order_id = $1', [order.id]);
    await query('DELETE FROM orders WHERE id = $1', [order.id]);

    const bizName = (await query('SELECT name FROM businesses WHERE id = $1', [order.business_id])).rows[0]?.name || '';
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Deleted order ${order.tracking_number}`, bizName]);

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
