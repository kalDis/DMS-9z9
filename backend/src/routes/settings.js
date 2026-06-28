const express = require('express');
const { db } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get resolution options for a business
router.get('/resolution-options/:businessId', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM resolution_options WHERE business_id = ? ORDER BY sort_order, id').all(req.params.businessId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a resolution option
router.post('/resolution-options/:businessId', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { label, action = 'resolve' } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) as mx FROM resolution_options WHERE business_id = ?').get(req.params.businessId);
    const result = db.prepare(
      'INSERT INTO resolution_options (business_id, label, action, sort_order) VALUES (?, ?, ?, ?)'
    ).run(req.params.businessId, label, action, (maxOrder?.mx || 0) + 1);

    res.json({ id: result.lastInsertRowid, label, action });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a resolution option
router.put('/resolution-options/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { label, action, is_active, sort_order } = req.body;
    db.prepare(
      'UPDATE resolution_options SET label = COALESCE(?, label), action = COALESCE(?, action), is_active = COALESCE(?, is_active), sort_order = COALESCE(?, sort_order) WHERE id = ?'
    ).run(label, action, is_active, sort_order, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a resolution option
router.delete('/resolution-options/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    db.prepare('DELETE FROM resolution_options WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
