# Solarium API Contract

This is the frontend/backend contract for the current scope. Exact field validation and response envelopes may be refined during implementation, but role boundaries and attribution rules are fixed here.

Base path:

```text
/api
```

Protected endpoints use the server-managed HTTP-only session. The client must not submit a role or vendor ID as an authority source.

The frontend calls these endpoints through one centralized API client with credentialed requests. Browser and API failures must be shown as user-facing states without exposing server stack traces.

## Common Response Rules

Success responses return JSON with the resource or operation result. Validation failures return `400 VALIDATION_ERROR` with a `details` array of `{path, message}` per invalid field (the centralized error handler maps every schema validation failure to this shape). Authentication failures return `401`. Authorization failures return `403`. Missing resources return `404`. Conflicts such as duplicate identifiers or an already-assigned QR return `409`. Unexpected failures are handled by centralized server error handling.

Do not expose password hashes, session tokens, reset tokens, raw customer hashes, internal database IDs where a public identifier is sufficient, or protected customer phone numbers to unauthorized roles.

## Authentication

### `POST /api/auth/login`

Authenticate an Admin or Sales user.

- Authentication: public
- Request: `username_or_mobile`, `password`
- Response: authenticated staff profile and session state
- Rules: derive role from the stored account; never trust a submitted role
- Security: requests are rate-limited per client IP; invalid credentials use a generic response

### `GET /api/auth/session`

Return the account and role for the currently authenticated session, if any.

- Authentication: any authenticated session (staff or Vendor)
- Response: `{ type: 'staff' | 'vendor', role, account }`
- Rules: read-only; relies entirely on the existing session cookie — never returns or accepts a password. Used by the frontend to silently restore a signed-in view (Admin/Sales/Vendor) without re-prompting for credentials within the session's lifetime.
- Errors: `401` if no valid session cookie is present

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
- Security: requests are rate-limited per client IP

### `POST /api/auth/reset-password`

Complete a staff or Vendor password reset.

- Authentication: public with a valid reset token
- Request: `reset_token`, `new_password`
- Rules: tokens are hashed in storage, expire after a short period (`PASSWORD_RESET_TTL_MINUTES`, default 15 minutes), are single-use, and are consumed atomically with the password update
- Security: requests are rate-limited per client IP

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
- Request: customer name, mobile number, and optional referral context (`scan_id` or `referral_qr`) with approved optional fields
- Rules: normalize the mobile number, generate the server-side HMAC identity, validate the qualifying scan, apply duplicate prevention transactionally, and persist `vendor_id`, `qr_id`, `qr_assignment_id`, and `scan_id`
- Response: safe confirmation without exposing internal attribution data

Request example:

```json
{
	"scan_id": "scan-id-from-qr-response",
	"customer_name": "Customer Name",
	"phone": "+91 9876543210",
	"email": "customer@example.com",
	"location": "Pune"
}
```

The server normalizes the phone number and stores only its HMAC identity for deduplication. The first lead is `NEW`; a later lead for the same identity is recorded as `DUPLICATE` and must not create payable attribution.

When `scan_id` is omitted, the backend accepts a direct public enquiry and creates attribution using `referral_qr` when provided; if no referral QR is provided, it records the enquiry under the configured general public assignment.

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
- Rules: scope results by Sales ownership or assignment; excludes any Vendor already holding an active QR assignment

### `POST /api/sales/vendors/:vendorId/onboard`

Complete onboarding for an eligible registration.

- Authentication: Sales
- Request: approved vendor details and initial credential setup
- Rules: authorize the vendor through Sales ownership; store only a password hash; set `must_change_password = true`; do not allow active QR reassignment; write an audit log (`VENDOR_CREATED`)
- Frontend sequence: use the returned Vendor identifier for the subsequent QR assignment request; do not reuse the registration identifier

### `POST /api/sales/vendors`

Create a Vendor directly — the third onboarding path, alongside self-registration-then-onboard and Admin's direct create (`POST /api/admin/vendors`).

- Authentication: Sales
- Request: `business_name`, `owner_name`, `login_identifier`, `mobile_number`, `password` (temporary — no OTP/mobile verification, matching the rest of this app's vendor-creation paths)
- Rules: normalize identifiers, store only a password hash, set `must_change_password = true`, set ownership to the creating Sales user (`sales_user_id`), write an audit log (`VENDOR_CREATED`)
- Errors: a duplicate `login_identifier` or `mobile_number` returns `409 VENDOR_ALREADY_EXISTS`; an invalid mobile number returns `400 INVALID_MOBILE_NUMBER`

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

### `POST /api/admin/vendors`

Create a Vendor directly.

- Authentication: Admin
- Request: business details and optional initial password
- Rules: normalize identifiers, store only a password hash, and audit the creation

### `POST /api/admin/vendors/:vendorId/deactivate`

Deactivate a Vendor without deleting historical records.

- Authentication: Admin
- Rules: set the Vendor inactive and write an audit log

### `POST /api/admin/vendors/:vendorId/delete`

Soft-delete a Vendor with no historical records.

- Authentication: Admin
- Rules: only permitted when the Vendor has zero leads, scans, payouts, and QR assignments; sets `status = DELETED` and writes an audit log (`VENDOR_DELETED`); a `DELETED` Vendor is excluded from the default `GET /api/admin/vendors` list
- Errors: any historical record present returns `409 VENDOR_HAS_HISTORY` — deactivate instead

### `POST /api/admin/vendors/:vendorId/reset-password`

Issue a secure temporary password/reset flow for a Vendor.

- Authentication: Admin
- Rules: store only a password hash, set `must_change_password = true`, invalidate prior reset state, and audit the action

### `GET /api/admin/qr`

List QR inventory and current assignment summary.

- Authentication: Admin
- Query: bounded pagination, `status` filter, and `assignment` filter (`ASSIGNED`/`UNASSIGNED`)

### `POST /api/admin/qr/generate`

Generate a batch of unique QR inventory records.

- Authentication: Admin
- Request: quantity and approved generation options
- Rules: enforce unique codes in the database and audit the batch

### `POST /api/admin/qr/:qrId/assign`

Assign and activate an unassigned QR directly (the Admin equivalent of the Sales-only `POST /api/sales/qr/assign`, without the Sales-ownership restriction).

- Authentication: Admin
- Request: `vendor_id`
- Rules: require `UNASSIGNED`, create the assignment and activate the QR transactionally, and write an audit log (`QR_ASSIGNED`)
- Errors: unknown `qrId` returns `404 QR_NOT_FOUND`; a QR that is not `UNASSIGNED` returns `409 QR_NOT_UNASSIGNED`

### `POST /api/admin/qr/:qrId/reassign`

Reassign an active QR.

- Authentication: Admin
- Request: new vendor reference
- Rules: close the old assignment, create the new assignment, preserve all historical attribution, and audit in one transaction

### `GET /api/admin/vendors/lookup`

List active vendors for a quick-pick UI (Admin's vendor-assignment dropdown for QR assign/reassign).

- Authentication: Admin
- Response: `vendors: [{ id, businessName, loginIdentifier }]`, bounded to 200, name-sorted
- Rules: read-only, no audit log; excludes any Vendor already holding an active QR assignment — one active QR per Vendor is enforced at this picker, not just in the reassignment logic

### `GET /api/admin/qr/:qrId/image`

Download a single QR code as a scannable image.

- Authentication: Admin
- Query: `format` (`svg` default, or `png`)
- Rules: the image encodes only the public referral URL (`${APP_BASE_URL}/v/:code`) — never an internal database id or vendor id; read-only, no audit log
- Errors: unknown `qrId` returns `404 QR_NOT_FOUND`

### `GET /api/admin/qr/print`

Generate a printable HTML sheet of QR codes for physical distribution.

- Authentication: Admin
- Query: `status` (`UNASSIGNED`/`ACTIVE`/`INACTIVE`/`RETIRED`, omitted = all), `vendor_id` (filters to QR codes currently assigned to that Vendor), bounded pagination (`page`/`limit`, same cap as every other Admin list endpoint)
- Response: `text/html`, not JSON — a self-contained page (inline QR images, no external requests) meant to be opened in a browser and printed to PDF via the browser's own print dialog; no server-side PDF dependency
- Rules: read-only, no audit log

### `GET /api/admin/scans`

List scans.

- Authentication: Admin
- Query: bounded pagination; cursor/keyset pagination for large datasets

### `GET /api/admin/leads`

List and filter leads.

- Authentication: Admin
- Query: bounded pagination and approved filters

### `PATCH /api/admin/leads/:leadId`

Change a lead status.

- Authentication: Admin
- Request: `status` (`NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `REJECTED`, or `DUPLICATE`)
- Rules: preserve immutable attribution and write an audit log; when status becomes `CONVERTED`, ensure a payout record exists for that lead (`UNPAID` by default)

### `GET /api/admin/payouts`

List manual payout-status records.

- Authentication: Admin
- Query: bounded pagination and status filters
- Rules: statuses are only `UNPAID`, `PAID`, and `PARTIAL`

### `POST /api/admin/payouts/:payoutId/status`

Set a payout's status to `UNPAID`, `PARTIAL`, or `PAID`.

- Authentication: Admin
- Request: `status` (`UNPAID`/`PARTIAL`/`PAID`), `paid_reference` (required for `PARTIAL` and `PAID`; optional for `UNPAID`)
- Rules: set `paid_by` from the authenticated Admin for `PARTIAL`/`PAID`; clear `paid_by`, `paid_at`, and `paid_reference` when setting `UNPAID`; set `paid_at` only when `status` is `PAID` (a `PARTIAL` update leaves `paid_at` unchanged); `PARTIAL` remains a manual status label only — no partial amount, split, or commission calculation is stored or computed; audit the change (`PAYOUT_MARKED_UNPAID`, `PAYOUT_MARKED_PARTIAL`, or `PAYOUT_MARKED_PAID`)

### `GET /api/admin/users`

List staff users.

- Authentication: Admin
- Query: bounded pagination

### `POST /api/admin/users`

Create an Admin or Sales staff user.

- Authentication: Admin
- Request: `name`, `username_or_mobile`, `password`, `role`
- Rules: store only a password hash and write an audit log

### `PATCH /api/admin/users/:userId`

Update a staff user.

- Authentication: Admin
- Rules: only Admin may modify staff users; at least one active Admin must remain

### `POST /api/admin/users/:userId/deactivate`

Deactivate a staff user.

- Authentication: Admin
- Rules: preserve audit history and protect the last active Admin account

### `GET /api/admin/audit-logs`

List audit records.

- Authentication: Admin
- Query: bounded pagination; cursor/keyset pagination for large datasets

## Vendor API

### `POST /api/vendor/login`

Authenticate using a login identifier or registered mobile number and password.

- Authentication: public
- Rules: create a server-managed Vendor session; enforce temporary-password change when `must_change_password = true`
- Security: requests are rate-limited per client IP and invalid credentials use a generic response

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

## Password Reset Development Note

`POST /api/auth/forgot-password` accepts `account_type` (`staff` or `vendor`) and `identifier`. It always returns a generic response to avoid account enumeration. For local development only, the reset token is included in the response; production responses never include it. Admins can issue a Vendor reset through `POST /api/admin/vendors/:vendorId/reset-password`.

## Authorization Invariants

- Frontend route guards never replace backend authorization.
- Vendor resource access is always derived from the authenticated Vendor session.
- Sales resource access is always scoped by explicit ownership or assignment.
- Only Admin may reassign active QR codes or mark payouts as paid.
- No role may alter historical lead attribution.
- Public QR requests cannot access internal records beyond the safe referral response.
- All state-changing sensitive operations create focused audit records.
