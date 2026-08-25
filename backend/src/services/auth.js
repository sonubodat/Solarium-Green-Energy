import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 1000 * 60 * 60 * 24;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHex] = storedHash?.split('$') || [];
  if (algorithm !== 'scrypt' || !salt || !expectedHex) {
    return false;
  }

  const derivedKey = await scrypt(password, salt, 64);
  const expectedKey = Buffer.from(expectedHex, 'hex');
  const actualKey = Buffer.from(derivedKey);
  return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
}

export function normalizeLoginIdentifier(value) {
  return value.trim().toLowerCase();
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createStaffSession(userId) {
  const token = createSessionToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + sessionLifetimeMs),
    },
  });
  return token;
}

export async function createVendorSession(vendorId) {
  const token = createSessionToken();
  await prisma.session.create({
    data: {
      vendorId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + sessionLifetimeMs),
    },
  });
  return token;
}

function cookieIsSecure() {
  // A SameSite=None cookie without Secure is rejected outright by browsers, so
  // these two settings must never be able to drift apart — Secure is required
  // whenever SameSite=None is in effect, regardless of how NODE_ENV is set.
  return env.nodeEnv === 'production' || env.sessionCookieSameSite === 'None';
}

export function setSessionCookie(response, token) {
  const secure = cookieIsSecure();
  response.setHeader(
    'Set-Cookie',
    `${env.sessionCookieName}=${encodeURIComponent(token)}; Max-Age=${sessionLifetimeMs / 1000}; Path=/; HttpOnly; SameSite=${env.sessionCookieSameSite}${secure ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(response) {
  response.setHeader(
    'Set-Cookie',
    `${env.sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=${env.sessionCookieSameSite}${cookieIsSecure() ? '; Secure' : ''}`
  );
}

export function publicStaff(user) {
  return { id: user.id, name: user.name, role: user.role };
}

export function publicVendor(vendor) {
  return {
    id: vendor.id,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    loginIdentifier: vendor.loginIdentifier,
    mustChangePassword: vendor.mustChangePassword,
  };
}
