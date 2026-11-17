// Server-to-server endpoints used by 9zFlow to keep DMS in sync.
// Auth: shared secret in the `x-integration-key` header (env INTEGRATION_KEY).
// 9zFlow links each of its businesses to a DMS business ONCE (by DMS business id), so the two
// names do not have to match. Matching by `business_name` still works as a fallback.
const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');

const router = express.Router();

function requireIntegrationKey(req, res, next) {
  const expected = process.env.INTEGRATION_KEY || '';
  const given = String(req.headers['x-integration-key'] || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  const ok = expected.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Invalid integration key' });
  next();
}

async function findBusinessById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return (await query('SELECT id, name FROM businesses WHERE id = $1', [n])).rows[0] || null;
}

async function findBusinessByName(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  return (await query('SELECT id, name FROM businesses WHERE LOWER(name) = LOWER($1)', [clean])).rows[0] || null;
}

// Lists DMS businesses so 9zFlow can offer them in its one-time "link business" dropdown.
router.get('/businesses', requireIntegrationKey, async (req, res) => {
  try {
    const rows = (await query('SELECT id, name FROM businesses ORDER BY name')).rows;
    res.json(rows.map(b => ({ id: b.id, name: b.name })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Insert-or-update products for one business. Matched on (business, product_sku, variant_sku).
// Never deletes anything, and never touches product_costs (cost stays managed inside DMS).
router.post('/products/upsert', requireIntegrationKey, async (req, res) => {
  try {
    const { business_id, business_name, products } = req.body;
    if (!Array.isArray(products)) return res.status(400).json({ error: 'products array required' });
    const business = business_id != null ? await findBusinessById(business_id) : await findBusinessByName(business_name);
    if (!business) return res.status(404).json({ error: `No matching DMS business (${business_id != null ? 'id ' + business_id : '"' + business_name + '"'})` });

    let inserted = 0, updated = 0, skipped = 0;
    for (const p of products) {
      const sku = String(p.sku || '').trim();
      const name = String(p.name || '').trim();
      if (!sku || !name) { skipped++; continue; }
      const variantSku = String(p.variant_sku || '').trim() || sku;
      const price = p.price === '' || p.price == null || isNaN(Number(p.price)) ? null : Number(p.price);

      const existing = (await query(
        'SELECT id FROM products WHERE business_id = $1 AND product_sku = $2 AND variant_sku = $3',
        [business.id, sku, variantSku]
      )).rows[0];
      if (existing) {
        await query('UPDATE products SET product_name = $1, price = $2 WHERE id = $3', [name, price, existing.id]);
        updated++;
      } else {
        await query(
          'INSERT INTO products (business_id, product_sku, product_name, variant_sku, price) VALUES ($1,$2,$3,$4,$5)',
          [business.id, sku, name, variantSku, price]
        );
        inserted++;
      }
    }
    res.json({ business: business.name, inserted, updated, skipped });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
