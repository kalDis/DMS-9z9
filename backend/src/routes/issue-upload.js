const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });

router.post('/domex-issues', authenticate, requireRole('admin','issue_handler'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.body.business_id) return res.status(400).json({ error: 'Business ID required' });
    const businessId = Number(req.body.business_id);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(req.file.path);
    const ws = workbook.worksheets[0];

    let headerRow = 1, trackingCol = null, branchCol = null, reasonCol = null;
    for (let r = 1; r <= 5; r++) {
      ws.getRow(r).eachCell((cell, col) => {
        const val = String(cell.value||'').trim().toLowerCase();
        if (val.includes('waybill') || val.includes('tracking')) { trackingCol = col; headerRow = r; }
        if (val === 'branch') branchCol = col;
        if (val === 'reason') reasonCol = col;
      });
      if (trackingCol) break;
    }
    if (!trackingCol) return res.status(400).json({ error: 'Could not find tracking number column' });

    let added = 0, skipped = 0, notFound = 0;
    const notFoundList = [];

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const tn = String(row.getCell(trackingCol).value||'').trim();
      if (!tn) continue;
      const reason = reasonCol ? String(row.getCell(reasonCol).value||'').trim() : '';
      const branch = branchCol ? String(row.getCell(branchCol).value||'').trim() : '';

      const order = (await query('SELECT id FROM orders WHERE business_id=$1 AND tracking_number=$2', [businessId, tn])).rows[0];
      if (!order) { notFound++; notFoundList.push(tn); continue; }
      const existing = (await query('SELECT id FROM delivery_issues WHERE order_id=$1', [order.id])).rows[0];
      if (existing) { skipped++; continue; }
      await query("INSERT INTO delivery_issues (order_id,business_id,source,status,attempt,reason,domex_branch) VALUES ($1,$2,'domex','open',0,$3,$4)", [order.id, businessId, reason||null, branch||null]);
      added++;
    }

    const bizName = (await query('SELECT name FROM businesses WHERE id=$1', [businessId])).rows[0]?.name||'';
    await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Uploaded Domex issues: ${added} added, ${skipped} already, ${notFound} not found`, bizName]);
    res.json({ added, skipped, not_found: notFound, not_found_list: notFoundList.slice(0, 20) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to process file' }); }
});

module.exports = router;
