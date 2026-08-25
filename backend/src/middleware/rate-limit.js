const windows = new Map();
const windowMs = 60 * 1000;
const maxRequests = 60;

function rateLimitResponse(response) {
  response.setHeader('Retry-After', '60');
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
    : { startedAt: now, count: 0 };

  entry.count += 1;
  windows.set(key, entry);

  if (entry.count > maxRequests) {
    return rateLimitResponse(response);
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
      : { startedAt: now, count: 0 };

    entry.count += 1;
    windows.set(key, entry);

    if (entry.count > limit) {
      response.setHeader('Retry-After', String(Math.ceil((durationMs - (now - entry.startedAt)) / 1000)));
      return rateLimitResponse(response);
    }
    return next();
  };
}

export const authRateLimit = createLimiter('auth', 10, 15 * 60 * 1000);
export const passwordResetRateLimit = createLimiter('password-reset', 5, 15 * 60 * 1000);
