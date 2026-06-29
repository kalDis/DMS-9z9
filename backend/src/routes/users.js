const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendCredentialsEmail } = require('../services/email');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const users = (await query('SELECT id, name, email, role, status, last_login, must_change_password, created_at FROM users ORDER BY name')).rows;
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

    const result = await query('INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,1) RETURNING id, name, email, role', [name, email, hash, role]);
    const userId = result.rows[0].id;

    if (business_ids?.length) {
      for (const bid of business_ids) {
        await query('INSERT INTO user_businesses (user_id, business_id) VALUES ($1,$2)', [userId, bid]);
      }
    }

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, `Created user ${name}`, 'System']);

    // Send email in background (don't block response)
    const loginUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/login` : 'http://localhost:3001/login';
    sendCredentialsEmail(email, name, tempPassword, loginUrl).catch(() => {});

    res.status(201).json({ ...result.rows[0], temp_password: tempPassword, email_sent: !!process.env.SMTP_USER });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, role, status, business_ids } = req.body;
    const current = (await query('SELECT * FROM users WHERE id = $1', [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ error: 'User not found' });

    await query('UPDATE users SET name=$1, email=$2, role=$3, status=$4, updated_at=NOW() WHERE id=$5',
      [name || current.name, email || current.email, role || current.role, status || current.status, req.params.id]);

    if (business_ids) {
      await query('DELETE FROM user_businesses WHERE user_id = $1', [req.params.id]);
      for (const bid of business_ids) {
        await query('INSERT INTO user_businesses (user_id, business_id) VALUES ($1,$2)', [req.params.id, bid]);
      }
    }

    const action = status && status !== current.status
      ? `${status === 'active' ? 'Activated' : 'Deactivated'} user ${current.name}`
      : `Updated user ${name || current.name}`;
    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.name, action, 'System']);

    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const user = (await query('SELECT name, email FROM users WHERE id = $1', [req.params.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tempPassword = 'TMP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const hash = await bcrypt.hash(tempPassword, 10);
    await query('UPDATE users SET password_hash = $1, must_change_password = 1 WHERE id = $2', [hash, req.params.id]);

    const loginUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/login` : 'http://localhost:3001/login';
    sendCredentialsEmail(user.email, user.name, tempPassword, loginUrl).catch(() => {});

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Reset password for ${user.name}`, 'System']);

    res.json({ temp_password: tempPassword, email_sent: !!process.env.SMTP_USER });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Delete user
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = (await query('SELECT name FROM users WHERE id = $1', [req.params.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    await query('DELETE FROM user_businesses WHERE user_id = $1', [req.params.id]);
    await query('DELETE FROM users WHERE id = $1', [req.params.id]);

    await query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, `Deleted user ${user.name}`, 'System']);

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Change own password
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const user = (await query('SELECT password_hash, must_change_password FROM users WHERE id = $1', [req.user.id])).rows[0];

    // If must change password, don't require current password
    if (!user.must_change_password) {
      if (!current_password) return res.status(400).json({ error: 'Current password required' });
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2', [hash, req.user.id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
