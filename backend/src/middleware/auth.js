const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

async function validateBusinessAccess(req, res, next) {
  const businessId = req.params.businessId || req.body.business_id || req.query.business_id;
  if (!businessId) return next();

  if (req.user.role === 'admin') return next();

  const result = query(
    'SELECT 1 FROM user_businesses WHERE user_id = $1 AND business_id = $2',
    [req.user.id, businessId]
  );
  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'No access to this business' });
  }
  next();
}

module.exports = { authenticate, requireRole, validateBusinessAccess };
