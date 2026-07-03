const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// --- Sri Lanka (Asia/Colombo) day helpers ---
// Attempts are counted per calendar day in Colombo time, and the "today"
// buckets are computed from this, NOT from the server's UTC clock.
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  let s = String(v);
  // SQLite stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' in UTC (no tz marker)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function colomboDay(v) {
  const d = toDate(v);
  if (!d) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(d); // YYYY-MM-DD
}

const ISSUE_COLS = `i.*, o.tracking_number, o.customer_name, o.phone, o.address, o.city,
  o.product, o.branch, o.salesperson, o.amount, o.order_id as order_number,
  o.status as order_status, o.item_names, o.pickup_date, o.delivered_date,
  (SELECT MAX(contacted_at) FROM issue_contacts ic WHERE ic.issue_id = i.id) as last_contact_at,
  (SELECT ds.status_text FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_status,
  (SELECT ds.status_date FROM delivery_statuses ds WHERE ds.order_id = i.order_id ORDER BY ds.status_date DESC LIMIT 1) as latest_delivery_date`;

router.get('/', authenticate, async (req, res) => {
  try {
    const { business_id, source, status, search, page = 1, limit = 50, bucket } = req.query;

    // Shared base filter builder (role + business + source + search)
    const buildBase = () => {
      const params = []; const conds = []; let idx = 0; const p = () => `$${++idx}`;
      if (req.user.role !== 'admin') { conds.push(`i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`); params.push(req.user.id); }
      if (business_id) { conds.push(`i.business_id = ${p()}`); params.push(business_id); }
      if (source) { conds.push(`i.source = ${p()}`); params.push(source); }
      if (search) { const term = String(search).trim(); if (term) { conds.push(`(o.tracking_number ILIKE ${p()} OR o.customer_name ILIKE ${p()} OR o.phone ILIKE ${p()})`); params.push(`%${term}%`, `%${term}%`, `%${term}%`); } }
      return { params, conds, p };
    };

    // Fetch all active issues (open + in_progress) — small set, bucketed in JS
    const b = buildBase();
    const activeWhere = 'WHERE ' + [...b.conds, `i.status IN ('open','in_progress')`].join(' AND ');
    const active = (await query(`SELECT ${ISSUE_COLS} FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${activeWhere}`, b.params)).rows;

    const todayCol = colomboDay(new Date());
    const toCall = [], called = [];
    for (const r of active) {
      const isToday = r.last_contact_at && colomboDay(r.last_contact_at) === todayCol;
      if (isToday) { r.called_today = true; r.section = 'called_today'; called.push(r); }
      else { r.called_today = false; r.section = r.last_contact_at ? 'followup' : 'new'; toCall.push(r); }
    }
    // To Call Today: follow-ups first (higher attempt / called longest ago on top), then new (oldest first)
    toCall.sort((a, c) => {
      const af = a.section === 'followup' ? 0 : 1, cf = c.section === 'followup' ? 0 : 1;
      if (af !== cf) return af - cf;
      if (af === 0) {
        if (c.attempt !== a.attempt) return c.attempt - a.attempt;
        return toDate(a.last_contact_at) - toDate(c.last_contact_at);
      }
      return toDate(a.created_at) - toDate(c.created_at);
    });
    // Called Today: oldest call on top (rotation — re-calling sends it to the bottom)
    called.sort((a, c) => toDate(a.last_contact_at) - toDate(c.last_contact_at));

    // Counts for tab badges
    const bc = buildBase();
    const cWhere = bc.conds.length ? 'WHERE ' + bc.conds.join(' AND ') : '';
    const statusCounts = (await query(`SELECT i.status as status, COUNT(*) as cnt FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${cWhere} GROUP BY i.status`, bc.params)).rows;
    const countsMap = { all: 0, to_call_today: toCall.length, called_today: called.length };
    for (const sc of statusCounts) { countsMap[sc.status] = Number(sc.cnt); countsMap.all += Number(sc.cnt); }

    const lim = Number(limit), off = (Number(page) - 1) * lim;

    if (bucket === 'called_today') {
      return res.json({ issues: called.slice(off, off + lim), total: called.length, status_counts: countsMap });
    }
    if (bucket === 'to_call_today' || (!status && !bucket)) {
      return res.json({ issues: toCall.slice(off, off + lim), total: toCall.length, status_counts: countsMap });
    }

    // Status-based view (resolved / auto_return) — SQL-paginated
    const s = buildBase();
    const sWhere = 'WHERE ' + [...s.conds, `i.status = ${s.p()}`].join(' AND ');
    s.params.push(status);
    const total = Number((await query(`SELECT COUNT(*) as cnt FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${sWhere}`, s.params)).rows[0].cnt);
    s.params.push(lim, off);
    const rows = (await query(`SELECT ${ISSUE_COLS} FROM delivery_issues i JOIN orders o ON i.order_id = o.id ${sWhere} ORDER BY i.resolved_at DESC, i.created_at DESC LIMIT ${s.p()} OFFSET ${s.p()}`, s.params)).rows;
    return res.json({ issues: rows, total, status_counts: countsMap });
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

    // Attempt = one day of trying. Calling again the SAME Colombo day does not
    // consume a new attempt; a call on a new day increments it. No time lock.
    const lastContact = (await query('SELECT contacted_at FROM issue_contacts WHERE issue_id = $1 ORDER BY contacted_at DESC LIMIT 1', [issue.id])).rows[0];
    const sameDay = lastContact ? colomboDay(lastContact.contacted_at) === colomboDay(new Date()) : false;
    const newAttempt = sameDay ? issue.attempt : issue.attempt + 1;
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

// Bulk delete issues
router.post('/bulk-delete', authenticate, async (req, res) => {
  try {
    const { issue_ids } = req.body;
    if (!issue_ids?.length) return res.status(400).json({ error: 'No issues selected' });

    let deleted = 0;
    for (const id of issue_ids) {
      await query('DELETE FROM issue_contacts WHERE issue_id = $1', [id]);
      await query('DELETE FROM delivery_issues WHERE id = $1', [id]);
      deleted++;
    }

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Bulk deleted ${deleted} issues`, '']);

    res.json({ deleted });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Bulk revert resolved issues
router.post('/bulk-revert', authenticate, async (req, res) => {
  try {
    const { issue_ids } = req.body;
    if (!issue_ids?.length) return res.status(400).json({ error: 'No issues selected' });

    let reverted = 0;
    for (const id of issue_ids) {
      const issue = (await query('SELECT * FROM delivery_issues WHERE id = $1', [id])).rows[0];
      if (!issue) continue;
      await query("UPDATE delivery_issues SET status = 'open', attempt = 0, resolved_at = NULL, updated_at = NOW() WHERE id = $1", [id]);
      await query('DELETE FROM issue_contacts WHERE issue_id = $1', [id]);
      const order = (await query('SELECT status FROM orders WHERE id = $1', [issue.order_id])).rows[0];
      if (order?.status === 'Returned') {
        await query("UPDATE orders SET status = 'In Transit', updated_at = NOW() WHERE id = $1", [issue.order_id]);
      }
      reverted++;
    }

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Bulk reverted ${reverted} issues to open`, '']);

    res.json({ reverted });
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
