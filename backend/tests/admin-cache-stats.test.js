import test from 'node:test';
import assert from 'node:assert/strict';
import { cached, invalidateResponseCache, invalidateAfterWrites, CACHE_KEYS } from '../src/lib/response-cache.js';
import { computeDashboardCounts, computeQrSummary } from '../src/lib/admin-stats.js';
import { pagination } from '../src/lib/pagination.js';
import { EventEmitter } from 'node:events';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- response cache -------------------------------------------------------------------------
test('cache: reuses within TTL, expires, and invalidate clears', async () => {
	invalidateResponseCache();
	let runs = 0;
	const compute = async () => { runs += 1; return runs; };
	assert.equal(await cached('a', 30, compute), 1);
	assert.equal(await cached('a', 30, compute), 1);
	await sleep(40);
	assert.equal(await cached('a', 30, compute), 2);
	invalidateResponseCache();
	assert.equal(await cached('a', 30, compute), 3);
});

test('cache: keys never leak into each other', async () => {
	invalidateResponseCache();
	assert.equal(await cached(CACHE_KEYS.dashboard, 1000, async () => 'd'), 'd');
	assert.equal(await cached(CACHE_KEYS.qrSummary, 1000, async () => 's'), 's');
	assert.equal(await cached(CACHE_KEYS.dashboard, 1000, async () => 'x'), 'd');
});

test('cache: a write during computation is not cached afterwards', async () => {
	invalidateResponseCache();
	let runs = 0;
	const slow = async () => { runs += 1; await sleep(20); return runs; };
	const first = cached('race', 1000, slow);
	invalidateResponseCache();
	assert.equal(await first, 1);
	assert.equal(await cached('race', 1000, slow), 2);
});

function fakeResponse(statusCode) {
	const response = new EventEmitter();
	response.statusCode = statusCode;
	return response;
}

test('middleware: successful write clears, failed write and GET do not', async () => {
	const fill = () => cached('m', 100000, async () => Math.random());
	invalidateResponseCache();
	let value = await fill();

	const failed = fakeResponse(500);
	invalidateAfterWrites({ method: 'POST' }, failed, () => {});
	failed.emit('finish');
	assert.equal(await fill(), value);

	const read = fakeResponse(200);
	invalidateAfterWrites({ method: 'GET' }, read, () => {});
	read.emit('finish');
	assert.equal(await fill(), value);

	const ok = fakeResponse(201);
	invalidateAfterWrites({ method: 'POST' }, ok, () => {});
	ok.emit('finish');
	assert.notEqual(await fill(), value);
});

// ---- dashboard / summary against a stubbed prisma ------------------------------------------
function stubDb({ vendors = [], qr = [], leads = [], payouts = [], assigned = 0, unassigned = 0, scans = 0, customers = 0, scanLinked = 0 }) {
	const groups = (rows) => async () => rows.map(([status, n]) => ({ status, _count: { _all: n } }));
	return {
		vendor: { groupBy: groups(vendors) },
		qrCode: {
			groupBy: groups(qr),
			count: async (args) => {
				if (!args) return qr.reduce((t, [, n]) => t + n, 0);
				return args.where.assignments.some ? assigned : unassigned;
			},
		},
		lead: { groupBy: groups(leads), count: async () => scanLinked },
		payout: { groupBy: groups(payouts) },
		scan: { count: async () => scans },
		customerIdentity: { count: async () => customers },
	};
}

test('dashboard: every legacy field is present and mapped like the old counts', async () => {
	const db = stubDb({
		vendors: [['ACTIVE', 7], ['INACTIVE', 2], ['DELETED', 5]],
		qr: [['UNASSIGNED', 30], ['ACTIVE', 70]],
		leads: [['NEW', 4], ['QUALIFIED', 3], ['CONVERTED', 2], ['LOST', 1]],
		payouts: [['UNPAID', 2], ['PARTIAL', 1], ['PAID', 4]],
		assigned: 70, scans: 50, customers: 20, scanLinked: 8,
	});
	const out = await computeDashboardCounts(db);
	assert.deepEqual(
		{ ...out },
		{
			totalVendors: 9, activeVendors: 7, totalQrCodes: 100, unassignedQrCodes: 30, totalScans: 50, uniqueCustomers: 20,
			totalLeads: 10, qualifiedLeads: 3, convertedLeads: 2, pendingCommission: 3, paidCommission: 4,
			assignedQrCodes: 70, scanLinkedLeads: 8, qrStatusMismatch: false,
		},
	);
});

test('dashboard: empty database gives zeros, no NaN, no mismatch', async () => {
	const out = await computeDashboardCounts(stubDb({}));
	for (const [key, value] of Object.entries(out)) assert.ok(value === 0 || value === false, `${key}=${value}`);
});

test('dashboard: flags a status-vs-assignment mismatch instead of hiding it', async () => {
	const out = await computeDashboardCounts(stubDb({ qr: [['UNASSIGNED', 10], ['ACTIVE', 5]], assigned: 4 }));
	assert.equal(out.qrStatusMismatch, true);
});

test('qr summary: whole inventory, consistent when assigned + unassigned = total', async () => {
	const ok = await computeQrSummary(stubDb({ qr: [['UNASSIGNED', 60], ['ACTIVE', 40]], assigned: 40, unassigned: 60 }));
	assert.deepEqual(ok, { total: 100, assigned: 40, unassigned: 60, consistent: true });
	const warned = [];
	const bad = await computeQrSummary(stubDb({ qr: [['UNASSIGNED', 60]], assigned: 40, unassigned: 30 }), { warn: (m) => warned.push(m) });
	assert.equal(bad.consistent, false);
	assert.equal(warned.length, 1);
});

// ---- pagination ----------------------------------------------------------------------------
test('pagination: 50/100/200 accepted, 201 clamps, bad values fall back', () => {
	const at = (limit, max) => pagination({ limit }, max).limit;
	assert.equal(at('50', 200), 50);
	assert.equal(at('100', 200), 100);
	assert.equal(at('200', 200), 200);
	assert.equal(at('201', 200), 200);
	assert.equal(at('0', 200), 50);
	assert.equal(at('abc', 200), 50);
	assert.equal(at(undefined, 200), 50);
	assert.equal(at('200', undefined), 100); // routes that did not opt in stay at 100
	assert.deepEqual(pagination({ page: '3', limit: '100' }, 200), { page: 3, limit: 100, skip: 200 });
});

import { cached as cachedForMisses, invalidateResponseCache as clearForMisses } from '../src/lib/response-cache.js';
test('cached(): a miss (null) is never kept, and a write clears hits', async () => {
	clearForMisses();
	let calls = 0;
	await cachedForMisses('k-miss', 60000, async () => { calls += 1; return null; });
	await cachedForMisses('k-miss', 60000, async () => { calls += 1; return null; });
	assert.equal(calls, 2);
	await cachedForMisses('k-hit', 60000, async () => { calls += 1; return { a: 1 }; });
	await cachedForMisses('k-hit', 60000, async () => { calls += 1; return { a: 1 }; });
	assert.equal(calls, 3);
	clearForMisses();
	await cachedForMisses('k-hit', 60000, async () => { calls += 1; return { a: 1 }; });
	assert.equal(calls, 4);
});
