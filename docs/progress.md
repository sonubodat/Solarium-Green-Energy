# Development Progress

## Current status

- Planning only.
- No implementation code has been added.
- Core role separation is defined as ADMIN, SALES, and VENDOR.
- Supabase is documented as the PostgreSQL provider.
- Vendor login is defined as username or mobile number plus password.
- Admin forgot-password or change-password access is now part of the plan.
- Vendor password reset from the dashboard is now part of the plan.
- `frontend/` and `backend/` application boundaries have been scaffolded.
- Prisma schema, seed entry point, API route boundaries, middleware, and shared frontend API client have been scaffolded.

## Next step

- Implement the authentication and authorization contracts, then generate and apply the first Prisma migration.

## Notes

- This file is for development tracking only.
- Keep implementation work module-by-module.
- Scaffold files are not feature-complete implementations; update this file as each route and workflow becomes functional.