const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get resolved issues for export (filterable by date)
router.get('/issues', authenticate, async (req, res) => {
  try {
    const { business_id, date_from, date_to } = req.query;
    const params = [];
    const conditions = ["i.status IN ('resolved', 'auto_return')"];
    let pIdx = 0;
    const p = () => `$${++pIdx}`;

    if (req.user.role !== 'admin') {
      conditions.push(`i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`);
      params.push(req.user.id);
    }
    if (business_id) { conditions.push(`i.business_id = ${p()}`); params.push(business_id); }
    if (date_from) { conditions.push(`date(i.resolved_at) >= ${p()}`); params.push(date_from); }
    if (date_to) { conditions.push(`date(i.resolved_at) <= ${p()}`); params.push(date_to); }

    const where = 'WHERE ' + conditions.join(' AND ');

    const rows = (await query(`
      SELECT i.*, o.tracking_number, o.customer_name, o.phone, o.address, o.city,
        o.product, o.branch, o.salesperson, o.amount, o.order_id as order_number,
        o.item_names,
        (SELECT ic.resolution FROM issue_contacts ic WHERE ic.issue_id = i.id ORDER BY ic.attempt_number DESC LIMIT 1) as resolution,
        (SELECT ic.scheduled_date FROM issue_contacts ic WHERE ic.issue_id = i.id ORDER BY ic.attempt_number DESC LIMIT 1) as scheduled_date,
        (SELECT ic.notes FROM issue_contacts ic WHERE ic.issue_id = i.id ORDER BY ic.attempt_number DESC LIMIT 1) as notes
      FROM delivery_issues i
      JOIN orders o ON i.order_id = o.id
      ${where}
      ORDER BY i.resolved_at DESC
    `, params)).rows;

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Download Excel export
router.get('/download', authenticate, async (req, res) => {
  try {
    const { business_id, date_from, date_to } = req.query;
    const params = [];
    const conditions = ["i.status IN ('resolved', 'auto_return')"];
    let pIdx = 0;
    const p = () => `$${++pIdx}`;

    if (req.user.role !== 'admin') {
      conditions.push(`i.business_id IN (SELECT business_id FROM user_businesses WHERE user_id = ${p()})`);
      params.push(req.user.id);
    }
    if (business_id) { conditions.push(`i.business_id = ${p()}`); params.push(business_id); }
    if (date_from) { conditions.push(`date(i.resolved_at) >= ${p()}`); params.push(date_from); }
    if (date_to) { conditions.push(`date(i.resolved_at) <= ${p()}`); params.push(date_to); }

    const where = 'WHERE ' + conditions.join(' AND ');

    const rows = (await query(`
      SELECT o.tracking_number, o.customer_name, o.phone, o.address, o.city,
        o.product, o.salesperson, o.branch, o.amount,
        i.status as issue_status, i.source, i.attempt, i.resolved_at, i.reason, i.domex_branch,
        (SELECT ic.resolution FROM issue_contacts ic WHERE ic.issue_id = i.id ORDER BY ic.attempt_number DESC LIMIT 1) as resolution,
        (SELECT ic.scheduled_date FROM issue_contacts ic WHERE ic.issue_id = i.id ORDER BY ic.attempt_number DESC LIMIT 1) as scheduled_date,
        (SELECT ic.notes FROM issue_contacts ic WHERE ic.issue_id = i.id ORDER BY ic.attempt_number DESC LIMIT 1) as notes
      FROM delivery_issues i
      JOIN orders o ON i.order_id = o.id
      ${where}
      ORDER BY i.resolved_at DESC
    `, params)).rows;

    // Build feedback text
    const feedbackRows = rows.map(r => {
      let feedback = r.resolution || (r.issue_status === 'auto_return' ? 'Auto-Return' : 'Resolved');
      if (r.scheduled_date) feedback += ` - ${r.scheduled_date}`;
      if (r.notes) feedback += ` - ${r.notes}`;
      return {
        date: r.resolved_at ? new Date(r.resolved_at) : new Date(),
        tracking: r.tracking_number,
        branch: r.domex_branch || r.branch || '',
        domex_reason: r.reason || '',
        feedback,
      };
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Domex Feedback');

    sheet.columns = [
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Tracking ', key: 'tracking', width: 18 },
      { header: 'Branch', key: 'branch', width: 20 },
      { header: 'Domex reason', key: 'domex_reason', width: 30 },
      { header: '9zero9 Feedback', key: 'feedback', width: 35 },
    ];

    // Style header
    sheet.getRow(1).font = { bold: true };

    feedbackRows.forEach(r => sheet.addRow(r));

    const bizName = business_id ? (await query('SELECT name FROM businesses WHERE id=$1', [business_id])).rows[0]?.name || 'All' : 'All';
    const dateStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DMS_Issue_Export_${bizName}_${dateStr}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Exported ${rows.length} issue updates`, bizName]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Analytics data
router.get('/analytics', authenticate, async (req, res) => {
  try {
    const { business_id, date_from, date_to } = req.query;

    // Build filters helper
    function buildFilter(prefix = '', table = '') {
      const params = []; let idx = 0; const p = () => `$${++idx}`;
      const conds = [];
      if (business_id) { conds.push(`${prefix}business_id = ${p()}`); params.push(business_id); }
      if (date_from) { conds.push(`date(${prefix}pickup_date) >= ${p()}`); params.push(date_from); }
      if (date_to) { conds.push(`date(${prefix}pickup_date) <= ${p()}`); params.push(date_to); }
      return { where: conds.length ? 'AND ' + conds.join(' AND ') : '', params };
    }

    const f = buildFilter();

    // Issue filter uses orders.pickup_date via join
    function buildIssueFilter() {
      const params = []; let idx = 0; const p = () => `$${++idx}`;
      const conds = [];
      if (business_id) { conds.push(`i.business_id = ${p()}`); params.push(business_id); }
      if (date_from) { conds.push(`date(o.pickup_date) >= ${p()}`); params.push(date_from); }
      if (date_to) { conds.push(`date(o.pickup_date) <= ${p()}`); params.push(date_to); }
      return { where: conds.length ? 'AND ' + conds.join(' AND ') : '', params };
    }
    const fi = buildIssueFilter();

    const statusBreakdown = (await query(
      `SELECT status, COUNT(*) as count FROM orders WHERE 1=1 ${f.where} GROUP BY status ORDER BY count DESC`, f.params
    )).rows;

    const totalOrders = (await query(`SELECT COUNT(*) as cnt FROM orders WHERE status != 'New' ${f.where}`, f.params)).rows[0]?.cnt || 0;
    const delivered = (await query(`SELECT COUNT(*) as cnt FROM orders WHERE status = 'Delivered' ${f.where}`, f.params)).rows[0]?.cnt || 0;
    const deliveryRate = totalOrders > 0 ? Math.round((Number(delivered) / Number(totalOrders)) * 100) : 0;

    const issuesBySource = (await query(
      `SELECT i.source, COUNT(*) as count FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE 1=1 ${fi.where} GROUP BY i.source`, fi.params
    )).rows;

    const issuesByStatus = (await query(
      `SELECT i.status, COUNT(*) as count FROM delivery_issues i JOIN orders o ON i.order_id = o.id WHERE 1=1 ${fi.where} GROUP BY i.status`, fi.params
    )).rows;

    const resolutions = (await query(`
      SELECT ic.resolution, COUNT(*) as count FROM issue_contacts ic
      JOIN delivery_issues i ON ic.issue_id = i.id
      JOIN orders o ON i.order_id = o.id
      WHERE ic.resolution IS NOT NULL ${fi.where}
      GROUP BY ic.resolution ORDER BY count DESC
    `, fi.params)).rows;

    const bySalesperson = (await query(
      `SELECT salesperson, COUNT(*) as total,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END) as returned,
        SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) as failed
       FROM orders WHERE salesperson IS NOT NULL AND salesperson != '' ${f.where}
       GROUP BY salesperson ORDER BY total DESC LIMIT 20`, f.params
    )).rows;

    res.json({
      status_breakdown: statusBreakdown,
      delivery_rate: deliveryRate,
      total_orders: Number(totalOrders),
      total_delivered: Number(delivered),
      issues_by_source: issuesBySource,
      issues_by_status: issuesByStatus,
      resolutions,
      by_salesperson: bySalesperson,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
