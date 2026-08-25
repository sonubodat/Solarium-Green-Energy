# Solarium Backend

Node.js/Express API foundation with Prisma and PostgreSQL via Supabase.

## Setup

1. Copy `.env.example` to `.env.local` and provide local values. The backend loads `.env.local` first, then `.env`.
2. Install dependencies with `npm install`; this automatically generates the Prisma client.
3. Apply migrations with `npm run db:migrate`.
4. Seed local development data with `npm run db:seed`.
5. Start the API with `npm run dev` or `npm start`.

If a migration failed before completing, inspect the migration state with `npx prisma migrate status` before rerunning it. Do not edit or delete a migration that has already been successfully applied to a shared database; create a follow-up migration instead.

The API runs on port `4000` by default and allows the frontend at `http://localhost:3000` to make credentialed requests. All domain routes (`/api/auth`, `/api/public`, `/api/vendors`, `/api/vendor`, `/api/sales`, `/api/admin`) are implemented — see `../docs/api.md` for the full contract. Each router still ends in a catch-all that returns `501` only for a path that doesn't match any of its defined routes.

Set `CORS_ORIGINS` to a comma-separated list of browser origins, without trailing slashes. For local testing use `http://localhost:3000`. For Render plus Vercel use the deployed Vercel URL; add an ngrok URL only while a local frontend is temporarily testing the deployed API. Postman does not need to be added to CORS.

For Render, set the service root directory to `backend`, use `npm install` as the build command, and set `DIRECT_URL` (and `DATABASE_URL` as a fallback) in the service environment. The `postinstall` hook automatically runs `prisma generate`, and the `prestart` hook verifies generation before the API starts. Prisma 7 uses `prisma.config.ts` for the CLI/migration connection. **The running API's own runtime connection prefers `DIRECT_URL` over `DATABASE_URL`** — Prisma's interactive `$transaction()`, used throughout this app's mutations, is unreliable against Supabase's transaction-mode pooler (port 6543) under concurrent load; see `../docs/architecture.md`'s Database section. Use the direct/session-mode connection string (port 5432) for `DIRECT_URL`, not the pooled one.

When a PostgreSQL password contains reserved URL characters such as `@`, encode them in the connection string (`@` becomes `%40`). Never commit `.env.local` or share its credentials.

`SESSION_SECRET` and `CUSTOMER_HASH_SECRET` must each be a freshly generated, unique value per environment — never reuse a local development value in staging or production. `CUSTOMER_HASH_SECRET` in particular is the HMAC key behind customer deduplication (`docs/data-model.md`'s `CustomerIdentity.hash`); changing it changes every future hash, so once a value is chosen for a real environment it must stay fixed for that environment going forward — rotating it silently breaks duplicate-detection continuity for existing customers.

PowerShell uses `curl.exe` for curl syntax. The command `curl` may resolve to `Invoke-WebRequest`, which does not support curl's `-H` option.

Development credentials created by the seed are for local testing only:

```text
Admin: admin@solarium.local / Admin@12345
Sales: sales@solarium.local / Sales@12345
Vendor: ram-store / Vendor@12345
```
