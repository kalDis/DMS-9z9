# Delivery Management + Issue Handling — Build Spec (Handoff)

This document specifies a **Delivery Management & Issue Handling module** for a
multi-tenant, COD (cash-on-delivery) e-commerce operation in Sri Lanka, integrated with
the **Domex** courier. It is a distilled, battle-tested spec taken from a working system
("DMS"). Build this as a **module** inside the larger order-handling system.

> **Scope — build ONLY these two areas:**
> 1. **Delivery Management** — orders' delivery state, Domex courier sync, tracking timeline,
>    delivering-branch, priority, delivery exports, branch performance report.
> 2. **Issue Handling** — the call/return workflow for problem deliveries.
>
> **Explicitly OUT of scope (do NOT build):** Ad ROI, product master, product costs, the
> Products report. Those are separate concerns in the target system.
>
> **Assumed to already exist in the target system** (integrate with them, don't rebuild):
> the base **Orders** entity/CRUD/upload, a **Reports** area (the Branch Performance report
> below plugs into it), authentication, and users. Where this spec lists order fields or
> user roles, treat them as the fields/roles this module *requires* — add them if missing.

The reference implementation was Node/Express + PostgreSQL + Next.js, but **the rules below
are what matter** — implement them in whatever stack the target system uses. Column names
and endpoint paths are suggestions; the **behavior and business rules are the contract.**

---

## 1. Core concepts & terminology

- **Business (tenant):** each business has its own orders, staff, Domex API credentials, and
  settings. Everything is scoped by `business_id`. A user can belong to multiple businesses.
- **Order:** one delivery. Carries sales data + delivery state + courier tracking.
- **Delivery status:** the order's current delivery state (New → … → Delivered/Returned),
  derived from Domex tracking scans.
- **Issue:** a problem delivery that staff must work (call the customer, reschedule, or
  return). Lives in an issue queue. An order can have **many issues over its life** but only
  **one active** at a time.
- **Contact attempt:** a logged phone call on an issue, with an outcome and resolution.
- **Delivering branch:** the last-mile Domex branch that actually attempted delivery.
- **Colombo day:** calendar day in `Asia/Colombo` timezone — the basis for the calling cadence.

---

## 2. Data model

Only delivery/issue tables are listed. Add columns to existing `orders`/`users` as needed.

### `businesses` (tenant) — delivery-relevant fields
| Field | Notes |
|---|---|
| `id` | PK |
| `name` | display name |
| `domex_api_key` | per-business Domex `x-api-key` |
| `domex_customer_code` | per-business Domex customer code |
| `auto_return_feedback` | TEXT, default `'Dawas Dekak Balala Return Karanna'` — feedback text written to Domex export rows for auto-returned issues (admin-editable per business) |

### `orders` — delivery-relevant fields (add to existing entity)
| Field | Notes |
|---|---|
| `id` | PK |
| `business_id` | tenant scope |
| `tracking_number` | courier waybill no. **Stored UPPERCASE** (see §9) |
| `courier` | default `'domex'`; may be `'unknown'` until detected |
| `status` | delivery status (see §5) — default `'New'` |
| `customer_name`, `phone`, `address`, `city` | filled from courier waybill if missing |
| `product`, `item_names`, `amount`, `pieces`, `weight`, `exchange` | order contents |
| `order_date`, `pickup_date`, `delivered_date`, `dispatched_at` | dates |
| `priority` | `'high'` / `'normal'`, default `'normal'` (see §8) |
| `delivery_branch` | last-mile branch name, nullable (see §7) |

### `delivery_statuses` — courier tracking timeline (one row per scan)
`id`, `order_id`, `status_code` (Domex code), `status_text`, `location` (branch, see §7),
`remark`, `status_date`. **Unique** on `(order_id, status_code, status_date)` so re-sync is
idempotent (insert-or-ignore).

### `delivery_issues` — the issue queue
`id`, `order_id`, `business_id`, `source` (`'domex'` | `'internal'`), `status`
(`'open'` | `'in_progress'` | `'resolved'` | `'auto_return'`, default `'open'`),
`attempt` (INT, default 0 — see note), `assigned_to` (user, nullable), `reason` (TEXT — Domex
return reason), `domex_branch` (TEXT), `created_at`, `updated_at`, `resolved_at`.
- **`order_id` is NOT unique.** Enforce "one active issue per order" in code (§10.3).
- `attempt` is a stored counter but the **authoritative attempt count is derived live** from
  contacts (§10.1). Keep the stored value updated on each contact for convenience.

### `issue_contacts` — call attempts
`id`, `issue_id`, `attempt_number` (INT), `outcome` (`'answered'` | `'no_answer'`),
`resolution` (TEXT/label), `scheduled_date` (TEXT, nullable), `notes`, `contacted_by`,
`contacted_by_name`, `contacted_at` (TIMESTAMP).
- **Same-day calls share an `attempt_number`.** Always order contacts by `contacted_at`,
  **never** by `attempt_number` (a common bug source — see §12, §13).

### `resolution_options` — configurable per business
`id`, `business_id`, `label`, `action` (default `'resolve'`), `is_active` (bool), `sort_order`.
The dropdown of resolutions staff pick when logging an answered call.

### Support tables
- `delivery_statuses` sync progress: a single-row `sync_status` (`id=1`, `status`, `progress`,
  `total`, `updated`, `errors`, `last_sync`) for the auto-sync UI.
- `user_businesses` (user↔business many-to-many) for scoping.
- `audit_logs` (`user_id`, `user_name`, `action`, `business_name`, `created_at`) — log every
  mutating action (uploads, bulk changes, returns, exports, status changes).
- `column_mappings` (per business, saved Excel header→field mapping) if you support uploads.

**Migrations:** run at startup, idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`), safe to re-run on every deploy. Index `orders(status)`, `orders(priority)`,
`orders(delivery_branch)`, `delivery_issues(status)`, `delivery_statuses(order_id)`.

---

## 3. Roles & multi-tenancy

| Role | Access |
|---|---|
| `admin` | everything, all businesses, settings, **reports** |
| `issue_handler` | upload orders, process issues, export — **assigned businesses only** |
| `viewer` | read-only — orders + statuses |

- Every list/query is **business-scoped**: non-admins see only orders in their
  `user_businesses`. Enforce server-side on every endpoint, not just the UI.
- **Reports are admin-only** — enforce server-side (return 403 for non-admins), not just by
  hiding the menu.

---

## 4. Courier integration (Domex)

- **Base URL:** `https://www.connectmesecure.com/api/CustomerInwards/`
- **Auth:** `x-api-key` header, per business.
- **Two endpoints only:**
  - `getCustomerStatusDetails` → array of `{ statusCode, status, statusDate, remark, trackingNo }`
    (the tracking timeline).
  - `getCustomerWayBillDetails` → `{ receiverName, receiverContactNo, receiverAddress,
    receiverCity, value, weight, noOfPcs, exchange, createdDate, sender* }` (customer details).
- **No hold-reason field exists.** On a Hold scan the `remark` comes back empty — do not
  expect a reason from the API for holds.
- **Auto-sync every 30 minutes** for all configured businesses; **manual sync** button;
  **selected-orders sync** ("Get Latest Status" on a selection).
- On sync, for each order: fetch status history; if customer fields are missing, also fetch
  the waybill and fill them. Insert each scan into `delivery_statuses` (idempotent). Compute
  the new `status`, `pickup_date`, `delivered_date`, and `delivery_branch` (§7).
- **`courier = 'unknown'`** orders: after import, try each configured courier API to detect
  which one recognizes the tracking number; save the result. Show a courier badge + filter.

### 4.1 Status mapping (`statusCode` → system status)
Scan the history **from newest to oldest** and use the **first code that maps** to a non-null
status (this fixes orders stuck at "New" when the latest scan is an ignored/finance code).

| Domex codes | System status |
|---|---|
| `CI`, `CIU`, `I`, `IER` | `Dispatched` |
| `CC`, `SO`, `SCCI`, `M`, `A`, `RR`, `RTNB`, `RS`, `SRR`, `SRRA` | `In Transit` |
| `HI`, `HO` | `Hold` |
| `ATD` | `Out for Delivery` |
| `D`, `PS`, `CRC`, `CBR` | `Delivered` |
| `UD`, `UDH` | `Failed` |
| `R`, `RTS`, `RTH`, `RTN`, `RTNQ` | `Returned` |
| `CD` | *(null — no status change)* |
| `CIG` | **ignored** — finance closure code, not a delivery state |

Text fallback (when code unknown): match on `status` text — `delivered` (not `undelivered`)
→ Delivered; `out for delivery` → Out for Delivery; `hold` → Hold; `in transit`/`sort
facility` → In Transit; `returned`/`return` → Returned; `undelivered`/`failed` → Failed;
`received`/`collected`/`pickup` → Dispatched.

---

## 5. Order delivery statuses

Canonical set: `New`, `Waiting`, `Dispatched`, `In Transit`, `Hold`, `Out for Delivery`,
`Delivered`, `Failed`, `Returned`. (Plus `Exchange` as a flag, not a status.)

**"Pending Delivery"** is a filter group = `Dispatched, In Transit, Out for Delivery,
Waiting, Failed, Hold`. **Hold** is part of this group and has its own filter/pill.

---

## 6. Orders list — filters & behaviors (delivery-relevant)

The Orders screen must support (server-side filters + counts):
- **Status tabs** incl. the `Pending Delivery` group, `Hold`, `Has Issues` (orders with an
  active issue), `Exchange` (exchange flag set), and each concrete status.
- **Courier** filter (All / Domex / Unknown), **Priority** filter (All / High),
  **Delivery Branch** filter (dropdown of branches with counts — see §7).
- **Search** across tracking / customer / phone / order id / item names (case-insensitive).
- **Date range** on order date and pickup date.
- **Sort** by any main column (incl. `delivery_branch`), **pagination**.
- **Bulk actions** on a selection (and "select all across pages"): add to issues, change
  status, set priority, delete, export to Excel, get-latest-status (sync selected).
- **Issue dot** per order: red = active Domex issue, amber = active internal issue,
  green = resolved, grey = auto-returned. Show a legend.

---

## 7. Delivering branch (last-mile branch) — IMPORTANT LOGIC

Domex status text is like `"Delivered By Yakkala"` / `"Out For Delivery By Negombo"`. Parse
the branch as **the text after `"By "`** (`location = status.replace(/^.*By\s+/i, '').trim()`).
Store per scan in `delivery_statuses.location`, and store the order's **delivering branch** in
`orders.delivery_branch`.

**Delivering branch = the `location` of the MOST RECENT scan whose code is a *delivery
action performed by the delivering branch*:**

```
DELIVERY_ACTION_CODES = ['ATD','D','PS','UD','UDH','RS','HI','HO','RTNB']
```
(out-for-delivery, delivered, POD, failed attempt, reschedule, hold, return-to-next-branch.)

**Deliberately EXCLUDED:** `A` ("Parcel Received By X") and `RTN` ("Return To Customer By
X"). These fire at the **origin** branch when a returned parcel comes back — including them
mis-attributes returns to the origin. (Real bug we hit: the origin branch "Digana" showed a
98% return rate because return-receipt `A` scans won. Excluding `A`/`RTN` and using the code
set above fixed it — returns then correctly attribute to the branch that attempted delivery.)
Also excluded: `I`/`CC`/`SO` (origin dispatch) and `SCCI`/`M` (sort/transit hubs).

- Populate `delivery_branch` on every sync (both full and selected-sync paths).
- **Backfill** from existing `delivery_statuses`: for each order, take the location of the
  most recent scan whose code ∈ DELIVERY_ACTION_CODES and location ≠ ''. Set-based, idempotent
  (only write when the value changes). Add a second pass that **NULLs** `delivery_branch` for
  orders that have **no** delivery-action scan (so stale values get cleared).
- An order still in transit (no delivery-action scan yet) legitimately has **no** delivering
  branch — that's correct, leave it null.

---

## 8. Order priority (manual, High/Normal)

- `orders.priority` = `'high'` | `'normal'`, default `'normal'`. **Manual only** (no rules).
- Set via a bulk action ("Set Priority → High/Normal") and a per-order toggle.
- Filter row (All / 🔴 High) with a live High count; a red **HIGH** badge on flagged rows.
- Every change audit-logged.

---

## 9. Tracking numbers

- **Normalize to UPPERCASE on ingest** (canonical storage) so there are no case-only dupes.
- **Match case-insensitively everywhere** (`UPPER(tracking_number) = UPPER($input)`): order
  upload, delivery-sheet upload, Domex issue upload. Search uses case-insensitive `LIKE`.
- A courier "not found" waybill is **usually a case mismatch, not a missing order** — check
  case first before treating it as missing.

---

## 10. Issue Handling — the core workflow

An issue is a problem delivery staff must resolve by phone or return. This is the heart of
the module. Get the cadence rules exactly right.

### 10.1 Day-based calling cadence
- **1 attempt = 1 day of trying.** Same-day re-calls do **NOT** increment the attempt.
  A "No Answer" on a **new Colombo calendar day** does.
- **Attempt count is derived live** from contact history = number of distinct
  `Asia/Colombo` calendar days that have a `no_answer` call. **No midnight cron** — always
  computed on read.
- **No time lock** — staff may call anytime; the cadence is purely day-based.
- `MAX_ATTEMPTS = 2`. After 2 days of no-answer, the issue moves to the **To Return** bucket.
- Use `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' })` (or equivalent) to get the
  Colombo `YYYY-MM-DD` for both "now" and each `contacted_at`.

### 10.2 Issue queue buckets (tabs)
The issue list is served by bucket. Compute buckets in code from Colombo dates:
- **To Call Today** — active issues not yet called today. Split into two sections:
  `followup` (called on a previous day — sort these on top) and `new` (never called).
- **Called Today** — active issues already called today, sorted **oldest-call-first** so that
  re-calling an issue drops it to the bottom (a natural rotation).
- **To Return** — active issues with `derived_attempts >= MAX_ATTEMPTS` **and** whose last
  call was on a previous day. **Nothing auto-returns** — staff confirm here.
- **Resolved** — closed as resolved.
- **Auto Return** — closed as returned via the To-Return flow.
- Paginate (e.g. 50/page).

### 10.3 One active issue per order
- Only a `status IN ('open','in_progress')` issue blocks a new one. **Every add path** must
  check this: manual add, bulk "add to issues", Domex issue upload, missing-order import.
- Once an issue is closed (resolved/auto_return), a **new** issue can be raised for the same
  order (e.g. Domex issue resolved, later the customer cancels → new internal issue).
- Bulk add returns a `skipped_active` count so the UI can explain what it skipped.
- The Orders list's issue source/status = the **active** issue if any, else the most recent
  closed one (drives the dot color).

### 10.4 Logging a contact (call)
`POST /issues/:id/contact` with `{ outcome, resolution?, scheduled_date?, notes? }`:
- **No time lock, NO auto-return.**
- `newAttempt = sameColomboDay ? currentAttempt : currentAttempt + 1`.
- If `outcome = 'answered'`, a resolution is required (a picked `resolution_options` label OR
  free-text). Answered typically resolves the issue (`status='resolved'`, `resolved_at=now`).
- If `outcome = 'no_answer'`, record it; the issue stays active and the derived attempt count
  drives whether it later appears in To Return.
- Insert an `issue_contacts` row; keep `delivery_issues.attempt`/`updated_at` fresh.

### 10.5 Confirming returns (never automatic)
`POST /issues/bulk-return` accepts either `{ issue_ids: [...] }` or
`{ return_all: true, business_id, source }` (server **recomputes** the eligible To-Return set —
don't trust a client list for "all"). For each: set issue `status='auto_return'` and the
order `status='Returned'`. Audit-log it.

### 10.6 Resolution options (configurable)
Admins (and issue handlers for their businesses) manage `resolution_options` per business
(add / enable-disable / reorder / delete). These populate the resolution dropdown in 10.4.

### 10.7 Issue history on an order
`GET /orders/:id/issue-history` → all issues for the order (oldest first), each with its
contacts. UI shows an "Issue History" section (status, source, Domex reason, every call
attempt; "Issue #n of m" when multiple).

---

## 11. Domex issue upload + missing-order recovery

- **Domex issue upload:** staff upload a Domex-provided sheet of problem waybills. Match rows
  to orders by tracking number (case-insensitive). Create an issue (`source='domex'`) for each
  matched order that has no active issue.
  - Parse **Reason** and **Branch** columns **fuzzily** (`header.includes('reason')` /
    `includes('branch')`) — exact-match header checks silently drop headers like "Return
    Reason". Store into `delivery_issues.reason` / `domex_branch`.
  - **Re-uploading backfills** missing reason/branch onto an existing issue (return an
    `updated` count) rather than skipping — repairs previously-missed reasons.
  - Provide a **confirmation/dry-run step** before committing (show what will be created).
- **Missing-order recovery:** for waybills not found locally, offer a two-step flow:
  `resolve` (read-only Domex lookup → split resolvable/unresolvable) then `import` (create
  order + status history + issue). Never create blank orders for unresolvable waybills.

---

## 12. Auto-return feedback text (per business)

- `businesses.auto_return_feedback` (default `'Dawas Dekak Balala Return Karanna'`),
  admin-editable per business via settings.
- Used by the Domex feedback export: auto-returned issues get this text as their feedback
  instead of a generic "Auto-Return".

---

## 13. Exports

### 13.1 Delivery list (Excel)
`GET /orders/export?ids=...` → xlsx with Tracking, Customer, Phone, Address, City, Product,
Amount, Pieces, Weight, **Delivery Branch**. Role-scoped. Works with select-all-across-pages.

### 13.2 Domex feedback export (resolved issues)
Export resolved issues for feedback to Domex — a "Domex" tab and an "Internal" tab. Select
specific resolved issues or export all by date range. Paginated.
- **CRITICAL:** when looking up an issue's resolution/scheduled_date/notes for the export,
  order the contacts by **`contacted_at DESC`**, NOT `attempt_number` — same-day calls share
  an `attempt_number`, and ordering by it picked the wrong (no-answer) row and exported the
  literal word "Resolved" instead of the real reason. This was a real bug.

---

## 14. Branch Performance report (delivery report → target's Reports module)

A per-delivering-branch scorecard. (Belongs in the target system's Reports area, but the data
and math come from this module. **Admin-only.**)
- `GET /reports/branch-performance?business_id&date_from&date_to` (date range on order date).
- One row per `delivery_branch` (exclude null branches):
  - **Total**, **Delivered** (status=Delivered), **Returned** (status=Returned),
    **Pending** = Total − Delivered − Returned.
  - **Return Rate %** = Returned ÷ (Delivered + Returned) — i.e. of *completed* orders, not of
    total (pending shouldn't dilute it).
  - **Delivered %** = Delivered ÷ Total.
- Sortable columns; totals row; Excel export. Color the return rate (≤5% green, ≤12% amber,
  else red).
- Also expose `GET /reports/branches` (or `/orders/branches`) → distinct delivering branches
  with counts, to populate the Orders delivery-branch filter (this one is **not** admin-only —
  all roles use the Orders filter).

---

## 15. Suggested API surface

Delivery:
- `GET /orders` (filters: status, search, dates, courier, priority, delivery_branch; paginated;
  returns status counts incl. Pending Delivery / Has Issues / Exchange / High Priority)
- `GET /orders/ids` (all matching ids, for select-all)
- `GET /orders/:id/tracking` (delivery_statuses timeline)
- `GET /orders/:id/issue-history`
- `POST /orders/bulk` (`add_issues` | `change_status` | `set_priority` | `delete`)
- `GET /orders/export` (xlsx), `GET /orders/branches`
- `POST /sync` (all), `POST /sync/selected`, `POST /sync/detect-courier`, `GET /sync/status`

Issues:
- `GET /issues?bucket=to_call_today|called_today|to_return|resolved|auto_return` (paginated)
- `POST /issues/add`, `POST /issues/:id/contact`, `POST /issues/bulk-return`
- `GET/POST/PATCH/DELETE /resolution-options` (per business)
- `POST /upload/domex-issues` (+ dry-run), `POST /upload/domex-issues/resolve`,
  `POST /upload/domex-issues/import`

Settings/reports:
- `GET/PUT /settings/auto-return/:businessId` (PUT admin-only)
- `GET /reports/branch-performance` (admin-only, + `?format=xlsx`)

---

## 16. Gotchas / rules checklist (get these right)

1. **Colombo timezone** for all calling-cadence date math. Attempt = distinct no-answer days.
2. `MAX_ATTEMPTS = 2` — if duplicated in backend + frontend, keep them in sync.
3. **Nothing auto-returns.** Returns are always a staff confirmation (To Return → bulk-return).
4. **One active issue per order**, enforced on every add path; closed issues allow a new one.
5. Order `issue_contacts` by **`contacted_at`**, never `attempt_number` (same-day tie bug).
6. Tracking numbers **UPPERCASE on ingest**, matched case-insensitively everywhere.
7. Delivering branch uses `ATD/D/PS/UD/UDH/RS/HI/HO/RTNB`; **exclude `A` and `RTN`** or
   returns mis-attribute to the origin branch.
8. Status detection scans **newest→oldest** for the first mappable code; **ignore `CIG`**.
9. `HI`/`HO` → **Hold** status (part of Pending Delivery group, own filter).
10. **No hold-reason** from the Domex API (remark empty on holds).
11. Everything **business-scoped**; **reports admin-only** — enforce server-side.
12. Migrations idempotent (`IF NOT EXISTS`), safe on every deploy.
13. Audit-log every mutation (uploads, bulk ops, returns, status changes, exports).

---

## 17. Build order (suggested)

1. Data model + migrations (§2) and business scoping/roles (§3).
2. Domex sync + status mapping + tracking timeline (§4, §5) — including delivering branch (§7).
3. Orders list filters/bulk/priority/exports (§6, §8, §13.1).
4. Issue queue + day-based buckets + contact + bulk-return + resolution options (§10).
5. Domex issue upload + missing-order recovery (§11) + auto-return text (§12) + feedback
   export (§13.2).
6. Branch Performance report (§14).
7. Walk the gotchas checklist (§16) as an acceptance test.
