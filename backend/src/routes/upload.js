const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : path.join(__dirname, '..', '..', 'uploads');
try { require('fs').mkdirSync(uploadDir, { recursive: true }); } catch {}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, fileFilter: (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  ['.xlsx','.xls','.csv'].includes(ext) ? cb(null, true) : cb(new Error('Only .xlsx, .xls, .csv allowed'));
}, limits: { fileSize: 10*1024*1024 } });

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

router.get('/mapping/:businessId/:type', authenticate, async (req, res) => {
  const row = (await query('SELECT mappings FROM column_mappings WHERE business_id = $1', [req.params.businessId])).rows[0];
  let mappings = null;
  if (row) {
    const all = typeof row.mappings === 'string' ? JSON.parse(row.mappings) : row.mappings;
    mappings = all[req.params.type] || null;
  }
  res.json({ mappings, fields: req.params.type === 'orders' ? ORDER_FIELDS : DELIVERY_FIELDS });
});

router.post('/mapping/:businessId/:type', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  const { mappings } = req.body;
  if (!mappings) return res.status(400).json({ error: 'Mappings required' });
  const existing = (await query('SELECT mappings FROM column_mappings WHERE business_id = $1', [req.params.businessId])).rows[0];
  let all = {};
  if (existing) {
    all = typeof existing.mappings === 'string' ? JSON.parse(existing.mappings) : existing.mappings;
    all[req.params.type] = mappings;
    await query("UPDATE column_mappings SET mappings = $1, updated_at = NOW() WHERE business_id = $2", [JSON.stringify(all), req.params.businessId]);
  } else {
    all[req.params.type] = mappings;
    await query('INSERT INTO column_mappings (business_id, mappings) VALUES ($1, $2)', [req.params.businessId, JSON.stringify(all)]);
  }
  res.json({ success: true });
});

router.post('/headers', authenticate, requireRole('admin','issue_handler'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const workbook = new ExcelJS.Workbook();
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.csv') await workbook.csv.readFile(req.file.path);
    else await workbook.xlsx.readFile(req.file.path);
    const sheets = workbook.worksheets.map(ws => {
      const headers = [];
      ws.getRow(1).eachCell((cell, col) => { const v = String(cell.value||'').trim(); if (v) headers.push({ col, name: v }); });
      return { name: ws.name, headers, row_count: ws.rowCount - 1 };
    });
    res.json({ file_id: req.file.filename, sheets });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to read file' }); }
});

router.post('/parse-orders', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  try {
    const { file_id, business_id, mappings, sheet_name } = req.body;
    if (!file_id || !business_id || !mappings?.tracking_number) return res.status(400).json({ error: 'Missing required fields' });
    const filePath = path.join(uploadDir, file_id);
    const workbook = new ExcelJS.Workbook();
    if (path.extname(file_id).toLowerCase() === '.csv') await workbook.csv.readFile(filePath);
    else await workbook.xlsx.readFile(filePath);
    const worksheet = sheet_name ? workbook.worksheets.find(ws => ws.name === sheet_name) : workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: 'Sheet not found' });
    const rows = parseSheet(worksheet, mappings);
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found' });

    const trackingNumbers = rows.map(r => r.tracking_number);
    const existing = new Set();
    for (const tn of trackingNumbers) {
      const r = (await query('SELECT tracking_number FROM orders WHERE business_id = $1 AND tracking_number = $2', [business_id, tn])).rows[0];
      if (r) existing.add(r.tracking_number);
    }
    res.json({ total: rows.length, new_count: rows.filter(r => !existing.has(r.tracking_number)).length, update_count: rows.filter(r => existing.has(r.tracking_number)).length, rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to parse file' }); }
});

router.post('/import-orders', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  try {
    const { business_id, rows } = req.body;
    if (!business_id || !rows?.length) return res.status(400).json({ error: 'Missing data' });
    let inserted = 0, updated = 0;
    for (const r of rows) {
      const exists = (await query('SELECT id FROM orders WHERE business_id = $1 AND tracking_number = $2', [business_id, r.tracking_number])).rows[0];
      if (exists) {
        await query(`UPDATE orders SET customer_name=COALESCE(NULLIF($1,''),customer_name), phone=COALESCE(NULLIF($2,''),phone), amount=COALESCE($3,amount), item_codes=COALESCE(NULLIF($4,''),item_codes), item_names=COALESCE(NULLIF($5,''),item_names), payment_status=COALESCE(NULLIF($6,''),payment_status), order_status=COALESCE(NULLIF($7,''),order_status), salesperson=COALESCE(NULLIF($8,''),salesperson), order_handler=COALESCE(NULLIF($9,''),order_handler), commission=COALESCE($10,commission), num_items=COALESCE($11,num_items), product=COALESCE(NULLIF($14,''),NULLIF(product,''),NULLIF($5,''),product), updated_at=NOW() WHERE business_id=$12 AND tracking_number=$13`,
          [r.customer_name, r.phone, r.amount||null, r.item_codes, r.item_names, r.payment_status, r.order_status, r.salesperson, r.order_handler, r.commission||null, r.num_items||null, business_id, r.tracking_number, r.product||'']);
        updated++;
      } else {
        await query(`INSERT INTO orders (business_id, tracking_number, customer_name, phone, address, product, salesperson, branch, status, order_date, order_id, amount, item_codes, item_names, payment_status, order_status, order_handler, commission, num_items) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'New',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [business_id, r.tracking_number, r.customer_name||'', r.phone||'', r.address||'', r.product||r.item_names||'', r.salesperson||'', r.branch||'', r.order_date||null, r.order_id||null, r.amount||null, r.item_codes||null, r.item_names||null, r.payment_status||null, r.order_status||null, r.order_handler||null, r.commission||null, r.num_items||null]);
        inserted++;
      }
    }
    const bizName = (await query('SELECT name FROM businesses WHERE id=$1', [business_id])).rows[0]?.name||'';
    await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, `Uploaded orders: ${inserted} new, ${updated} updated`, bizName]);
    res.json({ inserted, updated });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Import failed' }); }
});

router.post('/parse-delivery', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  try {
    const { file_id, business_id, sheet_name, mappings, delivery_status } = req.body;
    if (!file_id || !business_id || !mappings?.tracking_number || !sheet_name) return res.status(400).json({ error: 'Missing required fields' });
    const filePath = path.join(uploadDir, file_id);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets.find(ws => ws.name === sheet_name);
    if (!worksheet) return res.status(400).json({ error: 'Sheet not found' });
    const rows = parseSheet(worksheet, mappings);
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found' });

    let matched = 0, unmatched = 0;
    for (const r of rows) {
      const exists = (await query('SELECT id FROM orders WHERE business_id=$1 AND tracking_number=$2', [business_id, r.tracking_number])).rows[0];
      if (exists) matched++; else unmatched++;
    }
    res.json({ total: rows.length, matched, unmatched, rows, delivery_status });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to parse' }); }
});

router.post('/import-delivery', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  try {
    const { business_id, rows, delivery_status, create_unmatched } = req.body;
    if (!business_id || !rows?.length) return res.status(400).json({ error: 'Missing data' });
    let updated = 0, created = 0, skipped = 0;
    for (const r of rows) {
      const exists = (await query('SELECT id FROM orders WHERE business_id=$1 AND tracking_number=$2', [business_id, r.tracking_number])).rows[0];
      if (exists) {
        await query(`UPDATE orders SET status=CASE WHEN status='New' OR status='Waiting' THEN $1 ELSE status END, customer_name=COALESCE(NULLIF($2,''),customer_name), phone=COALESCE(NULLIF($3,''),phone), address=COALESCE(NULLIF($4,''),address), product=COALESCE(NULLIF($5,''),product), city=COALESCE(NULLIF($6,''),city), pieces=COALESCE($7,pieces), weight=COALESCE(NULLIF($8,''),weight), amount=COALESCE($9,amount), exchange=COALESCE(NULLIF($10,''),exchange), reference=COALESCE(NULLIF($11,''),reference), remark=COALESCE(NULLIF($12,''),remark), salesperson=COALESCE(NULLIF($13,''),salesperson), dispatched_at=CASE WHEN $1='Dispatched' THEN COALESCE(dispatched_at,NOW()) ELSE dispatched_at END, updated_at=NOW() WHERE business_id=$14 AND tracking_number=$15`,
          [delivery_status, r.customer_name, r.phone, r.address, r.product, r.city, r.pieces||null, r.weight, r.amount||null, r.exchange, r.reference, r.remark, r.salesperson, business_id, r.tracking_number]);
        updated++;
      } else if (create_unmatched) {
        await query(`INSERT INTO orders (business_id,tracking_number,customer_name,phone,address,product,salesperson,branch,city,status,pieces,weight,amount,exchange,reference,remark,dispatched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [business_id, r.tracking_number, r.customer_name||'', r.phone||'', r.address||'', r.product||'', r.salesperson||'', r.city||'', r.city||'', delivery_status, r.pieces||null, r.weight||null, r.amount||null, r.exchange||null, r.reference||null, r.remark||null, delivery_status==='Dispatched'?new Date().toISOString():null]);
        created++;
      } else { skipped++; }
    }
    const bizName = (await query('SELECT name FROM businesses WHERE id=$1', [business_id])).rows[0]?.name||'';
    await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Delivery update (${delivery_status}): ${updated} updated, ${created} created, ${skipped} skipped`, bizName]);
    res.json({ updated, created, skipped });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Import failed' }); }
});

function parseSheet(worksheet, mappings) {
  const headerRow = worksheet.getRow(1);
  const colToField = {};
  headerRow.eachCell((cell, col) => {
    const name = String(cell.value||'').trim();
    for (const [key, val] of Object.entries(mappings)) { if (val === name) colToField[col] = key; }
  });
  const rows = [];
  worksheet.eachRow((row, rn) => {
    if (rn === 1) return;
    const record = {};
    for (const [col, key] of Object.entries(colToField)) {
      const v = row.getCell(Number(col)).value;
      record[key] = v != null ? (typeof v === 'object' && v.text ? v.text : String(v).trim()) : '';
    }
    if (record.tracking_number) rows.push(record);
  });
  return rows;
}

module.exports = router;
