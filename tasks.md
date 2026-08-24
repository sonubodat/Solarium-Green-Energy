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