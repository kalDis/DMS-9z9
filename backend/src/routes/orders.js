const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { business_id, status, search, date_from, date_to, pickup_from, pickup_to, page = 1, limit = 50, sort_by, sort_dir } = req.query;
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
    if (search) {
      const term = search.trim();
      if (term) {
        conditions.push(`(o.tracking_number ILIKE ${p()} OR o.customer_name ILIKE ${p()} OR o.phone ILIKE ${p()} OR o.order_id ILIKE ${p()} OR o.item_names ILIKE ${p()})`);
        params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const allowedSorts = ['order_id','tracking_number','customer_name','product','branch','salesperson','status','created_at','amount','order_date','pickup_date'];
    const sortCol = allowedSorts.includes(sort_by) ? `o.${sort_by}` : 'o.order_id';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';

    const countRow = (await query(`SELECT COUNT(*) as cnt FROM orders o ${where}`, params)).rows[0];

    params.push(Number(limit), Number(offset));
    const rows = (await query(
      `SELECT o.*, b.name as business_name,
        (SELECT di.source FROM delivery_issues di WHERE di.order_id = o.id AND di.status NOT IN ('resolved','auto_return') LIMIT 1) as issue_source,
        (SELECT di.status FROM delivery_issues di WHERE di.order_id = o.id AND di.status NOT IN ('resolved','auto_return') LIMIT 1) as issue_status
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
    const { business_id, status, search, date_from, date_to, pickup_from, pickup_to } = req.query;
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

router.get('/:id/tracking', authenticate, async (req, res) => {
  try {
    const statuses = (await query('SELECT * FROM delivery_statuses WHERE order_id = $1 ORDER BY status_date ASC', [req.params.id])).rows;
    res.json(statuses);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
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

    let affected = 0;
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
          const existing = (await query('SELECT id FROM delivery_issues WHERE order_id = $1', [id])).rows[0];
          if (!existing) {
            await query("INSERT INTO delivery_issues (order_id, business_id, source, status, attempt) VALUES ($1,$2,$3,'open',0)", [id, business_id, source || 'internal']);
            affected++;
          }
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

    res.json({ affected });
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
