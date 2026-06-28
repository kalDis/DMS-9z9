const express = require('express');
const { db } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  try {
    const { business_id, status, search, date_from, date_to, pickup_from, pickup_to, page = 1, limit = 50, sort_by, sort_dir } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (req.user.role !== 'admin') {
      conditions.push('o.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ?)');
      params.push(req.user.id);
    }

    if (business_id) {
      conditions.push('o.business_id = ?');
      params.push(business_id);
    }
    if (status === 'Pending Delivery') {
      conditions.push("o.status IN ('Dispatched', 'In Transit', 'Out for Delivery', 'Waiting', 'Failed')");
    } else if (status && status !== 'All') {
      conditions.push('o.status = ?');
      params.push(status);
    }
    if (date_from) {
      conditions.push("date(o.created_at) >= ?");
      params.push(date_from);
    }
    if (date_to) {
      conditions.push("date(o.created_at) <= ?");
      params.push(date_to);
    }
    if (pickup_from) {
      conditions.push("date(o.pickup_date) >= ?");
      params.push(pickup_from);
    }
    if (pickup_to) {
      conditions.push("date(o.pickup_date) <= ?");
      params.push(pickup_to);
    }
    if (search) {
      const term = search.trim();
      if (term) {
        conditions.push("(o.tracking_number LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ? OR o.order_id LIKE ? OR o.item_names LIKE ?)");
        params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM orders o ${where}`).get(...params);

    const allowedSorts = ['order_id', 'tracking_number', 'customer_name', 'product', 'branch', 'salesperson', 'status', 'created_at', 'amount', 'order_date'];
    const sortCol = allowedSorts.includes(sort_by) ? `o.${sort_by}` : 'o.order_id';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';

    const rows = db.prepare(
      `SELECT o.*, b.name as business_name,
        (SELECT di.source FROM delivery_issues di WHERE di.order_id = o.id AND di.status NOT IN ('resolved', 'auto_return') LIMIT 1) as issue_source,
        (SELECT di.status FROM delivery_issues di WHERE di.order_id = o.id AND di.status NOT IN ('resolved', 'auto_return') LIMIT 1) as issue_status
       FROM orders o
       JOIN businesses b ON o.business_id = b.id ${where}
       ORDER BY CASE WHEN ${sortCol} IS NULL OR ${sortCol} = '' THEN 1 ELSE 0 END, ${sortCol} ${sortDirection} LIMIT ? OFFSET ?`
    ).all(...params, Number(limit), Number(offset));

    // Get status counts for filter pills
    const countParams = [];
    const countConditions = [];
    if (req.user.role !== 'admin') {
      countConditions.push('business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ?)');
      countParams.push(req.user.id);
    }
    if (business_id) {
      countConditions.push('business_id = ?');
      countParams.push(business_id);
    }
    const countWhere = countConditions.length ? 'WHERE ' + countConditions.join(' AND ') : '';
    const statusCounts = db.prepare(`SELECT status, COUNT(*) as cnt FROM orders ${countWhere} GROUP BY status`).all(...countParams);
    const countsMap = {};
    let allCount = 0;
    let pendingCount = 0;
    const pendingStatuses = ['Dispatched', 'In Transit', 'Out for Delivery', 'Waiting', 'Failed'];
    for (const sc of statusCounts) {
      countsMap[sc.status] = sc.cnt;
      allCount += sc.cnt;
      if (pendingStatuses.includes(sc.status)) pendingCount += sc.cnt;
    }
    countsMap['All'] = allCount;
    countsMap['Pending Delivery'] = pendingCount;

    res.json({ orders: rows, total: countRow.cnt, status_counts: countsMap });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/tracking', authenticate, (req, res) => {
  try {
    const statuses = db.prepare(
      'SELECT * FROM delivery_statuses WHERE order_id = ? ORDER BY status_date ASC'
    ).all(req.params.id);
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
