# Development Progress

## Current status

- Foundation implementation is in progress.
- Frontend/backend connection and the initial backend structure are implemented.
- Core role separation is defined as ADMIN, SALES, and VENDOR.
- Supabase is documented as the PostgreSQL provider.
- Vendor login is defined as username or mobile number plus password.
- Admin forgot-password or change-password access is now part of the plan.
- Vendor password reset from the dashboard is now part of the plan.
- `frontend/` and `backend/` application boundaries have been scaffolded.
- Prisma schema, seed entry point, API route boundaries, middleware, and shared frontend API client have been scaffolded.
- Server-side session lookup and reusable Admin, Sales, Vendor, and Admin-or-Sales authorization guards are implemented.
- Staff and Vendor login, logout, and password-change endpoints are implemented with hashed passwords and server-managed sessions.
- Frontend and backend `.env.example` and `.gitignore` boundaries are configured; secrets and generated artifacts are excluded from commits.
- Password reset issuance and completion are implemented with hashed, expiring, single-use reset tokens; reset tokens are never returned in production responses.
- A visible frontend portal preview is implemented with Public, Vendor, Sales, and Admin views using text-only status presentation.
- Prisma client generation is automatic after backend installation and before startup for local and Render environments.
- Prisma is now consistently configured for Prisma 7 with `prisma.config.ts`, the PostgreSQL adapter, and matching pinned package versions.
- Prisma version consistency was restored after an unsafe `npm audit fix --force` downgrade; Prisma packages must remain pinned together.
- Public vendor registration and authenticated Vendor profile retrieval are implemented against the Prisma data model with input validation and normalized mobile/login identifiers.
- Schema integrity hardening is prepared: VendorRegistration status is typed, and the database migration enforces one active QR assignment per QR.
- Sales registration visibility and transactional Vendor onboarding are implemented with Sales ownership checks and hashed initial credentials.
- The applied baseline migration was restored unchanged after Prisma detected migration drift; follow-up migrations contain the schema hardening changes.
- Local Prisma Client generation and API startup succeed on port `4000`.
- Supabase connectivity is now working; migration status reached the database and reported the two pending follow-up migrations.
- Supabase migrations are now fully applied; Prisma reports the database schema is up to date.
- Prisma migration configuration now prefers `DIRECT_URL`, allowing the runtime pooler URL and migration connection URL to be configured separately.
- QR inventory listing and generation, Sales unassigned-QR assignment, and Admin transactional QR reassignment are implemented with audit logging.
- Public QR resolution now validates the current assignment, records immutable scan attribution, returns safe referral context, and applies single-instance rate limiting.
- Public lead capture now validates the scan, normalizes Indian mobile numbers, creates HMAC customer identities, preserves attribution, and records duplicate leads as `DUPLICATE`.
- Vendor lead and manual payout views are implemented with authenticated Vendor scoping, bounded pagination, protected customer fields, and text-only payout statuses.
- Admin operational list views for vendors, leads, scans, payouts, and audit logs are implemented with Admin authorization and bounded pagination.
- Admin Vendor create/update/deactivate, lead status changes, and manual payout marking are implemented with validation, transactions, and audit logging.
- Admin staff-user listing, creation, update, and deactivation are implemented with hashed passwords, audit logging, and last-Admin protection.
- The applied baseline migration remains unchanged; `RESTRICT` is valid PostgreSQL syntax and its editor underline is a dialect warning, not a runtime issue.
- Development seed data now provides repeatable Admin, Sales, Vendor, and QR records for Postman/API verification.
- CORS now supports a comma-separated browser-origin allowlist for local, Render, Vercel, and temporary ngrok testing; expected `401/403` responses are no longer logged as server errors.
- Production session cookies use configurable `SameSite=None; Secure` behavior for the separate Vercel frontend and Render backend.
- A client-facing RFI has been prepared covering the product scope, technical approach, security model, current progress, exclusions, acceptance scenarios, and information required from Solarium Energy.
- Security hardening now rate-limits staff and Vendor login attempts and password-reset requests per client IP, while preserving generic authentication and reset responses.
- The frontend now connects the Public QR/lead workflow and authenticated Vendor, Sales, and Admin entry workflows to the live API with loading, success, and error states.
- The Sales frontend now supports pending-registration selection, temporary-password onboarding, QR status lookup, and assignment of an unassigned QR using the returned Vendor identifier.
- The Admin frontend now loads bounded operational views for vendors, QR inventory, leads, scans, payouts, staff users, and audit logs through a resource selector.
- The Vendor frontend now renders the authenticated Vendor workspace with profile, referral, payout-status, empty, and first-login password-change states without exposing customer phone numbers.

## Next step

- Verify the complete Sales onboarding and QR assignment flow against seeded data, then verify Admin operational views, QR reassignment, public QR scanning, lead deduplication, Vendor data isolation, Admin writes, and staff-user management. Complete authorization/security tests before adding Admin mutation controls and final portal screens.

## Notes

- This file is for development tracking only.
- Keep implementation work module-by-module.
- Scaffold files are not feature-complete implementations; update this file as each route and workflow becomes functional.