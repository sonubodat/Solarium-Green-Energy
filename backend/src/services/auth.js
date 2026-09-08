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

// Bulk vendor creation derives a login_identifier from just a business name (no username is
// typed by hand for 500 rows at once) — collapse anything that isn't a letter/digit into a
// single hyphen. A name that's only punctuation/emoji still needs a usable base, hence the
// 'vendor' fallback (the caller is responsible for de-duping/suffixing this against existing
// identifiers, since that requires DB state this pure function doesn't have).
export function slugifyVendorName(name) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'vendor';
}

// Confirmed pattern for bulk-created vendors' optional auto-password: "<name>@123", e.g.
// "Ram Store" -> "ramstore@123". padEnd guarantees the >=8 character minimum this app requires
// of every password even for very short names (e.g. "A1" -> "a1000@123", 9 chars).
export function autoPasswordFor(businessName) {
  const cleaned = businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (cleaned || 'vendor').padEnd(5, '0');
  return `${base}@123`;
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

export function sessionCookieName(role) {
  return `${env.sessionCookieName}_${role.toLowerCase()}`;
}

function cookieOptions(name, value, maxAge) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=${env.sessionCookieSameSite}${cookieIsSecure() ? '; Secure' : ''}`;
}

export function setSessionCookie(response, token, role) {
  response.setHeader(
    'Set-Cookie',
    [
      cookieOptions(sessionCookieName(role), encodeURIComponent(token), sessionLifetimeMs / 1000),
      cookieOptions(env.sessionCookieName, '', 0),
    ]
  );
}

export function clearSessionCookie(response, role) {
  response.setHeader(
    'Set-Cookie',
    [
      cookieOptions(sessionCookieName(role), '', 0),
      cookieOptions(env.sessionCookieName, '', 0),
    ]
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
