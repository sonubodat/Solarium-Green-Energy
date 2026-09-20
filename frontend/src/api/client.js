export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

// Short-TTL cache for GET responses, shared by every portal. Cuts down repeat DB round-trips
// (and, on a free-tier host, repeat cold-start wake-ups) when a user re-opens the same tab/page
// within a few seconds — or has several tabs open at once. Backed by both an in-memory Map
// (fastest, this tab only) and localStorage (shared with every other tab on the same origin), so
// e.g. three Admin tabs opened together only cost one real /auth/session round trip, not three.
// Any successful non-GET request clears the whole cache, in both places (simplest invalidation
// strategy that can never show stale data after a create/update/delete). Pass
// { forceRefresh: true } to bypass it, e.g. for explicit "Refresh" buttons.
const CACHE_TTL_MS = 30000;
const CACHE_STORAGE_PREFIX = 'solarium:api-cache:';
const getCache = new Map();

function readSharedCacheEntry(path) {
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_PREFIX + path);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.time >= CACHE_TTL_MS) return null;
    return entry;
  } catch (error) {
    return null;
  }
}

function writeSharedCacheEntry(path, entry) {
  try {
    window.localStorage.setItem(CACHE_STORAGE_PREFIX + path, JSON.stringify(entry));
  } catch (error) {
    // Storage unavailable (private browsing, quota, disabled) — caching is an optimization only.
  }
}

function clearSharedCache() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(CACHE_STORAGE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch (error) {
    // Storage unavailable — nothing to clear.
  }
}

export function clearApiCache() {
  getCache.clear();
  clearSharedCache();
}

async function apiRequestCore(path, options = {}) {
  const { forceRefresh, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  if (isGet && !forceRefresh) {
    const cached = getCache.get(path) || readSharedCacheEntry(path);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      if (cached.ok) return cached.data;
      const error = new Error(cached.errorMessage);
      error.code = cached.errorCode;
      error.status = cached.errorStatus;
      throw error;
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
    // Only 401s are worth caching as a negative result — "not logged in" is a stable fact
    // that's safe (and useful, across simultaneously-open tabs) to reuse for a few seconds.
    // A 500/network failure is exactly the kind of thing a quick retry should get past, so
    // those are deliberately left uncached.
    if (isGet && response.status === 401) {
      const entry = { ok: false, time: Date.now(), errorMessage: message, errorCode: error.code, errorStatus: error.status };
      getCache.set(path, entry);
      writeSharedCacheEntry(path, entry);
    }
    throw error;
  }

  if (isGet) {
    const entry = { ok: true, time: Date.now(), data: payload };
    getCache.set(path, entry);
    writeSharedCacheEntry(path, entry);
  } else {
    getCache.clear();
    clearSharedCache();
  }

  return payload;
}

// ---- Activity tracking (drives the progress bar in WakeButton) -------------------------------
// Only operations started with a `label` are tracked, so the bar never names an unrelated
// request. The list is replaced (never mutated) so useSyncExternalStore sees a new snapshot.
let activity = [];
let activitySeq = 0;
const activityListeners = new Set();

export function subscribeActivity(listener) {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function getActivitySnapshot() {
  return activity;
}

function setActivity(next) {
  activity = next;
  activityListeners.forEach((listener) => listener());
}

export async function trackOperation(label, work) {
  activitySeq += 1;
  const operation = { id: activitySeq, label };
  setActivity([...activity, operation]);
  try {
    return await work();
  } finally {
    setActivity(activity.filter((item) => item !== operation));
  }
}

// ---- apiRequest ------------------------------------------------------------------------------
// Extra options on top of fetch's own:
//   label:  name shown in the progress bar while this request runs.
//   dedupe: identical requests (same method + path + string body) made while one is still in
//           flight share that one request, so a double click cannot send it twice. Removed as soon
//           as it settles (success or failure); a finished result is never reused.
const pendingDedupe = new Map();

export function apiRequest(path, options = {}) {
  const { label, dedupe, ...rest } = options;
  const start = () => (label ? trackOperation(label, () => apiRequestCore(path, rest)) : apiRequestCore(path, rest));
  if (!dedupe || typeof rest.body !== 'string') return start();

  const key = `${(rest.method || 'GET').toUpperCase()} ${path} ${rest.body}`;
  if (pendingDedupe.has(key)) return pendingDedupe.get(key);
  const promise = start();
  pendingDedupe.set(key, promise);
  const clear = () => pendingDedupe.delete(key);
  promise.then(clear, clear);
  return promise;
}

// Downloads a file through fetch (instead of navigating to it) so the page knows when it is done
// or failed. Always resolves only after the browser was handed the file.
export function downloadFile(path, fallbackName, label = 'Preparing download') {
  return trackOperation(label, async () => {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
    } catch (error) {
      throw new Error('Download failed. Check your connection and try again.');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.error?.message || 'Download failed. Try again.');
      error.code = payload?.error?.code;
      error.status = response.status;
      throw error;
    }
    let blob;
    try {
      blob = await response.blob();
    } catch (error) {
      throw new Error('Download was interrupted. Try again.');
    }
    const name = /filename="?([^";]+)"?/i.exec(response.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
