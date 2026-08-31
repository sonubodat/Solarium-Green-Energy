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
- Verify the first lead is `NEW` and a repeat customer (globally, across any vendor) is rejected with `409 CUSTOMER_ALREADY_EXISTS` rather than creating a second `DUPLICATE`-status lead row.
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
- Measure public QR and lead endpoint response times after the database query optimizations and confirm low-latency behavior under normal local traffic.
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

## Session persistence and vendor-assignment UX — done (requested directly, outside the sequenced plan)

Added `GET /api/auth/session` (generic session check, no password storage — relies on the existing 24h `HttpOnly` cookie) and wired it into `changeView()` so returning to the Admin/Sales/Vendor tab restores an already-signed-in session instead of re-prompting for credentials; added a "Sign out" button since view-switching no longer doubles as a logout. Also closed the gap where Admin had no way to assign an `UNASSIGNED` QR (only reassign `ACTIVE` ones) and both Admin/Sales required typing a raw Vendor id: added `POST /api/admin/qr/:qrId/assign`, `GET /api/admin/vendors/lookup`, and `GET /api/sales/vendors` (this one was already documented in `api.md`/`plan.md` §19 as a planned route, now implemented), and replaced the raw-ID inputs with vendor-name `<select>` pickers in both the Admin QR view and the Sales QR-assignment flow (no longer limited to the just-onboarded vendor). Full detail and live verification steps are in `progress.md`.

## Commission/payout Partial status, vendor delete, QR one-vendor rule, QR filter fix, Leads detail, Scans/Payouts/Audit-logs table views — done (requested directly, outside the sequenced plan)

Two of these conflicted with `plan.md`'s written rules and were confirmed with you before building: `PARTIAL` as a third payout status (plan.md said UNPAID/PAID only) and a Vendor "delete" action (plan.md says never hard-delete a Vendor with history, deactivate only). Both were resolved in the smaller, plan-respecting direction: `PARTIAL` is a manual label with no amount/calculation; delete is a guarded soft-delete that only succeeds with zero historical records, otherwise blocked with a clear message pointing at Deactivate. `plan.md` §13/§16/§20 were updated to match.

Also fixed: the QR inventory list had no working status filter at all (only the separate Print/export filter existed, and it never touched the list) — this was the actual bug behind "assigned/unassigned filter not working." Also enforced "a Vendor already holding an active QR can't be picked for another QR" at the vendor-lookup/quick-pick endpoints Admin and Sales both use. Also added a Leads "Details" expand (phone/email/location/all ids — the backend already returned these, the frontend just didn't show them) and replaced the Scans/Audit-logs raw JSON dumps with real table views (this completes design-system-plan step 4 ahead of its sequenced turn).

A real dev-workflow issue was found and is worth remembering: `npm run dev`'s `node --watch` silently stopped applying file changes partway through this session while still logging fake-looking "Restarting.../Completed running..." lines — confirmed via PID inspection (same PID alive 31+ minutes across many logged "restarts"). If a route you just added 501s unexpectedly, don't trust the watch log — kill and restart the backend process fully.

Full detail, exact endpoint names, and the live/curl verification steps are in `progress.md`.

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

## Admin / Sales / Vendor dashboard design-system audit and plan — planning only, not yet implemented

Requested via `/design:design-system`. This is a plan to review and execute one item at a time later, the same way every other slice in this file has been — nothing below has been coded yet.

### Audit: current state

There is no formal design system to audit in the usual sense — no token file, no extracted/reusable components, no documented variants or states. The entire UI lives in one file, `frontend/src/App.js` (787 lines, one `render*()` function per resource/role) plus one stylesheet, `frontend/src/App.css` (60 lines). That's not a criticism of what exists — it's matched the project's actual pace, and everything in it works, is accessible enough to use, and has been verified live in a real browser repeatedly this session — but it means "audit the design system" mostly means **naming what's missing before deciding what to build**:

- **Tokens: none formalized.** 11 distinct hex colors (`#18332d`, `#d9e1d7`, `#ef6f45`, `#718078`, `#597069`, `#fffaf2`, `#cbd8cc`, `#9a8f80`, `#eef3ec`, `#e6eee3`, `#9eb1a3`) are hardcoded inline throughout `App.css`, each repeated 1–9 times, with no CSS custom properties. Spacing uses ad-hoc rem values with no defined scale. No dark-mode support (the QR print sheet's earlier black-background bug was exactly this class of issue).
- **Components: none extracted.** Every button, input, row, and form is raw JSX with a shared className, not a reusable `<Button>`/`<Input>`/`<DataTable>` component. `.primary-action`/`.secondary-action` are the closest thing to a button "variant" system — two variants, no size scale, no icon-button/danger/link variants, no loading-spinner state (loading is communicated only via changed button text, e.g. "Generating...").
- **Patterns: partially consistent, not documented.** The create/edit-form pattern (`.lead-form`, `.inline-form`), the list-row-with-actions pattern (`.data-row`/`.admin-row`/`.row-actions`), and the empty-state pattern (`.empty-state`) are each used consistently within their own resource, but nothing documents them as *the* pattern to reuse for the next one — a future contributor would have no way to discover "use `.data-row` for list items" except by reading existing JSX.
- **Confirmation pattern**: every destructive/sensitive Admin action uses the browser's native `window.confirm()` (deactivate, reassign, mark-paid, role change, self-lockout attempts). Functional and already verified live, but not a designed/branded UI pattern — no way to show *why* an action needs confirming beyond a generic OS dialog.
- **Accessibility**: role/tab semantics exist (`role="tablist"`, `aria-selected`) on the view switcher; form inputs mostly rely on `placeholder` rather than associated `<label>` elements (a few explicit `<label htmlFor>` pairs exist, e.g. the QR quantity field, but most Admin list forms don't). No accessibility-specific pass has been done — `docs/testing.md`'s browser walkthrough checks *that things work*, not screen-reader/keyboard-only usability.

### Gap analysis against `plan.md` §19 and `api.md`

Cross-checked the documented contract against what's actually built for the three staff-facing dashboards (Public is out of scope for this plan — it's a single simple form and isn't a "dashboard").

**Structural — the biggest, most consequential gap:**
- `plan.md` §19 specifies distinct URL routes per role (`/admin/dashboard`, `/admin/vendors`, `/admin/vendors/:id`, `/admin/qr`, ... `/sales/dashboard`, `/sales/registrations`, ... `/vendor/dashboard`, `/vendor/leads`, ...). The app has **no router** (`react-router` isn't even a dependency) — every role is a client-side tab switch within one page at `/`, all state resets on switch. This was a deliberate simplification that's held up fine so far (already reflected honestly in `frontend/README.md`'s "single-page `View as` switcher... rather than as separate routes" line), but it means: no shareable/bookmarkable URLs per screen, no browser back-button support between resources, and no `/admin/vendors/:id` vendor-detail view at all (Admin can edit a vendor inline in the list, but there's no dedicated detail page showing that vendor's own leads/scans/payouts together, which `plan.md` §19 and §16 describe).
- **This needs a decision, not just execution** — see "Open decision" below before sequencing the rest of this plan.

**Pagination and search — real, currently-invisible functional gaps:**
- The backend's every Admin list endpoint accepts `page`/`limit` (`docs/api.md`, verified in `docs/testing.md` §8), but `frontend/src/App.js` never sends either param and has zero pagination controls. Any resource beyond the first `page=1&limit=50`/`100` page is **permanently inaccessible from the UI** today — this will become a real problem the moment vendor/lead/scan/audit-log counts pass one page, which `plan.md`'s stated 50,000-vendor scale target guarantees will happen.
- No search/filter UI exists for Vendors, Leads, Payouts, or Staff users (QR is the only resource with a filter panel, built for the print feature). `api.md` documents "approved search/filter fields" for several of these list endpoints that the frontend never exposes.

**Resource-view gaps:**
- Scans and Audit logs are still raw `<pre>{JSON.stringify(...)}</pre>` dumps — functional (correctly read-only, per `plan.md`) but not a designed table view. Audit logs specifically will grow to the "millions of rows" `plan.md` §17 anticipates; a raw JSON dump of even one page of 50-100 rows is hard to scan visually.
- No Admin dashboard/overview screen at all — `plan.md` §19 lists `/admin/dashboard` as a route; nothing renders there today (the resource selector defaults straight to Vendors). Note: `plan.md` §20 explicitly forbids progress bars/completion meters/KPI scorecards, so this must stay text-only counts/links, not a metrics dashboard — easy to over-build here, watch that.
- Sales has no distinct "my vendors" list view separate from the onboarding flow (`plan.md` mentions Sales should see "operational vendor information required for onboarding" but there's currently no browsable list of a Sales user's own vendors, only the pending-registrations queue).
- Vendor workspace already covers profile/leads/payouts/password-change content-wise (verified live, no gaps there) — its only real gap is the missing route split, covered above.

**Branding — blocked on the client, not actionable now:**
- `RFI.md` §9 still has open questions for logo/colors/fonts/wording. The current palette is a placeholder. Don't invest in polishing colors/typography before that answer lands — formalizing *tokens as a system* (see below) is worth doing now since it's structure, not final values; picking final brand colors is not.

### Open decision before sequencing implementation

Before turning any of this into "step 1 of N" the way QR printing/export was sequenced, one thing needs a decision, not more analysis: **does this project adopt real per-role routing (`react-router`) now, or stay single-page and just add pagination/search/table-view polish within the current structure?**

- **Stay single-page** is the lower-risk, faster path, consistent with everything built so far, and defers the routing question until it's actually blocking something (e.g., needing to link directly to `/admin/vendors/:id` from an audit log entry or a payout record).
- **Add routing now** is a bigger, riskier change (touches every render function, the view-switcher, and how state resets between views) but directly closes the gap against `plan.md` §19's literal route list and enables deep-linking (e.g., a shareable link to one vendor's detail page).

Recommendation: stay single-page for now and treat the pagination/search/table-view gaps as the actual next work, since those are functional gaps (data becomes literally unreachable at scale) rather than structural ones (URLs don't match a spec that no one has asked to see enforced). Revisit routing only if a concrete need surfaces (e.g., the client asks for shareable admin links).

**Decision made: stay single-page.** Confirmed by you; routing is not being adopted now.

**Superseded:** real per-role routing was adopted directly in a later request, once development was far enough along to separate the app for production — see the "Real per-role routing" entry in `progress.md`. `/`, `/admin`, `/sales`, `/vendor` (and `/v/:code`) are now genuinely separate pages via `react-router-dom`; the dev-preview "View as" switcher is gone. This is top-level route separation only — the more granular routes plan.md §19 lists (e.g. `/admin/vendors/:id`, `/admin/qr/print`) are still handled as in-page resource tabs within `/admin`, not their own routes; revisit only if a concrete need surfaces (e.g. a shareable deep link to one vendor's detail).

### Sequenced plan, one step at a time like every other slice

1. **Design tokens — done.** Extracted all 13 hardcoded colors (the 11 counted in the audit plus `#fff` and the live-dot green) into named CSS custom properties on `:root` in `frontend/src/App.css` — no value changes, no JSX touched. Verified live in a real browser: pixel-identical render, no console errors. A documented spacing scale was not added in this pass (colors only, matching the audit's stated scope); revisit if a future step needs it. Establishes the vocabulary the rest of this plan's steps reuse.
2. **Pagination controls — done.** `loadAdminResource(resource, page)` in `frontend/src/App.js` now sends `?page=&limit=50` and tracks `adminPage`; `renderAdminPagination()` shows a "Showing X–Y of Z" summary with Prev/Next wired to the `pagination` metadata every Admin list endpoint already returned. Switching resource resets to page 1; every mutation follow-up reload now stays on the admin's current page instead of resetting to page 1. Verified live: generated a QR batch past 50 records, confirmed real `page=2` and back-to-`page=1` requests and correct Prev/Next disabled states at both boundaries, no console errors.
3. **Search/filter for Vendors and Leads.** Match the pattern already built for QR's filter panel (status/vendor-id) — add the "approved search/filter fields" `api.md` already documents for these two endpoints specifically (highest-traffic Admin views).
4. **Real table views for Scans and Audit logs — done (completed ahead of turn, requested directly alongside a batch of other fixes).** Reused the `.data-row` pattern. See the "Commission/payout Partial status..." entry below for full detail.
5. **Confirmation pattern.** Replace `window.confirm()` with a small in-page confirm affordance (e.g., a second click-to-confirm state on the button, or an inline "Are you sure? Yes/Cancel" row) for the highest-stakes actions specifically (deactivate, reassign, mark-paid) — lower priority than 2–4, since `window.confirm()` already works and was already verified live; this is pure polish.
6. **Accessibility pass.** Add explicit `<label htmlFor>` associations to every form input still relying on placeholder-only labeling, once the form set from steps 2–4 has stabilized (do this last so it's not redone per new form).

Each step should be implemented, verified live (curl/browser as established this session), and documented in `progress.md` before starting the next — no step implemented blind, matching how the QR printing/export and testing-pass work went.

## Incomplete steps snapshot (current)

- Design-system plan step 3: add search/filter UI for Vendors and Leads (QR filter now implemented; Vendors/Leads filter UI still pending).
- Design-system plan step 5: replace `window.confirm()` with an in-page confirmation pattern for high-stakes Admin actions.
- Design-system plan step 6: accessibility pass for explicit labels and keyboard/screen-reader validation on all Admin/Sales/Vendor forms.
- Production validation pending from `RFI.md` values: final deployed `CORS_ORIGINS`/`FRONTEND_ORIGIN` and live cross-origin cookie verification.
- Independent manual verification pass still recommended (Postman/curl/Supabase) for payout and access-control flows after each mutation slice change.