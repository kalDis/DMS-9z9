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
