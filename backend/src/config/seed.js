const { db } = require('./db');
const bcrypt = require('bcryptjs');

function seed() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_person TEXT,
      contact_phone TEXT,
      sms_sender_id TEXT,
      default_branch TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'issue_handler', 'viewer')),
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_businesses (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, business_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      tracking_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      product TEXT,
      salesperson TEXT,
      branch TEXT,
      status TEXT DEFAULT 'Dispatched' CHECK (status IN ('Dispatched', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed', 'Returned')),
      dispatched_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(business_id, tracking_number)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT,
      action TEXT NOT NULL,
      business_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const existing = db.prepare("SELECT id FROM users WHERE email = 'admin@dms.lk'").get();
  if (existing) {
    console.log('Database already seeded');
    process.exit(0);
  }

  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Admin User', 'admin@dms.lk', hash, 'admin');

  // Seed sample businesses
  const biz1 = db.prepare("INSERT INTO businesses (name, contact_person, contact_phone, sms_sender_id, default_branch) VALUES (?, ?, ?, ?, ?)").run('BU Alpha', 'Nimal Silva', '0771112222', 'BUALPHA', 'Colombo');
  const biz2 = db.prepare("INSERT INTO businesses (name, contact_person, contact_phone, sms_sender_id, default_branch) VALUES (?, ?, ?, ?, ?)").run('BU Beta', 'Priya Kumari', '0712223333', 'BUBETA', 'Kandy');
  const biz3 = db.prepare("INSERT INTO businesses (name, contact_person, contact_phone, sms_sender_id, default_branch, status) VALUES (?, ?, ?, ?, ?, ?)").run('BU Gamma', 'Amara Rajitha', '0753334444', 'BUGAMMA', 'Galle', 'inactive');

  // Seed sample orders
  const orders = [
    [biz1.lastInsertRowid, 'DX001234', 'Kamal Perera', '0771234567', '123 Galle Rd, Colombo', 'Wireless Earbuds', 'Nimal S.', 'Colombo', 'Delivered'],
    [biz1.lastInsertRowid, 'DX001235', 'Sitha Fernando', '0712345678', '45 Kandy Rd', 'Smart Watch', 'Priya K.', 'Kandy', 'In Transit'],
    [biz1.lastInsertRowid, 'DX001236', 'Roshan Silva', '0759876543', '78 Beach Rd, Galle', 'Bluetooth Speaker', 'Amara R.', 'Galle', 'Failed'],
    [biz1.lastInsertRowid, 'DX001237', 'Dilani Jayawardena', '0787654321', '90 Park St, Colombo', 'Laptop Stand', 'Nimal S.', 'Colombo', 'Out for Delivery'],
    [biz1.lastInsertRowid, 'DX001238', 'Thilak Bandara', '0701122334', '12 Main St, Negombo', 'USB-C Hub', 'Kasun M.', 'Negombo', 'Dispatched'],
    [biz2.lastInsertRowid, 'DX001239', 'Malini Wickrama', '0763344556', '56 Hill St, Kandy', 'Desk Lamp', 'Priya K.', 'Kandy', 'Failed'],
    [biz1.lastInsertRowid, 'DX001240', 'Chamara Gunasekara', '0778899001', '34 Lake Dr, Colombo', 'Webcam HD', 'Amara R.', 'Colombo', 'Returned'],
  ];

  const stmt = db.prepare('INSERT INTO orders (business_id, tracking_number, customer_name, phone, address, product, salesperson, branch, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const o of orders) stmt.run(...o);

  // Seed sample users
  const handler1Hash = bcrypt.hashSync('handler123', 10);
  const handler1 = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Nimal Silva', 'nimal@bualpha.lk', handler1Hash, 'issue_handler');
  db.prepare('INSERT INTO user_businesses (user_id, business_id) VALUES (?, ?)').run(handler1.lastInsertRowid, biz1.lastInsertRowid);

  const viewer1Hash = bcrypt.hashSync('viewer123', 10);
  const viewer1 = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Kasun Mendis', 'kasun@bualpha.lk', viewer1Hash, 'viewer');
  db.prepare('INSERT INTO user_businesses (user_id, business_id) VALUES (?, ?)').run(viewer1.lastInsertRowid, biz1.lastInsertRowid);

  // Seed audit logs
  db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (1, 'Admin User', 'Created business BU Alpha', 'BU Alpha')").run();
  db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (1, 'Admin User', 'Created business BU Beta', 'BU Beta')").run();
  db.prepare("INSERT INTO audit_logs (user_id, user_name, action, business_name) VALUES (1, 'Admin User', 'Created user Nimal Silva', 'BU Alpha')").run();

  console.log('Database seeded successfully!');
  console.log('Admin: admin@dms.lk / admin123');
  console.log('Issue Handler: nimal@bualpha.lk / handler123');
  console.log('Viewer: kasun@bualpha.lk / viewer123');
  process.exit(0);
}

seed();
