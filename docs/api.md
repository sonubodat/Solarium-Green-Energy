# Solarium API Contract

This is the frontend/backend contract for the current scope. Exact field validation and response envelopes may be refined during implementation, but role boundaries and attribution rules are fixed here.

Base path:

```text
/api
```

Protected endpoints use the server-managed HTTP-only session. The client must not submit a role or vendor ID as an authority source.

## Common Response Rules

Success responses return JSON with the resource or operation result. Validation failures return `400`. Authentication failures return `401`. Authorization failures return `403`. Missing resources return `404`. Conflicts such as duplicate identifiers or an already-assigned QR return `409`. Unexpected failures are handled by centralized server error handling.

Do not expose password hashes, session tokens, reset tokens, raw customer hashes, internal database IDs where a public identifier is sufficient, or protected customer phone numbers to unauthorized roles.

## Authentication

### `POST /api/auth/login`

Authenticate an Admin or Sales user.

- Authentication: public
- Request: `username_or_mobile`, `password`
- Response: authenticated staff profile and session state
- Rules: derive role from the stored account; never trust a submitted role

### `POST /api/auth/logout`

- Authentication: authenticated staff or Vendor
- Response: success
- Rules: revoke the current server-side session

### `POST /api/auth/change-password`

Change the authenticated account password.

- Authentication: authenticated staff or Vendor
- Request: current password where required, new password
- Rules: store only a password hash; clear `must_change_password` after a successful Vendor change

### `POST /api/auth/forgot-password`

Staff password recovery or change-password initiation, according to the selected secure implementation.

- Authentication: public entry, protected completion
- Rules: do not reveal whether an account exists; reset credentials server-side

## Public Referral API

### `GET /api/public/qr/:qrCode`

Resolve a public QR and record a scan.

- Authentication: public
- Response: public referral context only
- Rules: lookup unique `QrCode.code`, resolve the current active assignment, create immutable scan attribution, and rate-limit the request
- Errors: invalid, unassigned, inactive, or retired QR returns a safe public error response

### `POST /api/public/leads`

Submit a customer referral lead.

- Authentication: public
- Request: QR/referral context, customer name, mobile number, and approved optional fields
- Rules: normalize the mobile number, generate the server-side HMAC identity, validate the qualifying scan, apply duplicate prevention transactionally, and persist `vendor_id`, `qr_id`, `qr_assignment_id`, and `scan_id`
- Response: safe confirmation without exposing internal attribution data

## Vendor Registration

### `POST /api/vendors/register`

Create a vendor registration.

- Authentication: public
- Request: `business_name`, `owner_name`, `mobile_number`, `login_identifier`
- Response: registration acknowledgement
- Rules: validate and normalize identifiers; do not assign or activate a QR during registration

## Sales API

### `GET /api/sales/registrations`

List registrations visible to the authenticated Sales user.

- Authentication: Sales
- Query: bounded pagination and approved search/filter fields
- Rules: scope results by explicit Sales ownership or assignment; do not return unrestricted lead or payout data

### `GET /api/sales/vendors`

List vendors operationally available to the authenticated Sales user.

- Authentication: Sales
- Query: bounded pagination; indexed identifier/name lookup
- Rules: scope results by Sales ownership or assignment

### `POST /api/sales/vendors/:vendorId/onboard`

Complete onboarding for an eligible registration.

- Authentication: Sales
- Request: approved vendor details and initial credential setup
- Rules: authorize the vendor through Sales ownership; store only a password hash; set `must_change_password = true`; do not allow active QR reassignment

### `GET /api/sales/qr/:code`

Check a QR for activation.

- Authentication: Sales
- Response: QR status and safe operational details
- Rules: Sales may proceed only when the QR is `UNASSIGNED`

### `POST /api/sales/qr/assign`

Assign and activate an unassigned QR.

- Authentication: Sales
- Request: QR code and authorized vendor reference
- Rules: verify Sales ownership, require `UNASSIGNED`, create the assignment and activate the QR transactionally, and write an audit log
- Errors: active or unavailable QR returns `409`

Sales has no endpoint for directly reassigning an active QR, reading payouts, reading unrestricted leads, or reading audit logs.

## Admin API

### `GET /api/admin/vendors`

List all vendors.

- Authentication: Admin
- Query: bounded pagination and indexed filters

### `POST /api/admin/vendors`

Create a vendor directly.

- Authentication: Admin
- Rules: validate database-unique identifiers and write an audit log

### `PATCH /api/admin/vendors/:vendorId`

Modify vendor information or status.

- Authentication: Admin
- Rules: preserve historical records and write an audit log

### `POST /api/admin/vendors/:vendorId/reset-password`

Issue a secure temporary password/reset flow for a Vendor.

- Authentication: Admin
- Rules: store only a password hash, set `must_change_password = true`, invalidate prior reset state, and audit the action

### `GET /api/admin/qr`

List QR inventory and current assignment summary.

- Authentication: Admin
- Query: bounded pagination and status filters

### `POST /api/admin/qr/generate`

Generate a batch of unique QR inventory records.

- Authentication: Admin
- Request: quantity and approved generation options
- Rules: enforce unique codes in the database and audit the batch

### `POST /api/admin/qr/:qrId/reassign`

Reassign an active QR.

- Authentication: Admin
- Request: new vendor reference
- Rules: close the old assignment, create the new assignment, preserve all historical attribution, and audit in one transaction

### `GET /api/admin/scans`

List scans.

- Authentication: Admin
- Query: bounded pagination; cursor/keyset pagination for large datasets

### `GET /api/admin/leads`

List and filter leads.

- Authentication: Admin
- Query: bounded pagination and approved filters

### `GET /api/admin/payouts`

List manual payout-status records.

- Authentication: Admin
- Query: bounded pagination and status filters
- Rules: statuses are only `UNPAID` and `PAID`

### `POST /api/admin/payouts/:payoutId/mark-paid`

Mark a payout as paid.

- Authentication: Admin
- Request: `paid_reference`
- Rules: set `paid_at` and `paid_by` from the authenticated Admin; do not calculate commission or invoke an automated payout provider; audit the change

### `GET /api/admin/users`

List and manage staff users.

- Authentication: Admin
- Rules: only Admin may create, modify, deactivate, or delete staff users where appropriate

### `GET /api/admin/audit-logs`

List audit records.

- Authentication: Admin
- Query: bounded pagination; cursor/keyset pagination for large datasets

## Vendor API

### `POST /api/vendor/login`

Authenticate using a login identifier or registered mobile number and password.

- Authentication: public
- Rules: create a server-managed Vendor session; enforce temporary-password change when `must_change_password = true`

### `GET /api/vendor/profile`

- Authentication: Vendor
- Rules: return only the authenticated Vendor's profile

### `PATCH /api/vendor/profile`

- Authentication: Vendor
- Rules: modify only permitted own profile fields; attribution and payout status are immutable to the Vendor

### `GET /api/vendor/leads`

- Authentication: Vendor
- Query: bounded pagination
- Rules: scope exclusively to the authenticated Vendor; protect customer phone data

### `GET /api/vendor/payouts`

- Authentication: Vendor
- Query: bounded pagination
- Rules: return only that Vendor's `UNPAID` or `PAID` status and permitted payment details; never expose other Vendors' records

### `POST /api/vendor/change-password`

- Authentication: Vendor
- Request: current password and new password
- Rules: clear `must_change_password` after success and invalidate temporary credentials

## Authorization Invariants

- Frontend route guards never replace backend authorization.
- Vendor resource access is always derived from the authenticated Vendor session.
- Sales resource access is always scoped by explicit ownership or assignment.
- Only Admin may reassign active QR codes or mark payouts as paid.
- No role may alter historical lead attribution.
- Public QR requests cannot access internal records beyond the safe referral response.
- All state-changing sensitive operations create focused audit records.
