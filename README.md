# Solarium workspace

The project is organized into separate application boundaries:

```text
frontend/  React customer, Vendor, Sales, and Admin UI
backend/   Node.js/Express API, Prisma, and database access
docs/      Product, architecture, data-model, API, task, and progress references
```

Use `frontend/README.md` for frontend setup and `backend/README.md` for API setup. There is no runnable application at the repository root — the `frontend/` and `backend/` directories are the two applications; the root's `public/` folder is unused leftover from before the frontend/backend split and can be ignored (or removed).

Important references:

- `docs/plan.md` — implementation contract
- `docs/requirements.md` — business requirements (superseded in places by `plan.md`; see `plan.md`'s own notes on where they diverge)
- `docs/architecture.md` — technical boundaries and runtime flows
- `docs/data-model.md` — persistence contract
- `docs/api.md` — frontend/backend API contract
- `docs/tasks.md` — execution tasks
- `docs/progress.md` — current implementation state
- `docs/testing.md` — curl/Postman/Supabase testing guide and acceptance scenarios
- `docs/RFI.md` — client-facing scope summary and open questions
