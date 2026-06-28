const express = require('express');
const { db } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { search, date_from, date_to, limit = 50 } = req.query;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(action LIKE ? OR user_name LIKE ? OR business_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (date_from) {
      conditions.push("date(created_at) >= ?");
      params.push(date_from);
    }
    if (date_to) {
      conditions.push("date(created_at) <= ?");
      params.push(date_to);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, Number(limit));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
