
# Solarium Implementation Plan

This repository currently contains a Create React App frontend shell.

The system will be implemented as a full-stack referral attribution platform for Solarium Energy.

The system has three authenticated roles:

* `ADMIN` — full system control
* `SALES` — field onboarding, QR activation, and vendor setup only
* `VENDOR` — own referral and commission data only

The public customer referral flow is unauthenticated.

The system is not a general CRM.

---

## 1. Architecture

```text
Customer
   ↓
Public QR URL
   ↓
QR / Vendor Attribution
   ↓
Lead
   ↓
Commission

ADMIN
   ↓
System-wide control

SALES
   ↓
Unassigned QR activation
   ↓
Vendor onboarding
   ↓
Initial QR assignment

VENDOR
   ↓
Username/number + password login
   ↓
Own leads / own commissions
```

Backend:

```text
React
 ↓
Node.js / Express
 ↓
Prisma
 ↓
PostgreSQL
 ↓
Supabase
```

Supabase is used as the hosted PostgreSQL provider.

Supabase Auth is not used.

Authentication and authorization remain server-controlled.

---

## 2. Scope

The system must support:

1. Vendor management.
2. QR generation and inventory.
3. QR assignment.
4. QR reassignment with historical attribution.
5. Salesperson-specific QR/vendor onboarding.
6. Public QR scanning.
7. Customer lead capture.
8. Customer deduplication using protected phone identity.
9. Lead attribution.
10. Commission calculation and tracking.
11. Admin management.
12. Vendor username/number plus password login.
13. Admin password forgot/change-password access.
14. Vendor password reset from the vendor dashboard.
15. Admin CRUD for staff users and vendors.
16. Audit logging.

Do not build unrelated CRM functionality.

---

## 3. Role Separation

### ADMIN

Full access to:

* Vendors
* QR codes
* Assignments
* Scans
* Leads
* Commissions
* Sales users
* Vendor users
* Audit logs
* System configuration

Admin is the only role with unrestricted system access.

Admin can create, modify, deactivate, and delete sales users.

Admin can create, modify, deactivate, and soft-delete vendors.

Admin can reset vendor credentials if required.

Admin must also have a secure forgotten-password or change-password flow for staff access.

---

### SALES

Sales users exist specifically for field/vendor onboarding.

Sales users can:

* Log into the sales portal.
* View only the vendors they onboarded or were assigned.
* View only the QR inventory they are responsible for.
* Scan or enter an unassigned QR.
* Create a vendor.
* Set the vendor's initial login username or mobile number.
* Set the vendor's initial password during onboarding.
* Assign an unassigned QR to that vendor.
* View assignment status for their own work.
* Request reassignment where applicable.

Sales users cannot:

* View global vendor lists.
* View customer leads.
* View customer phone numbers.
* View commissions.
* Modify commissions.
* View other salespeople's private data.
* Delete vendors.
* Reassign active QR codes without admin authorization.
* Access admin APIs.
* Access audit logs.
* Change system settings.

Backend authorization must enforce these restrictions.

Hiding UI elements is not sufficient.

Sales is not an admin panel with hidden menu items.

---

### VENDOR

Vendors authenticate using a username or mobile number plus password.

The initial password may be set by the sales user during first-time onboarding.

The vendor dashboard must include a secure password reset option.

Vendor password reset is an initial required capability and does not depend on later validation phases.

Vendors can see only their own:

* Business information.
* Referral statistics.
* Leads/statistics appropriate for the business.
* Commission information.
* Commission history.

Vendors cannot:

* Modify attribution.
* Assign QR codes.
* Access other vendors.
* Access admin data.
* Access sales data.
* Modify commissions.

---

## 4. Execution Order

### Phase 1 — Foundation

* Inspect existing React app.
* Preserve working frontend structure.
* Establish client/server/shared directories.
* Add environment templates.
* Add `.gitignore`.
* Add backend foundation.
* Add centralized error handling.
* Add validation infrastructure.

---

### Phase 2 — Database

Create Prisma models for:

* User
* Vendor
* VendorSession
* PasswordResetToken
* QrCode
* QrAssignment
* CustomerIdentity
* Scan
* Lead
* Commission
* OtpRequest only if a future vendor recovery flow needs it
* AuditLog

User roles:

```text
ADMIN
SALES
```

Staff users should at minimum support:

```text
user_id
name
username_or_mobile
password_hash
role
status
created_at
updated_at
```

Vendor authentication is separate from the staff user table and must support a login identifier plus password.

Vendor users should at minimum support:

```text
vendor_id
business_name
owner_name
login_identifier
mobile_number
password_hash
status
created_at
updated_at
```

Password reset tokens must be stored server-side with an expiration time and single-use semantics.

Use Supabase PostgreSQL.

Create migrations.

Create development seed data.

Seed examples must include:

* Admin user.
* Sales users.
* Vendors.
* Vendor login credentials in hashed form only.
* QR codes.
* QR assignments.
* Historical reassignment.
* Scans.
* Leads.
* Commissions.

---

### Phase 3 — Authentication

#### Staff authentication

Use server-controlled password authentication for admin and sales users.

Use secure HTTP-only cookie sessions or an equivalent server-managed mechanism.

Authorization middleware:

```text
requireAuth
requireAdmin
requireSales
requireAdminOrSales
```

Never trust role information supplied by the frontend.

#### Vendor authentication

Use separate password-based authentication for vendors.

The vendor identifier can be a username or registered mobile number.

Initial vendor credentials may be created by sales during first-time onboarding, but only the hashed password is ever stored.

Never accept `vendorId` from the frontend as the authority for vendor data access.

Vendor sessions must identify the authenticated vendor server-side.

Vendor password reset must be supported from the dashboard with a secure server-side flow.

---

### Phase 4 — QR System

Generate QR IDs dynamically.

Initial pool:

```text
VEN-0001
...
VEN-2000
```

The system must support:

```text
VEN-2001+
```

without architectural changes.

QR statuses:

```text
UNASSIGNED
ACTIVE
INACTIVE
RETIRED
```

QR URL:

```text
https://solariumenergy.in/v/:qrId
```

---

### Phase 5 — Sales QR Activation

Sales flow:

```text
Sales login
 ↓
Scan QR
 ↓
System identifies QR
 ↓
Check QR status
 ↓
If UNASSIGNED:
    Create or select vendor
    Set vendor username/mobile
    Set initial vendor password
    Assign QR
    Activate QR
 ↓
Complete
```

Sales must not be given access to the admin dashboard.

Sales gets a separate `/sales` application area and separate backend authorization.

Sales cannot freely reassign an active QR.

If reassignment is needed, sales can request it and admin must approve it.

---

### Phase 6 — QR Reassignment

Only ADMIN can directly reassign an active QR.

When reassigned:

1. Close the previous assignment.
2. Create a new assignment.
3. Record the admin user who performed the change.
4. Preserve historical attribution.

Old scans and leads must never be modified to point to the new vendor.

---

### Phase 7 — Public Referral Flow

Customer scans:

```text
/v/VEN-0001
```

Backend:

```text
Validate QR
 ↓
Resolve active assignment
 ↓
Resolve vendor
 ↓
Create scan
 ↓
Show referral page
```

If QR is invalid, unassigned, or inactive, show an appropriate public error page.

Never expose internal IDs or database information unnecessarily.

---

### Phase 8 — Customer Identity

Normalize mobile numbers.

Generate a server-side HMAC-based customer identity.

Do not use raw phone numbers as the attribution identity.

Record duplicate scans but do not blindly create duplicate commissionable leads.

---

### Phase 9 — Lead Attribution

Every lead must retain immutable attribution:

```text
QR
 ↓
Assignment at scan time
 ↓
Vendor
 ↓
Scan
 ↓
Customer Identity
 ↓
Lead
```

Current QR assignment must not affect historical leads.

---

### Phase 10 — Commission

Commission belongs to a lead.

Statuses:

```text
PENDING
APPROVED
PAID
CANCELLED
```

Commission calculations must happen server-side.

Vendors can see only their own commission information.

Sales users cannot see commission information.

---

### Phase 11 — Admin UI

Admin routes:

```text
/admin/dashboard
/admin/vendors
/admin/vendors/:id
/admin/qr
/admin/scans
/admin/leads
/admin/commissions
/admin/users
/admin/audit-logs
```

Admin has complete management capability.

Admin can manage staff users and vendor users from the same control surface.

---

### Phase 12 — Sales UI

Sales routes:

```text
/sales/dashboard
/sales/qr
/sales/qr/activate
/sales/vendors
/sales/vendors/:id
```

Sales dashboard must expose only operational information required for vendor onboarding and QR management.

No lead, customer, commission, audit, or system settings pages.

---

### Phase 13 — Vendor UI

Vendor routes:

```text
/vendor/login
/vendor/reset-password
/vendor/dashboard
/vendor/leads
/vendor/commissions
/vendor/profile
```

Vendor data must always be scoped to the authenticated vendor.

The vendor dashboard must support password reset without exposing other vendor data.

---

### Phase 14 — Security

Implement server-side authorization for every protected endpoint.

Prevent:

* IDOR
* privilege escalation
* cross-vendor access
* cross-salesperson access
* unauthorized QR reassignment
* unauthorized commission modification
* unauthorized lead access
* password brute force
* QR abuse
* duplicate commission abuse

Frontend route protection alone is never sufficient.

---

### Phase 15 — Audit Logging

Audit:

* Vendor creation.
* Vendor modification.
* Vendor deactivation.
* Vendor password reset.
* QR generation.
* QR assignment.
* QR reassignment.
* QR activation.
* QR deactivation.
* Commission changes.
* Lead status changes.
* Admin user changes.
* Sales user changes.

Record:

```text
actor
role
action
entity
entity_id
timestamp
```

---

### Phase 16 — Validation

Test separately:

#### Admin

* Complete access.
* Vendor management.
* Sales user management.
* QR reassignment.
* Commission management.

#### Sales

* Can activate unassigned QR.
* Can onboard vendor.
* Can set vendor initial password.
* Cannot access leads.
* Cannot access commissions.
* Cannot access other restricted admin data.
* Cannot reassign active QR without authorization.

#### Vendor

* Can log in using username or mobile number plus password.
* Can reset password.
* Can access only own data.
* Cannot change attribution.
* Cannot access another vendor.

#### Public

* Valid QR works.
* Invalid QR handled.
* Inactive QR handled.
* Duplicate customer handled.
* Lead attribution preserved.

---

## 5. Current Development Rule

Do not implement the entire system in one step.

Work module-by-module.

For each module:

1. Inspect current implementation.
2. Update database if required.
3. Implement backend.
4. Implement authorization.
5. Implement frontend.
6. Run TypeScript and build checks.
7. Test.
8. Fix errors.
9. Continue.

Never bypass role separation to simplify implementation.

The ADMIN, SALES, and VENDOR applications must remain logically and technically separated through route guards and backend authorization.

---

## 6. Definition of Done

The project is complete only when:

* Admin authentication works.
* Sales authentication works.
* Vendor username or mobile plus password login works.
* Vendor password reset works.
* Admin authorization works.
* Sales authorization works.
* Vendor isolation works.
* QR generation works.
* QR activation works.
* QR assignment works.
* QR reassignment works.
* Historical attribution works.
* Scan tracking works.
* Customer deduplication works.
* Lead capture works.
* Commission calculation works.
* Admin dashboard works.
* Sales dashboard works.
* Vendor dashboard works.
* Audit logs work.
* Production builds successfully.
* No secrets are committed.
* Critical authorization tests pass.
