require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
const { startAutoSync } = require('./services/domex-sync');

const app = express();

app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true }));
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

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`DMS API running on port ${PORT}`);
  startAutoSync();
});
