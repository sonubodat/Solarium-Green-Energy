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
created_at
updated_at
```

Constraints and indexes:

- Unique normalized `login_identifier`.
- Define the duplicate policy for `mobile_number`; enforce the chosen policy in the database.
- Index `mobile_number`, `status`, `sales_user_id`, and `created_at`.
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
status
created_at
updated_at
```

Index `sales_user_id`, `status`, and `created_at`. Do not expose more contact data to Sales than the onboarding workflow requires.

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
status
created_at
updated_at
```

Index `vendor_id`, `qr_id`, `qr_assignment_id`, `customer_identity_id`, `created_at`, and `status`. The lead keeps `vendor_id`, `qr_id`, `qr_assignment_id`, and `scan_id` permanently so QR reassignment cannot change historical ownership.

Duplicate prevention must be implemented with a transaction and the configured database constraint. Duplicate scans may be recorded, but they must not create duplicate commissionable or payable attribution.

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
