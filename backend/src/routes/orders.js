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

    res.json({ orders: rows, total: Number(countRow.cnt), status_counts: countsMap });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/tracking', authenticate, async (req, res) => {
  try {
    const statuses = (await query('SELECT * FROM delivery_statuses WHERE order_id = $1 ORDER BY status_date ASC', [req.params.id])).rows;
    res.json(statuses);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
