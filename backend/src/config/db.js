const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', '..', 'dms.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.queryAsync = (text, params = []) => {
  const isSelect = text.trim().toUpperCase().startsWith('SELECT') || text.trim().toUpperCase().startsWith('WITH');
  const isReturning = text.trim().toUpperCase().includes('RETURNING');

  const cleaned = text
    .replace(/\$(\d+)/g, '?')
    .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/TIMESTAMPTZ/g, 'TEXT')
    .replace(/JSONB/g, 'TEXT')
    .replace(/VARCHAR\(\d+\)/g, 'TEXT')
    .replace(/ILIKE/g, 'LIKE')
    .replace(/NOW\(\)/g, "datetime('now')")
    .replace(/json_agg\(json_build_object\((.*?)\)\)\s*FILTER\s*\(WHERE\s+\w+\.\w+\s+IS\s+NOT\s+NULL\)/g, "json_group_array(json_object($1))")
    .replace(/COALESCE\((json_group_array.*?),\s*'.*?'\)/g, '$1');

  try {
    if (isSelect) {
      const rows = db.prepare(cleaned).all(...params);
      return { rows };
    } else if (isReturning) {
      const row = db.prepare(cleaned).get(...params);
      return { rows: row ? [row] : [] };
    } else {
      const info = db.prepare(cleaned).run(...params);
      return { rows: [], rowCount: info.changes };
    }
  } catch (err) {
    console.error('DB Error:', err.message, '\nQuery:', cleaned, '\nParams:', params);
    throw err;
  }
};

module.exports = {
  query: (text, params) => db.queryAsync(text, params),
  db,
};
