import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  appBaseUrl: process.env.APP_BASE_URL || 'https://solariumenergy.in',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'solarium_session',
  sessionCookieSameSite: process.env.SESSION_COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  customerHashSecret: process.env.CUSTOMER_HASH_SECRET || '',
};
