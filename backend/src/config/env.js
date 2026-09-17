import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const configuredCorsOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  appBaseUrl: process.env.APP_BASE_URL || 'https://solariumenergy.in',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  corsOrigins: [...new Set([
    ...configuredCorsOrigins,
    ...(nodeEnv === 'development' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
  ])],
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'solarium_session',
  sessionCookieSameSite: process.env.SESSION_COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'),
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 15),
  // Prisma's interactive $transaction() API (used throughout this app's mutations)
  // is unreliable against Supabase's transaction-mode pooler (port 6543) under
  // concurrent load, so the runtime connects via the direct/session-mode URL when
  // available, matching prisma.config.ts's connection for the CLI. DATABASE_URL
  // remains the fallback for environments where only a pooled URL is configured.
  databaseUrl: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  customerHashSecret: process.env.CUSTOMER_HASH_SECRET || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'vendor-documents',
  supabaseQrStorageBucket: process.env.SUPABASE_QR_STORAGE_BUCKET || 'qr-artifacts',
  supabaseVendorPhotosBucket: process.env.SUPABASE_VENDOR_PHOTOS_BUCKET || 'vendor-photos',
};
