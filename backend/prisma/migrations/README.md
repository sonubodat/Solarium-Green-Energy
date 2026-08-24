Prisma migrations will be generated from schema.prisma after DATABASE_URL and the schema contract are approved.

Run from backend:

```text
npm run db:generate
npm run db:migrate
```

The applied baseline migration uses `ON DELETE RESTRICT`, which is valid PostgreSQL syntax and preserves historical records. Do not edit an already-applied migration to remove an editor underline; create a follow-up migration for future schema changes to avoid migration drift.
