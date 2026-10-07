# Solarium Technical Architecture

This document is the technical reference for implementing Solarium. Product scope and business decisions remain defined in the root `plan.md` and `requirements.md`.

## System Boundary

```text
Browser
  |-- Public QR referral flow
  |-- Vendor portal
  |-- Sales portal
  `-- Admin portal
          |
          v
      Node.js / Express API
          |
      Authentication and authorization
          |
      Application services
          |
      Prisma ORM
          |
      PostgreSQL via Supabase
```

The frontend and backend are separate codebases or directories. The frontend may be served from the same domain as the API:

```text
https://solariumenergy.in/       -> frontend
https://solariumenergy.in/api/*  -> backend
```

Do not introduce microservices, a separate QR service, a separate payout service, or a separate authentication service for the current scope.

## Runtime Components

### Frontend

- React application for public, Vendor, Sales, and Admin experiences.
- Role-specific route guards are for navigation and presentation only.
- The frontend never determines authority from a submitted role or vendor ID.

### Backend

- Node.js and Express REST API.
- Centralized validation, authentication, authorization, error handling, and audit logging.
- Business operations that change attribution or payout state run inside database transactions.

### Database

- PostgreSQL hosted by Supabase.
- Prisma is the database access layer.
- Database uniqueness and integrity constraints are authoritative.
- Use deployment-appropriate PostgreSQL connection pooling.
- The runtime connects via Supabase's direct/session-mode connection (`DIRECT_URL`), not the transaction-mode pooler (port 6543). Prisma's interactive `$transaction()` — used throughout this app's mutations (vendor/staff-user CRUD, QR generate/assign/reassign, lead submission, payout mark-paid) — is unreliable against transaction-mode pooling under concurrent load (a documented Prisma/Supabase incompatibility, confirmed live during the `docs/testing.md` verification pass: intermittent `P2028` failures under load through the pooler, none through the direct connection). At the current single-instance scope this is a non-issue. Revisit only when multiple backend instances or measured high write concurrency require more connection headroom than the session-mode pool provides — options then include a dedicated pooler tier sized for interactive transactions, splitting reads (pooler-safe) from writes (direct connection) across two Prisma clients, or reducing reliance on interactive transactions in the hottest paths. Do not switch back to the transaction-mode pooler for the runtime without addressing this.

Supabase Auth is not used. Authentication is server-controlled with secure HTTP-only sessions or an equivalent server-managed session mechanism.

## Authentication and Authorization

There are three authenticated roles:

- `ADMIN`: unrestricted system administration.
- `SALES`: assigned vendor onboarding and unassigned QR activation.
- `VENDOR`: authenticated vendor's own profile, referrals, and payout status.

The public QR flow is unauthenticated.

Every protected request must derive identity and role from the server-managed session. Authorization middleware must enforce the route policy and resource ownership. The application must not trust `role`, `vendor_id`, or `sales_user_id` supplied by the browser.

Sales visibility is restricted by explicit vendor ownership, such as `vendor.sales_user_id` or an approved sales-team ownership model. Vendor queries are always scoped to the authenticated vendor.

## Main Request Flows

### Public QR flow

```text
GET /v/:qrCode
  -> find unique QrCode.code
  -> resolve the current active assignment
  -> resolve the vendor
  -> create a scan with immutable attribution
  -> show the public referral/lead journey
```

The lookup must use indexed fields and must not scan the complete assignment history. Invalid, unassigned, inactive, and retired QR codes receive an appropriate public response without exposing internal IDs or sensitive vendor data.

The endpoint is rate-limited server-side. An in-memory limiter is acceptable for one backend instance; a shared Redis-compatible store is required before horizontally scaling the backend.

### Sales onboarding flow

```text
Sales login
  -> view registrations owned by or assigned to the salesperson
  -> select or complete a vendor
  -> scan or enter an UNASSIGNED QR
  -> assign the QR in a transaction
  -> activate the QR
```

Sales cannot reassign an active QR, view unrestricted leads, view payouts, or access Admin routes.

### Admin reassignment flow

```text
Admin login
  -> select an active QR
  -> close the current assignment
  -> create the new assignment
  -> preserve historical records
  -> write an audit log
```

Closing and creating assignments must be one transaction. Existing scans, leads, and payouts are never rewritten to the new vendor.

### Vendor data flow

```text
Vendor login
  -> resolve the authenticated vendor from the session
  -> query only records belonging to that vendor
  -> allow profile/password changes
  -> expose own referral and payout status
```

Payouts are manual `UNPAID` or `PAID` records. There is no commission engine, approval workflow, PAN/TDS flow, or automated payout integration.

## Scalability Constraints

### QR artwork and placement

Admin QR templates accept an optional `artwork` multipart file. The backend stores it in the private `SUPABASE_QR_STORAGE_BUCKET` bucket (default `qr-artifacts`) and stores only the object key and file metadata in `qr_print_templates`. Artwork upload does not decide QR placement.

Placement remains explicit template data: `qr_x`, `qr_y`, `qr_width`, and `qr_height` are measured in millimetres relative to the physical page. The optional label coordinates and font size use the same coordinate system. A future proof renderer must convert millimetres to PDF points using `points = millimetres * 72 / 25.4`, preserve the template page dimensions, and place the generated QR at those exact coordinates.

The admin UI should show the artwork filename, page dimensions, and a preview with a clearly marked QR placeholder. Before a template is published, verify that the placeholder is inside the page bounds and does not overlap required artwork content. After publishing, treat the template geometry as immutable; corrections create a new version. A print batch snapshots the published template ID and QR range, and proof approval must happen before final PDF generation.

The design targets approximately 50,000 vendors and potentially millions of scans, leads, and audit logs while keeping the application monolithic and maintainable.

- Use explicit indexes for QR lookup, vendor ownership, historical attribution, status, and timestamps.
- Enforce uniqueness in PostgreSQL, not only in application code.
- Never return an unbounded administrative collection.
- Use bounded pagination everywhere; use cursor/keyset pagination for large scans, leads, and audit logs.
- Prefer indexed identifier or prefix-compatible vendor search. Do not use unrestricted leading-wildcard searches across large tables.
- Keep audit logs in PostgreSQL initially and paginate them.
- Add shared caching or rate limiting only when deployment topology or measured traffic requires it.

## Account types, portals and permissions

| Type | Portal / cookie | Rights |
| --- | --- | --- |
| `ADMIN` | Admin | everything (super-admin) |
| `STAFF` | Admin (same cookie), filtered | only the permissions of its custom role (`staff_roles.permissions`) |
| `SALES` | Sales | own assigned leads plus onboarding and QR activation |
| `VENDOR` | Vendor | own data |

`requireAdmin` guards super-admin-only routes; `requirePermission(...)` (any-of) guards delegable routes and admits `ADMIN` always. `requireAuth` loads the session, the user and the user's role from the database on every request, so a role edit, deactivation or account-type change applies immediately. The Admin UI gets the permission list from the session (`account.permissions`) and the catalog from `GET /admin/roles`; it hides screens and controls, but the backend check is the real gate. Lead ownership and locking rules live in `backend/src/lib/lead-ownership.js` (locks in a fixed order: assignee row first, then leads by id).

## Operational Separation

Admin, Sales, Vendor, and public flows remain logically separated in both frontend routes and backend authorization. The separation is a security boundary, not merely hidden navigation.

The implementation proceeds in the order defined by `plan.md`: foundation, database, authentication, authorization, QR and onboarding flows, public referral flow, attribution, payout status, audit logging, role UIs, hardening, and validation.
