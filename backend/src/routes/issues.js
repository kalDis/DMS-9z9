const express = require('express');
const { db } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get all issues with order details
router.get('/', authenticate, (req, res) => {
  try {
    const { business_id, source, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (req.user.role !== 'admin') {
      conditions.push('i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ?)');
      params.push(req.user.id);
    }
    if (business_id) { conditions.push('i.business_id = ?'); params.push(business_id); }
    if (source) { conditions.push('i.source = ?'); params.push(source); }
    if (status) { conditions.push('i.status = ?'); params.push(status); }
    if (search) {
      const term = search.trim();
      if (term) {
        conditions.push("(o.tracking_number LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ?)");
        params.push(`%${term}%`, `%${term}%`, `%${term}%`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${where}`).get(...params);

    const rows = db.prepare(`
      SELECT i.*, o.tracking_number, o.customer_name, o.phone, o.address, o.city,
        o.product, o.branch, o.salesperson, o.amount, o.order_id as order_number,
        o.status as order_status, o.item_names, o.pickup_date, o.delivered_date,
        (SELECT MAX(contacted_at) FROM issue_contacts ic WHERE ic.issue_id = i.id) as last_contact_at,
        (SELECT ds.status_text FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_status,
        (SELECT ds.status_date FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_date,
        (SELECT ds.location FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_location
      FROM delivery_issues i
      JOIN orders o ON i.order_id = o.id
      ${where}
      ORDER BY
        CASE i.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    // Get status counts
    const countParams = [];
    const countConds = [];
    if (req.user.role !== 'admin') {
      countConds.push('i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ?)');
      countParams.push(req.user.id);
    }
    if (business_id) { countConds.push('i.business_id = ?'); countParams.push(business_id); }
    if (source) { countConds.push('i.source = ?'); countParams.push(source); }
    const cWhere = countConds.length ? 'WHERE ' + countConds.join(' AND ') : '';
    const statusCounts = db.prepare(`SELECT status, COUNT(*) as cnt FROM delivery_issues i ${cWhere} GROUP BY status`).all(...countParams);
    const countsMap = { all: 0 };
    for (const sc of statusCounts) { countsMap[sc.status] = sc.cnt; countsMap.all += sc.cnt; }

    res.json({ issues: rows, total: countRow.cnt, status_counts: countsMap });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get contact history for an issue
router.get('/:id/contacts', authenticate, (req, res) => {
  try {
    const contacts = db.prepare('SELECT * FROM issue_contacts WHERE issue_id = ? ORDER BY attempt_number ASC').all(req.params.id);
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add orders to issue queue (bulk)
router.post('/add', authenticate, (req, res) => {
  try {
    const { order_ids, source = 'internal', business_id } = req.body;
    if (!order_ids?.length || !business_id) return res.status(400).json({ error: 'order_ids and business_id required' });

    const checkStmt = db.prepare('SELECT id FROM delivery_issues WHERE order_id = ?');
    const insertStmt = db.prepare(
      `INSERT INTO delivery_issues (order_id, business_id, source, status, attempt) VALUES (?, ?, ?, 'open', 0)`
    );

    let added = 0, skipped = 0;
    db.transaction(() => {
      for (const orderId of order_ids) {
        const existing = checkStmt.get(orderId);
        if (existing) { skipped++; continue; }
        insertStmt.run(orderId, business_id, source);
        added++;
      }
    })();

    db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (?, ?, ?, ?)")
      .run(req.user.id, req.user.name, `Added ${added} orders to issue queue (${source})`,
        db.prepare('SELECT name FROM businesses WHERE id = ?').get(business_id)?.name || '');

    res.json({ added, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload Domex issue file — match tracking numbers and create issues
router.post('/add-by-tracking', authenticate, (req, res) => {
  try {
    const { tracking_numbers, business_id, source = 'domex' } = req.body;
    if (!tracking_numbers?.length || !business_id) return res.status(400).json({ error: 'tracking_numbers and business_id required' });

    const findOrder = db.prepare('SELECT id FROM orders WHERE business_id = ? AND tracking_number = ?');
    const checkIssue = db.prepare('SELECT id FROM delivery_issues WHERE order_id = ?');
    const insertIssue = db.prepare(
      `INSERT INTO delivery_issues (order_id, business_id, source, status, attempt) VALUES (?, ?, ?, 'open', 0)`
    );

    let added = 0, skipped = 0, notFound = 0;
    db.transaction(() => {
      for (const tn of tracking_numbers) {
        const order = findOrder.get(business_id, tn.trim());
        if (!order) { notFound++; continue; }
        const existing = checkIssue.get(order.id);
        if (existing) { skipped++; continue; }
        insertIssue.run(order.id, business_id, source);
        added++;
      }
    })();

    res.json({ added, skipped, not_found: notFound });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Record a contact attempt
router.post('/:id/contact', authenticate, (req, res) => {
  try {
    const { outcome, resolution, scheduled_date, notes } = req.body;
    if (!outcome) return res.status(400).json({ error: 'outcome required (answered/no_answer)' });

    const issue = db.prepare('SELECT * FROM delivery_issues WHERE id = ?').get(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    // Check 3-day rule: minimum 1 day between attempts
    if (issue.attempt > 0) {
      const lastContact = db.prepare(
        'SELECT contacted_at FROM issue_contacts WHERE issue_id = ? ORDER BY attempt_number DESC LIMIT 1'
      ).get(issue.id);

      if (lastContact) {
        const lastDate = new Date(lastContact.contacted_at);
        const now = new Date();
        const daysDiff = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff < 1) {
          return res.status(400).json({
            error: 'Must wait at least 1 day between contact attempts',
            next_attempt_at: new Date(lastDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      }
    }

    const newAttempt = issue.attempt + 1;

    // Insert contact record
    db.prepare(
      `INSERT INTO issue_contacts (issue_id, attempt_number, outcome, resolution, scheduled_date, notes, contacted_by, contacted_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(issue.id, newAttempt, outcome, resolution || null, scheduled_date || null, notes || null, req.user.id, req.user.name);

    if (outcome === 'answered') {
      // Resolved — update issue
      const newStatus = resolution === 'return_confirmed' ? 'resolved' : 'resolved';
      db.prepare("UPDATE delivery_issues SET status = ?, attempt = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(newStatus, newAttempt, issue.id);

      // Update order status
      if (resolution === 'return_confirmed') {
        db.prepare("UPDATE orders SET status = 'Returned', updated_at = datetime('now') WHERE id = ?").run(issue.order_id);
      }
    } else {
      // No answer
      if (newAttempt >= 3) {
        // 3rd attempt no answer → auto return
        db.prepare("UPDATE delivery_issues SET status = 'auto_return', attempt = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run(newAttempt, issue.id);
        db.prepare("UPDATE orders SET status = 'Returned', updated_at = datetime('now') WHERE id = ?").run(issue.order_id);
      } else {
        db.prepare("UPDATE delivery_issues SET status = 'in_progress', attempt = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newAttempt, issue.id);
      }
    }

    db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (?, ?, ?, ?)")
      .run(req.user.id, req.user.name,
        `Issue ${issue.id}: Attempt ${newAttempt} - ${outcome}${resolution ? ' (' + resolution + ')' : ''}`,
        db.prepare('SELECT name FROM businesses WHERE id = ?').get(issue.business_id)?.name || '');

    const updated = db.prepare('SELECT * FROM delivery_issues WHERE id = ?').get(issue.id);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
