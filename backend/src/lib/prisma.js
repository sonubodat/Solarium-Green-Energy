import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';

// A modest pool size: Supabase's free-tier session-mode pooler has a small shared
// connection ceiling, and every extra idle connection this process holds is one
// fewer available under load. 5 is enough for this app's concurrency at this scale.
const adapter = new PrismaPg({ connectionString: env.databaseUrl, max: 5 });

export const prisma = new PrismaClient({
  adapter,
  // Prisma's interactive $transaction() default timeout is 5000ms. Measured real-world
  // round trips to this database (a distant region) regularly land in the 2-4s range per
  // query, and every $transaction() in this app runs 2-5 sequential queries — so the
  // default was failing legitimate, successful work, not just genuinely stuck requests.
  // This is a global default; individual call sites can still override it if one specific
  // transaction needs a tighter or looser bound.
  transactionOptions: { timeout: 15000, maxWait: 8000 },
});
