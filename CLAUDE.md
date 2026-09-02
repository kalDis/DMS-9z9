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
- **Database:** Railway-hosted PostgreSQL — internal host `postgres.railway.internal`, database `railway` (NOT Neon/Supabase). Connected via the `DATABASE_URL` secret over Railway's private network.
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
| `src/routes/orders.js` | Orders CRUD, search, sort, filter, bulk actions, /ids, `/export` (xlsx delivery list), `/:id/issue-history` |
| `src/routes/businesses.js` | Business CRUD with Domex API config |
| `src/routes/users.js` | User management — create/edit/delete/reset-password/change-password |
| `src/routes/issues.js` | Issue queue, day-based attempts, To Call/Called Today/To Return buckets (Colombo tz), bulk ops, bulk-return, revert |
| `src/routes/issue-upload.js` | Domex issue Excel upload (fuzzy reason/branch, case-insensitive, backfill) + missing-order resolve/import |
| `src/routes/upload.js` | Order + delivery data Excel upload with column mapping and courier tagging |
| `src/routes/export.js` | Domex feedback export — ?ids= for selected-only, per-business auto-return text |
| `src/routes/sync.js` | Domex sync trigger, status, /selected, /detect-courier endpoints |
| `src/routes/settings.js` | Per business: resolution options, auto-return text, product master upload (+cost col), cost-sheet upload, manual product CRUD (`/product/*`) |
| `src/routes/ads.js` | Ad ROI — weekly/date-range ad_data CRUD (per product·platform·period, duplicate-guarded) + `/report` (funnel, ROAS, true profit) |
| `src/routes/audit.js` | Audit log |
| `src/services/domex-sync.js` | Domex API — syncOrders, syncSelectedOrders, detectCouriers, mapDomexStatus |
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
| `src/components/OrdersScreen.tsx` | Order list — filters, sort, pagination, edit, bulk, phone column, issue dot + legend, Issue History, Excel export |
| `src/components/IssuesScreen.tsx` | Issue queue — day buckets, contact workflow, To Return confirm, bulk actions, pagination |
| `src/components/ExportScreen.tsx` | Domex feedback export — search, pagination, select specific issues to export |
| `src/components/AdminScreen.tsx` | Admin panel — businesses, users, per-business settings (resolution options, auto-return text, product list + cost uploads, manual product editor), audit |
| `src/components/ProductsScreen.tsx` | Products report — per product total/delivered/returned, search, date filter, xlsx export |
| `src/components/AdRoiScreen.tsx` | Ad ROI — row-by-row ad entry (product·platform·date range), report list with sortable columns + expandable funnel/ROAS/true-profit detail |
| `src/components/ProductEditor.tsx` | Admin inline product editor (edit Name/Price/Cost, add, delete; SKU read-only) |
| `src/components/ResolutionOptionsManager.tsx` | Shared add/enable/delete resolution options (Admin + staff Settings) |
| `src/components/SettingsScreen.tsx` | Staff-facing Settings page (issue_handler only) — manage resolution options for assigned businesses |
| `src/components/UploadModal.tsx` | Excel upload — courier selection step, column mapping, preview |
| `src/components/StatusPill.tsx` | Status badge component (incl. Hold = amber) |
| `src/components/Pagination.tsx` | Shared page navigator (Issues + Export, 50/page) |
| `src/components/DateRangeFilter.tsx` | Date picker — Today/Yesterday/7 days/This month/Last month/Custom |

## Database Tables

| Table | Purpose |
|---|---|
| `businesses` | Business units with Domex API config + `auto_return_feedback` text |
| `users` | Staff accounts with roles, must_change_password flag |
| `user_businesses` | User-to-business assignments (one user can have multiple businesses) |
| `orders` | All orders — sales + delivery data + courier field. Tracking numbers stored UPPERCASE |
| `delivery_statuses` | Domex tracking timeline per order |
| `delivery_issues` | Issue queue entries. **order_id is NOT unique** — many issues per order over time; only one may be ACTIVE (enforced in routes) |
| `issue_contacts` | Contact attempt records with resolution. Same-day calls share an `attempt_number` — order by `contacted_at`, not `attempt_number` |
| `resolution_options` | Configurable resolution options per business |
| `products` | Product master (uploaded): product_sku, product_name, variant_sku, price. Full-replace on upload |
| `product_costs` | Avg cost per product (code + cost), SEPARATE table so re-uploading the master never wipes costs. Matched to orders by base SKU |
| `ad_data` | Ad metrics per business·product·platform (tiktok/meta)·date range: spend, impressions, clicks, leads, messages |
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
- **Status mapping:** 27+ Domex codes mapped to system statuses (`mapDomexStatus` in domex-sync.js)
- `CIG` intentionally **ignored** — finance closure code, not delivery status
- **Hold:** Domex `HI` (Hold) and `HO` (Branch Hold) map to a **"Hold"** DMS status (a "Hold" filter/pill exists in Orders; part of the Pending Delivery group). Held orders update to Hold on the next sync.
- Status detection: scans history backwards to find most recent mappable status (fixes orders stuck at "New" when CIG is the latest entry)
- **API response fields** (only 2 endpoints): `getCustomerStatusDetails` → array of `{statusCode, status, statusDate, remark, trackingNo}`; `getCustomerWayBillDetails` → `{receiverName/ContactNo/Address/City, value, weight, noOfPcs, exchange, createdDate, sender*...}`. **No hold-reason field** — the `remark` on a Hold entry comes back empty.

## Order Flow

1. Upload Sales Report → courier selection → orders created as "New"
2. If courier unknown → system auto-detects via API in background
3. Domex sync → updates status + fills customer details from waybill
4. Optional: Upload Delivery Sheet → fills receiver details
5. Auto-sync every 30 min; manual: select orders → "↻ Get Latest Status"

## Issue Workflow

1. Add orders to issues (bulk from orders or Domex issue upload)
2. **Day-based calling** — 1 attempt = 1 day of trying. Same-day re-calls do NOT
   increment the attempt; a "No Answer" on a new **Asia/Colombo** day does. No time
   lock — staff can call anytime. (See "Day-Based Issue Calling" below.)
3. Resolution: select suggested option OR type custom text (at least one required)
4. After `MAX_ATTEMPTS` (**2**) days of no answer the issue surfaces in the
   **"To Return"** tab. **Calls never auto-return** — staff confirm the return there.
5. Resolved issues appear in Export screen — Domex tab or Internal tab
6. Export: select specific resolved issues → "Export Selected", or export all by date range

## Day-Based Issue Calling

- Attempt count is derived from call history: the number of distinct Colombo-calendar
  days with a "No Answer" call. No midnight cron job — it's always computed live.
- `MAX_ATTEMPTS = 2` — defined in BOTH `routes/issues.js` and `IssuesScreen.tsx`;
  keep them in sync.
- `issues.js` GET buckets (`bucket=` param), computed in JS from `Intl` Asia/Colombo dates:
  - `to_call_today` — not called today. Split into `section: 'followup'` (called before,
    sorted on top) and `'new'`.
  - `called_today` — called today, sorted oldest-call-first (rotation: re-calling drops
    it to the bottom).
  - `to_return` — active, `attempt >= MAX_ATTEMPTS`, last call on a previous day.
- `issues.js` POST `/:id/contact`: no time lock, **no auto-return**;
  `newAttempt = sameColomboDay ? attempt : attempt+1`.
- `POST /issues/bulk-return` — staff confirm returns; accepts `issue_ids` or
  `{ return_all: true, business_id, source }` (recomputes the eligible set server-side).
  Sets `auto_return` + order `Returned`.
- Frontend `IssuesScreen` tabs: To Call Today / Called Today / **To Return** / Resolved /
  Auto Return. To Return has per-row select + "Return Selected", select-all, and
  "Return All". Paginated 50/page (shared `Pagination.tsx`, also used by ExportScreen).

## One Active Issue Per Order

- `delivery_issues.order_id` has **NO UNIQUE constraint** (dropped via migration) — an
  order may accumulate several issues over time.
- Only an **ACTIVE** issue blocks a new one: every add path checks
  `status IN ('open','in_progress')` (`issues.js /add`, `orders.js /bulk add_issues`,
  Domex issue upload, missing-order import). A closed (resolved/auto_return) issue lets
  a fresh issue be raised — e.g. Domex issue resolved, then the customer cancels.
- `orders.js /bulk` returns `skipped_active` so the UI can explain skips.
- Orders list `issue_source`/`issue_status` subqueries pick the ACTIVE issue first, else
  the most recent closed one (drives the dot color).

## Order Issue History

- `GET /orders/:id/issue-history` → `{ issues: [...] }`, all issues for the order
  (oldest first), each with its `contacts`. Role-scoped.
- UI: "Issue History" section in the expanded order row (above Delivery Tracking
  History) — status, source, Domex reason, and every call attempt. Renders
  "Issue #n of m" when an order has multiple.
- Orders list dot: red = active Domex, amber = active Internal, **green = resolved**,
  **grey = auto-returned** (legend at the top of the Orders page).

## Auto-Return Feedback Text

- `businesses.auto_return_feedback` (migration, default `'Dawas Dekak Balala Return Karanna'`).
- `GET/PUT /settings/auto-return/:businessId` (admin-only PUT). Admin panel →
  Settings tab → "Auto-Return Feedback Text" per business.
- `export.js` joins `businesses` and uses it for `auto_return` rows instead of "Auto-Return".
- Export resolution/scheduled_date/notes lookups order by **`contacted_at DESC`** (NOT
  `attempt_number`) — same-day calls share an attempt_number, and the tie-break used to
  pick a "No Answer" row, falling back to the literal "Resolved".

## Tracking Numbers

- Matched **case-insensitively everywhere** via `UPPER(tracking_number)=UPPER($n)`
  (order upload, delivery upload, Domex issue upload); search already used ILIKE.
- Normalized to **uppercase on ingest** (canonical storage) so no case-only duplicates.

## Domex Issue Upload

- Reason/Branch columns are matched **fuzzily** (`val.includes('reason')` /
  `includes('branch')`) — an exact-match check silently dropped headers like
  "Return Reason", leaving `delivery_issues.reason` null so no reason showed on cards.
- Re-uploading **backfills** reason/branch onto an existing issue that's missing them
  (returns an `updated` count) instead of just skipping — lets a re-upload repair
  previously-missed reasons.

## Missing-Order Recovery (Domex issue upload)

- Issue-upload "not found" waybills can be rebuilt: `POST /upload/domex-issues/resolve`
  (read-only Domex lookup, splits resolvable/unresolvable) then
  `POST /upload/domex-issues/import` (creates order + status history + issue).
  UI: review modal in `IssuesScreen`. Unresolvable waybills are skipped, never created blank.
- Note: a "not found" waybill is usually NOT a missing order — check case first
  (see Tracking Numbers).

## Order Excel Export

- `GET /orders/export?ids=...` streams an xlsx delivery list (Tracking, Customer, Phone,
  Address, City, Product, Amount, Pieces, Weight), role-scoped. UI: "⬇ Export Excel"
  in the Orders bulk-action bar (works with select-all-pages), with a toast on success.

## Product Master & Costs

- **Product master** (`products`): upload in Admin → Settings ("⬆ Upload Product List").
  Columns (fuzzy): Product SKU, Product Name, Variant SKU, Price, **and optional Unit cost**
  (if present, refreshes costs too). Full-replace per business.
- **Costs** (`product_costs`): separate upload ("⬆ Upload Cost Sheet", columns Code, Unit cost)
  OR the Unit cost column on the master. Kept separate so master re-upload never wipes costs.
- **Manual editor** (`ProductEditor`, admin only): edit Name/Price/Cost, add, delete a product
  inline. SKU is read-only (it's the key linking to orders). Endpoints `PUT/POST/DELETE /settings/product`.
- **Base-SKU matching:** order item_codes (e.g. `TY-058-STANDARD`, `TY058`, `TY 058`) and master/
  cost codes normalize to a base key (letters+digits) so they line up regardless of format.

## Products Report

- `GET /orders/product-report` — per product (grouped by base SKU via the master, multi-product
  orders split by newline/;/,): **Total / Delivered / Returned** counts. Date range on order_date,
  `?format=xlsx` export. UI: `ProductsScreen` (search, date filter, summary cards).

## Ad ROI

- Measures ad performance/ROI from `ad_data` (what you enter) + order performance (delivered,
  revenue = delivered × master price) + `product_costs`.
- `ad_data` per business·product·platform(tiktok|meta)·**date range** (period_start/period_end);
  entry POST is **duplicate-guarded** (same product+platform+range → `{duplicate:true}` unless `force`).
- `GET /ads/:businessId/report?date_from&date_to` → per product: spend/impr/clicks/leads/messages
  (+ platform split), delivered/returned/revenue, **COGS** (delivered × cost), **true_profit**
  (revenue − ad spend − COGS), margin. Totals cover tracked products (spend>0) for a meaningful ROAS.
- UI: `AdRoiScreen` — row-by-row entry grid (product search via datalist, one date range + platform,
  "＋" adds 2nd platform, expand row for impressions/clicks/date override), sortable report list,
  click a product to expand its funnel (impressions→clicks→leads→msgs→orders→delivered) + platform split.

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

## Local SQLite Gotchas (dev only — production PG is fine)

The `db.js` SQLite translation layer has limits that only bite in local dev:
- **`ON CONFLICT (...) DO NOTHING`** is rewritten to a malformed `... OR IGNORE` at the
  end of the statement → "near OR: syntax error". So such inserts (e.g. delivery_statuses
  history) silently fail locally. (Fix tracked separately.)
- **Repeated params** (`$5` used twice in one query, e.g. the order-import UPDATEs) fail
  with "too few parameter values" because `$n→?` is positional. PG handles reuse fine.
- Verify write paths that use these against production PG, not just local SQLite.

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
