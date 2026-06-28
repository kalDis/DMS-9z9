const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = query('SELECT id, name, email, password_hash, role, status FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status === 'inactive') return res.status(403).json({ error: 'Account deactivated' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    let allBusinesses;
    if (user.role === 'admin') {
      allBusinesses = query("SELECT id, name FROM businesses WHERE status = 'active' ORDER BY name").rows;
    } else {
      allBusinesses = query(
        "SELECT b.id, b.name FROM businesses b JOIN user_businesses ub ON b.id = ub.business_id WHERE ub.user_id = $1 AND b.status = 'active'",
        [user.id]
      ).rows;
    }

    query("UPDATE users SET last_login = datetime('now') WHERE id = $1", [user.id]);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      businesses: allBusinesses,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authenticate, (req, res) => {
  try {
    const result = query('SELECT id, name, email, role, status FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });

    const businesses = req.user.role === 'admin'
      ? query("SELECT id, name FROM businesses WHERE status = 'active' ORDER BY name").rows
      : query("SELECT b.id, b.name FROM businesses b JOIN user_businesses ub ON b.id = ub.business_id WHERE ub.user_id = $1 AND b.status = 'active'", [req.user.id]).rows;

    res.json({ user: result.rows[0], businesses });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
