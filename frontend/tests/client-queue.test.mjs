// Run: node --test frontend/tests/client-queue.test.mjs   (no browser, no backend: fetch is stubbed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = path.join(os.tmpdir(), `client-under-test-${process.pid}.mjs`);
fs.copyFileSync(path.join(here, '../src/api/client.js'), copy); // .js is CommonJS here; .mjs loads as ESM

// Own enumerable keys, like a real localStorage (the client clears its cache via Object.keys()).
class FakeStorage {
	getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
	setItem(key, value) { this[key] = String(value); }
	removeItem(key) { delete this[key]; }
}
const storage = new FakeStorage();
globalThis.window = { localStorage: storage };
globalThis.FormData = class {};

let log = [];
let active = 0;
let peak = 0;
let behaviour = () => ({ status: 200, body: { ok: true } });
globalThis.fetch = async (url, options) => {
	const p = String(url).replace('/api', '');
	active += 1; peak = Math.max(peak, active);
	log.push(p);
	try {
		await new Promise((resolve) => setTimeout(resolve, 15));
		const { status, body } = behaviour(p, options);
		return new Response(JSON.stringify(body), { status });
	} finally { active -= 1; }
};
const client = await import(pathToFileURL(copy).href);
const stubFetch = globalThis.fetch;
const reset = () => { log = []; peak = 0; globalThis.fetch = stubFetch; Object.keys(storage).forEach((key) => delete storage[key]); client.clearApiCache(); behaviour = () => ({ status: 200, body: { ok: true } }); };

test('never more than 2 GETs in flight; all complete', async () => {
	reset();
	await Promise.all(['/a', '/b', '/c', '/d', '/e'].map((p) => client.apiRequest(p, { forceRefresh: true })));
	assert.equal(log.length, 5);
	assert.ok(peak <= 2, `peak was ${peak}`);
});

test('a rejected request frees its slot and the next one runs', async () => {
	reset();
	behaviour = (p) => (p === '/bad' ? { status: 500, body: { error: { message: 'boom' } } } : { status: 200, body: { ok: 1 } });
	const results = await Promise.allSettled(['/bad', '/bad2', '/x', '/y'].map((p) => client.apiRequest(p, { forceRefresh: true })));
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
	assert.equal(results[0].status, 'rejected');
});

test('identical in-flight GETs dedupe before queueing (one fetch)', async () => {
	reset();
	const [a, b, c] = await Promise.all([client.apiRequest('/same'), client.apiRequest('/same'), client.apiRequest('/same')]);
	assert.equal(log.filter((p) => p === '/same').length, 1);
	assert.deepEqual([a, b], [c, c]);
});

test('forceRefresh never reuses a normal in-flight request, but shares with another forced one', async () => {
	reset();
	await Promise.all([client.apiRequest('/p'), client.apiRequest('/p', { forceRefresh: true }), client.apiRequest('/p', { forceRefresh: true })]);
	assert.equal(log.filter((p) => p === '/p').length, 2);
});

test('cache: second GET within TTL makes no request; different queries never share', async () => {
	reset();
	await client.apiRequest('/admin/qr?page=1&limit=50');
	await client.apiRequest('/admin/qr?page=1&limit=50');
	assert.equal(log.length, 1);
	await client.apiRequest('/admin/qr?page=1&limit=100');
	assert.equal(log.length, 2);
});

test('a successful write wipes the cache; a failed write does not', async () => {
	reset();
	await client.apiRequest('/admin/qr?page=1');
	behaviour = () => ({ status: 500, body: { error: { message: 'x' } } });
	await assert.rejects(client.apiRequest('/admin/qr/generate', { method: 'POST', body: '{}' }));
	behaviour = () => ({ status: 200, body: { ok: true } });
	await client.apiRequest('/admin/qr?page=1');
	assert.equal(log.filter((p) => p === '/admin/qr?page=1').length, 1, 'failed write must not clear the cache');
	await client.apiRequest('/admin/qr/generate', { method: 'POST', body: '{}' });
	await client.apiRequest('/admin/qr?page=1');
	assert.equal(log.filter((p) => p === '/admin/qr?page=1').length, 2, 'successful write must clear it');
});

test('per-path TTLs', () => {
	assert.equal(client.cacheTtlFor('/admin/qr/templates'), 60000);
	assert.equal(client.cacheTtlFor('/admin/dashboard'), 60000);
	assert.equal(client.cacheTtlFor('/vendor/leads'), 30000);
});

test('supersede drops a still-queued older request, running ones continue', async () => {
	reset();
	const results = await Promise.allSettled([
		client.apiRequest('/r1', { forceRefresh: true }),
		client.apiRequest('/r2', { forceRefresh: true }),
		client.apiRequest('/list-old', { forceRefresh: true, supersede: 'admin-list' }),
		client.apiRequest('/list-new', { forceRefresh: true, supersede: 'admin-list' }),
	]);
	assert.equal(results[2].status, 'rejected');
	assert.equal(results[2].reason.name, 'AbortError');
	assert.equal(results[3].status, 'fulfilled');
	assert.ok(!log.includes('/list-old'));
});

test('priority paths skip a full queue', async () => {
	reset();
	const order = [];
	const slow = ['/s1', '/s2', '/s3'].map((p) => client.apiRequest(p, { forceRefresh: true }).then(() => order.push(p)));
	const health = client.apiRequest('/health', { forceRefresh: true }).then(() => order.push('/health'));
	await Promise.all([...slow, health]);
	assert.ok(order.indexOf('/health') < order.indexOf('/s3'));
});

test('a hung request times out, frees its slot, and the queue keeps moving', async () => {
	reset();
	const realTimeout = AbortSignal.timeout;
	AbortSignal.timeout = () => AbortSignal.abort(new DOMException('t', 'TimeoutError'));
	globalThis.fetch = async (url, options) => { if (options?.signal?.aborted) throw options.signal.reason; return new Response('{}'); };
	await assert.rejects(client.apiRequest('/hung', { forceRefresh: true }), /took too long/);
	AbortSignal.timeout = realTimeout;
	globalThis.fetch = async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 });
	assert.deepEqual(await client.apiRequest('/after', { forceRefresh: true }), { ok: 1 });
});

test('labelled tracking clears after success and failure', async () => {
	reset();
	behaviour = () => ({ status: 500, body: { error: { message: 'x' } } });
	await assert.rejects(client.apiRequest('/t', { method: 'POST', body: '{}', label: 'Working' }));
	assert.equal(client.getActivitySnapshot().length, 0);
});

// ---- session expiry popup trigger -------------------------------------------------------------
const unauthenticated = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Session is invalid or expired.' } } };

test('session expiry: a requireAuth 401 notifies subscribers and clears the cached data', async () => {
	reset();
	await client.apiRequest('/admin/qr?page=1'); // cached
	assert.equal(log.length, 1);
	let notified = 0;
	const unsubscribe = client.subscribeSessionExpired(() => { notified += 1; });
	behaviour = () => unauthenticated;
	await assert.rejects(client.apiRequest('/admin/leads?page=1', { forceRefresh: true }), /invalid or expired/);
	assert.equal(notified, 1);
	behaviour = () => ({ status: 200, body: { ok: true } });
	await client.apiRequest('/admin/qr?page=1'); // cache was wiped, so this hits the network again
	assert.equal(log.filter((p) => p === '/admin/qr?page=1').length, 2);
	unsubscribe();
	behaviour = () => unauthenticated;
	await assert.rejects(client.apiRequest('/admin/leads?page=2', { forceRefresh: true }));
	assert.equal(notified, 1); // unsubscribed
});

test('session expiry: wrong password, the /auth/session probe and /auth/logout never notify', async () => {
	reset();
	let notified = 0;
	const unsubscribe = client.subscribeSessionExpired(() => { notified += 1; });
	behaviour = () => ({ status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' } } });
	await assert.rejects(client.apiRequest('/auth/login?portal=admin', { method: 'POST', body: '{}' }));
	behaviour = () => unauthenticated;
	await assert.rejects(client.apiRequest('/auth/session?portal=admin', { forceRefresh: true }));
	await assert.rejects(client.apiRequest('/auth/logout?portal=admin', { method: 'POST' }));
	behaviour = () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'no' } } });
	await assert.rejects(client.apiRequest('/admin/x', { forceRefresh: true }));
	behaviour = () => ({ status: 500, body: { error: { message: 'boom' } } });
	await assert.rejects(client.apiRequest('/admin/y', { forceRefresh: true }));
	assert.equal(notified, 0);
	unsubscribe();
});

test('session expiry: every subscriber is told, and a write that gets a 401 notifies too', async () => {
	reset();
	const seen = [];
	const off = [client.subscribeSessionExpired(() => seen.push('a')), client.subscribeSessionExpired(() => seen.push('b'))];
	behaviour = () => unauthenticated;
	await assert.rejects(client.apiRequest('/admin/vendors/bulk-create', { method: 'POST', body: '{}' }));
	assert.deepEqual(seen, ['a', 'b']);
	off.forEach((fn) => fn());
});
