const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { db } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Upload Domex issue Excel
router.post('/domex-issues', authenticate, requireRole('admin', 'issue_handler'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.body.business_id) return res.status(400).json({ error: 'Business ID required' });

    const businessId = Number(req.body.business_id);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const ws = workbook.worksheets[0];

    // Find header row (look for row containing 'waybill' or tracking-like header)
    let headerRow = 1;
    let trackingCol = null, branchCol = null, reasonCol = null, updateCol = null;

    for (let r = 1; r <= 5; r++) {
      const row = ws.getRow(r);
      row.eachCell((cell, col) => {
        const val = String(cell.value || '').trim().toLowerCase();
        if (val.includes('waybill') || val.includes('tracking')) { trackingCol = col; headerRow = r; }
        if (val === 'branch') branchCol = col;
        if (val === 'reason') reasonCol = col;
        if (val === 'update') updateCol = col;
      });
      if (trackingCol) break;
    }

    if (!trackingCol) {
      return res.status(400).json({ error: 'Could not find tracking number column (WayBILL/Tracking)' });
    }

    // Parse rows
    const findOrder = db.prepare('SELECT id FROM orders WHERE business_id = ? AND tracking_number = ?');
    const checkIssue = db.prepare('SELECT id FROM delivery_issues WHERE order_id = ?');
    const insertIssue = db.prepare(
      `INSERT INTO delivery_issues (order_id, business_id, source, status, attempt, reason, domex_branch) VALUES (?, ?, 'domex', 'open', 0, ?, ?)`
    );

    let added = 0, skipped = 0, notFound = 0;
    const notFoundList = [];

    db.transaction(() => {
      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const tn = String(row.getCell(trackingCol).value || '').trim();
        if (!tn) continue;

        const reason = reasonCol ? String(row.getCell(reasonCol).value || '').trim() : '';
        const branch = branchCol ? String(row.getCell(branchCol).value || '').trim() : '';

        const order = findOrder.get(businessId, tn);
        if (!order) {
          notFound++;
          notFoundList.push(tn);
          continue;
        }

        const existing = checkIssue.get(order.id);
        if (existing) { skipped++; continue; }

        insertIssue.run(order.id, businessId, reason || null, branch || null);
        added++;
      }
    })();

    const bizName = db.prepare('SELECT name FROM businesses WHERE id = ?').get(businessId)?.name || '';
    db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (?, ?, ?, ?)")
      .run(req.user.id, req.user.name, `Uploaded Domex issues: ${added} added, ${skipped} already in queue, ${notFound} not found`, bizName);

    res.json({ added, skipped, not_found: notFound, not_found_list: notFoundList.slice(0, 20) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

module.exports = router;
