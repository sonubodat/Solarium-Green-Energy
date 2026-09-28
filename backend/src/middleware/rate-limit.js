const windows = new Map();
const windowMs = 60 * 1000;
const maxRequests = 60;
const sweepIntervalMs = 5 * 60 * 1000;

function rateLimitResponse(response, retryAfterSeconds) {
  response.setHeader('Retry-After', String(retryAfterSeconds));
  return response.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
  });
}

export function publicRateLimit(request, response, next) {
  const key = `${request.ip}:${request.params.qrCode || 'public'}`;
  const now = Date.now();
  const current = windows.get(key);
  const entry = current && now - current.startedAt < windowMs
    ? current
    : { startedAt: now, count: 0, durationMs: windowMs };

  entry.count += 1;
  windows.set(key, entry);

  if (entry.count > maxRequests) {
    return rateLimitResponse(response, Math.ceil((windowMs - (now - entry.startedAt)) / 1000));
  }
  return next();
}

function createLimiter(prefix, limit, durationMs) {
  return (request, response, next) => {
    const key = `${prefix}:${request.ip}`;
    const now = Date.now();
    const current = windows.get(key);
    const entry = current && now - current.startedAt < durationMs
      ? current
      : { startedAt: now, count: 0, durationMs };

    entry.count += 1;
    windows.set(key, entry);

    if (entry.count > limit) {
      return rateLimitResponse(response, Math.ceil((durationMs - (now - entry.startedAt)) / 1000));
    }
    return next();
  };
}

export const authRateLimit = createLimiter('auth', 10, 15 * 60 * 1000);
export const passwordResetRateLimit = createLimiter('password-reset', 5, 15 * 60 * 1000);
// Public "Apply for Solar Mitra": a few applications per IP is plenty for a real person.
export const registerRateLimit = createLimiter('register', 5, 15 * 60 * 1000);

const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now - entry.startedAt >= entry.durationMs) {
      windows.delete(key);
    }
  }
}, sweepIntervalMs);
sweepTimer.unref();
