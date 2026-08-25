# Solarium Implementation Plan

This repository currently contains a Create React App frontend shell.

The system will be implemented as a minimal full-stack referral attribution platform for Solarium Energy.

The current business scope is limited to:

- QR inventory and vendor attribution
- Vendor self-registration and sales-assisted onboarding
- Vendor login with password-based access
- Public QR referral flow
- Lead capture and customer deduplication
- Historical attribution and QR reassignment tracking
- Manual payout status tracking only
- Admin, sales, and vendor role separation

This is not a CRM, not a commission platform, and not a payout automation system.

---

## 1. Goal

Build a secure, maintainable referral system that supports:

1. Physical QR inventory management
2. Vendor onboarding and registration
3. Sales-assisted QR assignment
4. Public referral/lead capture
5. Historical attachment of leads and scans to the correct vendor
6. Manual payout status tracking only
7. Role-based admin/sales/vendor access
8. Audit logging for sensitive business actions

---

## 2. Architecture

### Backend and frontend separation

```text
/frontend
  → customer-facing and role-based UI
/backend
  → REST API, auth, business logic, database access
```

The front end and back end remain separate codebases/directories.

The application may be hosted on the same infrastructure/domain, for example:

```text
solariumgreenenergy.in
    → frontend

solariumgreenenergy.in/api/*
    → backend
```

This keeps the architecture simple and production-appropriate without introducing unnecessary microservices or fragmented deployment patterns.

### Runtime stack

```text
Frontend
  ↓
Backend (Node.js / Express)
  ↓
Prisma ORM
  ↓
PostgreSQL via Supabase
```

Supabase is used as the PostgreSQL hosting provider.

Supabase Auth is not used for this project.

Authentication and authorization remain server-controlled.

### Scalability target

The initial architecture must support approximately 50,000 vendors without introducing microservices or an enterprise-only platform design.

The expected high-volume records are scans, leads, and audit logs rather than vendor records alone. The implementation must therefore prioritize indexed transactional lookups, bounded result sets, immutable historical attribution, and a fast public QR path.

Keep the following architecture at this scale:

- React frontend and Node.js/Express backend
- Prisma and PostgreSQL via Supabase
- Separate Admin, Sales, Vendor, and public routes
- No microservices, Kafka, Elasticsearch, Kubernetes, GraphQL, CQRS, event sourcing, or separate QR/payout/authentication services unless a later measured requirement justifies them

Use connection pooling through the deployment and database configuration. Do not add Redis on day one solely for scale; introduce a shared Redis/Upstash Redis rate limiter or cache only when multiple backend instances or measured traffic requires it.

The system should be designed for 50,000 vendors and millions of scans, leads, or audit records without treating 50,000 vendors as a reason to overcomplicate the application.

---

## 3. Role Model

The system has three authenticated roles:

- `ADMIN` — full system control
- `SALES` — field onboarding and QR assignment only
- `VENDOR` — own profile, own referrals, and own payout status only

The public customer flow remains unauthenticated.

The frontend must consume the backend through the centralized API client, include credentials for server-managed sessions, and provide loading, validation, success, empty, and error states for each implemented workflow.

---

## 4. Role Separation

### ADMIN

Admin has full control over:

- vendors
- QR inventory
- QR assignments and reassignment
- scans
- leads
- payout status
- sales users
- vendor users
- audit logs
- system configuration

Admin is the only role with unrestricted system access.

Admin can:

- create vendors
- modify vendors
- deactivate vendors
- soft-delete vendors where appropriate
- reset vendor passwords
- manage sales users
- reassign active QR codes
- mark eligible payouts as `PAID`
- review audit logs

Admin must also have a secure staff password-change/reset flow.

An Admin can never deactivate or demote their own account (change their own `status` away from `ACTIVE` or their own `role` away from `ADMIN`), independent of the last-active-Admin protection — this is checked before the last-Admin check and applies even when other Admins exist.

---

### SALES

Sales users exist specifically for field onboarding and vendor enablement.

Sales users can:

- log into the sales portal
- view vendor registrations relevant to their role
- contact the vendor using the registration information
- onboard vendors
- view operational vendor information required for onboarding
- scan or enter an unassigned QR code
- assign an unassigned QR to a vendor
- view QR assignment status for their own work

Sales users cannot:

- access the admin dashboard
- access customer phone numbers beyond the minimum operational need for onboarding
- access unrestricted lead data
- access payout information
- mark payouts as paid
- reassign active QR codes
- access audit logs
- access system settings
- access other salespeople's private data unless explicitly authorized

Backend authorization must enforce these restrictions.

Hiding UI elements is not sufficient.

---

### VENDOR

Vendors authenticate using a username or mobile-number login identifier plus a password.

The vendor account is created through a hybrid registration/onboarding workflow.

The vendor may self-register through the vendor registration page, providing at minimum:

```text
business_name
owner_name
mobile_number
login_identifier
```

After self-registration:

```text
Vendor registers
    ↓
Vendor contact details stored
    ↓
Sales team sees the registration
    ↓
Salesperson contacts the vendor
    ↓
Salesperson completes onboarding
    ↓
Salesperson completes QR assignment
```

The vendor does not independently activate or assign a QR during registration.

The salesperson handles the actual onboarding and assignment in the `/sales` area.

For authorization at scale, every vendor must have an explicit sales ownership value, such as `sales_user_id` (or a deliberately chosen sales-team ownership field). Sales visibility is limited by that ownership value and must not default to every salesperson seeing every vendor.

Vendors can:

- log in
- change password
- view own profile
- view own referrals/leads
- view own payout status/history

Vendors cannot:

- modify attribution
- assign or reassign QR codes
- access other vendors
- access sales data
- access admin data
- modify payout status

---

## 5. Vendor Registration and Onboarding Flow

### Vendor self-registration

Vendor self-registration is allowed.

The vendor provides:

```text
business_name
owner_name
mobile_number
login_identifier
```

This creates a vendor record with the contact information, but it does not grant QR activation or assignment rights.

### Sales-assisted onboarding

A separate `/sales` application handles onboarding.

The salesperson can:

- view vendor registrations relevant to their work
- contact the vendor using the stored contact information
- onboard the vendor
- complete QR assignment
- assign unassigned QR codes to the appropriate vendor

The salesperson must not receive access to the admin dashboard.

---

## 6. Vendor Password Flow

The vendor account is created through the registration/onboarding flow, but the salesperson handles the initial account setup during onboarding.

The salesperson sets or receives a temporary password for the vendor account.

Never store the temporary password in plaintext.

Store only:

```text
password_hash
must_change_password
```

Set:

```text
must_change_password = true
```

on first-time onboarding or reset.

When the vendor first logs in:

```text
Vendor login
    ↓
Temporary password accepted
    ↓
Force password-change screen
    ↓
Vendor sets permanent password
    ↓
must_change_password = false
```

The temporary password must no longer be usable once the permanent password is set.

### Forgotten password

If a vendor forgets their password:

```text
Vendor
  ↓
Contacts Solarium Energy
  ↓
Admin verifies vendor
  ↓
Admin resets vendor password
  ↓
Temporary password is issued
  ↓
Vendor logs in
  ↓
Vendor must set a new password
```

Admin must have a secure vendor password reset capability.

The reset must follow the same `must_change_password` mechanism.

Do not build:

- email password-reset links
- vendor OTP password recovery
- SMS/email automated recovery

---

## 7. QR Inventory Model

QR codes are physical inventory identifiers, not secret vendor identifiers.

The public URL format remains:

```text
https://solariumgreenenergy.in/v/V-0001
```

or the project's finalized equivalent.

QR inventory may use sequential identifiers such as:

```text
V-0001
V-0002
V-0003
...
V-20000
```

The system must support generating a substantially larger inventory without architectural changes.

It is acceptable for someone to know or guess a QR identifier.

The QR identifier itself does not determine the vendor.

The database relationship determines the current vendor assignment.

### QR code entity

Conceptually:

```text
id
code
status
created_at
updated_at
```

QR statuses:

```text
UNASSIGNED
ACTIVE
INACTIVE
RETIRED
```

### QR assignment entity

Conceptually:

```text
id
qr_code_id
vendor_id
assigned_by
assigned_at
unassigned_at
```

The assignment history must be preserved.

When a QR is reassigned:

1. close the previous assignment
2. create a new assignment
3. record who performed the reassignment
4. preserve the old assignment permanently for historical attribution

Never modify old scans, leads, or referrals to point to the new vendor.

Database constraints and indexes must support the public lookup and assignment lifecycle. At minimum:

- `QrCode.code` must be unique and indexed.
- `QrCode.status` must be indexed.
- `QrAssignment.qr_code_id`, `vendor_id`, `assigned_at`, and `unassigned_at` must be indexed.
- The data model must enforce at most one active assignment for a QR code according to the database's chosen active-assignment representation.

### QR printing and export

Confirmed scope (previously an open question in `RFI.md`; now decided): Admin must be able to generate printable, physical QR code images for the inventory, filterable by status and by current vendor assignment.

Requirements:

- The QR image encodes only the public referral URL (`${APP_BASE_URL}/v/:code`) — the same "no private data in the QR" rule from this section applies; never encode an internal database id or vendor id.
- Admin can export/print by `status` (`UNASSIGNED`, `ACTIVE`, `INACTIVE`, `RETIRED`, or all) and optionally filtered to a single Vendor's currently assigned codes.
- Admin can download a single QR as an image, or generate a printable sheet for a batch.
- A batch export is bounded (a fixed maximum codes per request, consistent with this plan's bounded-collection rule elsewhere) rather than unbounded — a very large inventory is paginated across multiple export requests, not rendered in one unbounded response.
- The printable sheet is a print-friendly HTML page (grid of QR image + code + status + assigned vendor name per cell), opened in the browser and printed via the browser's native print-to-PDF — this avoids adding a server-side PDF-generation dependency for a need the browser already satisfies.
- Generating a QR image is a read-only export action; it does not require an audit log entry (no state change), matching the read-only treatment of scans/audit-logs elsewhere in this plan.
- This introduces exactly one new backend dependency: a QR-image-generation library. Keep it to a single well-established, pure-JS package (no native build step) rather than a broader document-generation toolkit.

This is added to `tasks.md` as its own sequenced set of steps — implemented and verified one step at a time, the same as every other slice in this plan, not built in one pass.

---

## 8. QR Database Relationship

Maintain a relational model equivalent to:

```text
Vendor
    ↓
QrAssignment
    ↓
QrCode
```

`QrCode` represents the physical QR inventory item.

`QrAssignment` represents the relationship between a QR and a vendor.

This relationship must preserve history.

The QR itself is not the vendor.

### Core indexes and uniqueness

Create explicit database indexes for the actual lookup and administration patterns:

```text
Vendor: mobile_number, login_identifier, status, created_at
QrCode: code, status
QrAssignment: qr_code_id, vendor_id, assigned_at, unassigned_at
Lead: vendor_id, qr_id, customer_hash, created_at, status
Scan: qr_id, created_at
Payout: vendor_id, status, paid_at
```

Enforce uniqueness at the database level where appropriate, including QR codes, vendor login identifiers, and the configured customer deduplication identity. Application checks alone are insufficient.

The public QR path must remain a simple indexed lookup:

```text
/v/:qrCode
  → unique QrCode.code
  → current active assignment
  → Vendor
```

It must not search or join across the complete assignment history for every request.

---

## 9. Final QR Onboarding Flow

The operational flow is:

```text
Vendor self-registers
        ↓
Sales team receives/sees registration
        ↓
Salesperson contacts vendor
        ↓
Salesperson visits vendor
        ↓
Vendor account is completed/onboarded
        ↓
Salesperson scans or enters physical QR
        ↓
System resolves QR
        ↓
QR must be UNASSIGNED
        ↓
Salesperson selects the vendor
        ↓
V-0001 → vendor_id
        ↓
QR becomes ACTIVE
        ↓
Onboarding complete
```

The sales dashboard must support selecting a vendor by unique vendor identifier/name/login identifier and assigning the scanned or entered QR to that vendor.

The Sales UI must complete onboarding before assignment, retain the returned Vendor identifier for the assignment request, show the QR status before assigning, and refresh state after a successful operation. It must never submit a registration identifier where the API requires a Vendor identifier.

Do not place the vendor ID in the QR URL.

The URL remains:

```text
/v/:qrCode
```

The backend resolves:

```text
qrCode
    ↓
active QrAssignment
    ↓
vendor_id
    ↓
Vendor
```

---

## 10. QR Reassignment

Only ADMIN can directly reassign an active QR.

Sales users cannot directly reassign an active QR.

For the current scope:

```text
SALES
    → assign UNASSIGNED QR

ADMIN
    → reassign ACTIVE QR
```

Keep this simple.

Do not create a reassignment-request workflow unless fully specified elsewhere.

Reassignment must run in a transaction so the previous assignment is closed and the new assignment is created without two active assignments for the same QR.

---

## 11. Public QR Flow

The public endpoint remains unauthenticated:

```text
/v/:qrCode
```

Backend flow:

```text
Validate QR code
    ↓
Resolve active QR assignment
    ↓
Resolve vendor
    ↓
Create scan/referral record
    ↓
Continue to referral/lead flow
```

If the QR is invalid, unassigned, inactive, or retired, show an appropriate public error/inactive page.

Do not expose internal database IDs or sensitive vendor information.

The public QR endpoint must have server-side rate limiting and abuse protection.

Rate limiting must be deployable with a shared store when the backend runs on multiple instances. An in-memory limiter is acceptable only for a single-instance deployment.

The in-memory limiter's request-window cache evicts stale entries on a periodic sweep (every 5 minutes) so it does not grow unbounded over the life of the process; it is not persisted and resets on restart, which remains acceptable for the current single-instance deployment.

Do not rely only on frontend protection.

---

## 12. Historical Attribution

Historical attribution is mandatory.

When a customer scans a QR:

```text
QR
 ↓
Assignment active at scan time
 ↓
Vendor
 ↓
Scan/referral
 ↓
Lead
```

The vendor attribution captured at the qualifying scan/referral event must be immutable.

Later QR reassignment must not change:

- historical scans
- historical leads
- historical payouts

If `QrAssignment` is used to resolve attribution, store the relevant assignment/vendor reference on the historical record where necessary so historical attribution does not depend on the QR's current assignment.

At lead creation, persist all attribution references required by the business record:

```text
vendor_id
qr_id
qr_assignment_id
scan_id
```

Old leads must remain attached to the original vendor after a QR is reassigned.

---

## 13. Vendor Deletion

Do not hard-delete vendors that have historical business records.

Use soft deletion or deactivation.

Admin may:

- create vendors
- modify vendors
- deactivate vendors
- soft-delete vendors where appropriate

Historical QR assignments, scans, leads, and payout records must remain intact.

The Admin "delete" action (distinct from deactivate) is a soft delete: it sets the Vendor's status to `DELETED` and is only permitted when the Vendor has zero historical leads, scans, payouts, and QR assignment records. If any exist, the action is rejected with a clear message directing the Admin to deactivate instead. A `DELETED` Vendor is excluded from the default Admin vendor list and cannot log in (session revocation already applies to any non-`ACTIVE` status).

---

## 14. Customer Identity and Deduplication

Normalize mobile numbers.

Generate a server-side HMAC-based customer identity.

Do not use raw phone numbers as the attribution identity.

The system must support duplicate prevention for the same customer based on the configured attribution rule.

Customer deduplication must be implemented at the database and transaction level where appropriate.

---

## 15. Lead and Referral Model

Every lead/referral must retain immutable attribution to the vendor and QR assignment active at the time of the relevant scan/referral event.

A scan does not automatically mean the same as a lead.

A customer may scan without submitting a lead, and a lead may remain in a non-converted state.

Lead/referral fields should include at minimum:

```text
lead_id
vendor_id
qr_id
scan_id
customer_hash
customer_name
phone
email
location
status
created_at
updated_at
```

The actual phone number must be protected and must not be exposed to vendors unless explicitly required later.

---

## 16. Payout Status Model

The project does not currently include a commission calculation or commission approval system.

The system only tracks payout status.

Use only:

```text
UNPAID
PAID
PARTIAL
```

`PARTIAL` is a manually-set status, same as `PAID` — it does not imply or store any partial amount, split, or commission calculation. It exists purely as a third informational label an Admin can set manually, no different in kind from `PAID`.

For a paid referral/payout record, capture:

```text
paid_at
paid_by
paid_reference
```

Where:

- `paid_at` = timestamp when the payout was marked paid
- `paid_by` = authenticated ADMIN who marked it paid
- `paid_reference` = manual payment reference such as a UTR or transaction ID

Manual payout processing is required for the current version.

Do not implement:

- commission models
- commission calculation
- commission approval workflow
- commission-specific progress or KPI tracking
- PAN/TDS collection
- PAN/TDS calculation
- Razorpay/UPI payout automation
- future commission-engine logic

Admin can manually mark an eligible payout as `PAID`.

Vendors can see their own payout status only.

Sales users must not see payout information.

---

## 17. Audit Logging

Keep audit logging, but keep it focused on meaningful business actions.

Audit at minimum:

```text
Vendor created
Vendor updated
Vendor deactivated
Vendor password reset
QR generated
QR assigned
QR reassigned
QR activated
QR deactivated
Payout marked PAID
Admin user changes
Sales user changes
```

Record:

```text
actor
role
action
entity
entity_id
timestamp
```

Where useful, store structured metadata describing the change, such as:

```text
old_vendor_id
new_vendor_id
paid_reference
```

Every action in the list above writes an `AuditLog` row, including `POST /api/admin/vendors/:vendorId/reset-password` (`VENDOR_PASSWORD_RESET`), which previously issued the reset token without an audit entry.

Do not turn audit logging into an unnecessarily complex enterprise system.

Audit logs may grow to millions of rows. Index and paginate them using at least:

```text
entity + entity_id
actor + timestamp
created_at
action + created_at
```

Keep the records in PostgreSQL initially; do not introduce a separate logging platform without a measured need.

---

## 18. Pagination and Search

Never load complete administrative collections into one response. Use bounded pagination for:

- vendors and registrations
- QR inventory and assignment history
- leads
- scans
- payouts
- audit logs

Offset pagination is acceptable for smaller administrative views. For scans, leads, and audit logs as they become large, use cursor/keyset pagination ordered by a stable pair such as `created_at` and `id` rather than deep offsets.

Normal vendor lookup must use indexed identifiers or prefix-compatible indexed fields. Do not use unrestricted `LIKE '%term%'` searches across large tables. Add a dedicated search system only if later requirements demonstrate a real need for fuzzy or global search.

---

## 18. Frontend and Backend Architecture

Keep frontend and backend as separate codebases/directories:

```text
/frontend
/backend
```

The application may be hosted on the same infrastructure/domain.

The key requirement is logical separation between UI and API code.

---

## 19. Admin, Sales, and Vendor UI Requirements

### Admin UI

Admin routes:

```text
/admin/dashboard
/admin/vendors
/admin/vendors/:id
/admin/qr
/admin/qr/print
/admin/scans
/admin/leads
/admin/payouts
/admin/users
/admin/audit-logs
```

Admin must be able to manage vendors, QR inventory, assignments, leads, payout status, and audit trails.

The first Admin UI slice exposes these operational collections through bounded API responses and a resource selector. Mutating actions remain explicit, authorized backend operations and are added only with confirmation and audit feedback.

The Vendor resource view is the first mutation slice: Admin can create a Vendor, edit its business name/owner name/login identifier/mobile number inline, issue a temporary-password reset, and deactivate a Vendor, each confirmed before submission and followed by a refreshed list. The QR resource view is the second mutation slice: Admin can generate a QR batch and reassign an `ACTIVE` QR to a different Vendor by ID, confirmed before submission and followed by a refreshed list. The Leads resource view is the third mutation slice: Admin can change a lead's status from the documented set (`NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `REJECTED`, `DUPLICATE`), confirmed before submission and followed by a refreshed list; attribution fields remain immutable to this action. The Payouts resource view is the fourth mutation slice: Admin can mark an `UNPAID` payout as `PAID` by supplying a manual payment reference, confirmed before submission and followed by a refreshed list; the action is only offered in the UI for `UNPAID` records. The Staff users resource view is the fifth mutation slice: Admin can create a staff user (`ADMIN` or `SALES`), update a staff user's role, and deactivate a staff user, each confirmed before submission and followed by a refreshed list; the backend protects the last active Admin from deactivation or role change. Remaining resources (scans, audit logs) are inherently read-only and have no documented mutation actions.

### Sales UI

Sales routes:

```text
/sales/dashboard
/sales/registrations
/sales/vendors
/sales/qr
/sales/qr/activate
```

The sales dashboard must expose only operational information required for vendor onboarding and QR management.

The sales area must not expose:

- admin dashboard
- customer phone numbers
- unrestricted leads
- payout information
- audit logs
- system settings

### Vendor UI

Vendor routes:

```text
/vendor/login
/vendor/change-password
/vendor/dashboard
/vendor/leads
/vendor/payouts
/vendor/profile
```

Vendor data must always be scoped to the authenticated vendor.

The Vendor UI may display only the authenticated Vendor's permitted profile, referral, and payout-status data. It must provide an empty state when no records exist and a password-change state when `must_change_password` is true.

---

## 20. UI Status Presentation

Do not create progress bars, completion meters, numeric scorecards, or KPI widgets for payout or referral status.

Status should be displayed as simple informational text labels.

For payout:

```text
Unpaid
Paid
Partial
```

For QR:

```text
Unassigned
Active
Inactive
Retired
```

Do not invent statuses such as:

```text
Completed
Approved
Active
```

for domains where those statuses are not actually defined.

No customer-side checkbox, toggle, or progress-style control is required.

---

## 21. Undefined Scope Removal

Remove all references to:

- customer-side login/dashboard
- customer-side checkbox/toggle status controls
- customer progress tracking
- commission progress
- commission KPI dashboards
- completion meters
- commission approval
- TDS
- PAN
- automated payouts
- vendor email password recovery
- vendor OTP recovery
- reassignment-request workflows unless fully specified elsewhere

The public customer flow remains unauthenticated and limited to the referral/lead journey.

---

## 22. Security Requirements

Implement server-side authorization for every protected endpoint.

Prevent:

- IDOR
- privilege escalation
- cross-vendor access
- cross-salesperson access
- unauthorized QR reassignment
- unauthorized payout modification
- unauthorized lead access
- password brute force
- QR abuse
- duplicate lead or payout attribution

Frontend route protection alone is never sufficient.

The public QR endpoint must have server-side rate limiting and abuse protection.

Authentication and password-reset entry points must also be rate-limited per client IP. Login attempts must return a generic credential error, and reset requests must not reveal whether an account exists. The limiter may use in-memory storage for a single backend instance; a shared store is required before running multiple instances.

---

## 23. Execution Order

Use the following implementation order:

```text
Phase 1 — Foundation
Phase 2 — Database & migrations
Phase 3 — Authentication
Phase 4 — Authorization & role isolation
Phase 5 — QR inventory
Phase 6 — Vendor registration & sales onboarding
Phase 7 — QR assignment & reassignment
Phase 8 — Public QR/referral flow
Phase 9 — Customer identity & deduplication
Phase 10 — Lead attribution
Phase 11 — Payout status & manual payout records
Phase 12 — Audit logging
Phase 13 — Admin UI
Phase 14 — Sales UI
Phase 15 — Vendor UI
Phase 16 — Security hardening
Phase 17 — Validation & production readiness
```

Do not create a separate UX-cleanup phase.

The simplified UI requirements must be implemented directly inside the Admin, Sales, and Vendor UI phases.

Security and authorization must also be implemented while building each protected backend module. Phase 16 is for hardening and testing, not for adding basic authorization for the first time.

---

## 24. Definition of Done

The project is complete only when:

- Admin authentication works.
- Sales authentication works.
- Vendor authentication works.
- Vendor first-login password change works.
- Admin vendor password reset works.
- Admin authorization works.
- Sales authorization works.
- Vendor isolation works.
- Vendor self-registration works.
- Sales can see relevant registrations.
- Sales can complete vendor onboarding.
- Sales can assign unassigned QR codes.
- Admin can reassign active QR codes.
- QR assignment history is preserved.
- Public QR URLs resolve through database assignment.
- Historical attribution remains immutable.
- Customer deduplication works.
- Lead/referral capture works.
- Payout status tracking works.
- `paid_at`, `paid_by`, and `paid_reference` are recorded when a payout becomes `PAID`.
- Admin can manage payout status.
- Sales cannot access payout information.
- Audit logs work.
- Vendors cannot access other vendors' data.
- Public QR endpoint has rate limiting/abuse protection.
- Public QR lookup uses indexed code and current-assignment access paths.
- Administrative collections use bounded pagination, with cursor/keyset pagination for large scans, leads, and audit logs.
- Vendor and customer deduplication constraints are enforced at the database level where appropriate.
- Sales visibility is restricted by explicit vendor ownership such as `sales_user_id` or an approved sales-team ownership field.
- Connection pooling is configured for the deployment, and shared rate limiting is available before running multiple backend instances.
- The design supports approximately 50,000 vendors and millions of scans, leads, or audit records without adding unnecessary microservices.
- No commission calculation system exists.
- No PAN/TDS system exists.
- No automated Razorpay/UPI payout system exists.
- No commission progress/KPI UI exists.
- Frontend and backend remain separate codebases/directories.
- Production build succeeds.
- No secrets are committed.
- Critical authorization tests pass.

---

## 25. Final Rule

This plan describes the minimal current Solarium referral, QR, vendor onboarding, and payout-status system.

It intentionally does not include:

- commission engine logic
- commission approval workflow
- PAN/TDS collection
- automated payouts
- customer login/dashboard
- customer progress tracking
- email or OTP vendor recovery
- separate UX cleanup phase

The scope remains intentionally minimal and aligned to the actual business requirement.
