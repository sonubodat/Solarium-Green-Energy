
# Solarium Energy Vendor Referral & QR Lead Tracking System

## 1. Project Overview

Build a full-stack vendor referral and QR-based lead attribution system for Solarium Energy.

Official domain:

`https://solariumenergy.in`

The system is NOT a CRM.

The purpose is strictly:

1. Generate and manage unique QR codes.
2. Assign QR codes to physical vendors/stores.
3. Track customer scans.
4. Capture customer leads.
5. Attribute every lead to the correct vendor/referral source.
6. Prevent duplicate commission attribution from the same customer.
7. Allow administrators to manage vendors, QR codes, scans, leads and commissions.
8. Give vendors a minimal private dashboard showing their own referral/commission information.
9. Maintain historical attribution even when QR codes or vendors are reassigned.

The system must be production-oriented, secure, maintainable and designed to scale from 2,000 QR codes to at least 50,000+.

---

# 2. Core Business Model

A physical QR code is distributed to a vendor/store.

Example:

`https://solariumenergy.in/v/VEN-0001`

The QR URL identifies the QR asset, NOT directly the vendor.

The database determines which vendor is currently assigned to that QR.

Example:

```text
QR: VEN-0001
        ↓
Vendor: VENDOR-78291
        ↓
Business: Ram Store
```

If the QR is later reassigned:

```text
VEN-0001
        ↓
New Vendor
```

historical scans and leads must remain associated with the vendor that owned the QR at the time of the scan.

---

# 3. Important Entity Separation

The system MUST maintain these as separate entities:

* QR Code
* Vendor
* QR Assignment
* Customer Identity
* Scan
* Lead
* Commission
* Admin User
* Vendor Authentication Session

Do NOT combine QR ID and Vendor ID.

A QR code is a physical asset.

A vendor is a business entity.

An assignment connects the two.

---

# 4. QR Code System

## 4.1 QR URL Format

Use:

`https://solariumenergy.in/v/:qrId`

Example:

`https://solariumenergy.in/v/VEN-0001`

Do NOT use `/v1`.

`v1` is commonly interpreted as an API version.

Use `/v/`.

---

## 4.2 Initial QR Pool

The system must support generating an initial pool of 2,000 QR codes:

```text
VEN-0001
VEN-0002
VEN-0003
...
VEN-2000
```

The system must NOT hard-code a maximum of 2,000.

It must support generating additional QR codes later:

```text
VEN-2001
...
VEN-50000+
```

QR IDs must be unique.

---

## 4.3 QR Status

Each QR must have a status:

* `UNASSIGNED`
* `ACTIVE`
* `INACTIVE`
* `RETIRED`

Default state for newly generated QR:

`UNASSIGNED`

---

## 4.4 QR Generation

Admin must be able to:

* Generate a batch of QR codes.
* Select quantity.
* Download individual QR.
* Download multiple QR codes.
* Generate a printable QR sheet.
* View QR ID.
* View current assigned vendor.
* Activate/deactivate QR.
* Reassign QR.
* View assignment history.

The QR image should contain only the referral URL.

Never encode private vendor information directly inside the QR.

---

# 5. Vendor Management

Admin must be able to:

* Create vendor.
* Edit vendor.
* View vendor.
* Activate vendor.
* Deactivate vendor.
* Soft-delete vendor.
* Assign QR.
* Reassign QR.
* View vendor leads.
* View vendor scans.
* View vendor commission.
* View vendor assignment history.

Vendor fields:

```text
vendor_id
business_name
owner_name
mobile_number
email
address
status
commission_rate
created_at
updated_at
```

Vendor ID must be permanent.

Example:

`VENDOR-78291`

Do not use the QR ID as the vendor ID.

---

# 6. QR Assignment System

A QR assignment represents:

```text
QR → Vendor
```

Example:

```text
VEN-0001 → Ram Store
```

The assignment must contain:

```text
assignment_id
qr_id
vendor_id
assigned_at
unassigned_at
status
assigned_by
```

Never overwrite historical assignments.

When a QR is reassigned:

```text
Old assignment:
VEN-0001 → Ram Store
assigned_at: ...
unassigned_at: ...

New assignment:
VEN-0001 → ABC Store
assigned_at: ...
unassigned_at: NULL
```

Historical scans must continue pointing to the original vendor.

---

# 7. Sales/Admin QR Activation Flow

A customer must NEVER be allowed to map a QR to a vendor.

Only authenticated admin/sales users can activate or assign QR codes.

Recommended flow:

```text
Sales person logs into authorized system
        ↓
Scans physical QR
        ↓
System identifies QR
        ↓
System shows current status
        ↓
Sales person enters vendor details
        ↓
Vendor created or selected
        ↓
QR assigned
        ↓
QR becomes ACTIVE
```

If QR is already assigned, the system must clearly warn the user before reassignment.

Reassignment must require confirmation.

---

# 8. Public QR Scan Flow

When a customer scans:

`https://solariumenergy.in/v/VEN-0001`

backend must:

1. Validate QR.
2. Check QR status.
3. Determine the vendor currently associated with the QR.
4. Create a scan record.
5. Generate/identify a scan session.
6. Show the appropriate public lead/referral page.

If QR is unassigned:

Show:

`This referral QR is not currently active.`

Do not expose internal database information.

If QR is inactive:

Show:

`This referral QR is currently inactive.`

---

# 9. Scan Tracking

Every valid scan must create a scan record.

Required fields:

```text
scan_id
qr_id
vendor_id
customer_hash
session_id
scanned_at
source
```

The system may record non-sensitive technical metadata where legally appropriate, but must NOT collect unnecessary personal information.

Do not use IP address as the customer identity.

Do not rely on browser fingerprinting for identity.

---

# 10. Customer Identity / Duplicate Prevention

The primary customer identity for commission attribution is the customer's normalized mobile number.

The raw phone number must NOT be used as the public/internal identity key.

Normalize Indian phone numbers consistently.

Examples:

```text
9876543210
+91 9876543210
+919876543210
```

must resolve to the same canonical phone identity.

Create a server-side protected identity using HMAC-SHA256 or an equivalent secure keyed hash.

Conceptually:

```text
customer_hash =
HMAC-SHA256(server_secret, normalized_phone)
```

Never expose the hash to customers or vendors.

Never use a client-side secret.

---

# 11. Duplicate Commission Rules

The application must support configurable duplicate attribution rules.

The initial recommended rule:

A customer cannot generate multiple commissionable leads for the same campaign/referral program within the configured attribution period.

The system must distinguish:

* Scan
* Lead
* Qualified lead
* Completed sale
* Commissionable event

A duplicate scan does NOT automatically create a new commission.

The admin must be able to see duplicate scans separately.

Example:

```text
Customer A
    ↓
Scans Ram Store QR
    ↓
Lead created

Customer A
    ↓
Scans another store QR
    ↓
Duplicate/previously attributed customer
    ↓
No second commission
```

Do not silently discard the second scan.

Record it as a scan and mark its attribution result appropriately.

---

# 12. Lead Capture

After scanning an active QR, the customer can submit a lead.

Minimum lead fields:

```text
lead_id
vendor_id
qr_id
scan_id
customer_hash
customer_name
phone
email (optional)
location (optional)
status
created_at
updated_at
```

The actual phone number must be protected and must not be displayed to vendors unless explicitly required by a future business requirement.

Recommended lead statuses:

```text
NEW
CONTACTED
QUALIFIED
CONVERTED
REJECTED
DUPLICATE
```

---

# 13. Attribution

Every lead must have an immutable attribution chain:

```text
QR
 ↓
QR Assignment at scan time
 ↓
Vendor
 ↓
Scan
 ↓
Customer Identity
 ↓
Lead
 ↓
Commission
```

The lead must never depend only on the QR's current vendor assignment.

If:

```text
VEN-0001 → Ram Store
```

and later:

```text
VEN-0001 → ABC Store
```

old leads from the Ram Store period must remain attributed to Ram Store.

This is a critical requirement.

---

# 14. Commission System

Commission must be associated with the lead, not directly with a QR scan.

Commission fields:

```text
commission_id
lead_id
vendor_id
amount
rate
status
created_at
paid_at
```

Statuses:

```text
PENDING
APPROVED
PAID
CANCELLED
```

The commission calculation must be isolated in a backend service.

Do not calculate commission only in React.

The server is the source of truth.

---

# 15. Admin Dashboard

Admin dashboard must provide:

### Overview

Show:

```text
Total Vendors
Active Vendors
Total QR Codes
Active QR Codes
Unassigned QR Codes
Total Scans
Unique Customers
Total Leads
Qualified Leads
Converted Leads
Pending Commission
Paid Commission
```

---

# 16. Admin Vendor Management

Vendor list must support:

* Search.
* Filter by status.
* Filter by QR assignment.
* View details.
* Edit.
* Activate/deactivate.
* Assign QR.
* Reassign QR.
* View leads.
* View commission.
* View history.

Vendor details should show:

```text
Business Name
Vendor ID
Current QR
QR Status
Total Scans
Unique Customers
Total Leads
Qualified Leads
Conversions
Pending Commission
Paid Commission
```

---

# 17. Admin QR Management

QR page must show:

```text
QR ID
Current Vendor
Business Name
Status
Assigned Date
```

Actions:

* View.
* Download.
* Print.
* Assign.
* Reassign.
* Deactivate.
* Retire.
* View history.

Provide batch generation.

Provide batch download.

---

# 18. Admin Lead Management

Admin must be able to:

* Search leads.
* Filter by vendor.
* Filter by QR.
* Filter by status.
* Filter by date.
* View lead details.
* Change lead status.
* View attribution.
* View commission status.

Lead detail must clearly show:

```text
Lead ID
Vendor
QR ID
Scan ID
Customer
Scan date/time
Lead date/time
Status
Commission
```

---

# 19. Vendor Login

Vendor authentication must use their registered mobile number.

Recommended flow:

```text
Enter mobile number
        ↓
Send OTP
        ↓
Verify OTP
        ↓
Create secure session
        ↓
Vendor dashboard
```

OTP must be handled server-side.

Do not implement fake OTP verification.

For development only, a development OTP mode may exist behind an environment variable.

Production must use a real OTP provider.

---

# 20. Vendor Dashboard

Vendor should see ONLY their own information.

Dashboard:

```text
Business Name

Total Leads
Qualified Leads
Converted Leads

Pending Commission
Approved Commission
Paid Commission
```

Lead/commission history:

```text
Date
Lead ID
Status
Commission
```

Do NOT expose other vendors' information.

Do NOT expose unnecessary customer private information.

Vendor cannot:

* Edit attribution.
* Change QR assignment.
* Change commission.
* See other vendors.
* Access admin APIs.
* Delete leads.

---

# 21. Admin Authentication

Admin endpoints must require authentication.

Use secure password/session authentication or an equivalent production-ready mechanism.

Requirements:

* Passwords must be hashed using Argon2id or bcrypt.
* Never store plaintext passwords.
* Secure HTTP-only cookies or secure token strategy.
* CSRF protection where applicable.
* Rate limiting.
* Login attempt protection.
* Server-side authorization checks.

Frontend route protection alone is NOT sufficient.

Every sensitive backend endpoint must enforce authorization.

---

# 22. API Architecture

Use REST APIs.

Example routes:

```text
POST   /api/auth/admin/login
POST   /api/auth/admin/logout

POST   /api/auth/vendor/request-otp
POST   /api/auth/vendor/verify-otp
POST   /api/auth/vendor/logout

GET    /api/vendors
POST   /api/vendors
GET    /api/vendors/:vendorId
PATCH  /api/vendors/:vendorId
POST   /api/vendors/:vendorId/deactivate

GET    /api/qr
POST   /api/qr/generate
GET    /api/qr/:qrId
POST   /api/qr/:qrId/assign
POST   /api/qr/:qrId/reassign
POST   /api/qr/:qrId/deactivate

GET    /api/scans
GET    /api/leads
GET    /api/leads/:leadId
PATCH  /api/leads/:leadId

GET    /api/commissions
GET    /api/vendors/:vendorId/commissions

GET    /api/vendor/dashboard
GET    /api/vendor/leads

GET    /v/:qrId
POST   /api/public/leads
```

The `/v/:qrId` route is public.

Admin and vendor management APIs are protected.

---

# 23. Database

Use PostgreSQL with Prisma.

Minimum models:

```text
AdminUser
Vendor
QrCode
QrAssignment
Scan
CustomerIdentity
Lead
Commission
VendorSession
OtpRequest
```

Use foreign keys.

Use indexes for:

```text
qr_id
vendor_id
customer_hash
scan_id
lead_id
created_at
status
```

Use database constraints for uniqueness wherever appropriate.

Do not rely only on application-level duplicate checking.

---

# 24. Security Requirements

The system must:

* Validate every API input.
* Use Zod or equivalent validation.
* Never trust IDs from the frontend.
* Never trust vendor IDs supplied by vendors.
* Verify authorization server-side.
* Rate-limit public lead submission.
* Rate-limit OTP requests.
* Prevent OTP brute force.
* Prevent QR assignment by unauthenticated users.
* Protect customer information.
* Never expose database secrets.
* Never expose HMAC secrets.
* Never put privileged credentials in React environment variables.
* Sanitize/validate user input.
* Use parameterized ORM queries.
* Prevent IDOR vulnerabilities.
* Prevent a vendor from changing `vendor_id` in a request and accessing another vendor's data.

---

# 25. Important Authorization Rule

Never assume:

```text
GET /api/vendor/leads
```

is safe because the frontend knows the vendor.

The backend must derive the authenticated vendor from the session.

Bad:

```text
GET /api/vendor/leads?vendorId=123
```

with the backend trusting `vendorId`.

Correct:

```text
Authenticated session
        ↓
Backend identifies vendor
        ↓
Query only that vendor's records
```

---

# 26. Soft Delete

Do not physically delete vendors that have historical data.

Use:

```text
status
deleted_at
```

or equivalent.

Historical:

* scans
* leads
* commissions
* QR assignments

must remain available.

---

# 27. QR Reassignment

When reassigning a QR:

1. Confirm the current assignment.
2. Close the old assignment.
3. Create a new assignment.
4. Record admin user who performed it.
5. Preserve historical attribution.

Never modify old scan records to point to the new vendor.

---

# 28. Audit Log

Create an audit log for sensitive administrative operations.

Track:

```text
admin user
action
entity
entity ID
old value where appropriate
new value where appropriate
timestamp
```

Important actions:

* Vendor creation.
* Vendor edit.
* Vendor deactivation.
* QR assignment.
* QR reassignment.
* QR deactivation.
* Commission modification.
* Lead status modification.

---

# 29. Error Handling

Use centralized backend error handling.

API responses should follow a consistent structure.

Example:

```json
{
  "success": false,
  "error": {
    "code": "QR_NOT_FOUND",
    "message": "QR code was not found."
  }
}
```

Never return stack traces to production clients.

Log detailed errors server-side.

---

# 30. Environment Variables

Use `.env`.

Never commit secrets.

Example:

```text
DATABASE_URL=
JWT_SECRET=
SESSION_SECRET=
CUSTOMER_HASH_SECRET=
OTP_PROVIDER=
OTP_API_KEY=
APP_BASE_URL=https://solariumenergy.in
```

Provide `.env.example`.

---

# 31. Development Seed Data

Provide a Prisma seed script.

Seed:

* 1 admin.
* 5 vendors.
* 20 QR codes.
* Several QR assignments.
* Several scans.
* Several customers.
* Several leads.
* Several commissions.

Seed data must demonstrate reassignment history.

Example:

```text
VEN-0001
    ↓
Ram Store
    ↓
historical scans

VEN-0001
    ↓
ABC Store
    ↓
new scans
```

The system must prove that old leads remain attributed to Ram Store.

---

# 32. Frontend Requirements

Use TypeScript strictly.

Do not use `any` unless absolutely unavoidable.

Use reusable components.

Handle:

* Loading states.
* Empty states.
* Error states.
* Form validation.
* Success messages.
* Confirmation dialogs.
* Pagination.
* Search.
* Filters.

Do not duplicate API logic throughout components.

Use centralized API/service functions.

---

# 33. Public Referral Page

The public page should be simple.

Example:

```text
Solarium Energy

You were referred by:

Ram Store

Interested in Solar?

[ Customer Name ]
[ Mobile Number ]
[ Email ]

[ Submit Enquiry ]
```

The customer should not be able to modify:

* Vendor.
* QR ID.
* Referral attribution.
* Commission information.

These values come from the backend.

---

# 34. Duplicate Customer Experience

If the customer already has an existing commissionable attribution, do not create a second commissionable lead automatically.

The system should still record the scan.

Example:

```text
This customer has already been referred.
```

The exact customer-facing wording should be configurable later.

Do not expose which vendor originally owns the customer if that creates a privacy/business issue.

---

# 35. Scaling Requirements

The architecture must support:

* 2,000 QR codes initially.
* 50,000+ QR codes later.
* Large scan volume.
* Large lead volume.

Do not load all QR codes into the browser.

Use pagination.

Do not calculate dashboard totals by downloading all records to React.

Use database aggregation queries.

Use proper indexes.

---

# 36. QR URL Performance

The `/v/:qrId` endpoint should be lightweight.

Required flow:

```text
Request
 ↓
Validate QR ID
 ↓
Database lookup
 ↓
Resolve current assignment
 ↓
Create scan
 ↓
Redirect/render referral page
```

Do not perform unnecessary API calls before the initial page response.

---

# 37. No Unnecessary Features

Do NOT build:

* Inventory.
* Orders.
* Product management.
* Full CRM pipeline.
* Marketing automation.
* WhatsApp automation.
* Email campaigns.
* Customer accounts.
* Vendor-to-vendor messaging.
* Payment gateway.
* Complex analytics.
* Delivery management.

Only build what is required for:

```text
QR
→ Vendor
→ Scan
→ Customer
→ Lead
→ Commission
```

---

# 38. Coding Standards

Before writing code:

1. Inspect the existing React application.
2. Identify the current React/Vite/Next configuration.
3. Do not unnecessarily replace working project configuration.
4. Create the required backend architecture.
5. Create Prisma schema.
6. Create migrations.
7. Create seed data.
8. Create API services.
9. Create frontend pages.
10. Connect frontend to real backend APIs.

Do not create fake/mock APIs for production functionality.

---

# 39. Implementation Order

Implement in this exact order.

### Phase 1 — Foundation

* Project structure.
* Server.
* PostgreSQL.
* Prisma.
* Environment configuration.
* Error handling.
* Validation.

### Phase 2 — Database

Implement:

```text
AdminUser
Vendor
QrCode
QrAssignment
CustomerIdentity
Scan
Lead
Commission
VendorSession
OtpRequest
AuditLog
```

Create migrations.

Create seed data.

### Phase 3 — Authentication

Implement:

* Admin login.
* Admin session.
* Vendor OTP.
* Vendor session.
* Authorization middleware.

### Phase 4 — QR

Implement:

* QR generation.
* QR storage.
* QR image generation.
* QR assignment.
* QR reassignment.
* QR history.
* `/v/:qrId`.

### Phase 5 — Attribution

Implement:

* Scan creation.
* Customer normalization.
* Customer HMAC identity.
* Duplicate detection.
* Immutable attribution.

### Phase 6 — Leads

Implement:

* Public lead form.
* Lead creation.
* Lead status.
* Admin lead management.

### Phase 7 — Commission

Implement:

* Commission calculation.
* Commission status.
* Admin management.
* Vendor commission view.

### Phase 8 — Admin UI

Implement:

* Dashboard.
* Vendors.
* QR management.
* Scans.
* Leads.
* Commissions.
* Audit logs.

### Phase 9 — Vendor UI

Implement:

* OTP login.
* Dashboard.
* Lead history.
* Commission history.
* Profile.

### Phase 10 — Testing

Test:

* QR assignment.
* QR reassignment.
* Duplicate customer.
* Duplicate scans.
* Vendor isolation.
* Admin authorization.
* Historical attribution.
* Deactivated QR.
* Deleted/deactivated vendor.
* Commission calculation.
* OTP abuse.
* Invalid QR.
* Invalid API requests.

---

# 40. Critical Acceptance Tests

The implementation is NOT considered complete until these scenarios work.

## Test 1 — New QR

```text
VEN-0001
→ Unassigned
```

Customer scan must NOT generate a valid vendor lead.

---

## Test 2 — Assign QR

```text
VEN-0001
→ Ram Store
```

Customer scan must identify Ram Store.

---

## Test 3 — Lead

Customer submits:

```text
Name
Phone
```

Lead must contain:

```text
vendor_id
qr_id
scan_id
customer_hash
```

---

## Test 4 — Reassignment

Change:

```text
VEN-0001
→ ABC Store
```

New scans must belong to ABC Store.

Old leads must remain with Ram Store.

---

## Test 5 — Duplicate customer

Customer scans:

```text
Ram Store QR
```

then:

```text
ABC Store QR
```

The system must detect the existing customer identity according to the configured attribution rule and must not blindly create a second commission.

---

## Test 6 — Vendor isolation

Ram Store must never be able to request or receive:

```text
ABC Store leads
ABC Store commissions
ABC Store scans
ABC Store profile
```

even if the frontend request is manually modified.

---

## Test 7 — Admin control

Admin can:

```text
Create vendor
Edit vendor
Assign QR
Reassign QR
Deactivate QR
View scans
View leads
Manage commissions
```

---

## Test 8 — Vendor login

Vendor logs in using OTP and sees only:

```text
Own business
Own leads
Own commission
```

---

# 41. Definition of Done

Do not declare the project complete because the UI renders.

The project is complete only when:

* Frontend builds successfully.
* Backend builds successfully.
* Database migrations run successfully.
* Seed script works.
* No TypeScript errors.
* No unhandled API errors.
* Authentication works.
* Authorization works.
* QR generation works.
* QR assignment works.
* QR reassignment works.
* Historical attribution works.
* Duplicate detection works.
* Lead creation works.
* Commission calculation works.
* Vendor isolation works.
* Admin controls work.
* Production environment variables are documented.
* No secrets are committed.
* Critical acceptance tests pass.

---

# 42. Copilot Implementation Rule

Do NOT implement the entire system blindly in one generation.

Work module-by-module.

Before implementing a module:

1. Inspect existing code.
2. Identify dependencies.
3. Implement backend.
4. Implement database changes.
5. Implement frontend.
6. Run TypeScript/build checks.
7. Fix errors.
8. Test the module.
9. Only then move to the next module.

Never replace working code simply to make the implementation easier.

Never invent APIs or database fields that contradict this specification.

If a requirement is ambiguous, preserve existing architecture and flag the ambiguity instead of silently making a destructive architectural decision.
