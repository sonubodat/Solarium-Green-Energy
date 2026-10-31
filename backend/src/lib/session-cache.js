// Tiny in-process cache for the session lookup that requireAuth does on EVERY request (session + user + role, or
// vendor). On a distant database that one query is most of a request's cost. Safety rules:
//  - entries live SESSION_CACHE_TTL_MS (30 s), and a hit is still checked against the session's expiry time;
//  - ANY successful write through the API (login, logout, deactivate, role change, password change ...) clears the
//    whole cache (see invalidateAfterWrites in lib/response-cache.js), so a revocation applies on the next request;
//  - a lookup that started before a clear is never stored (generation counter);
//  - bounded size, oldest entry dropped first.
// ponytail: per process (one instance); several instances would need a shared cache or a shorter TTL.
const SESSION_CACHE_TTL_MS = 30 * 1000;
const MAX_ENTRIES = 500;

const store = new Map(); // tokenHash -> { session, storedAt }
let generation = 0;

export function currentSessionGeneration() {
	return generation;
}

export function getCachedSession(tokenHash) {
	const hit = store.get(tokenHash);
	if (!hit) return null;
	if (Date.now() - hit.storedAt > SESSION_CACHE_TTL_MS || hit.session.expiresAt <= new Date()) {
		store.delete(tokenHash);
		return null;
	}
	return hit.session;
}

export function putCachedSession(tokenHash, session, startedInGeneration) {
	if (startedInGeneration !== generation) return;
	if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
	store.set(tokenHash, { session, storedAt: Date.now() });
}

export function clearSessionCache() {
	generation += 1;
	store.clear();
}
