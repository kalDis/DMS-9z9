const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/resolution-options/:businessId', authenticate, async (req, res) => {
  try {
    const rows = (await query('SELECT * FROM resolution_options WHERE business_id = $1 ORDER BY sort_order, id', [req.params.businessId])).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/resolution-options/:businessId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { label, action = 'resolve' } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });
    const maxOrder = (await query('SELECT MAX(sort_order) as mx FROM resolution_options WHERE business_id = $1', [req.params.businessId])).rows[0];
    const result = await query('INSERT INTO resolution_options (business_id, label, action, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [req.params.businessId, label, action, (maxOrder?.mx||0)+1]);
    res.json({ id: result.rows[0]?.id || result.lastId, label, action });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/resolution-options/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { label, action, is_active, sort_order } = req.body;
    await query('UPDATE resolution_options SET label=COALESCE($1,label), action=COALESCE($2,action), is_active=COALESCE($3,is_active), sort_order=COALESCE($4,sort_order) WHERE id=$5', [label, action, is_active, sort_order, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/resolution-options/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM resolution_options WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
