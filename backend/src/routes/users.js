const express = require('express');
const bcrypt = require('bcryptjs');
const { query, db } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), (req, res) => {
  try {
    const users = db.prepare(`SELECT id, name, email, role, status, last_login, created_at FROM users ORDER BY name`).all();
    for (const u of users) {
      const bizsRaw = db.prepare('SELECT b.id, b.name FROM businesses b JOIN user_businesses ub ON b.id = ub.business_id WHERE ub.user_id = ?').all(u.id);
      u.businesses = bizsRaw;
    }
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, role, business_ids } = req.body;
    if (!name || !email || !role) return res.status(400).json({ error: 'Name, email, and role required' });

    const tempPassword = 'TMP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const hash = await bcrypt.hash(tempPassword, 10);

    const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, hash, role);
    const userId = info.lastInsertRowid;

    if (business_ids?.length) {
      const stmt = db.prepare('INSERT INTO user_businesses (user_id, business_id) VALUES (?, ?)');
      for (const bid of business_ids) stmt.run(userId, bid);
    }

    query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.name, `Created user ${name}`, 'System']);

    res.status(201).json({ id: userId, name, email, role, temp_password: tempPassword });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { name, role, status, business_ids } = req.body;

    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'User not found' });

    db.prepare('UPDATE users SET name = ?, role = ?, status = ?, updated_at = datetime(?) WHERE id = ?')
      .run(name || current.name, role || current.role, status || current.status, 'now', req.params.id);

    if (business_ids) {
      db.prepare('DELETE FROM user_businesses WHERE user_id = ?').run(req.params.id);
      const stmt = db.prepare('INSERT INTO user_businesses (user_id, business_id) VALUES (?, ?)');
      for (const bid of business_ids) stmt.run(req.params.id, bid);
    }

    const action = status ? `${status === 'active' ? 'Activated' : 'Deactivated'} user ${current.name}` : `Updated user ${current.name}`;
    query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.name, action, 'System']);

    res.json({ id: Number(req.params.id), name: name || current.name, email: current.email, role: role || current.role, status: status || current.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const tempPassword = 'TMP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const hash = await bcrypt.hash(tempPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);

    query('INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.name, `Reset password for user ID ${req.params.id}`, 'System']);

    res.json({ temp_password: tempPassword });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
