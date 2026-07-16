const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { getWaybillDetails, getTrackingStatus, mapDomexStatus } = require('../services/domex-sync');

const router = express.Router();
const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : path.join(__dirname, '..', '..', 'uploads');
try { require('fs').mkdirSync(uploadDir, { recursive: true }); } catch {}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });

// Run an async mapper over items in small batches with a short pause between
// batches, mirroring the Domex sync service so we don't hammer their API.
async function mapBatched(items, fn, size = 10, delay = 200) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const res = await Promise.all(batch.map(fn));
    out.push(...res);
    if (i + size < items.length) await new Promise(r => setTimeout(r, delay));
  }
  return out;
}

// Look up a single tracking number against a business's Domex account and
// return an enriched order record, or null if Domex has no record of it.
async function fetchDomexDetails(biz, trackingNo) {
  const wbRes = await getWaybillDetails(biz.domex_api_key, biz.domex_customer_code, trackingNo);
  if (!(wbRes.status === 200 && wbRes.data && !wbRes.data.errorCode)) return null;
  const wb = wbRes.data;

  let history = [];
  try {
    const statusRes = await getTrackingStatus(biz.domex_api_key, biz.domex_customer_code, trackingNo);
    if (statusRes.status === 200 && Array.isArray(statusRes.data)) history = statusRes.data;
  } catch {}

  // Most recent mappable status (scan backwards, same as sync)
  let status = 'New';
  for (let i = history.length - 1; i >= 0; i--) {
    const m = mapDomexStatus(history[i].statusCode, history[i].status);
    if (m) { status = m; break; }
  }
  let pickupDate = null, deliveredDate = null;
  for (const s of history) {
    if (s.statusCode === 'I' && !pickupDate) pickupDate = s.statusDate;
    if (s.statusCode === 'D' || s.statusCode === 'PS') deliveredDate = s.statusDate;
  }

  return {
    customer_name: wb.receiverName || '',
    phone: wb.receiverContactNo || '',
    address: wb.receiverAddress || '',
    city: wb.receiverCity || '',
    product: wb.packageDesc || '',
    weight: wb.weight ? String(wb.weight) : '',
    amount: wb.value || null,
    pieces: wb.noOfPcs || null,
    exchange: wb.exchange || '',
    status, pickupDate, deliveredDate, history,
  };
}

router.post('/domex-issues', authenticate, requireRole('admin','issue_handler'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.body.business_id) return res.status(400).json({ error: 'Business ID required' });
    const businessId = Number(req.body.business_id);
    // dry_run: report what WOULD happen without writing anything (confirmation step)
    const dryRun = String(req.body.dry_run || '') === 'true';
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(req.file.path);
    const ws = workbook.worksheets[0];

    let headerRow = 1, trackingCol = null, branchCol = null, reasonCol = null;
    for (let r = 1; r <= 5; r++) {
      ws.getRow(r).eachCell((cell, col) => {
        const val = String(cell.value||'').trim().toLowerCase();
        if (val.includes('waybill') || val.includes('tracking')) { trackingCol = col; headerRow = r; }
        // Fuzzy match so variations ("Return Reason", "Domex Branch", trailing spaces) are captured
        if (val.includes('branch')) branchCol = col;
        if (val.includes('reason')) reasonCol = col;
      });
      if (trackingCol) break;
    }
    if (!trackingCol) return res.status(400).json({ error: 'Could not find tracking number column' });

    let added = 0, skipped = 0, updated = 0, notFound = 0;
    const notFoundList = [];

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const tn = String(row.getCell(trackingCol).value||'').trim().toUpperCase();
      if (!tn) continue;
      const reason = reasonCol ? String(row.getCell(reasonCol).value||'').trim() : '';
      const branch = branchCol ? String(row.getCell(branchCol).value||'').trim() : '';

      // Case-insensitive match: issue files sometimes carry lowercase waybills
      // (e.g. "9z9ty..") while orders are stored uppercase ("9Z9TY..").
      const order = (await query('SELECT id FROM orders WHERE business_id=$1 AND UPPER(tracking_number)=UPPER($2)', [businessId, tn])).rows[0];
      if (!order) { notFound++; notFoundList.push({ tracking_number: tn, reason, branch }); continue; }
      // Only an ACTIVE issue blocks a new one — if the previous issue is closed,
      // a fresh Domex flag creates a new issue.
      const existing = (await query("SELECT id, reason, domex_branch FROM delivery_issues WHERE order_id=$1 AND status IN ('open','in_progress') ORDER BY id DESC LIMIT 1", [order.id])).rows[0];
      if (existing) {
        // Backfill reason/branch onto an existing issue that is missing them
        // (lets a re-upload fill in reasons that weren't captured before).
        if ((reason && !existing.reason) || (branch && !existing.domex_branch)) {
          if (!dryRun) await query("UPDATE delivery_issues SET reason = COALESCE(NULLIF(reason,''), $1), domex_branch = COALESCE(NULLIF(domex_branch,''), $2), updated_at = NOW() WHERE id = $3", [reason||null, branch||null, existing.id]);
          updated++;
        } else { skipped++; }
        continue;
      }
      if (!dryRun) await query("INSERT INTO delivery_issues (order_id,business_id,source,status,attempt,reason,domex_branch) VALUES ($1,$2,'domex','open',0,$3,$4)", [order.id, businessId, reason||null, branch||null]);
      added++;
    }

    if (!dryRun) {
      const bizName = (await query('SELECT name FROM businesses WHERE id=$1', [businessId])).rows[0]?.name||'';
      await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)',
        [req.user.id, req.user.name, `Uploaded Domex issues: ${added} added, ${updated} updated, ${skipped} already, ${notFound} not found`, bizName]);
    }
    res.json({ dry_run: dryRun, added, updated, skipped, not_found: notFound, not_found_list: notFoundList });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to process file' }); }
});

// Phase 1 — Look up "not found" waybills against Domex to identify them.
// Read-only: creates nothing, just returns a preview split into resolvable
// (Domex has a record we can rebuild an order from) and unresolvable.
router.post('/domex-issues/resolve', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  try {
    const businessId = Number(req.body.business_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!businessId) return res.status(400).json({ error: 'Business ID required' });
    if (!items.length) return res.json({ resolved: [], unresolved: [] });

    const biz = (await query('SELECT id, name, domex_api_key, domex_customer_code FROM businesses WHERE id=$1', [businessId])).rows[0];
    if (!biz || !biz.domex_api_key) return res.status(400).json({ error: 'Business has no Domex API configured' });

    const enriched = await mapBatched(items, async (item) => {
      const tn = String(item.tracking_number || '').trim().toUpperCase();
      if (!tn) return null;
      const base = { tracking_number: tn, reason: item.reason || '', branch: item.branch || '' };
      try {
        const d = await fetchDomexDetails(biz, tn);
        if (!d) return { ...base, resolved: false };
        return {
          ...base, resolved: true,
          customer_name: d.customer_name, phone: d.phone, city: d.city,
          address: d.address, product: d.product, status: d.status,
        };
      } catch {
        return { ...base, resolved: false };
      }
    });

    const resolved = enriched.filter(e => e && e.resolved);
    const unresolved = enriched.filter(e => e && !e.resolved);
    res.json({ resolved, unresolved });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to resolve missing waybills' }); }
});

// Phase 2 — Create the orders + issues for confirmed waybills. Re-fetches
// each waybill from Domex (single source of truth) and skips anything Domex
// can no longer resolve. Safe to re-run: existing orders/issues are skipped.
router.post('/domex-issues/import', authenticate, requireRole('admin','issue_handler'), async (req, res) => {
  try {
    const businessId = Number(req.body.business_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!businessId) return res.status(400).json({ error: 'Business ID required' });
    if (!items.length) return res.json({ created: 0, skipped: 0, failed: 0 });

    const biz = (await query('SELECT id, name, domex_api_key, domex_customer_code FROM businesses WHERE id=$1', [businessId])).rows[0];
    if (!biz || !biz.domex_api_key) return res.status(400).json({ error: 'Business has no Domex API configured' });

    let created = 0, skipped = 0, failed = 0;

    for (const item of items) {
      const tn = String(item.tracking_number || '').trim().toUpperCase();
      if (!tn) { failed++; continue; }
      try {
        let order = (await query('SELECT id FROM orders WHERE business_id=$1 AND UPPER(tracking_number)=UPPER($2)', [businessId, tn])).rows[0];

        if (!order) {
          const d = await fetchDomexDetails(biz, tn);
          if (!d) { failed++; continue; }
          const ins = await query(
            `INSERT INTO orders (business_id, tracking_number, customer_name, phone, address, city, product, branch, status, amount, pieces, weight, exchange, pickup_date, delivered_date, courier)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'domex') RETURNING id`,
            [businessId, tn, d.customer_name || 'Unknown', d.phone || '', d.address || '', d.city || '',
             d.product || '', item.branch || '', d.status, d.amount, d.pieces, d.weight, d.exchange, d.pickupDate, d.deliveredDate]
          );
          order = ins.rows[0];

          for (const s of d.history) {
            const location = (s.status || '').replace(/^.*By\s+/i, '').trim();
            try {
              await query(
                `INSERT INTO delivery_statuses (order_id, status_code, status_text, location, remark, status_date) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id, status_code, status_date) DO NOTHING`,
                [order.id, s.statusCode, s.status, location, s.remark || '', s.statusDate]
              );
            } catch {}
          }
        }

        const existingIssue = (await query("SELECT id FROM delivery_issues WHERE order_id=$1 AND status IN ('open','in_progress')", [order.id])).rows[0];
        if (existingIssue) { skipped++; continue; }
        await query("INSERT INTO delivery_issues (order_id,business_id,source,status,attempt,reason,domex_branch) VALUES ($1,$2,'domex','open',0,$3,$4)",
          [order.id, businessId, item.reason || null, item.branch || null]);
        created++;
      } catch (e) {
        console.error('Import missing order failed', tn, e.message);
        failed++;
      }
    }

    await query('INSERT INTO audit_logs (user_id,user_name,action,business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Imported ${created} missing Domex orders + issues (${skipped} existing, ${failed} failed)`, biz.name]);
    res.json({ created, skipped, failed });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to import missing orders' }); }
});

module.exports = router;
