const express = require('express');
const { query } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { search, date_from, date_to, limit = 50 } = req.query;
    const conditions = [];
    const params = [];
    let pIdx = 0;
    const p = () => `$${++pIdx}`;

    if (search) { conditions.push(`(action ILIKE ${p()} OR user_name ILIKE ${p()} OR business_name ILIKE ${p()})`); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (date_from) { conditions.push(`date(created_at) >= ${p()}`); params.push(date_from); }
    if (date_to) { conditions.push(`date(created_at) <= ${p()}`); params.push(date_to); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(Number(limit));
    const rows = (await query(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ${p()}`, params)).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
