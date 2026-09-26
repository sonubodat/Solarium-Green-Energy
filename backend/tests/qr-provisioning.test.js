import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	AUTO_CREATED_ASSIGNMENT_WHERE,
	POSTER_PRODUCED_JOB_STATUSES,
	QR_NUMBERING_LOCK_KEY,
	REPLACEABLE_AUTO_ASSIGNMENT_WHERE,
	SENTINEL_VENDOR_LOGINS,
	VENDOR_WITHOUT_LOCKED_QR_WHERE,
	formatQrCode,
	isAutoCreatedQrAssignment,
	isReplaceableAutoQr,
	sortedVendorLockIds,
	vendorQrLockKey,
} from '../src/lib/qr-provisioning.js';

const assignment = (overrides = {}) => ({
	assignedById: null,
	vendor: { loginIdentifier: '9876543210' },
	qrCode: { code: 'V-1148', _count: { scans: 0, leads: 0, printJobItems: 0 } },
	...overrides,
});

test('formatQrCode: zero-padded to 4 digits, wider numbers are not truncated', () => {
	assert.equal(formatQrCode(1), 'V-0001');
	assert.equal(formatQrCode(1148), 'V-1148');
	assert.equal(formatQrCode(10000), 'V-10000');
});

test('lock keys are namespaced per purpose and per vendor', () => {
	assert.equal(QR_NUMBERING_LOCK_KEY, 'solar-mitra-qr-numbering');
	assert.equal(vendorQrLockKey('abc'), 'solar-mitra-qr-vendor:abc');
	assert.notEqual(vendorQrLockKey('a'), vendorQrLockKey('b'));
	assert.notEqual(vendorQrLockKey('numbering'), QR_NUMBERING_LOCK_KEY);
});

test('sortedVendorLockIds: de-duplicated, ignores empty ids, deterministic order', () => {
	assert.deepEqual(sortedVendorLockIds(['b', 'a', 'b', null, undefined, '']), ['a', 'b']);
	assert.deepEqual(sortedVendorLockIds(['a', 'b']), sortedVendorLockIds(['b', 'a']));
	assert.deepEqual(sortedVendorLockIds([undefined]), []);
});

test('isAutoCreatedQrAssignment: only a null assigner on a real vendor\'s V-#### code', () => {
	assert.equal(isAutoCreatedQrAssignment(assignment()), true);
	// A staff member assigned it: manual.
	assert.equal(isAutoCreatedQrAssignment(assignment({ assignedById: 'staff-1' })), false);
	// An empty string is NOT "no assigner": never treated as automatic.
	assert.equal(isAutoCreatedQrAssignment(assignment({ assignedById: '' })), false);
	// System vendors are never automatic Solar Mitra QRs.
	for (const login of SENTINEL_VENDOR_LOGINS) {
		assert.equal(isAutoCreatedQrAssignment(assignment({ vendor: { loginIdentifier: login } })), false, login);
	}
	assert.equal(isAutoCreatedQrAssignment(assignment({ qrCode: { code: 'COMPANY-IMPORT', _count: { scans: 0, leads: 0, printJobItems: 0 } } })), false);
	assert.equal(isAutoCreatedQrAssignment(null), false);
	assert.equal(isAutoCreatedQrAssignment(undefined), false);
});

test('isReplaceableAutoQr: automatic AND zero scans AND zero leads AND no produced poster', () => {
	assert.equal(isReplaceableAutoQr(assignment()), true);
	assert.equal(isReplaceableAutoQr(assignment({ qrCode: { code: 'V-1148', _count: { scans: 1, leads: 0, printJobItems: 0 } } })), false);
	assert.equal(isReplaceableAutoQr(assignment({ qrCode: { code: 'V-1148', _count: { scans: 0, leads: 1, printJobItems: 0 } } })), false);
	assert.equal(isReplaceableAutoQr(assignment({ qrCode: { code: 'V-1148', _count: { scans: 3, leads: 2, printJobItems: 0 } } })), false);
	// A produced poster makes it "used" like a printed sticker.
	assert.equal(isReplaceableAutoQr(assignment({ qrCode: { code: 'V-1148', _count: { scans: 0, leads: 0, printJobItems: 1 } } })), false);
	// Manual QR is never replaceable, however unused.
	assert.equal(isReplaceableAutoQr(assignment({ assignedById: 'staff-1' })), false);
	// Missing counts are not proof of "unused".
	assert.equal(isReplaceableAutoQr(assignment({ qrCode: { code: 'V-1148' } })), false);
	assert.equal(isReplaceableAutoQr(null), false);
});

test('the picker where-clause encodes the same definition as the predicate', () => {
	assert.deepEqual(REPLACEABLE_AUTO_ASSIGNMENT_WHERE, {
		assignedById: null,
		vendor: { loginIdentifier: { notIn: SENTINEL_VENDOR_LOGINS } },
		qrCode: {
			code: { startsWith: 'V-' },
			scans: { none: {} },
			leads: { none: {} },
			printJobItems: { none: { printJob: { status: { in: POSTER_PRODUCED_JOB_STATUSES } } } },
		},
	});
	assert.deepEqual(POSTER_PRODUCED_JOB_STATUSES, ['APPROVED', 'GENERATING', 'COMPLETED']);
	assert.deepEqual(AUTO_CREATED_ASSIGNMENT_WHERE.qrCode, { code: { startsWith: 'V-' } });
	// "no active QR that is NOT replaceable": vendors with none, or only a replaceable automatic one.
	assert.deepEqual(VENDOR_WITHOUT_LOCKED_QR_WHERE, {
		assignments: { none: { unassignedAt: null, NOT: REPLACEABLE_AUTO_ASSIGNMENT_WHERE } },
	});
});

test('lock order in services/qr.js: the vendor lock is always taken before the numbering lock', () => {
	const source = fs.readFileSync(fileURLToPath(new URL('../src/services/qr.js', import.meta.url)), 'utf8');
	const body = source.slice(source.indexOf('async function provisionVendorQr'), source.indexOf('// A burst of first logins'));
	assert.ok(body.indexOf('lockVendorsQr(') !== -1 && body.indexOf('lockQrNumbering(') !== -1);
	assert.ok(body.indexOf('lockVendorsQr(') < body.indexOf('lockQrNumbering('), 'provisioning must lock the vendor first');
	// Admin bulk generation takes only the numbering lock (it touches no vendor).
	const generate = source.slice(source.indexOf('export async function generateQrCodes'), source.indexOf('export async function generateSpecificQrCodes'));
	assert.ok(generate.includes('lockQrNumbering(') && !generate.includes('lockVendorsQr('));
	// Automatic provisioning must never assign or modify an existing QR: it only ever calls qrCode.create.
	assert.ok(!body.includes('qrCode.update') && !body.includes('qrCode.updateMany') && !body.includes('UNASSIGNED'));
});
