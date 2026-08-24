# Solarium Backend

Node.js/Express API foundation with Prisma and PostgreSQL via Supabase.

## Setup

1. Copy `.env.example` to `.env` and provide local values.
2. Install dependencies with `npm install`.
3. Generate the Prisma client with `npm run db:generate`.
4. Apply migrations with `npm run db:migrate`.
5. Start the API with `npm run dev`.

The API runs on port `4000` by default and allows the frontend at `http://localhost:3000` to make credentialed requests. It currently exposes `/health`; domain routes are scaffolded and return `501` until their implementation phase.
