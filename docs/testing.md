# Solarium Testing Guide

This is the practical companion to `plan.md`, `api.md`, and `data-model.md`. It gives exact `curl` commands, request bodies, expected responses, Postman notes, and Supabase checks for every implemented endpoint, plus end-to-end acceptance scenarios and a frontend manual walkthrough.

Update this file whenever an endpoint's contract changes — it should never drift from `api.md`.

**Fixed since this guide was first written:** every `-> 400` claim below for an invalid request body was previously wrong in practice — the central error handler didn't recognize Zod validation errors and returned `500` instead. This is now fixed (`400 VALIDATION_ERROR` with a `details` array); every validation-failure case in this guide is accurate as written.

---

## 0. Prerequisites

```bash
cd backend
npm install
npm run db:seed      # creates the accounts and QR codes below
npm run dev           # starts the API on http://localhost:4000
```

```bash
cd frontend
npm install
npm start              # starts the UI on http://localhost:3000
```

Frontend needs no `REACT_APP_API_BASE_URL` for local dev — leave it unset. `frontend/src/setupProxy.js` makes the CRA dev server forward `/api/*` calls to the backend, which works both at plain `localhost:3000` and when the frontend is opened through a tunnel (ngrok, etc.) from another device — including a full-page navigation to a server-rendered `/api` endpoint (e.g. the Admin QR print sheet), which package.json's simpler `"proxy"` field cannot do (it excludes any request whose `Accept` header includes `text/html`). See `frontend/.env.example` for when to set `REACT_APP_API_BASE_URL` explicitly (separate deployed domains only).

Backend needs `backend/.env.local` (or `.env`) with at least `DIRECT_URL`, `SESSION_SECRET`, `CUSTOMER_HASH_SECRET` — copy from `backend/.env.example`. `DIRECT_URL` (Supabase's direct/session-mode connection, port 5432) is what the app actually uses at runtime — see `architecture.md`'s Database section for why the transaction-mode pooler (port 6543) is not safe here. A blank `CUSTOMER_HASH_SECRET` makes every lead submission fail with `503 CUSTOMER_IDENTITY_UNAVAILABLE`; a blank `SESSION_SECRET` doesn't currently break anything functionally (it isn't consumed by session hashing) but should still be set.

All commands below assume:

```bash
BASE=http://localhost:4000/api
```

---

## 1. Seeded test accounts

From `backend/prisma/seed.js` — re-run `npm run db:seed` any time to restore them (upsert, safe to repeat):

| Role | Identifier | Password |
|---|---|---|
| Admin | `admin@solarium.local` | `Admin@12345` |
| Sales | `sales@solarium.local` | `Sales@12345` |
| Vendor | `ram-store` (or mobile `9876543210`) | `Vendor@12345` |
| Vendor | `abc-store` (or mobile `9876543211`) | `Vendor@12345` |

Seeded QR codes: `V-0001` → Ram Store (ACTIVE), `V-0002` → ABC Store (ACTIVE), `V-0003` (UNASSIGNED).

Both seeded vendors are owned by the seeded Sales user (`sales_user_id` set), and both have `must_change_password = false`.

---

## 2. How to use these commands

**curl + cookie jar** — every protected request needs the session cookie from login. Use a separate cookie file per role so sessions don't clobber each other:

```bash
curl -c admin.cookies -b admin.cookies ...   # Admin session
curl -c sales.cookies -b sales.cookies ...   # Sales session
curl -c vendor.cookies -b vendor.cookies ... # Vendor session
```

`-c` writes cookies from the response, `-b` sends cookies on the request — pass both on every call so login persists and later calls stay authenticated.

**Postman** — cookie jar is on by default per Postman environment; just run Login first, then the rest of the requests in the same tab/environment will carry the cookie automatically. Set a collection variable `base_url = http://localhost:4000/api` and use `{{base_url}}/...` in each request.

**Supabase** — open the SQL Editor in your Supabase project and run the queries in §9 to confirm what the API calls actually wrote.

**Shared login rate limit** — `POST /auth/login` and `POST /vendor/login` share the *same* per-IP bucket (10 requests / 15 min). If you hammer Admin login in a loop you'll also throttle Vendor login tests from the same machine — space them out or wait 15 minutes between heavy test runs.

---

## 3. Public API

### 3.1 Vendor self-registration

```bash
curl -i -X POST $BASE/vendors/register \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Sunrise Solar",
    "owner_name": "Priya Singh",
    "mobile_number": "9812345678",
    "login_identifier": "sunrise-solar"
  }'
```
Expect: `201`, `{"success":true,"registration":{"id":"...","status":"PENDING"}}`.

Repeat the same request → expect `409 REGISTRATION_ALREADY_EXISTS` (`login_identifier` is unique at the database level; `mobile_number` uniqueness is an open policy question — see `data-model.md`).

Supabase check: new row in `vendor_registrations`, `status = 'PENDING'`, `vendor_id IS NULL`.

### 3.2 Resolve a public QR (creates a scan)

```bash
curl -i $BASE/public/qr/V-0001
```
Expect: `200`, `{"success":true,"referral":{"qr_code":"V-0001","vendor_name":"Ram Store","scan_id":"..."}}`. **Save `scan_id`** — the lead submission below needs it.

Other cases:
```bash
curl -i $BASE/public/qr/V-0003        # UNASSIGNED -> 404 QR_NOT_ACTIVE
curl -i $BASE/public/qr/NOT-A-CODE    # -> 404 QR_NOT_FOUND
```
To test `INACTIVE`/`RETIRED`, set a QR's `status` directly in Supabase (`update "QrCode" set status = 'INACTIVE' where code = 'V-0003'`) — there's no admin deactivate endpoint for QR in the current scope, so this is the only way to test it → expect `410 QR_INACTIVE`.

Supabase check: new row in `scans` with `qr_id`, `qr_assignment_id`, `vendor_id` set from the *current* active assignment.

### 3.3 Submit a lead

```bash
SCAN_ID="paste-scan_id-from-3.2"
curl -i -X POST $BASE/public/leads \
  -H "Content-Type: application/json" \
  -d "{
    \"scan_id\": \"$SCAN_ID\",
    \"customer_name\": \"Test Customer\",
    \"phone\": \"9000000001\",
    \"email\": \"customer@example.com\",
    \"location\": \"Pune\"
  }"
```
Expect: `201`, `{"success":true,"lead":{"id":"...","status":"NEW"},"message":"Enquiry submitted successfully."}`.

**Duplicate customer test** — scan a *different* QR (`V-0002`), grab its `scan_id`, then submit a lead with the **same phone number**:
```bash
curl -i $BASE/public/qr/V-0002   # note new scan_id
curl -i -X POST $BASE/public/leads -H "Content-Type: application/json" \
  -d '{"scan_id":"<new-scan_id>","customer_name":"Test Customer","phone":"9000000001"}'
```
Expect: `201`, `status: "DUPLICATE"`, `message: "This customer has already been referred."` — and it must still be linked to **ABC Store** (the vendor of the *second* scan), not Ram Store, since attribution is per-scan.

Invalid cases:
```bash
curl -i -X POST $BASE/public/leads -H "Content-Type: application/json" -d '{"scan_id":"bogus","customer_name":"X","phone":"9000000002"}'
# -> 400 SCAN_NOT_FOUND
curl -i -X POST $BASE/public/leads -H "Content-Type: application/json" -d '{"scan_id":"'$SCAN_ID'","customer_name":"X","phone":"123"}'
# -> 400 INVALID_MOBILE_NUMBER
```

Supabase check: `customer_identities` has one row per unique `hash` (never the raw phone); `leads.phone` stores the *normalized* 10-digit number, not the raw input.

**Frontend-specific case, not reachable via curl alone:** the public enquiry form's Email field is optional, but the React form always sends `email` as a key even when the user leaves it blank (an empty string, not an absent key) — `.email().optional()` in the backend schema only skips validation when the key is fully absent, so an empty string was previously rejected. This is why it's worth running §11's browser walkthrough in addition to curl: a curl call that simply omits the `email` key (as the examples above do) cannot catch this class of bug. Confirm in the browser: submit the enquiry form with Customer name + Mobile only, Email and Location left blank → must succeed, not show "Request validation failed."

---

## 4. Auth API (Admin / Sales staff login)

### 4.1 Login
```bash
curl -i -c admin.cookies -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username_or_mobile":"admin@solarium.local","password":"Admin@12345"}'
```
Expect: `200`, `{"success":true,"user":{"id":"...","name":"Development Admin","role":"ADMIN"}}`, and a `Set-Cookie: solarium_session=...` header.

Sales:
```bash
curl -i -c sales.cookies -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username_or_mobile":"sales@solarium.local","password":"Sales@12345"}'
```

Wrong password:
```bash
curl -i -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"username_or_mobile":"admin@solarium.local","password":"wrong"}'
# -> 401 INVALID_CREDENTIALS (generic message, does not reveal whether the account exists)
```

### 4.2 Logout
```bash
curl -i -b admin.cookies -c admin.cookies -X POST $BASE/auth/logout
```
Expect `200`. A subsequent authenticated call with the same cookie file should now `401`.

### 4.3 Staff change password
```bash
curl -i -b admin.cookies -c admin.cookies -X POST $BASE/auth/change-password \
  -H "Content-Type: application/json" \
  -d '{"current_password":"Admin@12345","new_password":"Admin@99999"}'
```
Expect `200`. **Change it back afterward** so the seeded credential in this guide keeps working, or update the table in §1.

### 4.4 Forgot / reset password (staff)
```bash
curl -i -X POST $BASE/auth/forgot-password -H "Content-Type: application/json" \
  -d '{"account_type":"staff","identifier":"admin@solarium.local"}'
```
Expect `200`, generic message; in non-production, response includes `reset_token`. Try a nonexistent identifier too — response shape must be **identical** (no account-enumeration signal).

```bash
RESET_TOKEN="paste-token-from-above"
curl -i -X POST $BASE/auth/reset-password -H "Content-Type: application/json" \
  -d "{\"reset_token\":\"$RESET_TOKEN\",\"new_password\":\"Admin@12345\"}"
```
Expect `200`. Reusing the same token a second time → `400 INVALID_RESET_TOKEN` (single-use).

### 4.5 Rate limiting
```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/auth/login \
    -H "Content-Type: application/json" -d '{"username_or_mobile":"admin@solarium.local","password":"wrong"}'
done
```
Expect the first 10 to return `401`, then `429` with a `Retry-After` header for the rest. Remember: this bucket is shared with `/vendor/login` from the same IP (§2).

```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/auth/forgot-password \
    -H "Content-Type: application/json" -d '{"account_type":"staff","identifier":"admin@solarium.local"}'
done
```
Expect the 6th request → `429` (limit is 5 / 15 min).

---

## 5. Vendor API

### 5.1 Login
```bash
curl -i -c vendor.cookies -X POST $BASE/vendor/login \
  -H "Content-Type: application/json" \
  -d '{"login_identifier":"ram-store","password":"Vendor@12345"}'
```
Expect `200`, `{"success":true,"vendor":{...,"mustChangePassword":false}}`. Login by mobile number also works: `"login_identifier":"9876543210"`.

### 5.2 Profile / leads / payouts (all scoped to the authenticated Vendor)
```bash
curl -i -b vendor.cookies $BASE/vendor/profile
curl -i -b vendor.cookies "$BASE/vendor/leads?page=1&limit=25"
curl -i -b vendor.cookies "$BASE/vendor/payouts?page=1&limit=25"
```
Check the `leads` response: it must **not** include a raw `phone` field (Vendor UI never sees the customer's phone number — confirm this against `backend/src/routes/vendor.js`'s `select`).

### 5.3 Vendor isolation (IDOR check)
There is no `vendorId` query param on these routes — the backend derives the Vendor from the session, so there's no parameter to tamper with. Confirm this by trying to add one anyway and see it's ignored:
```bash
curl -i -b vendor.cookies "$BASE/vendor/leads?vendorId=<abc-store-vendor-id>"
```
Expect: still only Ram Store's leads come back — the extra query param has no effect.

### 5.4 Vendor change password
```bash
curl -i -b vendor.cookies -c vendor.cookies -X POST $BASE/vendor/change-password \
  -H "Content-Type: application/json" \
  -d '{"current_password":"Vendor@12345","new_password":"Vendor@99999"}'
```
Expect `200`, `mustChangePassword: false`. Revert afterward.

### 5.5 Cross-role rejection
```bash
curl -i -b admin.cookies $BASE/vendor/profile     # -> 403 FORBIDDEN (Admin session, not Vendor)
curl -i $BASE/vendor/profile                       # -> 401 UNAUTHENTICATED (no session)
```

---

## 6. Sales API

### 6.1 List pending registrations owned by (or unassigned to) this Sales user
```bash
curl -i -b sales.cookies "$BASE/sales/registrations"
```
Should include the "Sunrise Solar" registration from §3.1 (unassigned → visible to any Sales user) but **not** registrations explicitly owned by a different Sales user.

### 6.2 Onboard a pending registration
```bash
curl -i -b sales.cookies -X POST $BASE/sales/vendors/<registration_id>/onboard \
  -H "Content-Type: application/json" \
  -d '{"password":"Temp@12345"}'
```
Expect `201`, `{"success":true,"vendor":{"id":"<new-vendor-id>",...,"mustChangePassword":true}}`. **Save the returned Vendor `id`** — QR assignment needs it, not the registration id.

Re-onboarding the same registration → `404 REGISTRATION_NOT_FOUND` (status is no longer `PENDING`).

### 6.3 Check a QR before assigning
```bash
curl -i -b sales.cookies $BASE/sales/qr/V-0003
```
Expect `{"success":true,"qr":{"id":"...","code":"V-0003","status":"UNASSIGNED"}}`.

### 6.4 Assign the QR to the new Vendor
```bash
curl -i -b sales.cookies -X POST $BASE/sales/qr/assign \
  -H "Content-Type: application/json" \
  -d '{"code":"V-0003","vendor_id":"<new-vendor-id-from-6.2>"}'
```
Expect `201`. Repeat with the same QR code → `409 QR_NOT_UNASSIGNED` (now `ACTIVE`).

### 6.5 Sales ownership boundary
```bash
curl -i -b sales.cookies -X POST $BASE/sales/qr/assign \
  -H "Content-Type: application/json" \
  -d '{"code":"V-0002","vendor_id":"<some-vendor-not-owned-by-this-sales-user>"}'
```
Expect `403 VENDOR_NOT_ASSIGNED` if the target Vendor's `sales_user_id` isn't this Sales user.

### 6.6 Sales cannot reach Admin-only actions
```bash
curl -i -b sales.cookies $BASE/admin/vendors                       # -> 403
curl -i -b sales.cookies $BASE/admin/payouts                       # -> 403
curl -i -b sales.cookies -X POST $BASE/admin/qr/<id>/reassign \
  -H "Content-Type: application/json" -d '{"vendor_id":"x"}'       # -> 403
curl -i -b sales.cookies $BASE/admin/audit-logs                    # -> 403
```

---

## 7. Admin API

All calls below use `-b admin.cookies -c admin.cookies`. Grab real ids from `GET /admin/vendors` / `GET /admin/qr` / `GET /admin/leads` / `GET /admin/payouts` / `GET /admin/users` as you go.

### 7.1 Vendors
```bash
curl -i -b admin.cookies "$BASE/admin/vendors?page=1&limit=50"

curl -i -b admin.cookies -X POST $BASE/admin/vendors -H "Content-Type: application/json" -d '{
  "business_name": "Direct Admin Vendor",
  "owner_name": "Test Owner",
  "login_identifier": "direct-admin-vendor",
  "mobile_number": "9812300000",
  "password": "Vendor@12345"
}'
# -> 201. Repeat -> 409 VENDOR_ALREADY_EXISTS

VENDOR_ID="<id-from-above>"
curl -i -b admin.cookies -X PATCH $BASE/admin/vendors/$VENDOR_ID -H "Content-Type: application/json" \
  -d '{"business_name":"Direct Admin Vendor (Updated)"}'
# -> 200, only business_name changes

curl -i -b admin.cookies -X POST $BASE/admin/vendors/$VENDOR_ID/reset-password
# -> 200, includes reset_token in non-production

curl -i -b admin.cookies -X POST $BASE/admin/vendors/$VENDOR_ID/deactivate
# -> 200, status -> INACTIVE

curl -i -b admin.cookies -X POST $BASE/admin/vendors/$VENDOR_ID/delete
# -> 409 VENDOR_HAS_HISTORY if this vendor has any lead/scan/payout/QR-assignment row (the one above from §7.1 does, from earlier tests)
# create a brand-new vendor with no history and delete THAT one instead to see the 200 path:
# -> 200, status -> DELETED, and it disappears from GET /admin/vendors (page total drops by 1)
```
Supabase check: each call above adds one row to `audit_logs` with `action` = `VENDOR_CREATED` / `VENDOR_UPDATED` / `VENDOR_DEACTIVATED` / `VENDOR_PASSWORD_RESET` / `VENDOR_DELETED` respectively.

### 7.2 QR inventory
```bash
curl -i -b admin.cookies -X POST $BASE/admin/qr/generate -H "Content-Type: application/json" -d '{"quantity": 5}'
# -> 201, {"success":true,"count":5,"codes":[...]}

curl -i -b admin.cookies "$BASE/admin/qr?page=1&limit=50"

curl -i -b admin.cookies "$BASE/admin/qr?status=UNASSIGNED&limit=50"   # every row's status is UNASSIGNED
curl -i -b admin.cookies "$BASE/admin/qr?status=ACTIVE&limit=50"       # every row's status is ACTIVE
curl -i -b admin.cookies "$BASE/admin/qr?status=NOT_A_STATUS"          # -> 400

curl -i -b admin.cookies "$BASE/admin/vendors/lookup"
# -> 200, {"success":true,"vendors":[...]} — a Vendor that already holds an active QR must NOT appear here;
# assign/reassign a QR to a Vendor, re-run this, confirm that Vendor drops out of the list
curl -i -b sales.cookies "$BASE/sales/vendors"
# same exclusion rule, additionally scoped to this Sales user's own vendors only

QR_ID="<id-of-V-0001-from-above-or-vendors-list>"
curl -i -b admin.cookies -X POST $BASE/admin/qr/$QR_ID/reassign -H "Content-Type: application/json" \
  -d '{"vendor_id":"<abc-store-vendor-id>"}'
# -> 200 if V-0001 is currently ACTIVE and not already on that vendor

# repeat immediately with the same vendor_id -> 409 QR_ALREADY_ASSIGNED
# try reassigning V-0003 (still UNASSIGNED unless you ran §6.4) -> 409 QR_NOT_ACTIVE
```
**This is the key historical-attribution test** — after reassigning V-0001 away from Ram Store:
```bash
curl -i $BASE/public/qr/V-0001            # now resolves to the NEW vendor
curl -i -b admin.cookies "$BASE/admin/leads?page=1&limit=50"   # old leads still show the ORIGINAL vendor_id
```
Supabase check: `qr_assignments` now has two rows for that `qr_code_id` — the old one with `unassigned_at` set, the new one with `unassigned_at IS NULL`. The `leads` rows created before reassignment must be unchanged (`vendor_id`, `qr_assignment_id` still point at the old assignment).

Also confirm the reassign response's `vendor` object contains no `passwordHash` field — check every field name in the returned `vendor` object against `publicVendor()`'s allowlist in `backend/src/services/auth.js`.

### 7.3 QR image and print export
```bash
curl -i -b admin.cookies "$BASE/admin/qr/$QR_ID/image" -o V-0001.svg
# -> 200, Content-Type: image/svg+xml, valid <svg> markup

curl -i -b admin.cookies "$BASE/admin/qr/$QR_ID/image?format=png" -o V-0001.png
# -> 200, Content-Type: image/png — open the file to confirm it's a real, scannable image

curl -i -b admin.cookies "$BASE/admin/qr/nonexistent-id/image"
# -> 404 QR_NOT_FOUND
```
Scan the downloaded image (any phone camera or QR reader) and confirm it resolves to `${APP_BASE_URL}/v/V-0001` and nothing else — no vendor id, no internal database id anywhere in the decoded text.

```bash
curl -i -b admin.cookies "$BASE/admin/qr/print" -o print-all.html
curl -i -b admin.cookies "$BASE/admin/qr/print?status=ACTIVE" -o print-active.html
curl -i -b admin.cookies "$BASE/admin/qr/print?status=UNASSIGNED" -o print-unassigned.html
curl -i -b admin.cookies "$BASE/admin/qr/print?vendor_id=<some-vendor-id>" -o print-vendor.html
curl -i -b admin.cookies "$BASE/admin/qr/print?limit=99999" -o print-clamped.html
```
Open each in a browser: confirm the header line matches the filter you requested and the shown/total counts, every card's status matches the requested filter, `print-clamped.html`'s header shows `100 per page` (server-side clamp, not the requested `99999`), and a `vendor_id` with no matching QR shows the "No QR codes match this filter." empty state rather than an error. Try the browser's print preview (Ctrl/Cmd+P) — cards should not split across a page break.
```bash
curl -i -b admin.cookies "$BASE/admin/qr/print?status=NOT_A_STATUS"
# -> 400 VALIDATION_ERROR
curl -i "$BASE/admin/qr/print"                    # no session -> 401
curl -i -b sales.cookies "$BASE/admin/qr/print"    # Sales session -> 403
```

### 7.4 Leads
```bash
curl -i -b admin.cookies "$BASE/admin/leads?page=1&limit=50"

LEAD_ID="<id-from-above>"
curl -i -b admin.cookies -X PATCH $BASE/admin/leads/$LEAD_ID -H "Content-Type: application/json" \
  -d '{"status":"CONTACTED"}'
# try each of: NEW, CONTACTED, QUALIFIED, CONVERTED, REJECTED, DUPLICATE

curl -i -b admin.cookies -X PATCH $BASE/admin/leads/$LEAD_ID -H "Content-Type: application/json" \
  -d '{"status":"NOT_A_STATUS"}'
# -> 400 (zod validation)
```
Supabase check: `vendor_id`, `qr_id`, `qr_assignment_id`, `scan_id` on the lead row must be **unchanged** after a status update. `audit_logs` gets a `LEAD_STATUS_CHANGED` row with `{"status":"..."}` in `metadata`.

### 7.5 Payouts

There is no endpoint to *create* a payout in the current scope — check Supabase for existing seeded/created payout rows, or create one directly via SQL if none exist:
```sql
insert into "Payout" (id, "leadId", "vendorId", status)
values (gen_random_uuid(), '<lead_id>', '<vendor_id>', 'UNPAID');
```
```bash
curl -i -b admin.cookies "$BASE/admin/payouts?page=1&limit=50"

PAYOUT_ID="<id>"
curl -i -b admin.cookies -X POST $BASE/admin/payouts/$PAYOUT_ID/status \
  -H "Content-Type: application/json" -d '{"status":"PARTIAL","paid_reference":"UTR-PARTIAL-001"}'
# -> 200, status -> PARTIAL, paid_at stays null (not the final state yet)

curl -i -b admin.cookies -X POST $BASE/admin/payouts/$PAYOUT_ID/status \
  -H "Content-Type: application/json" -d '{"status":"PAID","paid_reference":"UTR123456789"}'
# -> 200, status -> PAID, paid_at set, paid_by = the logged-in Admin's user id

# repeat with either status -> 409 PAYOUT_ALREADY_PAID
curl -i -b admin.cookies -X POST $BASE/admin/payouts/$PAYOUT_ID/status -H "Content-Type: application/json" -d '{}'
# -> 400 (status and paid_reference required)
```
Sales must never see this data at all:
```bash
curl -i -b sales.cookies $BASE/admin/payouts   # -> 403
```

### 7.6 Staff users
```bash
curl -i -b admin.cookies "$BASE/admin/users"

curl -i -b admin.cookies -X POST $BASE/admin/users -H "Content-Type: application/json" -d '{
  "name": "Second Sales",
  "username_or_mobile": "sales2@solarium.local",
  "password": "Sales2@12345",
  "role": "SALES"
}'
# -> 201, response has no passwordHash field

USER_ID="<id-from-above>"
curl -i -b admin.cookies -X PATCH $BASE/admin/users/$USER_ID -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}'
curl -i -b admin.cookies -X POST $BASE/admin/users/$USER_ID/deactivate
```

**Last-Admin protection test** — this is a documented invariant, worth deliberately trying to break:
```bash
ADMIN_USER_ID="<the-seeded-admin's-id-if-it-is-currently-the-only-ACTIVE-ADMIN>"
curl -i -b admin.cookies -X POST $BASE/admin/users/$ADMIN_USER_ID/deactivate
# -> 409 LAST_ADMIN_PROTECTED (only if no other ACTIVE ADMIN exists)
curl -i -b admin.cookies -X PATCH $BASE/admin/users/$ADMIN_USER_ID -H "Content-Type: application/json" -d '{"role":"SALES"}'
# -> same 409 if it would leave zero active Admins
```
To actually observe the `409`, first make sure there is only **one** `ACTIVE` `ADMIN` row in Supabase; if you created a second Admin earlier in this section, deactivate it first.

**Self-lockout protection test** — separate from and checked *before* the last-Admin rule above, an Admin can never deactivate or demote **their own** account, even when other Admins exist:
```bash
# using the same admin.cookies session that is currently logged in as ADMIN_USER_ID
curl -i -b admin.cookies -X POST $BASE/admin/users/$ADMIN_USER_ID/deactivate
# -> 409 CANNOT_MODIFY_OWN_ACCOUNT
curl -i -b admin.cookies -X PATCH $BASE/admin/users/$ADMIN_USER_ID -H "Content-Type: application/json" -d '{"role":"SALES"}'
# -> 409 CANNOT_MODIFY_OWN_ACCOUNT
```
To confirm this is genuinely self-only (not just the last-Admin check firing), create a second Admin first (§7.6 create), log in as that *second* Admin, and deactivate the *first* Admin — that should succeed with `200`.

**Deactivation revokes the existing session immediately** — this is a critical, easy-to-miss check: deactivation must not just block *new* logins, it must also invalidate a session created *before* the deactivation.
```bash
# while the deactivated Admin's OLD session cookie (from before deactivation) is still unexpired:
curl -i -b <deactivated-account-old-cookies> "$BASE/admin/vendors?limit=1"
# -> 401 UNAUTHENTICATED (not 200 — a live session must not survive its account being deactivated)
```
Run the same check for a deactivated Vendor against `GET /vendor/profile` with their pre-deactivation session cookie.

### 7.7 Read-only resources
```bash
curl -i -b admin.cookies "$BASE/admin/scans?page=1&limit=50"
curl -i -b admin.cookies "$BASE/admin/audit-logs?page=1&limit=50"
```
No mutation endpoints exist for these — confirm only `GET` is accepted (any `POST`/`PATCH` you invent here should `404`/`501`, never succeed).

### 7.8 Cross-role rejection (repeat for every Admin endpoint you test above)
```bash
curl -i $BASE/admin/vendors                          # no session -> 401
curl -i -b sales.cookies $BASE/admin/vendors          # Sales session -> 403
curl -i -b vendor.cookies $BASE/admin/vendors         # Vendor session -> 403
```

---

## 8. Pagination & bounded-collection checks

Every Admin list endpoint accepts `?page=&limit=` (default `limit=50`, capped at `100`) — confirm the cap is enforced server-side, not just respected when honest:
```bash
curl -i -b admin.cookies "$BASE/admin/vendors?limit=99999"
```
Expect the response's `pagination.limit` to be clamped to `100`, and the returned array to actually contain ≤100 rows regardless of what was requested.

---

## 9. Supabase SQL checks

Run these in the Supabase SQL Editor to cross-check what the API calls above actually persisted (table/column names follow Prisma's default camelCase-in-quotes convention — adjust quoting per your SQL client):

```sql
-- Vendor never stores a plaintext password
select id, "businessName", "loginIdentifier", "passwordHash", "mustChangePassword", status
from "Vendor" order by "createdAt" desc limit 10;

-- QR assignment history is append-only — never overwritten
select "qrCodeId", "vendorId", "assignedAt", "unassignedAt"
from "QrAssignment" order by "assignedAt" desc limit 20;

-- Only one active (unassignedAt IS NULL) assignment per QR
select "qrCodeId", count(*) from "QrAssignment"
where "unassignedAt" is null group by "qrCodeId" having count(*) > 1;
-- must return zero rows

-- Leads retain original attribution after reassignment
select id, "vendorId", "qrId", "qrAssignmentId", "scanId", status, "createdAt"
from "Lead" order by "createdAt" desc limit 20;

-- Customer identity never stores a raw phone number
select hash, "createdAt" from "CustomerIdentity" order by "createdAt" desc limit 10;

-- Payout server-controlled fields
select id, "vendorId", status, "paidAt", "paidById", "paidReference" from "Payout";

-- Audit trail for every mutation tested above
select "actorRole", action, entity, "entityId", metadata, timestamp
from "AuditLog" order by timestamp desc limit 30;

-- Exactly one ACTIVE ADMIN remains protected
select id, name, role, status from "User" where role = 'ADMIN';
```

---

## 10. End-to-end acceptance scenarios

These mirror `requirements.md` §40 and `RFI.md` §12 — run them as full sequences, not isolated calls.

**Scenario A — Unassigned QR cannot generate a lead**
1. `GET /public/qr/V-0003` (or any freshly generated, unassigned code) → `404 QR_NOT_ACTIVE`.
2. Confirm no `Scan` row was created for it in Supabase.

**Scenario B — Assign → scan → lead → reassign → old lead unchanged**
1. Sales onboards a Vendor (§6.2) and assigns a fresh QR to it (§6.4).
2. Public scan + lead submit against that QR (§3.2–3.3) → note the lead's `vendor_id`.
3. Admin reassigns the same QR to a different Vendor (§7.2).
4. Public scan the same QR again → new scan's vendor is the *new* Vendor.
5. Re-fetch the original lead from step 2 via `GET /admin/leads` → `vendor_id` is still the *original* Vendor.

**Scenario C — Duplicate customer across vendors**
1. Scan Vendor A's QR, submit a lead with phone `9000000099` → `status: NEW`.
2. Scan Vendor B's QR, submit a lead with the same phone → `status: DUPLICATE`, and the `vendor_id` on this second lead is Vendor B's (attribution is per-scan, duplicate status is per-customer).

**Scenario D — Vendor isolation under parameter tampering**
1. Log in as Ram Store. Attempt `GET /vendor/leads?vendorId=<abc-store-id>` → response still contains only Ram Store's leads (§5.3).

**Scenario E — Role boundary enforcement**
1. Run every "cross-role rejection" block in §5–§7 in one pass; confirm every response is `401`/`403`, never `200` or leaked data.

**Scenario F — Admin lifecycle on a Vendor**
1. Admin creates a Vendor (§7.1), edits it, resets its password, then deactivates it.
2. Confirm in Supabase that the Vendor row still exists (`status = 'INACTIVE'`, not deleted) and any `Lead`/`Scan`/`Payout` rows tied to it are untouched.

**Scenario G — Payout lifecycle**
1. Mark a payout `PARTIAL`, then `PAID` (§7.5), each with a reference.
2. Confirm `paid_at` stays null through the `PARTIAL` step and is only set on `PAID`, `paid_by`/`paid_reference` are set, a second status update after `PAID` `409`s, and Sales cannot read it.

---

## 11. Frontend manual walkthrough

`npm start` in `frontend/`, then in the browser at `http://localhost:3000`:

1. **Public** — enter `V-0001` in "Referral QR", submit → should show "Referred by Ram Store" and the enquiry form; submit the form → success message. Try `V-0003` → error message, no enquiry form appears.
2. **Vendor** — sign in as `ram-store` / `Vendor@12345` → profile, referral list, and payout list render; no customer phone number is visible anywhere on the page (View Source / inspect network response to confirm the field itself is absent, not just hidden by CSS).
3. **Sales** — sign in as `sales@solarium.local` / `Sales@12345` → pending registrations list shows "Sunrise Solar" from §3.1; onboard it with a temporary password; check a QR code; assign it — confirm the success message and that re-checking the same QR now shows `ACTIVE`.
4. **Admin** — sign in as `admin@solarium.local` / `Admin@12345`:
   - Vendors: create one, click **Edit** and change a field, **Reset password** (message should show the dev `reset_token`), **Deactivate** (button becomes disabled after).
   - QR inventory: generate a batch, confirm new `UNASSIGNED` rows appear; reassign an `ACTIVE` one (input the target Vendor's id) and confirm the confirmation dialog appears before it submits. In the Print/export panel, pick a status filter and click "Open printable sheet" — confirm the new tab/window shows only matching QR codes with real scannable images; click a row's "SVG" or "PNG" link and confirm it opens/downloads a real image.
   - Leads: change a status via the dropdown + Update.
   - Payouts: mark an `UNPAID` one paid with a reference; confirm it disappears from the "Mark paid" action set afterward.
   - Staff users: create one, change its role, deactivate it.
   - Scans / Audit logs: confirm these are read-only (raw JSON view, no action buttons).
5. For every mutation above, check the browser's Network tab: the request should be the exact endpoint/method documented in `api.md`, and the response should trigger an automatic list refresh (you should see two requests: the mutation, then a fresh `GET` for the same resource).

---

## 12. Coverage checklist

Use this to track a full pass. Check off against `plan.md` §24 (Definition of Done) once every row here is confirmed working against your own Supabase project.

- [ ] §3 Public: registration, QR resolve (valid/unassigned/inactive/not-found), lead submit, duplicate detection
- [ ] §4 Auth: staff login/logout/change-password, forgot/reset-password, rate limiting (login + reset)
- [ ] §5 Vendor: login (identifier + mobile), profile/leads/payouts scoping, isolation under tampering, change-password
- [ ] §6 Sales: registrations visibility, onboarding, QR check, QR assign, ownership boundary, Admin-route rejection
- [ ] §7 Admin: Vendor CRUD + reset-password + guarded delete, QR generate/reassign/assign + status filter + one-active-QR-per-vendor picker rule + historical attribution, QR image download + print export (filters, pagination clamp, scanned-image content check), Lead status change + details view, Payout status (paid/partial), Staff user CRUD + last-Admin protection + self-lockout protection, read-only scans/audit-logs
- [ ] §8 Pagination cap enforced server-side
- [ ] §9 Supabase checks all pass (no plaintext passwords/phones, append-only assignments, single active assignment per QR, audit trail present)
- [ ] §10 All seven acceptance scenarios pass end-to-end
- [ ] §11 Frontend walkthrough for all four portals with no console errors
