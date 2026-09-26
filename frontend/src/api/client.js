export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

// Short-TTL cache for GET responses, shared by every portal. Cuts down repeat DB round-trips
// (and, on a free-tier host, repeat cold-start wake-ups) when a user re-opens the same tab/page
// within a few seconds — or has several tabs open at once. Backed by both an in-memory Map
// (fastest, this tab only) and localStorage (shared with every other tab on the same origin), so
// e.g. three Admin tabs opened together only cost one real /auth/session round trip, not three.
// Any successful non-GET request clears the whole cache, in both places (simplest invalidation
// strategy that can never show stale data after a create/update/delete). Pass
// { forceRefresh: true } to bypass it, e.g. for explicit "Refresh" buttons.
const DEFAULT_TTL_MS = 30000;
// Longer for data that changes rarely; every successful write still wipes the whole cache, so a
// change made through this app is visible immediately. Explicit Refresh buttons use forceRefresh.
export function cacheTtlFor(path) {
  // Template list carries 300 s signed artwork URLs: keep it well under that (server 60 s + client 60 s).
  if (path.startsWith('/admin/qr/templates')) return 60 * 1000;
  if (path.startsWith('/admin/')) return 60 * 1000;
  return DEFAULT_TTL_MS;
}
const CACHE_STORAGE_PREFIX = 'solarium:api-cache:';
const getCache = new Map();

function readSharedCacheEntry(path) {
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_PREFIX + path);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.time >= cacheTtlFor(path)) return null;
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

// ---- Session expiry ---------------------------------------------------------------------------
// A signed-in portal page subscribes to be told when the server says the login is gone (it expired,
// was revoked, or the browser dropped the cookie at its Max-Age). Only requireAuth's 401 counts
// (code UNAUTHENTICATED): a wrong password is a 401 with another code, and /auth/session is the
// "am I signed in?" probe that legitimately 401s for someone who never signed in.
// /auth/session is the probe; /auth/logout is what "Sign in again" itself calls, and it must not re-raise the popup.
const SESSION_EXPIRY_IGNORED_PATHS = ['/auth/session', '/auth/logout'];
const sessionExpiredListeners = new Set();

export function subscribeSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired() {
  clearApiCache(); // never let the next person to sign in see the last person's cached data
  sessionExpiredListeners.forEach((listener) => listener());
}

async function apiRequestCore(path, options = {}) {
  const { forceRefresh, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  if (isGet && !forceRefresh) {
    const cached = getCache.get(path) || readSharedCacheEntry(path);
    if (cached && Date.now() - cached.time < cacheTtlFor(path)) {
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
    if (response.status === 401 && error.code === 'UNAUTHENTICATED' && !SESSION_EXPIRY_IGNORED_PATHS.some((prefix) => path.startsWith(prefix))) notifySessionExpired();
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
//   label:     name shown in the progress bar while this request runs.
//   dedupe:    (non-GET) identical requests (same method + path + string body) made while one is still
//              in flight share that one request. Removed as soon as it settles; a finished result is
//              never reused.
//   supersede: (GET) a group name. A newer request in the same group drops an older one that is still
//              WAITING in the queue (it rejects with AbortError). Already-running requests continue.
//   priority:  (GET) skip the queue.
//
// GETs go through a small queue (MAX_CONCURRENT_GETS at a time) so a screen that asks for several
// things does not hit the backend with a burst. Order for a GET: cache -> dedupe -> queue -> fetch.
export const MAX_CONCURRENT_GETS = 2;
const GET_TIMEOUT_MS = 90000; // covers a Render cold start; also frees the queue slot if a request hangs
const PRIORITY_PREFIXES = ['/auth/', '/vendor/login', '/vendor/profile', '/health'];

const getQueue = [];
let runningGets = 0;
const inFlightGets = new Map();
const pendingDedupe = new Map();

function abortError() {
  const error = new Error('Request was replaced by a newer one.');
  error.name = 'AbortError';
  return error;
}

function finishGet() {
  runningGets -= 1;
  pumpGets();
}

function startGet(item) {
  runningGets += 1;
  // finally runs on success, error, abort and timeout alike, so a slot can never leak.
  Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(finishGet);
}

function pumpGets() {
  while (runningGets < MAX_CONCURRENT_GETS && getQueue.length) startGet(getQueue.shift());
}

function enqueueGet(task, group) {
  return new Promise((resolve, reject) => {
    if (group) {
      for (let index = getQueue.length - 1; index >= 0; index -= 1) {
        if (getQueue[index].group === group) getQueue.splice(index, 1)[0].reject(abortError());
      }
    }
    getQueue.push({ task, resolve, reject, group });
    pumpGets();
  });
}

function hasFreshCache(path) {
  const cached = getCache.get(path) || readSharedCacheEntry(path);
  return Boolean(cached && Date.now() - cached.time < cacheTtlFor(path));
}

function getRequest(path, fetchOptions, { supersede, priority }) {
  const forced = Boolean(fetchOptions.forceRefresh);
  // A cache hit needs no network, so it never waits in the queue.
  if (!forced && hasFreshCache(path)) return apiRequestCore(path, fetchOptions);

  // A forced refresh only shares with another forced refresh, never with a (possibly stale) normal one.
  const key = `${forced ? 'F' : 'N'} ${path}`;
  if (inFlightGets.has(key)) return inFlightGets.get(key);

  const run = () => apiRequestCore(path, { signal: AbortSignal.timeout(GET_TIMEOUT_MS), ...fetchOptions }).catch((error) => {
    if (error?.name === 'TimeoutError') throw new Error('The server took too long to respond. Try again.');
    throw error;
  });
  const skipQueue = priority || PRIORITY_PREFIXES.some((prefix) => path.startsWith(prefix));
  const promise = skipQueue ? run() : enqueueGet(run, supersede);
  inFlightGets.set(key, promise);
  const clear = () => { if (inFlightGets.get(key) === promise) inFlightGets.delete(key); };
  promise.then(clear, clear);
  return promise;
}

export function apiRequest(path, options = {}) {
  const { label, dedupe, supersede, priority, ...rest } = options;
  const isGet = (rest.method || 'GET').toUpperCase() === 'GET';
  const start = () => {
    const work = () => (isGet ? getRequest(path, rest, { supersede, priority }) : apiRequestCore(path, rest));
    return label ? trackOperation(label, work) : work();
  };
  if (isGet || !dedupe || typeof rest.body !== 'string') return start();

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
