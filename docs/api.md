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

Every CSV export (`toCsv`/`csvCell` in `backend/src/routes/admin.js`, used by leads/vendors/print-history/audit-logs export) neutralizes a cell that starts with `=`, `+`, `-`, or `@` by prefixing it with `'`, before the existing quote/newline escaping — defusing Excel/Sheets formula injection from any pasted or stored value (a UPI ID, an account holder name, a lead's name field, etc.) that later gets exported and opened in a spreadsheet.

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

Search and page through Solar Mitras available to the authenticated Sales user. Backs both Sales pickers ("Assign QR" and "Complete onboarding").

- Authentication: Sales
- Query: `search` (optional), `page` (default 1), `limit` (default 10, capped at 50), `include_assigned` (`true` only for the "Complete onboarding" picker)
- Search: substring, case-insensitive, over business name, owner name, login ID and mobile number; a phone-shaped query (`+91 98765 43210`, `98765-43210`, `919876543210`) is normalized to digits first. See `backend/src/lib/vendor-search.js` for the exact rules — `%` and `_` are matched literally, and a bare `91` is an ordinary substring, never "every Indian number"
- Response: `vendors: [{ id, businessName, ownerName, loginIdentifier, mobileNumber }]` **newest first** (`createdAt desc`, `id` as tie-break; the Sales UI shows the first 3 and finds the rest through `search`), plus `pagination: { page, limit, total }`. The old hard cap of 100 is gone: every eligible Solar Mitra is reachable by paging or searching
- Rules: scope results by Sales ownership (owned by this user, or by nobody), ACTIVE only; excludes any Vendor already holding an active QR assignment unless `include_assigned=true`, so one active QR per Solar Mitra is still enforced at the assign picker
- **This only narrows what the UI offers.** The ownership checks on `POST /api/sales/qr/assign`, `PATCH /api/sales/vendors/:vendorId/location` and the photo endpoints remain the real authorization boundary and are unchanged

### `POST /api/sales/vendors/:vendorId/onboard`

Complete onboarding for an eligible registration.

- Authentication: Sales
- Request: approved vendor details and initial credential setup
- Rules: authorize the vendor through Sales ownership; `password` is optional (blank = the Vendor's phone number); store only a password hash; set `must_change_password = true`; do not allow active QR reassignment; write an audit log (`VENDOR_CREATED`)
- Frontend sequence: use the returned Vendor identifier for the subsequent QR assignment request; do not reuse the registration identifier

### `POST /api/sales/vendors`

Create a Vendor directly — the third onboarding path, alongside self-registration-then-onboard and Admin's direct create (`POST /api/admin/vendors`).

- Authentication: Sales
- Request: `business_name`, `owner_name`, `login_identifier`, `mobile_number`, `password` (temporary — no OTP/mobile verification, matching the rest of this app's vendor-creation paths), **`state`** (required — one of the fixed India state/UT names, `backend/src/lib/indian-states.js`); optional `latitude`, `longitude`, `accuracy`, `captured_at` (the Solar Mitra's shop geo-tag — same validation as `POST /api/public/leads`'s location fields: both-or-neither, `400 INVALID_LOCATION` otherwise)
- Rules: normalize identifiers, `password` optional (blank = the mobile number), store only a password hash, set `must_change_password = true`, set ownership to the creating Sales user (`sales_user_id`), write an audit log (`VENDOR_CREATED`); a valid geo-tag creates a `VendorOnboardingMedia` row in the same transaction — never blocks creation if omitted
- Errors: a duplicate `login_identifier` or `mobile_number` returns `409 VENDOR_ALREADY_EXISTS`; an invalid mobile number returns `400 INVALID_MOBILE_NUMBER`; a missing/unrecognized `state` returns `400 VALIDATION_ERROR`

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

### `GET|PATCH /api/sales/vendors/:vendorId/bank-details` and `POST /api/sales/vendors/:vendorId/bank-details/:documentType`

Sales fills bank details on a Solar Mitra's behalf (same fields as the Vendor's own form: `upi_number`, `upi_id`, `account_holder_name`, `account_number`, `ifsc_code`; `documentType` is `passbook` or `cheque`, PDF/JPG/PNG up to 200 KB).

- Rules: same ownership as location/photos (`sales_user_id` is the caller or null); stored in the same `VendorBankDetails` row Admin and the Vendor see; the PATCH writes a `VENDOR_BANK_DETAILS_UPDATED` audit log
- **Locked once set**: PATCH and the document upload both check `isBankDetailsSet()` (`backend/src/lib/vendor-bank-details.js` — true once any of the 5 text fields or a passbook/cheque object key is non-empty) *before* writing anything; if it is already set, both return `403 BANK_DETAILS_LOCKED` and change nothing. GET is unaffected — Sales can still view. Only `PATCH|POST /api/admin/vendors/:vendorId/bank-details...` (below) can change it after that.
- Errors: `404 VENDOR_NOT_FOUND`, `400 INVALID_DOCUMENT_TYPE`, `413 DOCUMENT_TOO_LARGE`, `403 BANK_DETAILS_LOCKED`

### `GET|PATCH /api/admin/vendors/:vendorId/bank-details` and `POST /api/admin/vendors/:vendorId/bank-details/:documentType`

Admin's own bank-details routes for any Vendor — same fields, document types and size/type limits as the Sales/Vendor versions above, sharing the same `bankDetailsSchema` (`backend/src/lib/vendor-bank-details.js`) and the same `VendorBankDetails` row.

- Authentication: Admin (no ownership restriction — any Vendor)
- Rules: **never locked** — Admin can create or overwrite bank details at any time, including after Sales or the Vendor has already set them (the one place that can still fix a mistake or replace a document); the PATCH and the document upload each write a `VENDOR_BANK_DETAILS_UPDATED` audit log with `{ source: 'ADMIN' }`
- **Format validation** (`bankDetailsSchema`, applies to this route and the Sales/Vendor ones above): `ifsc_code` is normalized to uppercase then checked against the standard 11-character IFSC pattern; `upi_id` is checked as a `name@bank`-shaped VPA (case preserved); `upi_number` and `account_number` are digits-only, 10-18 and 6-18 digits respectively — a **character/length sanity check only, not verification** that the account/IFSC/UPI actually exists or belongs to the Vendor. A malformed value on these routes returns `400 VALIDATION_ERROR`; `account_holder_name` has no format check (free text). A blank field clears it; an omitted key leaves it unchanged.
- Errors: `404 VENDOR_NOT_FOUND`, `400 INVALID_DOCUMENT_TYPE`, `413 DOCUMENT_TOO_LARGE`

### `POST /api/admin/vendors/:vendorId/bank-details/:documentType/delete`

Removes one uploaded bank document (passbook or cheque). Admin only — Sales has no equivalent.

- Authentication: Admin
- Rules: clears only that document type's 4 fields (object key, file name, size, content type); the other document and all 5 text fields are untouched. Idempotent — a no-op success if nothing was uploaded for that type. Writes a `VENDOR_BANK_DETAILS_UPDATED` audit log with `{ source: 'ADMIN', action: 'DOCUMENT_DELETED', documentType, vendorId }`.
- **Ordering**: the database is cleared and audited first, then the storage object is removed. If storage cleanup fails (logged server-side), the response is still `200 { success: true, warning: 'Document metadata was deleted, but storage cleanup failed.' }` — the DB is already consistent; a leftover storage object is a harmless cleanup-later concern rather than a dangling reference to a missing file.
- Errors: `404 VENDOR_NOT_FOUND`, `400 INVALID_DOCUMENT_TYPE`

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

List all vendors (excluding soft-deleted).

- Authentication: Admin
- Query: bounded pagination, plus `search` (optional) — server-side, so a match on any page is found from page 1. Same rules as `GET /api/sales/vendors` (substring over name, owner, login ID, mobile; phone normalization; literal `%`/`_`), and an exact vendor `id` also matches, so an id copied from Print History or an audit log still finds its Solar Mitra
- Query: `state` (optional) — exact match against one of the fixed India state/UT names (`backend/src/lib/indian-states.js`); an unrecognized value returns `400 INVALID_STATE` rather than being silently ignored
- INACTIVE vendors are included (the list is where they are managed); DELETED are not
- Response: each vendor now includes `state` (nullable — blank until set)

### `GET /api/admin/vendors/export`

Export every matching Vendor as CSV (`solarium-solar-mitras.csv`), same shape as `GET /api/admin/leads/export`.

- Authentication: Admin
- Query: the same `search` and `state` filters as `GET /api/admin/vendors` (no pagination — the whole matching set is exported); an unrecognized `state` returns `400 INVALID_STATE`
- Columns: Business Name, Owner Name, Login ID, Mobile Number, State, Status, Current QR, Leads, Sales Owner, Created At

### `POST /api/admin/vendors`

Create a Vendor directly.

- Authentication: Admin
- Request: business details, optional initial password, **`state`** (required — one of the fixed India state/UT names), and optional `latitude`, `longitude`, `accuracy`, `captured_at` (the Solar Mitra's shop geo-tag — same both-or-neither validation as the Sales equivalent, `400 INVALID_LOCATION` otherwise)
- Rules: normalize identifiers, store only a password hash, and audit the creation; a valid geo-tag creates a `VendorOnboardingMedia` row in the same transaction — never blocks creation if omitted
- `state` is **not** offered by bulk create (CSV rows or names-only) — a bulk-created Vendor's `state` is blank until edited. It is also optional again on `PATCH` (edit) — this requirement is creation-only.

### `PATCH /api/admin/vendors/:vendorId`

Modify vendor information or status.

- Authentication: Admin
- Request: any subset of the create fields, including `state`
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

Create up to 500 Solar Mitras at once. Two mutually exclusive request shapes (sending both or neither returns `400`).

- Authentication: Admin
- Optional `state`, applied to **every** Vendor in the batch (not a per-row field) — batch metadata, e.g. "this whole paste is Gujarat". Works with either mode below.
- **Rows mode (real phone numbers).** `{ "rows": [{ "name": "Ram Store", "phone": "9876543210", "password": "", "upi_number": "", "upi_id": "", "account_holder_name": "", "account_number": "", "ifsc_code": "" }] }` — 1 to 500 rows; every field but `name` is optional in the schema, enforced per row below. Built for the CSV upload/paste in the Admin UI (columns `name, phone, password` plus the 5 bank columns; template at `GET /api/admin/vendors/bulk-import-template`).
  - Per row, in order: the phone is normalized (`+91`/`91`/`0091`/spaces handled) and must be a valid Indian mobile (`MOBILE_REQUIRED`, `INVALID_MOBILE_NUMBER`); the password is the trimmed `password`, or the normalized phone when blank, and must be at least 8 characters (`PASSWORD_TOO_SHORT`); a phone repeated later in the same batch, or already held by a non-deleted Solar Mitra, or equal to any existing `login_identifier` (including a deleted vendor's), is skipped (`PHONE_ALREADY_USED`). A deleted vendor's *mobile number* may be reused unless its `login_identifier` equals that number.
  - **Bank fields, per row, all optional.** Each of `upi_number`/`upi_id`/`account_number`/`ifsc_code` is validated and normalized independently with the same `bankDetailsSchema` rules as the single-entry bank-details routes above (format sanity checks only, never verification). A malformed field is **not saved and does not fail the row** — it's dropped and reported in `summary.warnings[]` (`{ row, field, code: 'INVALID_FORMAT', reason }`); the Solar Mitra is still created. `account_holder_name` is free text (trimmed, no format check). A row with no valid bank fields gets no `VendorBankDetails` row at all.
  - Created fields: `business_name` = `owner_name` = `name`; `login_identifier` = `mobile_number` = the normalized phone (so the phone is literally the username, backed by the unique constraint); `must_change_password = true`. Vendor creation and any bank-details rows for the batch are written in one transaction — if the bank-details insert fails, the vendor insert rolls back too. A bank-details row is only ever attached to a vendor this same batch verified it created (matched by phone **and** name) — never to a pre-existing or unrelated Vendor.
  - One row's problem never fails the batch; `summary.failures[].row` is the row's original 1-based position in the request.
- **Names mode (legacy).** `{ "names": ["Ram Store"], "auto_password": false }` — `owner_name` defaults to the business name, `login_identifier` is a slug of the name (`-2`/`-3` on collision), `mobile_number` is a placeholder from a reserved band (`9000010001` upward) for the Admin to correct later. With `auto_password` the password is `<slug-without-hyphens>@123`, otherwise `password_hash` stays `null`. No per-row bank fields (names mode has no per-row structure for them; only batch-level `state` applies here too).
- Rows are written with a small fixed number of bulk statements, never one transaction per row (measured ~0.8 s/row that way). One `VENDOR_BULK_CREATED` audit entry per created vendor; passwords are never logged or audited.
- Success: `{ success: true, summary: { totalRows, created, failed, failures: [{ row, businessName, reason }], warnings: [{ row, field, code, reason }] } }`

### `GET /api/admin/vendors/bulk-import-template`

Download the blank CSV for rows mode.

- Authentication: Admin
- Response: `text/csv`, header `name,phone,password=phonenumber,upi_number,upi_id,account_holder_name,account_number,ifsc_code` and one valid-format example row. The parser matches the password column by prefix (a plain `password` header also works); the 5 bank columns are matched by exact header alias only (e.g. `ifsc_code`, `ifsc`, or `ifsc code`), not by prefix or position — a header like `account_number_backup` is never misread as the real column. A blank password cell means "use the phone number"; a blank bank cell means that field is simply not provided.

### `POST /api/admin/vendors/:vendorId/reset-password`

Issue a secure temporary password/reset flow for a Vendor.

- Authentication: Admin
- Rules: store only a password hash, set `must_change_password = true`, invalidate prior reset state, and audit the action

### `GET /api/admin/qr`

List QR inventory and current assignment summary.

- Authentication: Admin
- Query: bounded pagination, `status` filter, and `assignment` filter (`ASSIGNED`/`UNASSIGNED`)
- Each row also carries `latestPrint: { jobId, kind, templateId, templateName, printedAt } | null` — the most recent template this code was printed with, or `null` if it has never been printed. Resolved in one extra query for the codes on the page, not per row.

### `POST /api/admin/qr/generate`

Generate a batch of unique QR inventory records, continuing sequentially from the highest existing `V-####` code.

- Authentication: Admin
- Request: `{ quantity }` (1–5000)
- Rules: enforce unique codes in the database and audit the batch
- Response: `201 { success: true, count, codes }`
- Exposed directly in QR Management's "Generate QR codes" panel (build up inventory — e.g. 100–200 codes — before printing), with a "Print these codes" shortcut that pre-fills the Print QR Codes wizard's Step 1 with the just-generated range

### `GET /api/admin/qr/range-check`

Read-only existence check for a QR range or a single code (`range_start === range_end`), used by the Print QR Codes wizard's Step 1 before it lets the admin continue.

- Authentication: Admin
- Query: `range_start`, `range_end`
- Response: `{ total, existingCount, missingCount, missing: [...] }` — `missing` is capped to 200 codes for display; the counts are always exact
- Errors: `400 QR_RANGE_INVALID` (malformed codes or start after end); `400 QR_RANGE_TOO_LARGE` if the span exceeds 5000 codes, checked before any database query

### `POST /api/admin/qr/generate-range`

Generates only the codes within a range that don't already exist — unlike `POST /api/admin/qr/generate`, which always appends sequentially after the current max and cannot fill a gap. This is a deliberate, separate, audited action the Print QR Codes wizard offers when Step 1's range-check finds missing codes; `POST /api/admin/qr/print-batch` itself still refuses to print a range with any missing code and never creates one as a side effect (see `qr-template-placement.md`).

- Authentication: Admin
- Request: `range_start`, `range_end` (same validation/cap as `range-check`)
- Rules: a range with nothing missing is a harmless no-op (`created: 0`); writes one `QR_GENERATED` audit row per call with `metadata: { mode: 'range', rangeStart, rangeEnd, quantity }`, distinguishing it from the sequential generator's `{ quantity }`-only metadata under the same audit action
- Response: `201 { success: true, created, codes }`
- Errors: same as `range-check`; `409 QR_BATCH_CONFLICT` on a genuine concurrent-generate race

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

### `POST /api/admin/qr/:qrId/delete`

Delete a QR code that has never been meaningfully used. A soft-delete equivalent to the vendor "delete vs deactivate" pattern: history is always preserved, never silently destroyed.

- Authentication: Admin
- Rules: only `UNASSIGNED` codes are eligible. Deletable when the code has **no scans, no leads, and no print records** — closed assignment rows (no scans/leads/prints attached) are the one exception and are removed along with the QR, since nothing else references them; this can happen when a code is manually reset to `UNASSIGNED` after an earlier assignment was closed. Deleting writes a `QR_DELETED` audit row recording `{ qrCode, removedAssignments }`.
- Errors:

| Code | Status | Cause |
|---|---|---|
| `QR_NOT_FOUND` | 404 | Unknown id |
| `QR_NOT_UNASSIGNED` | 409 | Status is not `UNASSIGNED` |
| `QR_HAS_HISTORY` | 409 | Scans, leads, or print records exist — message names which (e.g. "printed 1 time, 3 scans, 2 leads") |
| `QR_STILL_ASSIGNED` | 409 | `UNASSIGNED` status but an assignment row is still open — an inconsistent state, reported distinctly rather than silently deleted through |

### `GET /api/admin/vendors/lookup`

Search and page through Solar Mitras that can be assigned a QR (the Admin QR-table picker and the scan-to-assign panel).

- Authentication: Admin
- Query: `search` (optional), `page` (default 1), `limit` (default 10, capped at 50)
- Response: `vendors: [{ id, businessName, ownerName, loginIdentifier, mobileNumber }]` name-sorted, plus `pagination: { page, limit, total }`. The old hard cap of 200 is gone: with hundreds of bulk-created Solar Mitras, everything past the 200th was previously impossible to choose
- Rules: read-only, no audit log; ACTIVE vendors only; excludes any Vendor already holding an active QR assignment — one active QR per Vendor is enforced at this picker, not just in the reassignment logic. The pickers are fetched when opened (never preloaded), so opening the QR page no longer requests this endpoint

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

### `POST /api/admin/qr/templates`

Create a QR print template, optionally with a background artwork file. Full placement rules are in `qr-template-placement.md`.

- Authentication: Admin
- Request: `multipart/form-data` — the geometry fields (`name`, `page_width_mm`, `page_height_mm`, `dpi`, `qr_x`, `qr_y`, `qr_width`, `qr_height`, optional label fields) plus an optional artwork file under the `artwork` field
- Artwork formats: **PNG, JPG, or single-page PDF, 8 MB or smaller** (8 MB exactly is accepted). The file's real content is inspected — `sharp` for images, `pdf-lib` for PDFs — so the browser-declared Content-Type alone is never trusted, and a file that cannot be printed never reaches Storage or creates a template
- The response's template rows elsewhere (`GET /api/admin/qr/templates`) carry `printJobCounts: { batch, single }` alongside the total `printJobCount`, so the usage label can say which kind of prints exist
- Response: `201` with the created template, plus a non-blocking `artworkWarning` string when a PDF artwork's page size differs from the template page (artwork is always stretched to fill the page, so a mismatch distorts the design)
- Errors:

| Code | Status | Cause |
|---|---|---|
| `QR_ARTWORK_TOO_LARGE` | 413 | Over 8 MB |
| `INVALID_QR_ARTWORK_TYPE` | 400 | Not a PNG, JPG, or PDF |
| `QR_ARTWORK_MULTIPAGE_PDF` | 400 | PDF has more than one page; the message names the real count |
| `QR_ARTWORK_CORRUPT` | 400 | File could not be decoded/parsed |
| `QR_ARTWORK_ENCRYPTED` | 400 | Password-protected PDF |
| `QR_ARTWORK_EMPTY_PDF` | 400 | PDF page has no drawable content |

Multi-page PDFs are rejected rather than silently printing page 1, because the editor preview shows every page.

### `GET /api/admin/qr/print-jobs`

List print jobs — the QR → template → Solar Mitra mapping. Covers both multi-code print batches and single-code designed PDF downloads.

- Authentication: Admin
- Query: bounded pagination (`page`/`limit`), plus filters `template_id`, `kind` (`BATCH`/`SINGLE`), `code` (jobs containing that QR code, case-insensitive), `vendor_id` (exact) and `vendor` (business-name prefix, case-insensitive)
- Response: `print_jobs: [...]` with `template {id,name,status}`, `createdBy {id,name}`, `kind`, `status`, `rangeStart`/`rangeEnd`, `itemCount`, `createdAt`/`generatedAt`, plus `pagination`
- Note: the `vendor` name filter exists because `GET /api/admin/vendors/lookup` deliberately *excludes* Solar Mitras that already hold an active QR — exactly the set this filter is about — so it cannot back this picker

### `GET /api/admin/qr/print-jobs/:jobId`

One print job with every code it contains and the Solar Mitra currently holding each.

- Authentication: Admin
- Response: `print_job` plus `items: [{ sequence, qrId, code, qrStatus, currentVendor }]`
- Errors: unknown id returns `404 QR_PRINT_JOB_NOT_FOUND`

### `GET /api/admin/qr/:qrId/print-history`

Every print of one QR code, newest first. A reprint adds a record and never replaces an earlier one.

- Authentication: Admin
- Response: `qr {id,code,status}`, `currentVendor`, and `prints: [{ jobId, kind, jobStatus, templateId, templateName, printedAt, printedBy, sequence }]`
- Errors: unknown id returns `404 QR_NOT_FOUND`

### `GET /api/admin/qr/print-history/export`

CSV of the flattened mapping, honouring the same filters as `GET /api/admin/qr/print-jobs`.

- Authentication: Admin
- Response: `text/csv` — QR Code, QR ID, Template, Template ID, Print Type, Print Job ID, Printed At, Printed By, Current Vendor, Vendor ID, QR Status
- Bounded to 5,000 rows, consistent with the other exports in this API; larger histories are paged through the list endpoint

### `GET /api/admin/scans`

List scans.

- Authentication: Admin
- Query: bounded pagination; cursor/keyset pagination for large datasets

### `GET /api/admin/leads`

List and filter leads.

- Authentication: Admin
- Query: bounded pagination and approved filters

### `GET /api/admin/leads/export`

Export every Lead as CSV (`solarium-leads.csv`), no pagination or filters.

- Authentication: Admin
- Columns: Customer Name, Customer Phone, Customer Email, Location, Pincode, Average Electricity Bill, Solar Size, GPS Latitude, GPS Longitude, GPS Accuracy (m), Lead Status, Vendor Name, Vendor Mobile Number, **Vendor State**, QR Code, Payout Status, Payout Reference, Created At — `Vendor State` is blank for a purged (hard-deleted) Vendor, same as every other live-Vendor-only column

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
- Rules: create a server-managed Vendor session. A Vendor created without a password (Admin create, Sales create/onboard, or bulk rows with a blank password) signs in with their **phone number** as the password. A legacy Vendor with no stored password can also sign in with the phone number; it is hashed and stored on first use.
- Login lookup: every ACTIVE Vendor matching the identifier (login ID or mobile number, also `+91`/spaced phone forms) is tried and the first whose password matches signs in, because `mobile_number` is not unique and old/test/deleted Vendors can share a phone. Typing the phone with `+91`/spaces also works while the password is still the phone number.
- Changing the password is **optional**: `must_change_password = true` now only means "still on the default password" (used by the portal to show a dismissible hint). It no longer blocks any Vendor route, and `PASSWORD_CHANGE_REQUIRED` is no longer returned (`requireVendorReady` only checks the Vendor role).
- When Admin edits a Vendor's mobile number without setting a password, the password follows the new number only if it is still the old phone number; a password the Vendor or Admin chose is never changed.
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

## Print queue errors and idempotency

- `503 SERVER_BUSY`: another PDF job is running and the wait queue is full; retry shortly. Returned by the proof, print PDF, template PDF and QR PDF endpoints.
- `422 QR_BATCH_TOO_LARGE`: a batch exceeds `QR_MAX_BATCH_PAGES` (default 500). `POST /api/admin/qr/print-batch` and `GET /api/admin/qr/print-batch/:jobId/pdf` return it.
- `GET /api/admin/qr/print-batch/:jobId/pdf`: batches of up to 50 QR codes return one `application/pdf` as before. Larger batches return `application/zip` (`<start>-print-files.zip`) holding one PDF per 50 QR codes (`V-0001_to_V-0050.pdf`, ...), generated one chunk at a time and streamed. `409 QR_PDF_IN_PROGRESS` if the same batch is already being prepared. A failure after the download started drops the connection instead of returning a truncated ZIP.
- `500 QR_PDF_GENERATION_FAILED`: PDF composition failed; the queue slot is released.
- `POST /api/admin/qr/print-batch` with an `idempotency_key` that already exists (including a concurrent duplicate) returns `200 { job, duplicate: true }` for the existing job instead of an error.

## Admin list size, summaries and caching

- `limit` on `GET /api/admin/{vendors,leads,qr,scans,payouts,audit-logs,qr/print-jobs}` accepts up to **200** (API default 50, the Admin UI asks for 10 / 25 / 50 / 100 / 200 and defaults to 10; `201` clamps to 200; missing/invalid falls back to 50). `users` and `vendors/lookup` stay capped at 100.
- `GET /api/admin/qr` now returns `summary: { total, assigned, unassigned, consistent }` for the **whole inventory**, ignoring the status/assignment filters and the page. `consistent` is `total === assigned + unassigned`; when false the numbers are returned as counted and a warning is logged. The request no longer performs a repair write.
- `POST /api/admin/qr/repair-status` `{ dry_run?: boolean }` (admin, audit `QR_STATUS_REPAIRED`): counts ACTIVE codes with no open assignment (legacy rows) and, unless `dry_run`, sets them to UNASSIGNED. Returns `{ dry_run, affected }`.
- `GET /api/admin/dashboard` keeps every existing field and adds `assignedQrCodes` (open-assignment count, the same relationship the QR table uses), `scanLinkedLeads` (leads with a scan) and `qrStatusMismatch`. `unassignedQrCodes` is still status-based.
- `GET /api/admin/qr/templates?refresh=1` skips the server cache (used by the Templates page Refresh button, so rows removed directly in the database disappear at once). The browser keeps the template list for 60 s (signed artwork URLs last 300 s).
- Server-side cache (in process, cleared after **any** successful non-GET request anywhere in the API): dashboard counts 30 s, QR summary 20 s, template list 60 s. Public scans are GETs, so counts can lag by up to the TTL.
