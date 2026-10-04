const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { syncOrders, syncSelectedOrders, detectCouriers, getSyncStatus, getTrackingStatus, getWaybillDetails, getDomexToken } = require('../services/domex-sync');
const { query } = require('../config/db');

const router = express.Router();

router.get('/status', authenticate, async (req, res) => {
  res.json(await getSyncStatus());
});

router.post('/trigger', authenticate, async (req, res) => {
  const status = await getSyncStatus();
  // A live sync bumps last_sync after every batch (seconds apart). If it's been >3 min
  // with no update the previous run died (e.g. a deploy restarted the container mid-sync)
  // and left the row stuck on 'syncing' — treat that as stale so a new sync can start.
  const sinceMs = status.last_sync ? Date.now() - new Date(status.last_sync).getTime() : Infinity;
  const stale = sinceMs > 3 * 60 * 1000;
  if (status.status === 'syncing' && !stale) {
    return res.json({ message: 'Sync already in progress', ...status });
  }
  // Respond immediately, run sync in background
  res.json({ message: 'Sync started', status: 'syncing', last_sync: status.last_sync });
  syncOrders().catch(err => console.error('Background sync error:', err));
});

router.post('/detect-courier', authenticate, async (req, res) => {
  try {
    const { order_ids } = req.body;
    if (!Array.isArray(order_ids) || !order_ids.length) return res.status(400).json({ error: 'order_ids required' });
    const result = await detectCouriers(order_ids);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Detection failed' }); }
});

router.post('/selected', authenticate, async (req, res) => {
  try {
    const { order_ids } = req.body;
    if (!Array.isArray(order_ids) || !order_ids.length) return res.status(400).json({ error: 'order_ids required' });
    const result = await syncSelectedOrders(order_ids);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sync failed' }); }
});

router.get('/track/:businessId/:trackingNo', authenticate, async (req, res) => {
  try {
    const row = (await query('SELECT id, domex_api_key, domex_username, domex_password FROM businesses WHERE id=$1', [req.params.businessId])).rows[0];
    if (!row?.domex_api_key) return res.status(400).json({ error: 'Domex API not configured' });
    const result = await getTrackingStatus(row, req.params.trackingNo);
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch status' }); }
});

// Verify Domex credentials by logging in for a token (new token-based API).
router.post('/test-connection', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { api_key, username, password } = req.body;
    if (!api_key || !username || !password) return res.status(400).json({ error: 'API key, username and password are required' });
    // Use a throwaway cache id so this doesn't collide with a real business token
    const token = await getDomexToken({ id: `__test__${Date.now()}`, domex_api_key: api_key, domex_username: username, domex_password: password }, true);
    if (token) res.json({ success: true, message: 'Connection successful — token received' });
    else res.json({ success: false, message: 'Login failed — check the API key, username and password' });
  } catch (err) { res.status(500).json({ success: false, message: 'Connection failed: ' + err.message }); }
});

module.exports = router;
