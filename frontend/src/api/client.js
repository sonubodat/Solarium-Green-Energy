export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

// Short-TTL in-memory cache for GET responses, shared by every portal. Cuts down repeat
// DB round-trips when a user re-opens the same tab/page within a few seconds. Any successful
// non-GET request clears the whole cache (simplest invalidation strategy that can never show
// stale data after a create/update/delete). Pass { forceRefresh: true } to bypass it, e.g. for
// explicit "Refresh" buttons.
const CACHE_TTL_MS = 30000;
const getCache = new Map();

export function clearApiCache() {
  getCache.clear();
}

export async function apiRequest(path, options = {}) {
  const { forceRefresh, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  if (isGet && !forceRefresh) {
    const cached = getCache.get(path);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const headers = fetchOptions.body instanceof FormData
    ? { ...fetchOptions.headers }
    : { 'Content-Type': 'application/json', ...fetchOptions.headers };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers,
    ...fetchOptions,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('[Solarium API error]', JSON.stringify({
      method,
      path,
      status: response.status,
      statusText: response.statusText,
      response: payload,
    }, null, 2));
    const baseMessage = payload?.error?.message || 'Request failed.';
    const details = payload?.error?.details;
    // A VALIDATION_ERROR's top-level message is always the same generic sentence — the
    // actually useful, field-specific reason only exists in `details`. Fold it into the
    // message every caller already reads, so no form in the app shows an unhelpful
    // "Request validation failed." with no indication of what was actually wrong.
    const message = Array.isArray(details) && details.length
      ? `${baseMessage} ${details.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
      : baseMessage;
    const error = new Error(message);
    error.code = payload?.error?.code;
    error.status = response.status;
    error.details = details;
    throw error;
  }

  if (isGet) {
    getCache.set(path, { data: payload, time: Date.now() });
  } else {
    getCache.clear();
  }

  return payload;
}
