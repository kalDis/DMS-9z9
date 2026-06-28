const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await query(`SELECT b.*, (SELECT COUNT(*) FROM user_businesses ub WHERE ub.business_id = b.id) as user_count FROM businesses b ORDER BY b.name`);
    } else {
      result = await query(`SELECT b.*, (SELECT COUNT(*) FROM user_businesses ub WHERE ub.business_id = b.id) as user_count FROM businesses b JOIN user_businesses ub ON b.id = ub.business_id WHERE ub.user_id = $1 ORDER BY b.name`, [req.user.id]);
    }
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, contact_person, contact_phone, sms_sender_id, default_branch, domex_api_key, domex_customer_code, domex_sender_name, domex_sender_address, domex_sender_phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Business name required' });

    const result = await query(
      `INSERT INTO businesses (name, contact_person, contact_phone, sms_sender_id, default_branch, domex_api_key, domex_customer_code, domex_sender_name, domex_sender_address, domex_sender_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, contact_person||null, contact_phone||null, sms_sender_id||null, default_branch||null, domex_api_key||null, domex_customer_code||null, domex_sender_name||null, domex_sender_address||null, domex_sender_phone||null]
    );
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, `Created business ${name}`, name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Business name already exists' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, contact_person, contact_phone, sms_sender_id, default_branch, status, domex_api_key, domex_customer_code, domex_sender_name, domex_sender_address, domex_sender_phone } = req.body;
    const result = await query(
      `UPDATE businesses SET name=COALESCE($1,name), contact_person=COALESCE($2,contact_person), contact_phone=COALESCE($3,contact_phone), sms_sender_id=COALESCE($4,sms_sender_id), default_branch=COALESCE($5,default_branch), status=COALESCE($6,status), domex_api_key=COALESCE($7,domex_api_key), domex_customer_code=COALESCE($8,domex_customer_code), domex_sender_name=COALESCE($9,domex_sender_name), domex_sender_address=COALESCE($10,domex_sender_address), domex_sender_phone=COALESCE($11,domex_sender_phone), updated_at=NOW() WHERE id=$12 RETURNING *`,
      [name, contact_person, contact_phone, sms_sender_id, default_branch, status, domex_api_key, domex_customer_code, domex_sender_name, domex_sender_address, domex_sender_phone, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Business not found' });
    const action = status ? `${status==='active'?'Activated':'Deactivated'} business ${result.rows[0].name}` : `Updated business ${result.rows[0].name}`;
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, action, result.rows[0].name]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
