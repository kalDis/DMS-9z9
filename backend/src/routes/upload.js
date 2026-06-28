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
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('Only .xlsx, .xls, .csv files allowed'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ORDER_FIELDS = [
  { key: 'tracking_number', label: 'Tracking Number', required: true },
  { key: 'order_id', label: 'Order ID', required: false },
  { key: 'order_date', label: 'Order Date', required: false },
  { key: 'customer_name', label: 'Customer Name', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'amount', label: 'Amount', required: false },
  { key: 'num_items', label: 'Number of Items', required: false },
  { key: 'item_codes', label: 'Item Codes', required: false },
  { key: 'item_names', label: 'Item Names', required: false },
  { key: 'payment_status', label: 'Payment Status', required: false },
  { key: 'order_status', label: 'Order Status', required: false },
  { key: 'salesperson', label: 'Sales Person', required: false },
  { key: 'order_handler', label: 'Order Handler', required: false },
  { key: 'commission', label: 'Commission', required: false },
];

const DELIVERY_FIELDS = [
  { key: 'tracking_number', label: 'Tracking Number', required: true },
  { key: 'reference', label: 'Reference', required: false },
  { key: 'product', label: 'Package Description', required: false },
  { key: 'customer_name', label: 'Receiver Name', required: false },
  { key: 'address', label: 'Receiver Address', required: false },
  { key: 'city', label: 'Receiver City', required: false },
  { key: 'phone', label: 'Receiver Contact No', required: false },
  { key: 'pieces', label: 'No of Pcs', required: false },
  { key: 'weight', label: 'Weight (Gram/Kilo)', required: false },
  { key: 'amount', label: 'Amount', required: false },
  { key: 'exchange', label: 'Exchange', required: false },
  { key: 'remark', label: 'Remark', required: false },
  { key: 'salesperson', label: 'Sale Rep', required: false },
];

// Get saved mapping
router.get('/mapping/:businessId/:type', authenticate, (req, res) => {
  const row = db.prepare('SELECT mappings FROM column_mappings WHERE business_id = ? AND id IN (SELECT id FROM column_mappings WHERE business_id = ?)')
    .get(req.params.businessId, req.params.businessId);
  // Store type-specific mappings
  const allRow = db.prepare("SELECT mappings FROM column_mappings WHERE business_id = ?").get(req.params.businessId);
  let mappings = null;
  if (allRow) {
    const all = JSON.parse(allRow.mappings);
    mappings = all[req.params.type] || null;
  }
  const fields = req.params.type === 'orders' ? ORDER_FIELDS : DELIVERY_FIELDS;
  res.json({ mappings, fields });
});

// Save mapping
router.post('/mapping/:businessId/:type', authenticate, requireRole('admin', 'issue_handler'), (req, res) => {
  const { mappings } = req.body;
  if (!mappings) return res.status(400).json({ error: 'Mappings required' });

  const existing = db.prepare('SELECT mappings FROM column_mappings WHERE business_id = ?').get(req.params.businessId);
  let all = {};
  if (existing) {
    all = JSON.parse(existing.mappings);
    all[req.params.type] = mappings;
    db.prepare("UPDATE column_mappings SET mappings = ?, updated_at = datetime('now') WHERE business_id = ?")
      .run(JSON.stringify(all), req.params.businessId);
  } else {
    all[req.params.type] = mappings;
    db.prepare('INSERT INTO column_mappings (business_id, mappings) VALUES (?, ?)')
      .run(req.params.businessId, JSON.stringify(all));
  }
  res.json({ success: true });
});

// Upload file and read headers + sheet names
router.post('/headers', authenticate, requireRole('admin', 'issue_handler'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = new ExcelJS.Workbook();
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.csv') await workbook.csv.readFile(req.file.path);
    else await workbook.xlsx.readFile(req.file.path);

    const sheets = workbook.worksheets.map(ws => {
      const headers = [];
      ws.getRow(1).eachCell((cell, col) => {
        const val = String(cell.value || '').trim();
        if (val) headers.push({ col, name: val });
      });
      return { name: ws.name, headers, row_count: ws.rowCount - 1 };
    });

    res.json({ file_id: req.file.filename, sheets });
  } catch (err) {
    console.error('Header read error:', err);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Parse orders from sales report
router.post('/parse-orders', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    const { file_id, business_id, mappings, sheet_name } = req.body;
    if (!file_id || !business_id || !mappings) return res.status(400).json({ error: 'Missing required fields' });
    if (!mappings.tracking_number) return res.status(400).json({ error: 'Tracking Number mapping is required' });

    const filePath = path.join(__dirname, '..', '..', 'uploads', file_id);
    const workbook = new ExcelJS.Workbook();
    const ext = path.extname(file_id).toLowerCase();
    if (ext === '.csv') await workbook.csv.readFile(filePath);
    else await workbook.xlsx.readFile(filePath);

    const worksheet = sheet_name ? workbook.worksheets.find(ws => ws.name === sheet_name) : workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: 'Sheet not found' });

    const rows = parseSheet(worksheet, mappings);
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found' });

    // Check existing
    const trackingNumbers = rows.map(r => r.tracking_number);
    const placeholders = trackingNumbers.map(() => '?').join(',');
    const existing = db.prepare(
      `SELECT tracking_number FROM orders WHERE business_id = ? AND tracking_number IN (${placeholders})`
    ).all(Number(business_id), ...trackingNumbers);
    const existingSet = new Set(existing.map(e => e.tracking_number));

    const newRows = rows.filter(r => !existingSet.has(r.tracking_number));
    const updateRows = rows.filter(r => existingSet.has(r.tracking_number));

    res.json({ total: rows.length, new_count: newRows.length, update_count: updateRows.length, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse file' });
  }
});

// Import orders from sales report
router.post('/import-orders', authenticate, requireRole('admin', 'issue_handler'), (req, res) => {
  try {
    const { business_id, rows } = req.body;
    if (!business_id || !rows?.length) return res.status(400).json({ error: 'Missing data' });

    let inserted = 0, updated = 0;

    const checkStmt = db.prepare('SELECT id FROM orders WHERE business_id = ? AND tracking_number = ?');
    const insertStmt = db.prepare(`INSERT INTO orders (business_id, tracking_number, customer_name, phone, address, product,
      salesperson, branch, status, order_date, order_id, amount, item_codes, item_names, payment_status,
      order_status, order_handler, commission, num_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const updateStmt = db.prepare(`UPDATE orders SET
      customer_name = COALESCE(NULLIF(?, ''), customer_name),
      phone = COALESCE(NULLIF(?, ''), phone),
      amount = COALESCE(?, amount),
      item_codes = COALESCE(NULLIF(?, ''), item_codes),
      item_names = COALESCE(NULLIF(?, ''), item_names),
      payment_status = COALESCE(NULLIF(?, ''), payment_status),
      order_status = COALESCE(NULLIF(?, ''), order_status),
      salesperson = COALESCE(NULLIF(?, ''), salesperson),
      order_handler = COALESCE(NULLIF(?, ''), order_handler),
      commission = COALESCE(?, commission),
      num_items = COALESCE(?, num_items),
      updated_at = datetime('now')
      WHERE business_id = ? AND tracking_number = ?`);

    db.transaction(() => {
      for (const r of rows) {
        const exists = checkStmt.get(business_id, r.tracking_number);
        if (exists) {
          updateStmt.run(r.customer_name, r.phone, r.amount || null, r.item_codes, r.item_names,
            r.payment_status, r.order_status, r.salesperson, r.order_handler, r.commission || null,
            r.num_items || null, business_id, r.tracking_number);
          updated++;
        } else {
          insertStmt.run(business_id, r.tracking_number, r.customer_name || '', r.phone || '', r.address || '',
            r.product || '', r.salesperson || '', r.branch || '', r.order_date || null, r.order_id || null,
            r.amount || null, r.item_codes || null, r.item_names || null, r.payment_status || null,
            r.order_status || null, r.order_handler || null, r.commission || null, r.num_items || null);
          inserted++;
        }
      }
    })();

    const bizName = db.prepare('SELECT name FROM businesses WHERE id = ?').get(business_id)?.name || '';
    db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (?, ?, ?, ?)")
      .run(req.user.id, req.user.name, `Uploaded orders: ${inserted} new, ${updated} updated`, bizName);

    res.json({ inserted, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Parse delivery data
router.post('/parse-delivery', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    const { file_id, business_id, sheet_name, mappings, delivery_status } = req.body;
    if (!file_id || !business_id || !mappings || !sheet_name) return res.status(400).json({ error: 'Missing required fields' });
    if (!mappings.tracking_number) return res.status(400).json({ error: 'Tracking Number mapping is required' });

    const filePath = path.join(__dirname, '..', '..', 'uploads', file_id);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets.find(ws => ws.name === sheet_name);
    if (!worksheet) return res.status(400).json({ error: 'Sheet not found' });

    const rows = parseSheet(worksheet, mappings);
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found' });

    // Check which exist in system
    const trackingNumbers = rows.map(r => r.tracking_number);
    const placeholders = trackingNumbers.map(() => '?').join(',');
    const existing = db.prepare(
      `SELECT tracking_number FROM orders WHERE business_id = ? AND tracking_number IN (${placeholders})`
    ).all(Number(business_id), ...trackingNumbers);
    const existingSet = new Set(existing.map(e => e.tracking_number));

    const matched = rows.filter(r => existingSet.has(r.tracking_number));
    const unmatched = rows.filter(r => !existingSet.has(r.tracking_number));

    res.json({ total: rows.length, matched: matched.length, unmatched: unmatched.length, rows, delivery_status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse' });
  }
});

// Import delivery data — update existing orders + create unmatched
router.post('/import-delivery', authenticate, requireRole('admin', 'issue_handler'), (req, res) => {
  try {
    const { business_id, rows, delivery_status, create_unmatched } = req.body;
    if (!business_id || !rows?.length) return res.status(400).json({ error: 'Missing data' });

    let updated = 0, created = 0, skipped = 0;

    const checkStmt = db.prepare('SELECT id FROM orders WHERE business_id = ? AND tracking_number = ?');
    const updateStmt = db.prepare(`UPDATE orders SET
      status = ?,
      customer_name = COALESCE(NULLIF(?, ''), customer_name),
      phone = COALESCE(NULLIF(?, ''), phone),
      address = COALESCE(NULLIF(?, ''), address),
      product = COALESCE(NULLIF(?, ''), product),
      city = COALESCE(NULLIF(?, ''), city),
      pieces = COALESCE(?, pieces),
      weight = COALESCE(NULLIF(?, ''), weight),
      amount = COALESCE(?, amount),
      exchange = COALESCE(NULLIF(?, ''), exchange),
      reference = COALESCE(NULLIF(?, ''), reference),
      remark = COALESCE(NULLIF(?, ''), remark),
      salesperson = COALESCE(NULLIF(?, ''), salesperson),
      dispatched_at = CASE WHEN ? = 'Dispatched' THEN COALESCE(dispatched_at, datetime('now')) ELSE dispatched_at END,
      updated_at = datetime('now')
      WHERE business_id = ? AND tracking_number = ?`);
    const insertStmt = db.prepare(`INSERT INTO orders (business_id, tracking_number, customer_name, phone, address, product,
      salesperson, branch, city, status, pieces, weight, amount, exchange, reference, remark, dispatched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    db.transaction(() => {
      for (const r of rows) {
        const exists = checkStmt.get(business_id, r.tracking_number);
        if (exists) {
          updateStmt.run(delivery_status, r.customer_name, r.phone, r.address, r.product, r.city,
            r.pieces || null, r.weight, r.amount || null, r.exchange, r.reference, r.remark, r.salesperson,
            delivery_status, business_id, r.tracking_number);
          updated++;
        } else if (create_unmatched) {
          insertStmt.run(business_id, r.tracking_number, r.customer_name || '', r.phone || '', r.address || '',
            r.product || '', r.salesperson || '', r.city || '', r.city || '', delivery_status,
            r.pieces || null, r.weight || null, r.amount || null, r.exchange || null, r.reference || null,
            r.remark || null, delivery_status === 'Dispatched' ? new Date().toISOString() : null);
          created++;
        } else {
          skipped++;
        }
      }
    })();

    const bizName = db.prepare('SELECT name FROM businesses WHERE id = ?').get(business_id)?.name || '';
    db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (?, ?, ?, ?)")
      .run(req.user.id, req.user.name,
        `Delivery update (${delivery_status}): ${updated} updated, ${created} created, ${skipped} skipped`, bizName);

    res.json({ updated, created, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Helper: parse worksheet rows using mapping
function parseSheet(worksheet, mappings) {
  const headerRow = worksheet.getRow(1);
  const colToField = {};
  headerRow.eachCell((cell, colNumber) => {
    const headerName = String(cell.value || '').trim();
    for (const [fieldKey, excelCol] of Object.entries(mappings)) {
      if (excelCol === headerName) colToField[colNumber] = fieldKey;
    }
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    for (const [colNum, fieldKey] of Object.entries(colToField)) {
      const val = row.getCell(Number(colNum)).value;
      if (val != null) {
        record[fieldKey] = typeof val === 'object' && val.text ? val.text : String(val).trim();
      } else {
        record[fieldKey] = '';
      }
    }
    if (record.tracking_number) rows.push(record);
  });
  return rows;
}

module.exports = router;
