import 'dotenv/config';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  appBaseUrl: process.env.APP_BASE_URL || 'https://solariumenergy.in',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'solarium_session',
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  customerHashSecret: process.env.CUSTOMER_HASH_SECRET || '',
};
