const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : path.join(__dirname, '..', '..', 'uploads');
try { require('fs').mkdirSync(uploadDir, { recursive: true }); } catch {}
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

// Admins manage any business; issue_handlers only their assigned businesses.
async function canManageBusiness(req, businessId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'issue_handler') return false;
  const row = (await query('SELECT 1 FROM user_businesses WHERE user_id = $1 AND business_id = $2', [req.user.id, businessId])).rows[0];
  return !!row;
}

router.get('/resolution-options/:businessId', authenticate, async (req, res) => {
  try {
    const rows = (await query('SELECT * FROM resolution_options WHERE business_id = $1 ORDER BY sort_order, id', [req.params.businessId])).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/resolution-options/:businessId', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    if (!(await canManageBusiness(req, req.params.businessId))) return res.status(403).json({ error: 'Not allowed for this business' });
    const { label, action = 'resolve' } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });
    const maxOrder = (await query('SELECT MAX(sort_order) as mx FROM resolution_options WHERE business_id = $1', [req.params.businessId])).rows[0];
    const result = await query('INSERT INTO resolution_options (business_id, label, action, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [req.params.businessId, label, action, (maxOrder?.mx||0)+1]);
    res.json({ id: result.rows[0]?.id || result.lastId, label, action });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/resolution-options/:id', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    const opt = (await query('SELECT business_id FROM resolution_options WHERE id = $1', [req.params.id])).rows[0];
    if (!opt) return res.status(404).json({ error: 'Option not found' });
    if (!(await canManageBusiness(req, opt.business_id))) return res.status(403).json({ error: 'Not allowed for this business' });
    const { label, action, is_active, sort_order } = req.body;
    await query('UPDATE resolution_options SET label=COALESCE($1,label), action=COALESCE($2,action), is_active=COALESCE($3,is_active), sort_order=COALESCE($4,sort_order) WHERE id=$5', [label, action, is_active, sort_order, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/resolution-options/:id', authenticate, requireRole('admin', 'issue_handler'), async (req, res) => {
  try {
    const opt = (await query('SELECT business_id FROM resolution_options WHERE id = $1', [req.params.id])).rows[0];
    if (!opt) return res.status(404).json({ error: 'Option not found' });
    if (!(await canManageBusiness(req, opt.business_id))) return res.status(403).json({ error: 'Not allowed for this business' });
    await query('DELETE FROM resolution_options WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Auto-Return feedback text (per business) — the wording used in the export
// for auto-returned orders instead of the default "Auto-Return".
router.get('/auto-return/:businessId', authenticate, async (req, res) => {
  try {
    const row = (await query('SELECT auto_return_feedback FROM businesses WHERE id = $1', [req.params.businessId])).rows[0];
    res.json({ auto_return_feedback: row?.auto_return_feedback || 'Dawas Dekak Balala Return Karanna' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/auto-return/:businessId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { auto_return_feedback } = req.body;
    if (!auto_return_feedback || !String(auto_return_feedback).trim()) return res.status(400).json({ error: 'Feedback text required' });
    await query('UPDATE businesses SET auto_return_feedback = $1, updated_at = NOW() WHERE id = $2', [String(auto_return_feedback).trim(), req.params.businessId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// --- Product master (per business) ---
router.get('/products/:businessId', authenticate, async (req, res) => {
  try {
    const rows = (await query('SELECT product_sku, product_name, variant_sku, price FROM products WHERE business_id = $1 ORDER BY product_sku', [req.params.businessId])).rows;
    res.json({ count: rows.length, products: rows });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Upload the product catalog Excel — full replace for that business.
// Expected columns (fuzzy): Product SKU, Product Name, Variant SKU, Price.
router.post('/products/:businessId', authenticate, requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const businessId = Number(req.params.businessId);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(req.file.path);
    const ws = wb.worksheets[0];

    // Locate columns by fuzzy header match
    let headerRow = 1, cProductSku = null, cProductName = null, cVariantSku = null, cPrice = null, cCost = null;
    for (let r = 1; r <= 5; r++) {
      let found = false;
      ws.getRow(r).eachCell((cell, col) => {
        const v = String(cell.value || '').trim().toLowerCase();
        if (v.includes('product') && v.includes('sku')) { cProductSku = col; found = true; }
        if (v.includes('product') && v.includes('name')) { cProductName = col; found = true; }
        if (v.includes('variant') && v.includes('sku')) { cVariantSku = col; found = true; }
        if (v.includes('cost')) cCost = col;               // "Unit cost" / "Cost"
        else if (v.includes('price')) cPrice = col;
      });
      if (found) { headerRow = r; break; }
    }
    if (!cProductSku || !cProductName) return res.status(400).json({ error: 'Could not find "Product SKU" and "Product Name" columns' });

    const rows = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sku = String(row.getCell(cProductSku).value || '').trim();
      const name = String(row.getCell(cProductName).value || '').trim();
      if (!sku || !name) continue;
      const vsku = cVariantSku ? String(row.getCell(cVariantSku).value || '').trim() : null;
      const numOr = (col) => { if (!col) return null; const n = Number(String(row.getCell(col).value || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; };
      rows.push({ sku, name, vsku, price: numOr(cPrice), cost: numOr(cCost) });
    }
    if (!rows.length) return res.status(400).json({ error: 'No product rows found' });

    // Full replace for this business
    await query('DELETE FROM products WHERE business_id = $1', [businessId]);
    for (const p of rows) {
      await query('INSERT INTO products (business_id, product_sku, product_name, variant_sku, price) VALUES ($1,$2,$3,$4,$5)', [businessId, p.sku, p.name, p.vsku || null, p.price]);
    }

    // If the file also carries a cost column, refresh product costs from the same file
    let costsImported = 0;
    if (cCost) {
      await query('DELETE FROM product_costs WHERE business_id = $1', [businessId]);
      for (const p of rows) {
        if (p.cost == null) continue;
        await query('INSERT INTO product_costs (business_id, code, name, cost) VALUES ($1,$2,$3,$4)', [businessId, p.sku, p.name, p.cost]);
        costsImported++;
      }
    }

    const bizName = (await query('SELECT name FROM businesses WHERE id=$1', [businessId])).rows[0]?.name || '';
    await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Uploaded product master: ${rows.length} products${costsImported ? `, ${costsImported} costs` : ''}`, bizName]);
    res.json({ imported: rows.length, costs_imported: costsImported });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to process file' }); }
});

// --- Product avg cost (per business, separate from the product master) ---
router.get('/product-costs/:businessId', authenticate, async (req, res) => {
  try {
    const rows = (await query('SELECT code, name, cost, weight FROM product_costs WHERE business_id = $1 ORDER BY code', [req.params.businessId])).rows;
    res.json({ count: rows.length, costs: rows });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Upload the cost sheet Excel — full replace. Columns (fuzzy): Code, Name, Unit cost, Weight.
router.post('/product-costs/:businessId', authenticate, requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const businessId = Number(req.params.businessId);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(req.file.path);
    const ws = wb.worksheets[0];

    let headerRow = 1, cCode = null, cName = null, cCost = null, cWeight = null;
    for (let r = 1; r <= 5; r++) {
      let found = false;
      ws.getRow(r).eachCell((cell, col) => {
        const v = String(cell.value || '').trim().toLowerCase();
        if (v === 'code' || (v.includes('code') && !v.includes('sup'))) { cCode = col; found = true; }
        if (v.includes('cost')) { cCost = col; found = true; }
        if (v === 'name' || v.includes('product name')) cName = col;
        if (v.includes('weight')) cWeight = col;
      });
      if (found && cCode) { headerRow = r; break; }
    }
    if (!cCode || !cCost) return res.status(400).json({ error: 'Could not find "Code" and "Unit cost" columns' });

    const rows = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = String(row.getCell(cCode).value || '').trim();
      if (!code) continue;
      const costRaw = String(row.getCell(cCost).value || '').replace(/[^0-9.]/g, '');
      const cost = costRaw ? Number(costRaw) : null;
      if (cost == null || isNaN(cost)) continue; // skip rows with no cost
      const name = cName ? String(row.getCell(cName).value || '').trim() : null;
      let weight = null; if (cWeight) { const w = Number(String(row.getCell(cWeight).value || '').replace(/[^0-9.]/g, '')); if (!isNaN(w)) weight = w; }
      rows.push({ code, name, cost, weight });
    }
    if (!rows.length) return res.status(400).json({ error: 'No cost rows found' });

    await query('DELETE FROM product_costs WHERE business_id = $1', [businessId]);
    for (const p of rows) {
      await query('INSERT INTO product_costs (business_id, code, name, cost, weight) VALUES ($1,$2,$3,$4,$5)', [businessId, p.code, p.name, p.cost, p.weight]);
    }
    const bizName = (await query('SELECT name FROM businesses WHERE id=$1', [businessId])).rows[0]?.name || '';
    await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Uploaded product costs: ${rows.length} products`, bizName]);
    res.json({ imported: rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to process file' }); }
});

module.exports = router;
