// Shared server-to-server auth: a constant-time check of the `x-integration-key`
// header against env INTEGRATION_KEY. Used by /api/integration routes (9zFlow sync,
// Cal daily brief). Keeping it here lets several route files share one implementation.
const crypto = require('crypto');

function requireIntegrationKey(req, res, next) {
  const expected = process.env.INTEGRATION_KEY || '';
  const given = String(req.headers['x-integration-key'] || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  const ok = expected.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Invalid integration key' });
  next();
}

module.exports = { requireIntegrationKey };
