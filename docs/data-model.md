# Solarium Data Model Contract

This document defines the persistence contract for the current Solarium scope. It supplements `plan.md`; it does not add a commission engine or automated payout system.

## Modeling Rules

- Use stable primary keys for every entity.
- Use foreign keys for all relationships.
- Use database constraints for uniqueness and integrity.
- Store timestamps in a consistent timezone, preferably UTC.
- Deactivate or soft-delete vendors with historical records; do not hard-delete their business history.
- Protect customer phone data and never expose it to Vendors unless explicitly approved.
- Historical attribution must not depend on the QR's current assignment.

## Entities

### User

Staff authentication entity for Admin and Sales users.

Required concepts:

```text
id
name
username_or_mobile
password_hash
role              ADMIN | SALES
status
created_at
updated_at
```

Constraints and indexes:

- Unique normalized `username_or_mobile`.
- Index `role`, `status`, and `created_at`.
- Store only password hashes.

### Vendor

Business and vendor authentication entity.

Required concepts:

```text
id
business_name
owner_name
login_identifier
mobile_number
password_hash
must_change_password
status
sales_user_id       nullable until ownership is assigned
state               nullable; one of a fixed India state/UT list (backend/src/lib/indian-states.js); set only by Admin's or Sales' own create/edit form, never by bulk create
created_at
updated_at
```

Constraints and indexes:

- Unique normalized `login_identifier`.
- Define the duplicate policy for `mobile_number`; enforce the chosen policy in the database.
- Index `mobile_number`, `status`, `sales_user_id`, and `created_at`. `state` is not indexed (a fixed short list filtered by equality on a small table); add one only if the table grows large enough to matter.
- Store only password hashes.
- Preserve the vendor record when historical records exist.

### VendorRegistration

Represents a vendor self-registration before Sales completes onboarding. If implementation combines registration and Vendor, preserve the registration state and ownership fields explicitly rather than losing the workflow distinction.

Required concepts:

```text
id
vendor_id          nullable before vendor creation
business_name
owner_name
mobile_number
login_identifier
sales_user_id      nullable until assigned
state              nullable; the applicant's state, becomes Vendor.state on approval
reviewed_by_id     nullable; the Admin who approved/rejected (plain id, the audit log names the actor)
reviewed_at        nullable
rejection_reason   nullable
status
created_at
updated_at
```

Status is `PENDING`, `ONBOARDED` (approved), or `REJECTED`. Public applications (`/apply`) are reviewed by Admin; Sales can still onboard a `PENDING` row. Both paths claim the row with a conditional `PENDING` update first, so exactly one Vendor can come out of one application. A rejected applicant may re-apply: the same row returns to `PENDING`. A registration may be linked to one Vendor at most once; onboarding must set `vendor_id` and transition the registration transactionally. Index `sales_user_id`, `status`, and `created_at`. Do not expose more contact data to Sales than the onboarding workflow requires.

`login_identifier` is unique at the database level, matching `Vendor.login_identifier` — this prevents duplicate pending registrations for the same identifier from silently coexisting. `mobile_number` uniqueness follows the same open policy question as `Vendor.mobile_number` (see `RFI.md` §9) and is not yet enforced.

### QrCode

Physical QR inventory item. It is not a vendor identifier.

```text
id
code
status              UNASSIGNED | ACTIVE | INACTIVE | RETIRED
created_at
updated_at
```

Constraints and indexes:

- Unique `code`.
- Index `status`.
- The code contains only the public referral URL when rendered into a QR image.

### QrAssignment

Historical relationship between a QR and a Vendor.

```text
id
qr_code_id
vendor_id
assigned_by
assigned_at
unassigned_at       nullable while active
```

Constraints and indexes:

- Foreign keys to `QrCode`, `Vendor`, and the assigning staff user where applicable.
- Index `qr_code_id`, `vendor_id`, `assigned_at`, and `unassigned_at`.
- Enforce at most one active assignment per QR in the database's chosen representation.
- Reassignment closes the old row and creates a new row in one transaction.

### CustomerIdentity

Protected deduplication identity.

```text
id
customer_hash
created_at
updated_at
```

Generate `customer_hash` server-side from a normalized mobile number using an application secret HMAC key. Never use the raw phone number as the identity key. Enforce the configured uniqueness rule at the database level.

**Confirmed rule: global uniqueness.** One phone number can produce at most one `Lead` across the entire system, regardless of which vendor's QR it came through — a customer already attributed to one vendor is rejected outright (not silently recorded as a second lead) if they try to submit again under a different vendor. Enforced by a unique constraint on `Lead.customer_identity_id` (migration `20260826090000_lead_customer_identity_unique`), not application logic alone — see `api.md`'s `POST /api/public/leads` for the exact mechanics (fast pre-check, then a `P2002` unique-violation catch to close the concurrent-request race). `CustomerIdentity.hash` itself is separately unique and identifies the normalized customer independent of any lead; `Scan` rows may still reference a `CustomerIdentity` freely (a scan is not a lead and duplicate scans are expected/harmless).

### Scan

A QR scan event. A scan is not automatically a lead.

```text
id
qr_id
qr_assignment_id
vendor_id
customer_identity_id    nullable
created_at
```

Index `qr_id`, `vendor_id`, `qr_assignment_id`, and `created_at`. The vendor and assignment references are captured at scan time.

### Lead

A customer referral submission with immutable attribution.

```text
id
vendor_id
qr_id
qr_assignment_id
scan_id
customer_identity_id
customer_name
phone                protected
email                protected as appropriate
location
pincode              six-digit Indian postal code
average_electricity_bill  selected monthly bill band
solar_size           selected solar capacity band in kW
status
created_at
updated_at
```

Index `vendor_id`, `qr_id`, `qr_assignment_id`, `customer_identity_id`, `created_at`, and `status`. The lead keeps `vendor_id`, `qr_id`, `qr_assignment_id`, and `scan_id` permanently so QR reassignment cannot change historical ownership.

`qr_id` and `customer_identity_id` are the only required-and-unique attribution fields at the database level; `vendor_id`, `qr_assignment_id`, and `scan_id` are nullable. Two features rely on this to represent a lead that never involved a real QR scan, without any schema change: the public form's scanless-submission fallback (a lazily-created "Solarium Direct" vendor + `PUBLIC-GENERAL` QR, both `vendor_id` and `qr_assignment_id`/`scan_id` populated because `Scan`'s own foreign keys are required) and Admin's CSV lead import (a lazily-created "Company Uploaded Leads" vendor + `COMPANY-IMPORT` QR, with `qr_assignment_id`/`scan_id` left `null` since no scan ever happened). Both patterns exist so every lead still has a real, non-null `vendor_id` — required to keep the `CONVERTED` → payout invariant (`Payout.vendor_id` copies `Lead.vendor_id` directly) working without a null-check.

Duplicate prevention must be implemented with a transaction and the configured database constraint. Duplicate scans may be recorded, but they must not create duplicate commissionable or payable attribution.

### LeadLocation

Optional GPS captured client-side via the public enquiry form's "Use my location" button, submitted only alongside the lead the customer is actually creating in the same request — never a standalone endpoint a client could point at someone else's `lead_id`.

```text
id
lead_id           unique — one optional location per lead
latitude
longitude
accuracy          nullable
captured_at
created_at
```

If the customer denies the browser's location permission or never taps the button, the lead is still created normally and simply has no `LeadLocation` row — this must never block or delay submission.

The backend validates real ranges regardless of what the browser sends: `latitude` in [-90, 90], `longitude` in [-180, 180], `accuracy` >= 0. `latitude`/`longitude` must be supplied together or not at all (`400 INVALID_LOCATION` otherwise).

**Deliberately out of scope for this pilot** — do not add without a concrete need: login-location or location history, IP-based geolocation, maps, geofencing, distance calculations, or any location analytics view. This table exists to be built on later (e.g. "show leads on a map"), not to pre-build those features now. Vendor/Solar Mitra shop location moved out of this list once a concrete need arrived — see `VendorOnboardingMedia` below.

### VendorOnboardingMedia

Captured at Sales/Admin onboarding time: GPS coordinates of the Solar Mitra's shop, plus a photo of the shop and a photo of where the QR code sticker is placed in the shop — evidence that onboarding happened at the real shop. This is the concrete need that justified moving vendor location out of `LeadLocation`'s out-of-scope list above.

```text
id
vendor_id                          unique — one row per vendor
latitude                           nullable
longitude                          nullable
accuracy                           nullable
captured_at                        nullable
shop_photo_object_key              nullable
shop_photo_file_name               nullable
shop_photo_file_size               nullable
shop_photo_content_type            nullable
qr_placement_photo_object_key      nullable
qr_placement_photo_file_name       nullable
qr_placement_photo_file_size       nullable
qr_placement_photo_content_type    nullable
created_at
updated_at
```

Every field is optional and independently completable — unlike `LeadLocation` (an all-or-nothing row created once alongside its lead), a Solar Mitra can be created with none of this captured, and each piece (location, shop photo, QR placement photo) can be added or replaced later by its own request. Capturing real GPS only means something if the capturing device is actually at the shop, so Sales sets/fixes the geo-tag from live device location (`PATCH /api/sales/vendors/:vendorId/location`). Admin isn't at the shop, so Admin instead types or pastes coordinates — e.g. relayed by the Sales rep, or copied from Google Maps — both at vendor-creation time and later via its own endpoint (`PATCH /api/admin/vendors/:vendorId/location`), which has no ownership restriction (unlike Sales' equivalent, which is scoped to vendors Sales created). Both Sales and Admin can upload/replace either photo (`POST .../vendors/:vendorId/photos/:photoType`), since that doesn't require physical presence. Admin can view both photos and the coordinates via `GET /api/admin/vendors/:vendorId/onboarding-media`.

Photos are never stored as uploaded: every photo is compressed server-side to roughly 800KB–1MB (resized and JPEG-re-encoded, EXIF-orientation-corrected) before it reaches Supabase Storage, in a dedicated private `vendor-photos` bucket (`SUPABASE_VENDOR_PHOTOS_BUCKET`) — kept separate from the `vendor-documents` bucket used for bank KYC documents, which has a different sensitivity profile. Only the object key and file metadata are stored in Postgres; an object is removed from Storage if the accompanying database write fails, and the previous object is removed after a successful replacement — the same rules already documented for QR template artwork in `qr-template-placement.md`.

### Payout

Manual payout-status record only.

```text
id
lead_id
vendor_id
status              UNPAID | PAID
paid_at             nullable
paid_by             nullable ADMIN user id
paid_reference      nullable
created_at
updated_at
```

Index `vendor_id`, `status`, and `paid_at`. A payout belongs to a lead and must retain the lead's historical vendor. Only Admin can change payout status to `PAID`; the operation records `paid_at`, `paid_by`, and the manual payment reference.

There is no commission rate calculation, commission approval state, PAN/TDS data, or automated payout provider integration.

### VendorSession / Session

Server-managed authentication session.

```text
id
user_id             nullable for vendor sessions
vendor_id           nullable for vendor sessions
session_token_hash
expires_at
created_at
revoked_at          nullable
```

Store a hash of the session token where possible. Index the lookup hash and expiration. A session must identify its authenticated staff user or vendor server-side.

### PasswordResetToken

Single-use, server-side reset credential.

```text
id
user_id             nullable
vendor_id           nullable
token_hash
expires_at
used_at             nullable
created_at
```

Index the token hash and expiration. Never store the raw reset token or password.

This table supports the server-side staff and Vendor reset endpoints currently implemented. It does not imply email recovery, OTP recovery, or automated messaging. Admin-issued Vendor temporary-password resets still use `must_change_password`.

### AuditLog

Record meaningful security and business changes.

```text
id
actor_user_id
actor_role
action
entity
entity_id
metadata           structured, nullable
timestamp
```

Index `entity + entity_id`, `actor_user_id + timestamp`, `timestamp`, and `action + timestamp`. Keep audit data in PostgreSQL initially and paginate reads.

**Retention**: capped at 5000 rows — once exceeded, the oldest rows are deleted automatically (see `backend/src/lib/audit-retention.js`), checked on every `GET /api/admin/dashboard` and `GET /api/admin/audit-logs` request and immediately after the two operations that can burst many rows at once (bulk vendor create, lead CSV import). At 4000 rows (80% of the cap) the Admin portal blocks with a modal until the admin downloads a CSV copy (`GET /api/admin/audit-logs/export`) — tracked server-side via a single-row `AuditLogRetentionState` table so it survives across logins/devices and only re-prompts after a future cleanup actually runs. This retention mechanism manages the `audit_logs` table only — it is not a general database-size safeguard for the rest of the schema (leads, lead locations, vendors, QR codes, and payouts are deliberately left to grow unmanaged), and the CSV export is a manual download, not an automated backup/disaster-recovery system.

### AccessRole (`staff_roles`)

Admin-defined back-office role: `id`, `name` (unique ignoring case), `description`, `permissions text[]`, `created_by_id`, timestamps. Referenced by `users.staff_role_id` (`ON DELETE RESTRICT`).

### User changes

`role` enum `StaffRole` gains `STAFF`. `staff_role_id` is required for `STAFF` and must be null for `ADMIN` and `SALES` (CHECK `users_role_access_role_ck`). Existing rows already satisfy it.

### Solar Mitra poster template

`qr_print_templates.vendor_poster` (boolean, default false) marks the template Solar Mitras get when they download their own poster. A partial unique index allows at most one true row. Resolution lives in `backend/src/services/vendor-poster.js`.

### Lead assignment

`leads.assigned_to_id` (FK users, `ON DELETE SET NULL`) and `leads.assigned_at`, index `(assigned_to_id, status)`. `lead_notes` (`lead_id` cascade, `author_id`, `body`, `created_at`, append-only). `lead_assignment_history` (`lead_id` cascade, `from_user_id`, `to_user_id`, `changed_by_id` as plain ids, `changed_at`), never pruned: it is the ownership record. AuditLog is pruned to 5,000 rows, so it is not.

## Relationship Rules

```text
Vendor
  |-- QrAssignment history -- QrCode
  |-- Lead -- Scan
  `-- Payout

Lead
  |-- vendor_id
  |-- qr_id
  |-- qr_assignment_id
  `-- scan_id
```

The active QR assignment is used only for a new public scan. Existing Scan, Lead, and Payout records use their stored historical references.

## Transaction Rules

1. QR assignment: verify QR is `UNASSIGNED`, create assignment, and activate QR atomically.
2. QR reassignment: close the current assignment, create the replacement, update QR state if needed, and audit atomically.
3. Lead creation: normalize identity, resolve the scan attribution, apply duplicate rules, and create the lead transactionally.
4. Payout marking: verify the authenticated actor is Admin, set `PAID`, record payment metadata, and audit atomically.
5. Password reset: create a short-lived single-use reset record and invalidate it after successful use.

6. Lead assignment: `SELECT ... FOR SHARE` on the assignee, then `FOR UPDATE` on the leads ordered by id, compare with the locked owner, update, write history and audit. Deactivating or moving a `SALES` user locks that user row first, then their leads in id order.

## Database-Only Constraints

Prisma schema syntax cannot express the active-assignment partial uniqueness rule. The PostgreSQL migration must maintain:

```sql
CREATE UNIQUE INDEX ...
ON qr_assignments(qr_code_id)
WHERE unassigned_at IS NULL;
```

Payout creation must always copy `lead.vendor_id`; clients never submit `Payout.vendor_id`. Service-level tests must reject any attempted divergence between the payout and its lead.
