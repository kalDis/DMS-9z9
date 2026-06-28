CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  contact_person VARCHAR(255),
  contact_phone VARCHAR(50),
  sms_sender_id VARCHAR(50),
  default_branch VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  settings JSONB DEFAULT '{}',
  domex_api_key TEXT,
  domex_customer_code VARCHAR(50),
  domex_sender_name VARCHAR(255),
  domex_sender_address TEXT,
  domex_sender_phone VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_businesses (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, business_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  tracking_number TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT,
  product TEXT,
  salesperson TEXT,
  branch TEXT,
  status VARCHAR(50) DEFAULT 'New',
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  order_date TEXT,
  order_id TEXT,
  amount NUMERIC,
  item_codes TEXT,
  item_names TEXT,
  payment_status TEXT,
  order_status TEXT,
  city TEXT,
  pieces INTEGER,
  weight TEXT,
  exchange TEXT,
  reference TEXT,
  remark TEXT,
  commission NUMERIC,
  order_handler TEXT,
  num_items INTEGER,
  pickup_date TEXT,
  delivered_date TEXT,
  UNIQUE(business_id, tracking_number)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_name VARCHAR(255),
  action TEXT NOT NULL,
  business_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS column_mappings (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id),
  mappings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_sync TEXT,
  status VARCHAR(50)
);
INSERT INTO sync_status (id, status) VALUES (1, 'idle') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS delivery_statuses (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status_code VARCHAR(20),
  status_text TEXT,
  location TEXT,
  remark TEXT,
  status_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, status_code, status_date)
);

CREATE TABLE IF NOT EXISTS delivery_issues (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) UNIQUE,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  source VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  attempt INTEGER DEFAULT 0,
  assigned_to INTEGER REFERENCES users(id),
  reason TEXT,
  domex_branch TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS issue_contacts (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES delivery_issues(id),
  attempt_number INTEGER NOT NULL,
  outcome VARCHAR(20),
  resolution VARCHAR(50),
  scheduled_date TEXT,
  notes TEXT,
  contacted_by INTEGER REFERENCES users(id),
  contacted_by_name TEXT,
  contacted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resolution_options (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  label TEXT NOT NULL,
  action VARCHAR(20) DEFAULT 'resolve',
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_number);
CREATE INDEX IF NOT EXISTS idx_user_businesses ON user_businesses(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_statuses_order ON delivery_statuses(order_id);
CREATE INDEX IF NOT EXISTS idx_issues_business ON delivery_issues(business_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON delivery_issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_order ON delivery_issues(order_id);
CREATE INDEX IF NOT EXISTS idx_contacts_issue ON issue_contacts(issue_id);
