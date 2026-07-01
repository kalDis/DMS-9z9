# DMS — Delivery Management System

Multi-tenant delivery management system for managing outbound orders across multiple business units with Domex courier integration. Built as a future module of a larger e-commerce SaaS platform.

## Architecture

```
frontend/          Next.js 14 (App Router) — port 3001 local
backend/           Node.js + Express — port 4000 local
Database:          SQLite (local dev) / PostgreSQL (production on Railway)
```

## Quick Start (Local Dev)

```bash
# Backend
cd backend
npm install
node src/config/seed.js    # First time only — creates DB + admin user
node src/index.js          # Starts on port 4000

# Frontend
cd frontend
npm install
npm run dev -- -p 3001     # Starts on port 3001
```

Default login: `admin@dms.lk` / `admin123`

## Production (Railway)

- **Frontend:** https://resilient-clarity-production-78b4.up.railway.app
- **Backend:** https://dms-9z9-production.up.railway.app
- **Database:** PostgreSQL on Railway
- **GitHub:** https://github.com/kalDis/DMS-9z9
- Auto-deploys from `main` branch on push

## Key Files

### Backend

| File | Purpose |
|---|---|
| `src/index.js` | Express app entry, route registration, DB init + migrations |
| `src/config/db.js` | Dual DB layer — SQLite (local) + PostgreSQL (prod). Always use $1,$2 params |
| `src/config/schema-pg.sql` | PostgreSQL schema — base tables only |
| `src/config/seed.js` | Database seeder for local dev |
| `src/middleware/auth.js` | JWT auth + role-based access |
| `src/routes/auth.js` | Login, /me endpoint, returns must_change_password flag |
| `src/routes/orders.js` | Orders CRUD, search, sort, filter, bulk actions, /ids endpoint |
| `src/routes/businesses.js` | Business CRUD with Domex API config |
| `src/routes/users.js` | User management — create/edit/delete/reset-password/change-password |
| `src/routes/issues.js` | Issue queue, contact attempts, bulk operations, revert |
| `src/routes/issue-upload.js` | Domex issue Excel upload |
| `src/routes/upload.js` | Order + delivery data Excel upload with column mapping and courier tagging |
| `src/routes/export.js` | Domex feedback export — supports ?ids= for selected-only export |
| `src/routes/sync.js` | Domex sync trigger, status, /selected, /detect-courier endpoints |
| `src/routes/settings.js` | Resolution options per business |
| `src/routes/audit.js` | Audit log |
| `src/services/domex-sync.js` | Domex API — syncOrders, syncSelectedOrders, detectCouriers |
| `src/services/email.js` | Gmail SMTP via nodemailer — sends credentials on user creation |

### Frontend

| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout with AuthProvider |
| `src/app/login/page.tsx` | Login page |
| `src/app/dashboard/page.tsx` | Main dashboard — sidebar, topbar, sync meter, force-password-change screen |
| `src/lib/api.ts` | API client with JWT |
| `src/lib/auth-context.tsx` | Auth state, login/logout, business switching, must_change_password flag |
| `src/components/Sidebar.tsx` | Navigation sidebar |
| `src/components/OverviewScreen.tsx` | Analytics dashboard with date range filter |
| `src/components/OrdersScreen.tsx` | Order list — filters, sort, pagination, edit, bulk, courier badge, select-all-pages |
| `src/components/IssuesScreen.tsx` | Issue queue with contact workflow, bulk actions |
| `src/components/ExportScreen.tsx` | Domex feedback export — select specific issues to export |
| `src/components/AdminScreen.tsx` | Admin panel — businesses, users (multi-business), settings, audit |
| `src/components/UploadModal.tsx` | Excel upload — courier selection step, column mapping, preview |
| `src/components/StatusPill.tsx` | Status badge component |
| `src/components/DateRangeFilter.tsx` | Date picker — Today/Yesterday/7 days/This month/Last month/Custom |

## Database Tables

| Table | Purpose |
|---|---|
| `businesses` | Business units with Domex API config |
| `users` | Staff accounts with roles, must_change_password flag |
| `user_businesses` | User-to-business assignments (one user can have multiple businesses) |
| `orders` | All orders — sales + delivery data + courier field |
| `delivery_statuses` | Domex tracking timeline per order |
| `delivery_issues` | Issue queue entries |
| `issue_contacts` | Contact attempt records with resolution |
| `resolution_options` | Configurable resolution options per business |
| `column_mappings` | Saved Excel column mappings per business |
| `sync_status` | Domex sync progress tracking (single row, id=1) |
| `audit_logs` | All user actions |

## DB Migrations

Migrations run at startup in `src/index.js` inside `initDb()`. Pattern:
```js
try { await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier VARCHAR(50) DEFAULT 'domex'"); } catch {}
```
Always use `IF NOT EXISTS` so they are safe to re-run on every deploy.

## User Roles

| Role | Access |
|---|---|
| `admin` | Everything — all businesses, admin panel, settings, delete users |
| `issue_handler` | Upload orders, process issues, export — assigned businesses only |
| `viewer` | Read-only — orders and statuses only |

## User Management

- New users get a temp password (`TMP-XXXXXX`) — must change on first login
- `must_change_password = 1` forces password change screen on dashboard load
- Credentials emailed via Gmail SMTP (SMTP_USER / SMTP_PASS env vars)
- One user can belong to multiple businesses (user_businesses table)
- Delete user: nullifies audit_logs, clears delivery_issues.assigned_to, removes issue_contacts first

## Courier System

- Every order has a `courier` field (default: `'domex'`)
- On upload: user selects courier or "Don't Know"
- "Don't Know" → system calls each configured courier API after import to detect
- `POST /sync/detect-courier` — tries each business API, saves result
- Orders show DX badge (Domex) or ? badge (unknown)
- Courier filter in orders list
- To add a new courier: add API check inside `detectCouriers()` in domex-sync.js

## Domex API Integration

- **Base URL:** `https://www.connectmesecure.com/api/CustomerInwards/`
- **Auth:** `x-api-key` header per business
- **Endpoints used:**
  - `getCustomerStatusDetails` — tracking status history
  - `getCustomerWayBillDetails` — customer/receiver details
- **Auto-sync:** Every 30 minutes for all configured businesses
- **Manual sync:** Sync button in topbar
- **Selected sync:** Select orders → "↻ Get Latest Status" button
- **Status mapping:** 27+ Domex codes mapped to system statuses
- `CIG` intentionally **ignored** — finance closure code, not delivery status
- Status detection: scans history backwards to find most recent mappable status (fixes orders stuck at "New" when CIG is the latest entry)

## Order Flow

1. Upload Sales Report → courier selection → orders created as "New"
2. If courier unknown → system auto-detects via API in background
3. Domex sync → updates status + fills customer details from waybill
4. Optional: Upload Delivery Sheet → fills receiver details
5. Auto-sync every 30 min; manual: select orders → "↻ Get Latest Status"

## Issue Workflow

1. Add orders to issues (bulk from orders or Domex issue upload)
2. Staff records contact attempts (max 3, 1-day gap between attempts)
3. Resolution: select suggested option OR type custom text (at least one required)
4. 3rd "No Answer" → Auto-Return
5. Resolved issues appear in Export screen — Domex tab or Internal tab
6. Export: select specific resolved issues → "Export Selected", or export all by date range

## Environment Variables

### Backend
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (if set, uses PG; otherwise SQLite) |
| `JWT_SECRET` | JWT signing secret |
| `PORT` | Server port (default 4000) |
| `NODE_ENV` | `production` for Railway |
| `FRONTEND_URL` | Allowed CORS origins (comma-separated) |
| `SMTP_USER` | Gmail address for sending credential emails |
| `SMTP_PASS` | Gmail App Password (not regular password) |

### Frontend
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API URL |

## Important Decisions & Why

- **CIG status ignored:** CIG always appears after D/RTN — it's an accounting close, not delivery. Including it was wrongly marking returned orders as Delivered.
- **Sync runs in background:** HTTP would time out on large order sets. Sync starts and responds immediately; progress tracked in sync_status table.
- **Email sent non-blocking:** User creation was hanging because email was awaited. Now fires and forgets with `.catch(() => {})`.
- **Backwards status scan:** When latest Domex status is unmapped, scan backwards to find most recent mappable status. Fixes orders stuck as "New".
- **Upload dir is /tmp in production:** Railway filesystem is read-only except /tmp.
- **PostgreSQL sequences:** After data migration, sequences can fall out of sync. Fix with `SELECT setval('table_id_seq', MAX(id))` for each table.

## Build Phases (DMS)

- [x] Phase 1 — Foundation (auth, admin, basic order list)
- [x] Phase 2 — Order Management (Excel upload, Domex sync, column mapping)
- [x] Phase 3 — Issue Workflow (3-attempt contact, resolution options, bulk actions)
- [x] Phase 4 — Export & Reports (Domex feedback export, analytics dashboard, date filters)
- [x] Phase 5 — User Management (multi-business, email credentials, force password change, delete)
- [x] Phase 6 — Courier System (courier tagging, auto-detection, badge, filter)
- [ ] Phase 7 — SMS & Notifications (Notify.lk — skipped for now)

## Future: Full E-Commerce SaaS

DMS is planned as the delivery module of a larger platform:
- CRM Module — leads from social media, sales call tracking
- Orders Module — product catalog, inventory, order entry
- DMS Module — this system (already built)
- Finance Module — COD collection, commissions, P&L

SaaS additions needed: subscription billing, self sign-up, plan limits, super-admin panel.
