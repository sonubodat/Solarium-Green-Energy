import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: '.env.local' });
dotenv.config();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    // Plain process.env lookups, not @prisma/config's env() helper: env() throws
    // synchronously if the variable is unset, and it would do so as soon as this
    // config file loads — before Prisma even knows which subcommand is running.
    // `prisma generate` doesn't need database connectivity at all (it only reads
    // schema.prisma), so it must not fail just because no DB env var is set yet.
    // Commands that do need connectivity (migrate deploy/status, db push) will
    // still fail with a clear, specific database-connection error if this ends up
    // undefined — this only prevents an unrelated command from being blocked.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});