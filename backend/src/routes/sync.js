const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { syncOrders, getSyncStatus, getTrackingStatus, getWaybillDetails } = require('../services/domex-sync');
const { db } = require('../config/db');

const router = express.Router();

router.get('/status', authenticate, (req, res) => {
  res.json(getSyncStatus());
});

router.post('/trigger', authenticate, async (req, res) => {
  try {
    const result = await syncOrders();
    res.json({ message: 'Sync completed', ...result, ...getSyncStatus() });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', ...getSyncStatus() });
  }
});

// Check single tracking number status from Domex
router.get('/track/:businessId/:trackingNo', authenticate, async (req, res) => {
  try {
    const biz = db.prepare('SELECT domex_api_key, domex_customer_code FROM businesses WHERE id = ?').get(req.params.businessId);
    if (!biz?.domex_api_key) return res.status(400).json({ error: 'Domex API not configured for this business' });

    const result = await getTrackingStatus(biz.domex_api_key, biz.domex_customer_code, req.params.trackingNo);
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status from Domex' });
  }
});

// Get waybill details from Domex
router.get('/waybill/:businessId/:trackingNo', authenticate, async (req, res) => {
  try {
    const biz = db.prepare('SELECT domex_api_key, domex_customer_code FROM businesses WHERE id = ?').get(req.params.businessId);
    if (!biz?.domex_api_key) return res.status(400).json({ error: 'Domex API not configured for this business' });

    const result = await getWaybillDetails(biz.domex_api_key, biz.domex_customer_code, req.params.trackingNo);
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch waybill from Domex' });
  }
});

// Test Domex API connection for a business
router.post('/test-connection', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { api_key, customer_code } = req.body;
    if (!api_key || !customer_code) return res.status(400).json({ error: 'API key and customer code required' });

    const result = await getTrackingStatus(api_key, customer_code, 'TEST000');
    // 404 = connection works but no tracking found (expected), 400 = validation, 200 = works
    if (result.status === 200 || result.status === 404) {
      res.json({ success: true, message: 'Connection successful' });
    } else if (result.status === 400) {
      res.json({ success: true, message: 'Connection successful (validation response)' });
    } else {
      res.json({ success: false, message: 'Connection failed', details: result.data });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Connection failed: ' + err.message });
  }
});

module.exports = router;
