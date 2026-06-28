const path = require('path');

const isPG = !!process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgresql');

let sqliteDb, pgPool;

if (isPG) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  console.log('Using PostgreSQL');
} else {
  const Database = require('better-sqlite3');
  sqliteDb = new Database(path.join(__dirname, '..', '..', 'dms.db'));
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  console.log('Using SQLite');
}

// Unified query interface — always use $1, $2 style params
async function query(text, params = []) {
  if (isPG) {
    const cleaned = text
      .replace(/datetime\('now'\)/g, 'NOW()')
      .replace(/datetime\('now',\s*'-(\d+) days?'\)/g, "NOW() - INTERVAL '$1 days'")
      .replace(/datetime\(\?\)/g, 'NOW()')
      .replace(/INSERT OR IGNORE/g, 'INSERT')
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      .replace(/\bdate\(([^)]+)\)/g, 'CAST($1 AS DATE)');
    try {
      return await pgPool.query(cleaned, params);
    } catch (err) {
      if (err.code === '23505') { err.message = 'UNIQUE constraint failed'; }
      throw err;
    }
  } else {
    const cleaned = text
      .replace(/\$(\d+)/g, '?')
      .replace(/ILIKE/g, 'LIKE')
      .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
      .replace(/TIMESTAMPTZ/g, 'TEXT')
      .replace(/JSONB/g, 'TEXT')
      .replace(/NOW\(\)/g, "datetime('now')")
      .replace(/NOW\(\)\s*-\s*INTERVAL\s*'(\d+)\s*days?'/g, "datetime('now', '-$1 days')")
      .replace(/ON CONFLICT \(.*?\) DO NOTHING/g, 'OR IGNORE');

    const isSelect = cleaned.trim().toUpperCase().startsWith('SELECT') ||
                     cleaned.trim().toUpperCase().startsWith('WITH');
    const isReturning = cleaned.toUpperCase().includes('RETURNING');

    if (isSelect) {
      return { rows: sqliteDb.prepare(cleaned).all(...params) };
    } else if (isReturning) {
      const row = sqliteDb.prepare(cleaned).get(...params);
      return { rows: row ? [row] : [] };
    } else {
      const info = sqliteDb.prepare(cleaned).run(...params);
      return { rows: [], rowCount: info.changes, lastId: info.lastInsertRowid };
    }
  }
}

// For batch operations that need direct DB access (SQLite transactions, etc.)
function getDirectDb() { return sqliteDb; }
function isPostgres() { return isPG; }

// Transaction helper
async function transaction(fn) {
  if (isPG) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const wrappedQuery = (text, params) => {
        const cleaned = text
          .replace(/datetime\('now'\)/g, 'NOW()')
          .replace(/datetime\('now',\s*'-(\d+) days?'\)/g, "NOW() - INTERVAL '$1 days'")
          .replace(/INSERT OR IGNORE/g, 'INSERT');
        return client.query(cleaned, params);
      };
      await fn(wrappedQuery);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const txn = sqliteDb.transaction(() => {
      const wrappedQuery = (text, params = []) => {
        const cleaned = text
          .replace(/\$(\d+)/g, '?')
          .replace(/ILIKE/g, 'LIKE')
          .replace(/NOW\(\)/g, "datetime('now')");
        const isSelect = cleaned.trim().toUpperCase().startsWith('SELECT');
        const isReturning = cleaned.toUpperCase().includes('RETURNING');
        if (isSelect) return { rows: sqliteDb.prepare(cleaned).all(...params) };
        else if (isReturning) { const r = sqliteDb.prepare(cleaned).get(...params); return { rows: r ? [r] : [] }; }
        else { const i = sqliteDb.prepare(cleaned).run(...params); return { rows: [], rowCount: i.changes, lastId: i.lastInsertRowid }; }
      };
      return fn(wrappedQuery);
    });
    return txn();
  }
}

module.exports = { query, transaction, getDirectDb, isPostgres, db: sqliteDb };
