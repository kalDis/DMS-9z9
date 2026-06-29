# DMS — Delivery Management System

Multi-tenant delivery management system for managing outbound orders across multiple business units with Domex courier integration.

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
- Auto-deploys from `main` branch on GitHub (kalDis/DMS-9z9)

## Key Files

### Backend

| File | Purpose |
|---|---|
| `src/index.js` | Express app entry, route registration, DB init |
| `src/config/db.js` | Dual DB layer — SQLite (local) + PostgreSQL (prod) |
| `src/config/schema-pg.sql` | PostgreSQL schema |
| `src/config/seed.js` | Database seeder |
| `src/middleware/auth.js` | JWT auth + role-based access |
| `src/routes/auth.js` | Login, /me endpoint |
| `src/routes/orders.js` | Orders CRUD, search, sort, filter, bulk actions |
| `src/routes/businesses.js` | Business CRUD with Domex API config |
| `src/routes/users.js` | User management |
| `src/routes/issues.js` | Issue queue, contact attempts, bulk operations |
| `src/routes/issue-upload.js` | Domex issue Excel upload |
| `src/routes/upload.js` | Order + delivery data Excel upload with column mapping |
| `src/routes/export.js` | Domex feedback export + analytics API |
| `src/routes/sync.js` | Domex API sync trigger + status |
| `src/routes/settings.js` | Resolution options per business |
| `src/routes/audit.js` | Audit log |
| `src/services/domex-sync.js` | Domex API integration — status sync, waybill fetch |

### Frontend

| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout with AuthProvider |
| `src/app/login/page.tsx` | Login page |
| `src/app/dashboard/page.tsx` | Main dashboard — sidebar, topbar, screen routing |
| `src/lib/api.ts` | API client with JWT |
| `src/lib/auth-context.tsx` | Auth state, login/logout, business switching |
| `src/components/Sidebar.tsx` | Navigation sidebar |
| `src/components/OverviewScreen.tsx` | Analytics dashboard |
| `src/components/OrdersScreen.tsx` | Order list with filters, sort, pagination, edit, bulk |
| `src/components/IssuesScreen.tsx` | Issue queue with contact workflow |
| `src/components/ExportScreen.tsx` | Domex feedback export |
| `src/components/AdminScreen.tsx` | Admin panel — businesses, users, settings, audit |
| `src/components/UploadModal.tsx` | Excel upload with column mapping |
| `src/components/StatusPill.tsx` | Status badge component |
| `src/components/DateRangeFilter.tsx` | Date picker with calendar icon |

## Database Tables

| Table | Purpose |
|---|---|
| `businesses` | Business units with Domex API config |
| `users` | Staff accounts with roles |
| `user_businesses` | User-business assignments |
| `orders` | All orders with delivery + sales data |
| `delivery_statuses` | Domex tracking timeline per order |
| `delivery_issues` | Issue queue entries |
| `issue_contacts` | Contact attempt records |
| `resolution_options` | Configurable resolution options per business |
| `column_mappings` | Saved Excel column mappings per business |
| `sync_status` | Domex sync progress tracking |
| `audit_logs` | All user actions |

## User Roles

| Role | Access |
|---|---|
| `admin` | Everything — all businesses, admin panel, settings |
| `issue_handler` | Upload orders, process issues, export — assigned businesses only |
| `viewer` | Read-only — orders and statuses only |

## Domex API Integration

- **Base URL:** `https://www.connectmesecure.com/api/CustomerInwards/`
- **Auth:** `x-api-key` header per business
- **Endpoints used:**
  - `getCustomerStatusDetails` — tracking status history
  - `getCustomerWayBillDetails` — customer/receiver details
- **Auto-sync:** Every 30 minutes for all configured businesses
- **Manual sync:** Sync button in topbar
- **Status mapping:** 27+ Domex codes mapped to system statuses
- `CIG` (Complete) is **ignored** — it's finance closure, not delivery confirmation

## Order Flow

1. Upload Sales Report → orders created as "New"
2. Domex API sync → updates status + fills customer details from waybill
3. Optional: Upload Delivery Sheet → fills receiver details
4. Sync continues updating statuses automatically

## Issue Workflow

1. Add orders to issues (bulk from orders or Domex issue upload)
2. Staff records contact attempts (max 3, 1-day gap between attempts)
3. Resolution: select suggested option or type custom text
4. 3rd "No Answer" → Auto-Return
5. Resolved issues available in Export screen

## Environment Variables

### Backend
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (if set, uses PG) |
| `JWT_SECRET` | JWT signing secret |
| `PORT` | Server port (default 4000) |
| `NODE_ENV` | `production` for Railway |
| `FRONTEND_URL` | Allowed CORS origins |

### Frontend
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API URL |

## Build Phases

- [x] Phase 1 — Foundation (auth, admin, basic order list)
- [x] Phase 2 — Order Management (Excel upload, Domex sync, column mapping)
- [x] Phase 3 — Issue Workflow (3-attempt contact, resolution options)
- [ ] Phase 4 — SMS & Notifications (Notify.lk — skipped for now)
- [x] Phase 5 — Export & Reports (Domex feedback export, analytics dashboard)
