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

The design targets approximately 50,000 vendors and potentially millions of scans, leads, and audit logs while keeping the application monolithic and maintainable.

- Use explicit indexes for QR lookup, vendor ownership, historical attribution, status, and timestamps.
- Enforce uniqueness in PostgreSQL, not only in application code.
- Never return an unbounded administrative collection.
- Use bounded pagination everywhere; use cursor/keyset pagination for large scans, leads, and audit logs.
- Prefer indexed identifier or prefix-compatible vendor search. Do not use unrestricted leading-wildcard searches across large tables.
- Keep audit logs in PostgreSQL initially and paginate them.
- Add shared caching or rate limiting only when deployment topology or measured traffic requires it.

## Operational Separation

Admin, Sales, Vendor, and public flows remain logically separated in both frontend routes and backend authorization. The separation is a security boundary, not merely hidden navigation.

The implementation proceeds in the order defined by `plan.md`: foundation, database, authentication, authorization, QR and onboarding flows, public referral flow, attribution, payout status, audit logging, role UIs, hardening, and validation.
