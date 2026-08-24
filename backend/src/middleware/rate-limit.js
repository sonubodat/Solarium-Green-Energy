const windows = new Map();
const windowMs = 60 * 1000;
const maxRequests = 60;

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
    response.setHeader('Retry-After', '60');
    return response.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
  }
  return next();
}
