const express = require('express');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const users = (await query('SELECT id, name, email, role, status, last_login, created_at FROM users ORDER BY name')).rows;
    for (const u of users) {
      u.businesses = (await query('SELECT b.id, b.name FROM businesses b JOIN user_businesses ub ON b.id = ub.business_id WHERE ub.user_id = $1', [u.id])).rows;
    }
    res.json(users);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, role, business_ids } = req.body;
    if (!name || !email || !role) return res.status(400).json({ error: 'Name, email, and role required' });

    const tempPassword = 'TMP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const hash = await bcrypt.hash(tempPassword, 10);

    const result = await query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role', [name, email, hash, role]);
    const userId = result.rows[0].id;

    if (business_ids?.length) {
      for (const bid of business_ids) {
        await query('INSERT INTO user_businesses (user_id, business_id) VALUES ($1,$2)', [userId, bid]);
      }
    }

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, `Created user ${name}`, 'System']);
    res.status(201).json({ ...result.rows[0], temp_password: tempPassword });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, role, status, business_ids } = req.body;
    const current = (await query('SELECT * FROM users WHERE id = $1', [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ error: 'User not found' });

    await query('UPDATE users SET name=$1, role=$2, status=$3, updated_at=NOW() WHERE id=$4',
      [name || current.name, role || current.role, status || current.status, req.params.id]);

    if (business_ids) {
      await query('DELETE FROM user_businesses WHERE user_id = $1', [req.params.id]);
      for (const bid of business_ids) {
        await query('INSERT INTO user_businesses (user_id, business_id) VALUES ($1,$2)', [req.params.id, bid]);
      }
    }

    const action = status ? `${status==='active'?'Activated':'Deactivated'} user ${current.name}` : `Updated user ${current.name}`;
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, action, 'System']);
    res.json({ id: Number(req.params.id), name: name||current.name, email: current.email, role: role||current.role, status: status||current.status });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const tempPassword = 'TMP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const hash = await bcrypt.hash(tempPassword, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, `Reset password for user ID ${req.params.id}`, 'System']);
    res.json({ temp_password: tempPassword });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
