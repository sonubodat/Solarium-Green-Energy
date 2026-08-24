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

## Next step

- Generate and apply the first Prisma migration, then replace the frontend preview with the first database-backed feature module.

## Notes

- This file is for development tracking only.
- Keep implementation work module-by-module.
- Scaffold files are not feature-complete implementations; update this file as each route and workflow becomes functional.