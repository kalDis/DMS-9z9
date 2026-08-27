require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/businesses');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const auditRoutes = require('./routes/audit');
const uploadRoutes = require('./routes/upload');
const syncRoutes = require('./routes/sync');
const issueRoutes = require('./routes/issues');
const issueUploadRoutes = require('./routes/issue-upload');
const settingsRoutes = require('./routes/settings');
const adsRoutes = require('./routes/ads');
const exportRoutes = require('./routes/export');
const { startAutoSync } = require('./services/domex-sync');
const { query, isPostgres } = require('./config/db');

const app = express();

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3001').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o)) || origin.includes('railway.app')) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/upload', issueUploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/export', exportRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

async function initDb() {
  if (isPostgres()) {
    const schema = fs.readFileSync(path.join(__dirname, 'config', 'schema-pg.sql'), 'utf8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      try { await query(stmt); } catch {}
    }
    console.log('PostgreSQL schema initialized');

    // Migrations
    try { await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier VARCHAR(50) DEFAULT 'domex'"); } catch {}
    try { await query("UPDATE orders SET courier = 'domex' WHERE courier IS NULL"); } catch {}
    // Allow an order to get a new issue after its previous one is closed
    // (only one ACTIVE issue is allowed — enforced in the routes). Drops any
    // UNIQUE constraint on delivery_issues.order_id, whatever it's named.
    try {
      await query(`DO $$
        DECLARE c text;
        BEGIN
          SELECT conname INTO c FROM pg_constraint
          WHERE conrelid = 'delivery_issues'::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) LIKE '%(order_id)%' LIMIT 1;
          IF c IS NOT NULL THEN EXECUTE 'ALTER TABLE delivery_issues DROP CONSTRAINT ' || quote_ident(c); END IF;
        END $$;`);
    } catch (e) { console.log('drop unique(order_id) skip:', e.message?.slice(0, 60)); }
    try { await query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS auto_return_feedback TEXT DEFAULT 'Dawas Dekak Balala Return Karanna'"); } catch {}
    try { await query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      variant_sku TEXT,
      price REAL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`); } catch {}
    try { await query("CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id)"); } catch {}
    try { await query(`CREATE TABLE IF NOT EXISTS product_costs (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT,
      cost REAL,
      weight REAL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`); } catch {}
    try { await query("CREATE INDEX IF NOT EXISTS idx_product_costs_business ON product_costs(business_id)"); } catch {}
    try { await query(`CREATE TABLE IF NOT EXISTS ad_data (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_sku TEXT NOT NULL,
      platform VARCHAR(20) NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      spend REAL DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      leads INTEGER DEFAULT 0,
      messages INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(business_id, product_sku, platform, period_start, period_end)
    )`); } catch {}
    try { await query("CREATE INDEX IF NOT EXISTS idx_ad_data_business ON ad_data(business_id)"); } catch {}
    // Migrate ad_data from single week_start → period_start/period_end (table was brand new & empty)
    try { await query("ALTER TABLE ad_data ADD COLUMN IF NOT EXISTS period_start TEXT"); } catch {}
    try { await query("ALTER TABLE ad_data ADD COLUMN IF NOT EXISTS period_end TEXT"); } catch {}
    try { await query("ALTER TABLE ad_data ALTER COLUMN week_start DROP NOT NULL"); } catch {}
    try { await query("UPDATE businesses SET auto_return_feedback = 'Dawas Dekak Balala Return Karanna' WHERE auto_return_feedback IS NULL OR auto_return_feedback = ''"); } catch {}

    // Seed admin if not exists
    const existing = (await query("SELECT id FROM users WHERE email = 'admin@dms.lk'")).rows;
    if (!existing.length) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin123', 10);
      await query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)', ['Admin User', 'admin@dms.lk', hash, 'admin']);
      console.log('Admin user seeded: admin@dms.lk / admin123');
    }
  }
}

const PORT = process.env.PORT || 4000;

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`DMS API running on port ${PORT}`);
    startAutoSync();
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
