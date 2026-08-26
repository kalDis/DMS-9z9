const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
