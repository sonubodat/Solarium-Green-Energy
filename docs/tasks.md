# Development Tasks

## Phase 1: Contract and structure

- Keep `plan.md` as the source implementation contract.
- Keep `progress.md` updated during development.
- Keep `tasks.md` updated with the current execution slice.
- Preserve the current React app shell until backend structure is defined.

## Phase 2: Auth decisions to lock

- Define admin password recovery or change-password flow.
- Define vendor password reset flow in the dashboard.
- Keep sales and vendor access fully separated.

## Phase 3: Data model decisions to lock later

- Define staff user schema.
- Define vendor credential schema.
- Define QR, assignment, scan, lead, and commission relationships.

## Phase 4: Implementation readiness

- Create backend scaffolding only after the plan is finalized.
- Add Prisma schema only after the auth and role model are locked.
- Add API routes only after the model is fixed.

## Current execution slice

- Apply the existing Prisma migrations from `backend/prisma/schema.prisma`.
- Verify typed registration statuses and the one-active-assignment-per-QR database constraint.
- Verify `POST /api/vendors/register` with a valid registration and duplicate identifiers.
- Verify `GET /api/vendor/profile` derives the Vendor from the authenticated session.
- Continue with Sales registration visibility and onboarding after database verification.
- Verify Sales can see only unassigned or owned registrations.
- Verify onboarding creates one Vendor, marks the registration `ONBOARDED`, and rejects a second conversion.
- Continue with QR inventory and assignment after onboarding verification.
- Run `npx prisma migrate deploy` to apply the two pending follow-up migrations now that Supabase connectivity is working.
- Confirm `npx prisma migrate status` reports the database schema is up to date.
- Verify Admin QR pagination and batch generation.
- Verify Sales can assign only an unassigned QR to an owned Vendor.
- Verify Admin reassignment closes the previous assignment, creates a new one, and preserves history.
- Continue with the public QR referral flow after QR verification.
- Verify valid, unassigned, inactive, and retired public QR responses.
- Verify a valid public scan stores the current QR assignment and Vendor attribution.
- Continue with public lead capture after QR verification.
- Verify the first lead is `NEW` and a repeat customer is recorded as `DUPLICATE` without a second payable attribution.
- Verify lead attribution retains the scan's Vendor and QR assignment after QR reassignment.
- Continue with Vendor lead views after lead verification.
- Verify Vendor lead and payout queries cannot access another Vendor even when request parameters are modified.
- Verify Vendor responses do not expose protected customer phone numbers.
- Continue with Admin operational views after Vendor isolation verification.
- Verify Admin list endpoints return bounded results and remain inaccessible to Sales and Vendor sessions.
- Verify Admin lead, payout, scan, and audit responses use the intended protected fields.
- Continue with Admin write operations after operational-view verification.
- Verify Admin can create, update, and deactivate Vendors without deleting historical records.
- Verify only Admin can change lead status or mark a payout `PAID`.
- Verify `paid_at`, `paid_by`, and `paid_reference` are recorded from the server-controlled operation.
- Continue with staff-user management after Admin write verification.
- Verify only Admin can create, update, or deactivate staff users.
- Verify password hashes are never returned and the last active Admin cannot be removed.
- Continue with security hardening after staff-user verification.
- Run `npm run db:seed`, log in through Postman, and retain the session cookie for protected endpoint checks.
- Use `curl.exe` rather than PowerShell's `curl` alias when testing curl commands.
- Verify CORS from `http://localhost:3000`, the deployed frontend origin, and any temporary ngrok origin; verify Postman requests are governed by authentication rather than CORS.
- Add and verify per-IP throttling for staff login, Vendor login, and password-reset endpoints.
- Verify rate-limited requests return `429` with `Retry-After` and do not reveal account existence.
- Run authorization regression checks for Admin, Sales, Vendor, and unauthenticated requests before connecting the live role-based UI.
- Connect the Public QR resolution and lead form to the live API client.
- Connect Vendor login/profile/leads/payouts to the live API client.
- Connect initial Admin and Sales login/list workflows to the live API client.
- Verify frontend loading, validation, success, empty, and API error states against the running backend.
- Verify Sales onboarding returns a Vendor identifier and QR assignment uses that identifier only.
- Verify Sales cannot assign an active, inactive, or retired QR and cannot onboard another Sales user's registration.
- Connect Admin operational resource views to vendors, QR inventory, leads, scans, payouts, staff users, and audit logs.
- Verify Admin operational views remain bounded and inaccessible to Sales, Vendor, and unauthenticated sessions.
- Expand Admin mutation controls and Vendor live screens after operational authorization verification.
- Verify Vendor first-login password change, Vendor isolation, protected customer fields, and empty states.
- Add Admin mutation controls only after the operational authorization checks pass.
- Admin Vendor mutation slice added: create Vendor, reset-password, deactivate, each with confirmation and an automatic list reload.
- Verify via Postman/curl/Supabase: `POST /api/admin/vendors` (create, then duplicate-identifier `409`), `POST /api/admin/vendors/:id/reset-password` (dev `reset_token` present, invalidates prior reset state), `POST /api/admin/vendors/:id/deactivate` (status becomes `INACTIVE`, historical records untouched), and that each action writes an `AuditLog` row.
- Verify Sales and Vendor sessions receive `401/403` on all three endpoints.
- Admin QR mutation slice added: generate a QR batch, reassign an `ACTIVE` QR to a Vendor by ID, each with confirmation and an automatic list reload.
- Verify via Postman/curl/Supabase: `POST /api/admin/qr/generate` (creates the requested count of `UNASSIGNED` codes, writes `QR_GENERATED` audit), `POST /api/admin/qr/:qrId/reassign` on an `ACTIVE` QR (closes the old `QrAssignment`, opens a new one, writes `QR_REASSIGNED` audit, old leads/scans keep the original `vendor_id`), and that reassigning an `UNASSIGNED` or already-owned Vendor returns `409`.
- Verify Sales and Vendor sessions receive `401/403` on both QR endpoints.
- Admin Leads mutation slice added: change a lead's status from the documented enum via a per-row selector, confirmed before submission and followed by an automatic list reload.
- Verify via Postman/curl/Supabase: `PATCH /api/admin/leads/:leadId` with each of `NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `REJECTED`, `DUPLICATE` succeeds and writes a `LEAD_STATUS_CHANGED` audit row with the new status in `metadata`; confirm `vendor_id`, `qr_id`, `qr_assignment_id`, and `scan_id` on the lead are unchanged after the update; confirm an invalid status value returns `400`.
- Verify Sales and Vendor sessions receive `401/403` on the lead status endpoint.
- Admin Payouts mutation slice added: mark an `UNPAID` payout as `PAID` with a required manual payment reference, confirmed before submission and followed by an automatic list reload; only offered in the UI for `UNPAID` records.
- Verify via Postman/curl/Supabase: `POST /api/admin/payouts/:payoutId/mark-paid` with `paid_reference` sets `status = PAID`, `paid_at` to the current time, and `paid_by` to the authenticated Admin's user id; writes a `PAYOUT_MARKED_PAID` audit row with `paid_reference` in `metadata`; repeating the call on an already-`PAID` payout returns `409`; an empty/missing `paid_reference` returns `400`.
- Verify Sales and Vendor sessions receive `401/403` on the payout mark-paid endpoint, and that Sales cannot read `/api/admin/payouts` or `/api/sales/*` payout data at all.
- Admin Staff users mutation slice added: create a staff user, update a staff user's role via a per-row selector, and deactivate a staff user, each confirmed before submission and followed by an automatic list reload.
- Verify via Postman/curl/Supabase: `POST /api/admin/users` creates `ADMIN`/`SALES` accounts and returns no `passwordHash`; duplicate `username_or_mobile` returns `409`; `PATCH /api/admin/users/:userId` changes `role`; `POST /api/admin/users/:userId/deactivate` sets `status = INACTIVE`; both the role-change-away-from-`ADMIN` and the deactivate path return `409 LAST_ADMIN_PROTECTED` when applied to the last active Admin.
- Verify Sales and Vendor sessions receive `401/403` on all three staff-user endpoints.
- Admin Vendor mutation slice gained the general "edit vendor" action: an inline form on each vendor row now `PATCH`es business_name/owner_name/login_identifier/mobile_number, confirmed before saving.
- Verify via Postman/curl/Supabase: `PATCH /api/admin/vendors/:vendorId` with a partial body updates only the supplied fields, writes a `VENDOR_UPDATED` audit row with `changedFields` in `metadata`, and rejects a mobile number that fails the 10-digit normalization check with `400`.
- All five documented Admin mutation slices (vendors, QR, leads, payouts, staff users) are now wired in the frontend. Scans and audit logs remain intentionally read-only — no documented mutation action exists for them.
- Phase 17 spot checks done locally (no live Postman session needed): `npm run build` (frontend) compiles cleanly; `.env*` files are git-ignored and untracked everywhere; no hardcoded secrets in `backend/src`; `npx prisma generate` succeeds; `npx prisma migrate status` against the configured Supabase database reports up to date (3/3 migrations applied); CORS/cookie code matches `plan.md`'s security requirements.
- Backend hardening pass completed ahead of the verification round: reset-password now audits (`VENDOR_PASSWORD_RESET`); rate-limit cache self-evicts stale entries every 5 minutes; password reset TTL is configurable via `PASSWORD_RESET_TTL_MINUTES`; Admin self-deactivation/self-demotion is blocked with `409 CANNOT_MODIFY_OWN_ACCOUNT` on both the deactivate route and the general PATCH route, checked before and independent of the existing last-active-Admin protection.
- Add to the `docs/testing.md` §7.5 staff-user pass: `POST /api/admin/users/<own-id>/deactivate` and `PATCH /api/admin/users/<own-id>` with `{"role":"SALES"}` or `{"status":"INACTIVE"}` must both return `409 CANNOT_MODIFY_OWN_ACCOUNT` even when other Admins exist (log in as a *second* Admin and confirm you *can* deactivate the *first* one — the block is self-only, not last-Admin-only).
- Remaining: complete the Postman/curl/Supabase Admin mutation verification pass in `docs/testing.md` (needs a logged-in session, so it is done by you), then the client-supplied production values from `RFI.md` §9 (final `CORS_ORIGINS`/`FRONTEND_ORIGIN`, deployed hosting) before a live cross-origin cookie check can run.

## QR printing and export — sequenced, not yet implemented

Newly confirmed scope, recorded in `plan.md` §7 ("QR printing and export") and route `/admin/qr/print` in §19. Build this **one step at a time in future sessions**, verifying each step before starting the next — do not implement all steps in one pass.

1. **Dependency + image service — done.** Added the `qrcode` npm package (`^1.5.4`, pure JS, no native build) to `backend/package.json`/`package-lock.json`. Added `backend/src/services/qr-image.js`: `publicReferralUrl(code)`, `generateQrSvg(code)`, `generateQrPng(code)`, all encoding only `${APP_BASE_URL}/v/:code` (URL-encoded) — no vendor id, no internal database id, no route yet. Verified with a throwaway script: SVG output is valid `<svg>` markup, PNG output has the correct PNG magic bytes, and a QR code containing special characters (`V 0001?x=<script>`) is safely percent-encoded rather than injected raw into the URL. `npm audit` reports 3 pre-existing high-severity advisories from a transitive Prisma/`deepmerge-ts` dependency, unrelated to this change — do **not** run `npm audit fix --force` (it previously downgraded Prisma; see the `progress.md` incident note).
2. **Single QR image download — done.** Added `GET /api/admin/qr/:qrId/image?format=svg|png` (Admin-only, defaults to SVG, no audit needed — read-only export) in `backend/src/routes/admin.js`, with a `safeFilenameSegment()` guard so the `Content-Disposition` filename never trusts raw QR-code text directly. Verified live end-to-end against the dev Supabase database: logged in as the seeded Admin, resolved `V-0001`'s id via `GET /admin/qr`, downloaded both formats — `Content-Type: image/svg+xml` with valid `<svg>` markup, and `Content-Type: image/png` confirmed by `file` as a real 512×512 PNG. Also confirmed `404 QR_NOT_FOUND` for a bogus id, `401` with no session, and `403` for a Sales session.
3. **Batch export endpoint — done.** Added `GET /api/admin/qr/print?status=&vendor_id=&page=&limit=` (Admin-only) in `backend/src/routes/admin.js`. Filters by QR `status` (`UNASSIGNED`/`ACTIVE`/`INACTIVE`/`RETIRED`, zod-validated, omitted = all) and optionally by the vendor currently holding the active assignment (`assignments: { some: { vendorId, unassignedAt: null } }`). Bounded using the *same* `pagination()` helper as every other Admin list endpoint (default 50, capped at 100) rather than inventing a separate limit — corrected from the "e.g. 200" placeholder originally written here, for consistency with the rest of the Admin API. Returns a self-contained print-friendly HTML page (inline SVGs, no external requests, `break-inside: avoid` cards) — no PDF dependency, uses the browser's own print-to-PDF. Verified live against the dev Supabase database for: no filter (all 3 seeded QR codes), `status=ACTIVE` (2 results, correct rows only), `status=UNASSIGNED` (1 result, "Unassigned" vendor label), a non-matching `vendor_id` (empty state, not an error), `limit=99999` clamped to 100, and `401`/`403` for unauthenticated/Sales sessions.
   - **Related fix discovered and applied while verifying step 3's own `status` validation:** every Zod-validated route across the *entire* backend (not just this one) was returning `500 INTERNAL_ERROR` instead of the documented `400` on invalid input, because `errorHandler` in `backend/src/middleware/errors.js` never special-cased `ZodError`. Fixed centrally: `ZodError` now maps to `400 VALIDATION_ERROR` with a `details` array of `{path, message}`. Verified live: `POST /admin/vendors` with an empty body now returns `400` with per-field details (previously `500`); `GET /admin/qr/print?status=NOT_REAL` now returns `400` (previously would have been `500`). This retroactively makes every "-> 400" validation assertion already written in `docs/testing.md` actually true for the first time — none of those were being hit by real code before this fix.
4. **Frontend integration — done.** Added to `frontend/src/App.js`: a "Print / export" panel on the Admin QR resource view with a status-filter `<select>`, an optional Vendor ID `<input>`, and an "Open printable sheet" button (`openQrPrintSheet()`) that builds `${API_BASE_URL}/admin/qr/print?...` from the selected filters and opens it via `window.open`. Every QR row got "SVG"/"PNG" download links pointing at the step-2 image endpoint (unconditional — not limited to `ACTIVE` rows, since re-printing an unassigned or retired physical code is still a valid need). Exported `API_BASE_URL` from `frontend/src/api/client.js` so both files share one source of truth for the backend origin. Added `.print-controls` CSS as its own flex layout rather than reusing `.inline-form` — the existing `.inline-form .primary-action { grid-column: 2; grid-row: 2 }` rule was written for the two-element (input + button) pattern used elsewhere and would have overlapped the button on top of the Vendor ID input with a third element in the row; caught this before it shipped, not after.
   - **Verified live in a real browser** (not just linted): started the already-running frontend dev server's browser session, logged in as the seeded Admin, switched to the QR resource — confirmed the Print/export panel and per-row SVG/PNG links render for `UNASSIGNED` and `ACTIVE` rows alike, `href`s resolve to the correct real QR ids. Clicked "Open printable sheet" — request hit `GET /admin/qr/print` and returned `200` with all 3 seeded QR codes, correct filter-summary header, and real scannable QR images. Clicked a single "SVG" link — rendered as a real QR image inline. Caught and fixed a real cosmetic bug in the process: the print sheet had no explicit `body` background, so it rendered black in a dark-mode browser — added `background: #fffaf2` to match the app's theme, verified the fix by reloading.
5. **Verification and docs — done.** `docs/testing.md` §7.3 covers both endpoints (exact curl commands, expected content-types, the pagination-clamp check, the empty-state check, and the scan-to-confirm-URL check); §11's Admin walkthrough step now covers the Print/export panel and per-row download links; §12's checklist line was updated. All five sequenced steps in this QR printing/export slice are complete and were each verified against the real backend (steps 1–3 via curl against the dev Supabase database, step 4 via an actual browser session) before moving to the next — no step was implemented blind.

## Full `docs/testing.md` verification pass — complete, 6 defects fixed

Ran every section of `docs/testing.md` (§3–§11) against the live dev Supabase database and, for the frontend, an actual browser session — not a dry read-through. Six real defects were found, root-caused, fixed, and the fix verified live (not assumed). Full detail is in `progress.md`'s corresponding entry; summary:

1. `VendorRegistration.login_identifier` had no DB-level unique constraint (dead `P2002` handling in the route) — added via migration `20260825093500_vendor_registration_login_identifier_unique`.
2. `Retry-After` header always said `60` regardless of the actual rate-limit window — fixed in `backend/src/middleware/rate-limit.js`.
3. `POST /admin/qr/:qrId/reassign` leaked the vendor's `passwordHash` in its response — wrapped with `publicVendor()` in `backend/src/routes/admin.js`, matching every other vendor-returning route.
4. Deactivating a Vendor/staff user didn't revoke their existing session (`requireAuth` never re-checked account status) — fixed in `backend/src/middleware/auth.js`. This was the highest-severity finding: it defeated the actual purpose of the deactivate action as an access-revocation control.
5. The public enquiry form broke when the optional Email field was left blank (frontend sent `""`, backend's `.email().optional()` rejects an empty string) — fixed in `frontend/src/App.js`'s `submitLead`.
6. The app's runtime connected via Supabase's transaction-mode pooler (port 6543), a documented Prisma incompatibility for interactive `$transaction()` under load, affecting every mutation in the app. Fixed by routing the runtime connection through `DIRECT_URL` (session-mode, port 5432) in `backend/src/config/env.js`, matching what `prisma.config.ts` already used for the CLI. Verified with a 20-concurrent-transaction stress test. See `architecture.md` for the scaling note this leaves for a later, measured-need revisit.

Next: you should still run your own independent Postman/curl/Supabase pass per `docs/testing.md`, especially for anything touching money (payouts) or access control — an automated pass reduces risk but doesn't replace manual review. After that, the remaining open items are the client-supplied production values from `RFI.md` §9 needed for real deployment (final `CORS_ORIGINS`/`FRONTEND_ORIGIN`, hosting details) before a live cross-origin cookie check can run.