const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { syncOrders, syncSelectedOrders, detectCouriers, getSyncStatus, getTrackingStatus, getWaybillDetails } = require('../services/domex-sync');
const { query } = require('../config/db');

const router = express.Router();

router.get('/status', authenticate, async (req, res) => {
  res.json(await getSyncStatus());
});

router.post('/trigger', authenticate, async (req, res) => {
  const status = await getSyncStatus();
  if (status.status === 'syncing') {
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
    const biz = (await query('SELECT domex_api_key, domex_customer_code FROM businesses WHERE id=$1', [req.params.businessId])).rows[0];
    if (!biz?.domex_api_key) return res.status(400).json({ error: 'Domex API not configured' });
    const result = await getTrackingStatus(biz.domex_api_key, biz.domex_customer_code, req.params.trackingNo);
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch status' }); }
});

router.post('/test-connection', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { api_key, customer_code } = req.body;
    if (!api_key || !customer_code) return res.status(400).json({ error: 'API key and customer code required' });
    const result = await getTrackingStatus(api_key, customer_code, 'TEST000');
    if (result.status === 200 || result.status === 404 || result.status === 400) {
      res.json({ success: true, message: 'Connection successful' });
    } else {
      res.json({ success: false, message: 'Connection failed', details: result.data });
    }
  } catch (err) { res.status(500).json({ success: false, message: 'Connection failed: ' + err.message }); }
});

module.exports = router;
