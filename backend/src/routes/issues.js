const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { business_id, source, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = []; const conditions = [];
    let pIdx = 0; const p = () => `$${++pIdx}`;

    if (req.user.role !== 'admin') { conditions.push(`i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`); params.push(req.user.id); }
    if (business_id) { conditions.push(`i.business_id = ${p()}`); params.push(business_id); }
    if (source) { conditions.push(`i.source = ${p()}`); params.push(source); }
    if (status) { conditions.push(`i.status = ${p()}`); params.push(status); }
    if (search) { const term = search.trim(); if (term) { conditions.push(`(o.tracking_number ILIKE ${p()} OR o.customer_name ILIKE ${p()} OR o.phone ILIKE ${p()})`); params.push(`%${term}%`,`%${term}%`,`%${term}%`); }}

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRow = (await query(`SELECT COUNT(*) as cnt FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${where}`, params)).rows[0];

    params.push(Number(limit), Number(offset));
    const rows = (await query(`
      SELECT i.*, o.tracking_number, o.customer_name, o.phone, o.address, o.city,
        o.product, o.branch, o.salesperson, o.amount, o.order_id as order_number,
        o.status as order_status, o.item_names, o.pickup_date, o.delivered_date,
        (SELECT MAX(contacted_at) FROM issue_contacts ic WHERE ic.issue_id = i.id) as last_contact_at,
        (SELECT ds.status_text FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_status,
        (SELECT ds.status_date FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_date
      FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${where}
      ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, i.created_at DESC
      LIMIT ${p()} OFFSET ${p()}
    `, params)).rows;

    // Status counts
    const cParams = []; let cIdx = 0; const cp = () => `$${++cIdx}`; const cConds = [];
    if (req.user.role !== 'admin') { cConds.push(`i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${cp()})`); cParams.push(req.user.id); }
    if (business_id) { cConds.push(`i.business_id = ${cp()}`); cParams.push(business_id); }
    if (source) { cConds.push(`i.source = ${cp()}`); cParams.push(source); }
    const cWhere = cConds.length ? 'WHERE ' + cConds.join(' AND ') : '';
    const statusCounts = (await query(`SELECT status, COUNT(*) as cnt FROM delivery_issues i ${cWhere} GROUP BY status`, cParams)).rows;
    const countsMap = { all: 0 };
    for (const sc of statusCounts) { countsMap[sc.status] = Number(sc.cnt); countsMap.all += Number(sc.cnt); }

    res.json({ issues: rows, total: Number(countRow.cnt), status_counts: countsMap });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/contacts', authenticate, async (req, res) => {
  try {
    const contacts = (await query('SELECT * FROM issue_contacts WHERE issue_id = $1 ORDER BY attempt_number ASC', [req.params.id])).rows;
    res.json(contacts);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/add', authenticate, async (req, res) => {
  try {
    const { order_ids, source = 'internal', business_id } = req.body;
    if (!order_ids?.length || !business_id) return res.status(400).json({ error: 'order_ids and business_id required' });

    let added = 0, skipped = 0;
    for (const orderId of order_ids) {
      try {
        const existing = (await query('SELECT id FROM delivery_issues WHERE order_id = $1', [orderId])).rows[0];
        if (existing) { skipped++; continue; }
        await query(`INSERT INTO delivery_issues (order_id, business_id, source, status, attempt) VALUES ($1,$2,$3,'open',0)`, [orderId, business_id, source]);
        added++;
      } catch { skipped++; }
    }

    const bizName = (await query('SELECT name FROM businesses WHERE id = $1', [business_id])).rows[0]?.name || '';
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Added ${added} orders to issue queue (${source})`, bizName]);

    res.json({ added, skipped });
  } catch (err) { console.error('ADD ISSUE ERROR:', err); res.status(500).json({ error: err.message, stack: err.stack?.split('\n')[0] }); }
});

router.post('/:id/contact', authenticate, async (req, res) => {
  try {
    const { outcome, resolution, resolution_label, scheduled_date, notes } = req.body;
    if (!outcome) return res.status(400).json({ error: 'outcome required' });

    const issue = (await query('SELECT * FROM delivery_issues WHERE id = $1', [req.params.id])).rows[0];
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    if (issue.attempt > 0) {
      const lastContact = (await query('SELECT contacted_at FROM issue_contacts WHERE issue_id = $1 ORDER BY attempt_number DESC LIMIT 1', [issue.id])).rows[0];
      if (lastContact) {
        const daysDiff = (Date.now() - new Date(lastContact.contacted_at).getTime()) / 86400000;
        if (daysDiff < 1) return res.status(400).json({ error: 'Must wait at least 1 day between contact attempts' });
      }
    }

    const newAttempt = issue.attempt + 1;
    const resLabel = resolution_label || resolution || null;

    await query(`INSERT INTO issue_contacts (issue_id, attempt_number, outcome, resolution, scheduled_date, notes, contacted_by, contacted_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [issue.id, newAttempt, outcome, resLabel, scheduled_date||null, notes||null, req.user.id, req.user.name]);

    if (outcome === 'answered') {
      await query("UPDATE delivery_issues SET status='resolved', attempt=$1, resolved_at=NOW(), updated_at=NOW() WHERE id=$2", [newAttempt, issue.id]);
      if (resolution === 'return_confirmed') {
        await query("UPDATE orders SET status='Returned', updated_at=NOW() WHERE id=$1", [issue.order_id]);
      }
    } else {
      if (newAttempt >= 3) {
        await query("UPDATE delivery_issues SET status='auto_return', attempt=$1, resolved_at=NOW(), updated_at=NOW() WHERE id=$2", [newAttempt, issue.id]);
        await query("UPDATE orders SET status='Returned', updated_at=NOW() WHERE id=$1", [issue.order_id]);
      } else {
        await query("UPDATE delivery_issues SET status='in_progress', attempt=$1, updated_at=NOW() WHERE id=$2", [newAttempt, issue.id]);
      }
    }

    const bizName = (await query('SELECT name FROM businesses WHERE id = $1', [issue.business_id])).rows[0]?.name || '';
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Issue ${issue.id}: Attempt ${newAttempt} - ${outcome}${resLabel ? ' ('+resLabel+')' : ''}`, bizName]);

    const updated = (await query('SELECT * FROM delivery_issues WHERE id = $1', [issue.id])).rows[0];
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Delete issue (remove from queue, order stays)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const issue = (await query('SELECT * FROM delivery_issues WHERE id = $1', [req.params.id])).rows[0];
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    await query('DELETE FROM issue_contacts WHERE issue_id = $1', [issue.id]);
    await query('DELETE FROM delivery_issues WHERE id = $1', [issue.id]);

    const bizName = (await query('SELECT name FROM businesses WHERE id = $1', [issue.business_id])).rows[0]?.name || '';
    const tn = (await query('SELECT tracking_number FROM orders WHERE id = $1', [issue.order_id])).rows[0]?.tracking_number || '';
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Deleted issue for ${tn}`, bizName]);

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Revert resolved issue back to open
router.post('/:id/revert', authenticate, async (req, res) => {
  try {
    const issue = (await query('SELECT * FROM delivery_issues WHERE id = $1', [req.params.id])).rows[0];
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    // Reset issue to open, clear attempts
    await query("UPDATE delivery_issues SET status = 'open', attempt = 0, resolved_at = NULL, updated_at = NOW() WHERE id = $1", [issue.id]);
    await query('DELETE FROM issue_contacts WHERE issue_id = $1', [issue.id]);

    // If order was set to Returned by issue resolution, revert it
    const order = (await query('SELECT status FROM orders WHERE id = $1', [issue.order_id])).rows[0];
    if (order?.status === 'Returned') {
      await query("UPDATE orders SET status = 'In Transit', updated_at = NOW() WHERE id = $1", [issue.order_id]);
    }

    const bizName = (await query('SELECT name FROM businesses WHERE id = $1', [issue.business_id])).rows[0]?.name || '';
    const tn = (await query('SELECT tracking_number FROM orders WHERE id = $1', [issue.order_id])).rows[0]?.tracking_number || '';
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Reverted resolved issue for ${tn} back to open`, bizName]);

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
