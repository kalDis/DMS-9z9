const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function seed() {
  const { query, isPostgres } = require('./db');

  // Run schema
  if (isPostgres()) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema-pg.sql'), 'utf8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      try { await query(stmt); } catch (err) { console.log('Schema skip:', err.message?.substring(0, 60)); }
    }
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(__dirname, '..', '..', 'dms.db'));
    const schema = fs.readFileSync(path.join(__dirname, 'schema-pg.sql'), 'utf8')
      .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
      .replace(/TIMESTAMPTZ/g, 'TEXT')
      .replace(/JSONB/g, 'TEXT')
      .replace(/NOW\(\)/g, "datetime('now')")
      .replace(/ON CONFLICT \(id\) DO NOTHING/g, 'OR IGNORE')
      .replace(/VARCHAR\(\d+\)/g, 'TEXT')
      .replace(/NUMERIC/g, 'REAL');
    db.exec(schema);
  }

  const existing = (await query("SELECT id FROM users WHERE email = 'admin@dms.lk'")).rows;
  if (existing.length > 0) {
    console.log('Database already seeded');
    process.exit(0);
  }

  const hash = await bcrypt.hash('admin123', 10);
  await query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)', ['Admin User', 'admin@dms.lk', hash, 'admin']);

  console.log('Database seeded. Admin: admin@dms.lk / admin123');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
