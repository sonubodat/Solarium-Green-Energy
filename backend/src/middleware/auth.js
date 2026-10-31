import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { sessionCookieName } from '../services/auth.js';
import { hasAnyPermission } from '../lib/permissions.js';
import { currentSessionGeneration, getCachedSession, putCachedSession } from '../lib/session-cache.js';

function unauthorized(message = 'Authentication is required.') {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = 'UNAUTHENTICATED';
  return error;
}

function forbidden(message = 'You are not authorized to perform this action.') {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = 'FORBIDDEN';
  return error;
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(';') || [];
  const cookie = cookies.find((value) => value.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : null;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function requestedPortal(request) {
  const headerRole = request.headers['x-portal-role']?.toUpperCase();
  if (['ADMIN', 'SALES', 'VENDOR'].includes(headerRole)) return headerRole;

  const queryRole = request.query.portal?.toUpperCase();
  if (['ADMIN', 'SALES', 'VENDOR'].includes(queryRole)) return queryRole;

  if (request.baseUrl.endsWith('/admin')) return 'ADMIN';
  if (request.baseUrl.endsWith('/sales')) return 'SALES';
  if (request.baseUrl.endsWith('/vendor')) return 'VENDOR';
  return null;
}

export async function requireAuth(request, _response, next) {
  try {
    const role = requestedPortal(request);
    const token = readCookie(request, role ? sessionCookieName(role) : env.sessionCookieName)
      || (!role && readCookie(request, sessionCookieName('ADMIN')))
      || (!role && readCookie(request, sessionCookieName('SALES')))
      || (!role && readCookie(request, sessionCookieName('VENDOR')));
    if (!token) {
      return next(unauthorized());
    }

    const tokenHash = hashToken(token);
    let session = getCachedSession(tokenHash);
    if (!session) {
      const generation = currentSessionGeneration();
      session = await prisma.session.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        // The role is read with the user on every request (or from a cache cleared by every write and kept 30 s),
        // so editing a role takes effect on the next request.
        include: { user: { include: { accessRole: true } }, vendor: true },
      });
      if (session) putCachedSession(tokenHash, session, generation);
    }

    if (!session || (!session.user && !session.vendor)) {
      return next(unauthorized('Session is invalid or expired.'));
    }

    const account = session.user || session.vendor;
    if (account.status !== 'ACTIVE') {
      return next(unauthorized('Session is invalid or expired.'));
    }

    request.auth = session.user
      ? { type: 'staff', user: session.user, role: session.user.role, sessionId: session.id }
      : { type: 'vendor', vendor: session.vendor, role: 'VENDOR', sessionId: session.id };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(role) {
  return (request, _response, next) => {
    if (!request.auth) {
      return next(unauthorized());
    }
    return request.auth.role === role ? next() : next(forbidden());
  };
}

export function requireAdmin(request, response, next) {
  return requireRole('ADMIN')(request, response, next);
}

// Admin route open to a super-admin and to STAFF whose role holds ANY of the listed permissions. A route that
// does not use this keeps requireAdmin and therefore stays super-admin only.
export function requirePermission(...permissions) {
  const guard = (request, _response, next) => {
    if (!request.auth) {
      return next(unauthorized());
    }
    if (request.auth.type !== 'staff') {
      return next(forbidden());
    }
    return hasAnyPermission(request.auth.user, permissions) ? next() : next(forbidden());
  };
  // Readable by tests/route-permissions.test.js, which lists every Admin route with its guard.
  guard.permissions = permissions;
  return guard;
}

export function requireSales(request, response, next) {
  return requireRole('SALES')(request, response, next);
}

export function requireVendor(request, response, next) {
  return requireRole('VENDOR')(request, response, next);
}

// Changing the default (phone-number) password is optional, so a Vendor is "ready" as soon as
// they are signed in. Kept as its own name so vendor data routes don't need to change.
export function requireVendorReady(request, response, next) {
  return requireRole('VENDOR')(request, response, next);
}

export function requireAdminOrSales(request, response, next) {
  if (!request.auth) {
    return next(unauthorized());
  }
  return ['ADMIN', 'SALES'].includes(request.auth.role) ? next() : next(forbidden());
}
