const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const sqlite = new Database(path.join(__dirname, 'dms.db'));
const pg = new Pool({
  connectionString: 'postgresql://postgres:nKdUoEYxeXNTDYsszbsybCtERvMzmjSc@centerbeam.proxy.rlwy.net:40538/railway',
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  // 1. Businesses
  const businesses = sqlite.prepare('SELECT * FROM businesses').all();
  console.log(`Migrating ${businesses.length} businesses...`);
  for (const b of businesses) {
    try {
      await pg.query(
        `INSERT INTO businesses (id, name, contact_person, contact_phone, sms_sender_id, default_branch, status, domex_api_key, domex_customer_code, domex_sender_name, domex_sender_address, domex_sender_phone, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
        [b.id, b.name, b.contact_person, b.contact_phone, b.sms_sender_id, b.default_branch, b.status, b.domex_api_key, b.domex_customer_code, b.domex_sender_name, b.domex_sender_address, b.domex_sender_phone, b.created_at, b.updated_at]
      );
    } catch (e) { console.log('Biz skip:', b.name, e.message?.substring(0, 50)); }
  }
  // Reset sequence
  await pg.query("SELECT setval('businesses_id_seq', (SELECT MAX(id) FROM businesses))");

  // 2. Users
  const users = sqlite.prepare('SELECT * FROM users').all();
  console.log(`Migrating ${users.length} users...`);
  for (const u of users) {
    try {
      await pg.query(
        `INSERT INTO users (id, name, email, password_hash, role, status, last_login, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [u.id, u.name, u.email, u.password_hash, u.role, u.status, u.last_login, u.created_at, u.updated_at]
      );
    } catch (e) { console.log('User skip:', u.email, e.message?.substring(0, 50)); }
  }
  await pg.query("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))");

  // 3. User-Business mappings
  const ub = sqlite.prepare('SELECT * FROM user_businesses').all();
  console.log(`Migrating ${ub.length} user-business mappings...`);
  for (const m of ub) {
    try { await pg.query('INSERT INTO user_businesses (user_id, business_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [m.user_id, m.business_id]); } catch {}
  }

  // 4. Orders (batch insert for speed)
  const orderCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM orders').get().cnt;
  console.log(`Migrating ${orderCount} orders...`);
  const BATCH = 100;
  for (let offset = 0; offset < orderCount; offset += BATCH) {
    const orders = sqlite.prepare(`SELECT * FROM orders LIMIT ${BATCH} OFFSET ${offset}`).all();
    for (const o of orders) {
      try {
        await pg.query(
          `INSERT INTO orders (id, business_id, tracking_number, customer_name, phone, address, product, salesperson, branch, status, dispatched_at, created_at, updated_at, order_date, order_id, amount, item_codes, item_names, payment_status, order_status, city, pieces, weight, exchange, reference, remark, commission, order_handler, num_items, pickup_date, delivered_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) ON CONFLICT (id) DO NOTHING`,
          [o.id, o.business_id, o.tracking_number, o.customer_name, o.phone, o.address, o.product, o.salesperson, o.branch, o.status, o.dispatched_at, o.created_at, o.updated_at, o.order_date, o.order_id, o.amount, o.item_codes, o.item_names, o.payment_status, o.order_status, o.city, o.pieces, o.weight, o.exchange, o.reference, o.remark, o.commission, o.order_handler, o.num_items, o.pickup_date, o.delivered_date]
        );
      } catch (e) { /* skip duplicates */ }
    }
    process.stdout.write(`\r  ${Math.min(offset + BATCH, orderCount)}/${orderCount}`);
  }
  await pg.query("SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders))");
  console.log('\n  Orders done');

  // 5. Delivery statuses
  const dsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM delivery_statuses').get().cnt;
  console.log(`Migrating ${dsCount} delivery statuses...`);
  for (let offset = 0; offset < dsCount; offset += BATCH) {
    const rows = sqlite.prepare(`SELECT * FROM delivery_statuses LIMIT ${BATCH} OFFSET ${offset}`).all();
    for (const d of rows) {
      try {
        await pg.query(
          `INSERT INTO delivery_statuses (id, order_id, status_code, status_text, location, remark, status_date, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [d.id, d.order_id, d.status_code, d.status_text, d.location, d.remark, d.status_date, d.created_at]
        );
      } catch {}
    }
    process.stdout.write(`\r  ${Math.min(offset + BATCH, dsCount)}/${dsCount}`);
  }
  await pg.query("SELECT setval('delivery_statuses_id_seq', (SELECT MAX(id) FROM delivery_statuses))");
  console.log('\n  Delivery statuses done');

  // 6. Delivery issues
  const issues = sqlite.prepare('SELECT * FROM delivery_issues').all();
  console.log(`Migrating ${issues.length} issues...`);
  for (const i of issues) {
    try {
      await pg.query(
        `INSERT INTO delivery_issues (id, order_id, business_id, source, status, attempt, assigned_to, reason, domex_branch, created_at, updated_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [i.id, i.order_id, i.business_id, i.source, i.status, i.attempt, i.assigned_to, i.reason, i.domex_branch, i.created_at, i.updated_at, i.resolved_at]
      );
    } catch {}
  }
  await pg.query("SELECT setval('delivery_issues_id_seq', COALESCE((SELECT MAX(id) FROM delivery_issues), 1))");

  // 7. Issue contacts
  const contacts = sqlite.prepare('SELECT * FROM issue_contacts').all();
  console.log(`Migrating ${contacts.length} issue contacts...`);
  for (const c of contacts) {
    try {
      await pg.query(
        `INSERT INTO issue_contacts (id, issue_id, attempt_number, outcome, resolution, scheduled_date, notes, contacted_by, contacted_by_name, contacted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [c.id, c.issue_id, c.attempt_number, c.outcome, c.resolution, c.scheduled_date, c.notes, c.contacted_by, c.contacted_by_name, c.contacted_at]
      );
    } catch {}
  }
  await pg.query("SELECT setval('issue_contacts_id_seq', COALESCE((SELECT MAX(id) FROM issue_contacts), 1))");

  // 8. Audit logs
  const audits = sqlite.prepare('SELECT * FROM audit_logs').all();
  console.log(`Migrating ${audits.length} audit logs...`);
  for (const a of audits) {
    try {
      await pg.query(
        `INSERT INTO audit_logs (id, user_id, user_name, action, business_name, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [a.id, a.user_id, a.user_name, a.action, a.business_name, a.created_at]
      );
    } catch {}
  }
  await pg.query("SELECT setval('audit_logs_id_seq', COALESCE((SELECT MAX(id) FROM audit_logs), 1))");

  // 9. Column mappings
  const mappings = sqlite.prepare('SELECT * FROM column_mappings').all();
  console.log(`Migrating ${mappings.length} column mappings...`);
  for (const m of mappings) {
    try {
      await pg.query('INSERT INTO column_mappings (id, business_id, mappings, created_at, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [m.id, m.business_id, m.mappings, m.created_at, m.updated_at]);
    } catch {}
  }

  // 10. Resolution options
  const resOpts = sqlite.prepare('SELECT * FROM resolution_options').all();
  console.log(`Migrating ${resOpts.length} resolution options...`);
  for (const r of resOpts) {
    try {
      await pg.query('INSERT INTO resolution_options (id, business_id, label, action, is_active, sort_order, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [r.id, r.business_id, r.label, r.action, r.is_active, r.sort_order, r.created_at]);
    } catch {}
  }

  // 11. Sync status
  await pg.query("UPDATE sync_status SET last_sync = NULL, status = 'idle' WHERE id = 1");

  // Verify
  const counts = await pg.query(`
    SELECT 'businesses' as t, COUNT(*) as c FROM businesses UNION ALL
    SELECT 'users', COUNT(*) FROM users UNION ALL
    SELECT 'orders', COUNT(*) FROM orders UNION ALL
    SELECT 'delivery_statuses', COUNT(*) FROM delivery_statuses UNION ALL
    SELECT 'delivery_issues', COUNT(*) FROM delivery_issues UNION ALL
    SELECT 'audit_logs', COUNT(*) FROM audit_logs
  `);
  console.log('\n=== Migration Complete ===');
  counts.rows.forEach(r => console.log(`  ${r.t}: ${r.c}`));

  await pg.end();
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
