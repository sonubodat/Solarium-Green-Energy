// Tiny in-process response cache for a few expensive, read-mostly admin responses.
// Only explicit constant keys are used (never request-derived ones), so a filter or page can never
// be served another request's data. Every successful write anywhere in the API clears it.
// ponytail: per process (one Render instance); several instances would need a shared cache.
export const CACHE_KEYS = { dashboard: 'dashboard', qrSummary: 'qr-summary', qrTemplates: 'qr-templates' };

const MAX_ENTRIES = 500;
const store = new Map(); // key -> { value, expires }
const computing = new Map(); // key -> promise (share one computation)
let generation = 0;

export async function cached(key, ttlMs, compute) {
	const hit = store.get(key);
	if (hit && hit.expires > Date.now()) return hit.value;
	if (computing.has(key)) return computing.get(key);

	const startedIn = generation;
	const run = (async () => {
		const value = await compute();
		// A write happened while computing: hand the value to this caller but do not keep it.
		// Misses (null) are never kept, and the store is bounded, so request-derived keys (public QR codes) cannot grow it.
		if (startedIn === generation && value != null) {
			if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
			store.set(key, { value, expires: Date.now() + ttlMs });
		}
		return value;
	})();
	computing.set(key, run);
	run.then(() => computing.delete(key), () => computing.delete(key));
	return run;
}

export function invalidateResponseCache() {
	generation += 1;
	store.clear();
	computing.clear();
}

import { clearSessionCache } from './session-cache.js';

// Express middleware: clears the cache after any non-GET request that finished successfully.
// Failed requests (status >= 400) leave it alone.
export function invalidateAfterWrites(request, response, next) {
	if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
		response.on('finish', () => {
			if (response.statusCode < 400) {
				invalidateResponseCache();
				clearSessionCache(); // a login, logout, deactivation or role change must apply on the very next request
			}
		});
	}
	next();
}
