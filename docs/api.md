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

### `POST /api/public/leads/check-phone`

Check whether a phone number can still submit a lead, before the customer fills out the rest of the form.

- Authentication: public
- Request: `{ "phone": "9876543210" }`
- Rules: normalize the mobile number and generate the server-side HMAC identity; the hash itself is never returned to the client
- Response: `{ "success": true, "available": true }` when no lead exists yet for this identity
- Errors: `400 VALIDATION_ERROR` for a missing phone value; `409 CUSTOMER_ALREADY_EXISTS` when a lead already exists for this identity (global — see below)
- This is a UX convenience only (lets the frontend block the form early). It is **not** the enforcement point — `POST /api/public/leads` repeats the same check and the database's unique constraint is what actually prevents a race between two concurrent submissions.

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
	"location": "Pune",
	"pincode": "411001",
	"average_electricity_bill": "5-6k",
	"solar_size": "3-4 kW",
	"location_lat": 18.5204,
	"location_lng": 73.8567,
	"location_accuracy": 25,
	"location_captured_at": "2026-08-26T10:15:00.000Z"
}
```

`pincode` is required. Pincode must be a six-digit Indian pincode beginning with 1-9. `average_electricity_bill` and `solar_size` are optional; when provided, accepted bill bands are `1-2k` through `9-10k` and `10k+`, and accepted solar-size bands are `1-2 kW` through `9-10 kW` and `10+ kW`.

**Optional GPS capture (pilot scope).** `location_lat`/`location_lng`/`location_accuracy`/`location_captured_at` are all optional — sent only if the customer tapped "Use my location" and the browser actually returned coordinates; omitted entirely (not sent as `null`) if they declined or skipped it, and the lead is created normally either way. When present, `location_lat` and `location_lng` must both be present (`400 INVALID_LOCATION` otherwise) and are validated server-side regardless of what the browser sent: latitude in [-90, 90], longitude in [-180, 180], accuracy >= 0 (`400 VALIDATION_ERROR` otherwise). A valid pair creates a `LeadLocation` row 1:1 with the new lead, created only inside the same lead-creation transaction — there is no separate endpoint that could attach a location to an arbitrary `lead_id`. See `data-model.md`'s LeadLocation section for what's deliberately out of scope for this pilot (no login-location history, no IP geolocation, no maps/analytics). Vendor/Solar Mitra shop location is captured separately — see `VendorOnboardingMedia` below.

**Duplicate rule (confirmed): global uniqueness.** One phone number can create at most one lead across the entire system, not one per vendor — a customer already attributed to one vendor is rejected if they scan a different vendor's QR and try to submit again. The server normalizes the phone number and stores only its HMAC identity (`CustomerIdentity.hash`) for deduplication; the hash is never exposed to the client.

A repeat submission for an identity that already has a lead does **not** create a second `Lead` row (a "DUPLICATE"-status row would pollute lead counts, exports, and payout tracking with garbage data). Instead the request is rejected outright with `409 CUSTOMER_ALREADY_EXISTS`. This is checked twice: once as a fast pre-check before opening a transaction (handles the common case without holding a pooled connection), and again via `Lead.customer_identity_id`'s database-level unique constraint, which is the actual enforcement — it is what protects against two concurrent requests both passing the pre-check before either has created a row. A unique-constraint violation (Prisma `P2002`) on this insert is caught and mapped to the same `409 CUSTOMER_ALREADY_EXISTS`.

`DUPLICATE` remains a valid **Admin-assigned** lead status (see `PATCH /api/admin/leads/:leadId`) for Admin's own manual triage — it is no longer something the system assigns automatically at submission time.

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
- Query: real page-based pagination (`page`, `limit` — default 25, capped at 100); response includes `pagination: { page, limit, total }`
- Rules: scope results by explicit Sales ownership or assignment; do not return unrestricted lead or payout data
- Corrected from a prior mismatch: this previously had no `page`/`skip` support at all — just a fixed `take: 50` with no way to reach anything beyond the first 50 pending registrations — despite this doc claiming pagination existed. Now genuinely paginated, matching every other Admin/Sales list endpoint's convention.

### `GET /api/sales/vendors`

List vendors operationally available to the authenticated Sales user, for the QR-assignment picker.

- Authentication: Sales
- Response: bounded to 100, name-sorted — a capped picker list (like `GET /api/admin/vendors/lookup`), not page-based pagination; this doc previously overclaimed "pagination" here
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
- Request: `business_name`, `owner_name`, `login_identifier`, `mobile_number`, `password` (temporary — no OTP/mobile verification, matching the rest of this app's vendor-creation paths); optional `latitude`, `longitude`, `accuracy`, `captured_at` (the Solar Mitra's shop geo-tag — same validation as `POST /api/public/leads`'s location fields: both-or-neither, `400 INVALID_LOCATION` otherwise)
- Rules: normalize identifiers, store only a password hash, set `must_change_password = true`, set ownership to the creating Sales user (`sales_user_id`), write an audit log (`VENDOR_CREATED`); a valid geo-tag creates a `VendorOnboardingMedia` row in the same transaction — never blocks creation if omitted
- Errors: a duplicate `login_identifier` or `mobile_number` returns `409 VENDOR_ALREADY_EXISTS`; an invalid mobile number returns `400 INVALID_MOBILE_NUMBER`

### `PATCH /api/sales/vendors/:vendorId/location`

Set or fix a Solar Mitra's shop geo-tag after creation ("complete later" — Sales only, using live device GPS, since capturing real coordinates only means something if the capturing device is actually at the shop).

- Authentication: Sales (same ownership rule as `GET /api/sales/vendors`: the vendor must be owned by the requesting Sales user, or unowned)
- Request: `latitude`, `longitude` (both required here — this endpoint's whole purpose is setting them), optional `accuracy`, `captured_at`
- Rules: upserts the `VendorOnboardingMedia` row's geo fields, leaving any existing photos untouched
- Errors: `400 INVALID_LOCATION` if latitude/longitude are missing; `404 VENDOR_NOT_FOUND` if not owned/found

### `PATCH /api/admin/vendors/:vendorId/location`

Set or fix a Solar Mitra's shop geo-tag — Admin only. Unlike the Sales endpoint above, Admin isn't at the shop, so this isn't live device GPS: Admin types or pastes coordinates (e.g. relayed by the Sales rep, or copied from Google Maps).

- Authentication: Admin (no ownership restriction, matching Admin's other vendor-mutation routes)
- Request: `latitude`, `longitude` (both required), optional `accuracy`, `captured_at`
- Rules: upserts the `VendorOnboardingMedia` row's geo fields, leaving any existing photos untouched
- Errors: `400 INVALID_LOCATION` if latitude/longitude are missing; `404 VENDOR_NOT_FOUND` if not found

### `POST /api/sales/vendors/:vendorId/photos/:photoType` and `POST /api/admin/vendors/:vendorId/photos/:photoType`

Attach or replace a Solar Mitra's shop photo or QR placement photo — a photo of where the QR code sticker is placed in the shop (`photoType` is `shop` or `qr-placement`). Used both right after creation and to complete/fix onboarding media later — the same endpoint serves both.

- Authentication: Sales (owned-or-unowned vendor only) or Admin (no ownership restriction)
- Request: `multipart/form-data` with the image under the `photo` field (`image/jpeg` or `image/png`, 15 MB raw upload cap — an abuse ceiling, not the stored size)
- Rules: the uploaded image is compressed server-side to roughly 800 KB–1 MB (resized, JPEG-re-encoded, EXIF-orientation-corrected) before it reaches the private `vendor-photos` bucket (`SUPABASE_VENDOR_PHOTOS_BUCKET`); only the object key and compressed file's metadata are stored in `VendorOnboardingMedia`; if the database write fails after upload, the just-uploaded object is removed; on a successful replacement, the *previous* object is removed after the new one is saved
- Errors: `400 INVALID_PHOTO_TYPE` (bad `photoType` or non-image upload), `413 PHOTO_TOO_LARGE` (over 15 MB raw), `404 VENDOR_NOT_FOUND`

### `GET /api/admin/vendors/:vendorId/onboarding-media`

View a Solar Mitra's captured geo-tag and both photos — Admin only.

- Authentication: Admin
- Response: `{ latitude, longitude, accuracy, capturedAt, shopPhotoUrl, qrPlacementPhotoUrl }`, or `{ onboarding_media: null }` if nothing has been captured yet. Photo URLs are short-lived (300s) signed URLs, never raw object keys — the bucket is never made public.

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

Create a Vendor directly.

- Authentication: Admin
- Request: business details, optional initial password, and optional `latitude`, `longitude`, `accuracy`, `captured_at` (the Solar Mitra's shop geo-tag — same both-or-neither validation as the Sales equivalent, `400 INVALID_LOCATION` otherwise)
- Rules: normalize identifiers, store only a password hash, and audit the creation; a valid geo-tag creates a `VendorOnboardingMedia` row in the same transaction — never blocks creation if omitted

### `PATCH /api/admin/vendors/:vendorId`

Modify vendor information or status.

- Authentication: Admin
- Rules: preserve historical records and write an audit log

### `POST /api/admin/vendors/:vendorId/deactivate`

Deactivate a Vendor without deleting historical records.

- Authentication: Admin
- Rules: set the Vendor inactive and write an audit log

### `POST /api/admin/vendors/:vendorId/delete`

Soft-delete a Vendor with no historical records.

- Authentication: Admin
- Rules: only permitted when the Vendor has zero leads, scans, payouts, and QR assignments; sets `status = DELETED` and writes an audit log (`VENDOR_DELETED`); a `DELETED` Vendor is excluded from the default `GET /api/admin/vendors` list
- Errors: any historical record present returns `409 VENDOR_HAS_HISTORY` — deactivate instead

### `POST /api/admin/vendors/:vendorId/purge`

Destructively remove a Vendor while preserving its Leads as deleted-Vendor history.

- Authentication: Admin
- Request: `{ "confirm_vendor_name": "Exact Business Name" }`
- Rules: requires exact business-name confirmation; blocks when any payout history exists; preserves Lead rows and stores the former business name in `vendor_name_snapshot`; removes permitted assignments, scans, sessions, reset tokens, registrations, bank metadata, onboarding-media metadata (both photo objects removed from the `vendor-photos` bucket), and the Vendor row; QR inventory is not deleted
- Response: `{ success: true, vendor_id, preserved_lead_vendor_name }`
- Errors: `409 VENDOR_PURGE_CONFIRMATION_MISMATCH` for wrong confirmation; `409 VENDOR_PURGE_FINANCIAL_HISTORY` when payout history exists

### `POST /api/admin/vendors/bulk-delete`

Soft-delete multiple Vendors from the current Admin selection.

- Authentication: Admin
- Request: `{ "ids": ["vendor-id-1", "vendor-id-2"] }` — 1 to 100 unique IDs
- Rules: the complete selection is preflighted and the operation is all-or-nothing; every Vendor must have zero leads, scans, payouts, and QR assignment history
- Success: `{ success: true, deleted: [...], count }`, with one `VENDOR_DELETED` audit entry per Vendor
- Errors: `409 BULK_DELETE_BLOCKED` includes `error.details` for each blocked Vendor; deactivate the Vendor and explicitly unlink/reassign its QR before trying again

### `POST /api/admin/vendors/bulk-create`

Create up to 500 Vendors at once from a plain list of business names (pasted or read from an uploaded file client-side — this endpoint only ever receives plain names, never a file).

- Authentication: Admin
- Request: `{ "names": ["Ram Store", "A1 Solar Co."], "auto_password": false }` — 1 to 500 names (2-160 chars each, same bound as `business_name` on the single-vendor form)
- Rules: for each name, `owner_name` defaults to the business name; `login_identifier` is a slugified version of the name (lowercase, non-alphanumeric collapsed to `-`) with a `-2`/`-3` suffix appended on collision (checked both within the request and against existing Vendors); `mobile_number` gets a clearly-fake sequential placeholder from a reserved band (`9000010001` upward) the Admin edits later per Vendor — this field has no uniqueness constraint at the database level. When `auto_password` is `true`, every created Vendor's password is `<slug-without-hyphens>@123` (e.g. "Ram Store" → `ramstore@123`, padded to stay above the 8-character minimum for very short names); when `false` (default), `password_hash` is left `null`, identical to omitting `password` on the single-vendor form. Rows are processed one at a time, not as a single all-or-nothing batch — a `login_identifier` collision on one row is reported and skipped rather than failing the whole request. One `VENDOR_BULK_CREATED` audit entry is written per created Vendor.
- Success: `{ success: true, summary: { totalRows, created, failed, failures: [{ row, businessName, reason }] } }`

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

### `POST /api/admin/leads/:leadId/delete`

Permanently delete a lead (and its `LeadLocation`/`UNPAID` payout, if any).

- Authentication: Admin
- Rules: blocked with `409 LEAD_PAYOUT_NOT_UNPAID` if the lead's payout has already recorded a real payment (`PAID` or `PARTIAL`) — matching the existing rule that a `PAID` payout cannot even be reverted to `UNPAID`; writes an audit log (`LEAD_DELETED`)

### `GET /api/admin/leads/import-template`

Download a blank CSV template for `POST /api/admin/leads/import`, with the exact expected header row and one example row.

- Authentication: Admin

### `POST /api/admin/leads/import`

Bulk-import pre-existing leads a company already has, without any QR scan or vendor referral. Imported leads are attributed to a single dedicated system vendor, "Company Uploaded Leads" (lazily created on first import, mirroring the existing `PUBLIC-GENERAL`/"Solarium Direct" fallback pattern used for scanless public submissions), so they group and filter cleanly alongside organic leads without any schema change.

- Authentication: Admin
- Request: `multipart/form-data` with the CSV under the `file` field (max 5 MB, max 2,000 data rows)
- CSV columns: `customer_name`, `phone` (required); `email`, `location`, `pincode`, `average_electricity_bill`, `solar_size`, `status`, `created_at` (all optional)
- Validation is lenient by design: only `customer_name` and a valid Indian mobile number are required per row. `pincode`/`email`/band fields are stored as given (or left blank) and never reject a row. An unrecognized `status` defaults to `NEW`. A present and parseable `created_at` is preserved as the lead's creation date; otherwise the import time is used.
- Duplicate handling: a row whose phone number already belongs to any existing lead (organic or previously imported) is skipped and reported — never overwritten, and never exposing the other lead's vendor (same privacy rule as the public duplicate-customer flow)
- A row with `status = CONVERTED` gets an `UNPAID` payout created automatically, via the same shared invariant `PATCH /api/admin/leads/:leadId` uses
- Response: `{ success, summary: { totalRows, imported, duplicates: [{row, phone}], invalid: [{row, reason}] } }`
- Rules: each row is created in its own short transaction (not one whole-file transaction), so one bad row never blocks the rest; each successfully imported lead writes an audit log entry (`LEAD_CSV_IMPORTED`)

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
- Response also includes `currentQr` (the code, or `null`) and `qrAssigned` (boolean) — the Vendor's own active QR assignment status

### `PATCH /api/vendor/profile`

- Authentication: Vendor
- Rules: modify only permitted own profile fields; attribution and payout status are immutable to the Vendor

### `GET /api/vendor/leads`

- Authentication: Vendor
- Query: bounded pagination (`page`, `limit` — default 25, capped at 100)
- Rules: scope exclusively to the authenticated Vendor; protect customer phone data
- The frontend now actually uses this (Prev/Next controls on the Referrals tab) — previously the backend supported pagination but the UI never sent `page`/`limit` or exposed page controls, so a Vendor with more than 25 leads had no way to see the rest.

### `GET /api/vendor/payouts`

- Authentication: Vendor
- Query: bounded pagination (`page`, `limit` — default 25, capped at 100)
- Rules: return only that Vendor's `UNPAID` or `PAID` status and permitted payment details; never expose other Vendors' records
- Same frontend fix as `GET /api/vendor/leads` — Prev/Next controls added to the Payouts tab.

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
