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