import test from 'node:test';
import assert from 'node:assert/strict';
import { isCustomerIdentityRace, leadImportBatchSchema, prepareLeadRows } from '../src/lib/lead-import.js';
import { BULK_BODY_LIMIT_BYTES, LEAD_FIELD_MAX, MAX_LEAD_BATCH_ROWS, VENDOR_ROW_FIELD_MAX } from '../src/lib/bulk-limits.js';

const billBands = ['1-2k', '2-3k'];
const solarSizeBands = ['1-2 kW', '2-3 kW'];
const prep = (records, rowOffset = 0) => prepareLeadRows(records, { rowOffset, hashFor: (phone) => `hash-${phone}`, billBands, solarSizeBands });
const lead = (index, extra = {}) => ({ customer_name: `Customer ${index}`, phone: String(9000000000 + index), ...extra });

// ---- row numbers: header = row 1, first data row = row 2 --------------------------------------
test('row numbers: batch 1 reports 2-101, batch 2 (offset 100) reports 102-201', () => {
	const batch = Array.from({ length: 100 }, (_, index) => lead(index));
	const first = prep(batch, 0);
	assert.deepEqual([first.valid[0].row, first.valid[99].row], [2, 101]);
	const second = prep(batch, 100);
	assert.deepEqual([second.valid[0].row, second.valid[99].row], [102, 201]);
});

test('row numbers apply to invalid and duplicate rows too', () => {
	const result = prep([lead(1), { customer_name: 'X', phone: '9000000002' }, lead(1)], 100);
	assert.deepEqual(result.invalid, [{ row: 103, reason: 'Missing or invalid customer name / phone number.' }]);
	assert.deepEqual(result.duplicates, [{ row: 104, phone: '9000000001' }]);
});

// ---- first occurrence wins, and every row lands in exactly one bucket -------------------------
test('duplicate phone inside a batch: the FIRST occurrence is eligible, later ones are duplicates', () => {
	const result = prep([lead(5, { customer_name: 'First' }), lead(6), lead(5, { customer_name: 'Second' })]);
	assert.deepEqual(result.valid.map((row) => [row.row, row.customerName]), [[2, 'First'], [3, 'Customer 6']]);
	assert.deepEqual(result.duplicates, [{ row: 4, phone: '9000000005' }]);
});

test('valid + invalid + duplicates always equals the input rows', () => {
	const records = [
		lead(1), lead(2), lead(1),
		{ customer_name: 'Bad Phone', phone: '12345' },
		{ customer_name: '', phone: '9000000009' },
		{ customer_name: 'No Phone' },
		lead(3, { phone: '+91 90000 00003' }),
	];
	const result = prep(records);
	assert.equal(result.valid.length + result.invalid.length + result.duplicates.length, records.length);
	// +91 formatted number normalizes to the bare 10 digits
	assert.ok(result.valid.some((row) => row.phone === '9000000003'));
});

// ---- field normalization (unchanged behavior, moved out of admin.js) --------------------------
test('aliases, bands, status and created_at are normalized as before', () => {
	const result = prep([
		{ name: 'Alias Name', mobile: '9000000001', average_electricity_bill: '2-3K', solar_size: '1-2 KW', status: 'converted', date: '2026-01-15' },
		{ customer_name: 'Plain', phone: '9000000002', average_electricity_bill: 'nonsense', status: 'weird', created_at: 'not a date' },
	]);
	const [aliased, plain] = result.valid;
	assert.equal(aliased.customerName, 'Alias Name');
	assert.equal(aliased.averageElectricityBill, '2-3k');
	assert.equal(aliased.solarSize, '1-2 kW');
	assert.equal(aliased.status, 'CONVERTED');
	assert.equal(aliased.createdAt.toISOString().slice(0, 10), '2026-01-15');
	assert.equal(plain.averageElectricityBill, null);
	assert.equal(plain.status, 'NEW');
	assert.ok(plain.createdAt instanceof Date && !Number.isNaN(plain.createdAt.getTime()));
});

// ---- race retry is only for the customer-identity uniqueness -----------------------------------
test('isCustomerIdentityRace: only P2002 on the customer hash / lead identity constraint', () => {
	assert.equal(isCustomerIdentityRace({ code: 'P2002', meta: { target: ['customer_hash'] } }), true);
	assert.equal(isCustomerIdentityRace({ code: 'P2002', meta: { target: 'customer_identities_customer_hash_key' } }), true);
	assert.equal(isCustomerIdentityRace({ code: 'P2002', meta: { target: ['customer_identity_id'] } }), true);
	assert.equal(isCustomerIdentityRace({ code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { fields: ['"customer_hash"'] } } } } }), true);
});

test('isCustomerIdentityRace: any other unique violation, error or unknown shape is NOT retried', () => {
	assert.equal(isCustomerIdentityRace({ code: 'P2002', meta: { target: ['login_identifier'] } }), false);
	assert.equal(isCustomerIdentityRace({ code: 'P2002', meta: { target: ['lead_id'] } }), false);
	assert.equal(isCustomerIdentityRace({ code: 'P2002' }), false);
	assert.equal(isCustomerIdentityRace({ code: 'P2003', meta: { target: ['customer_hash'] } }), false);
	assert.equal(isCustomerIdentityRace(new Error('boom')), false);
	assert.equal(isCustomerIdentityRace(null), false);
	assert.equal(isCustomerIdentityRace(undefined), false);
});

// ---- request schema: server-side caps never rely on the UI -------------------------------------
test('import-batch schema: max 100 rows, per-field max lengths, row_offset defaults to 0', () => {
	assert.equal(MAX_LEAD_BATCH_ROWS, 100);
	const rows = (count) => Array.from({ length: count }, (_, index) => lead(index));
	assert.equal(leadImportBatchSchema.parse({ rows: rows(100) }).row_offset, 0);
	assert.equal(leadImportBatchSchema.safeParse({ rows: rows(101) }).success, false);
	assert.equal(leadImportBatchSchema.safeParse({ rows: [] }).success, false);
	assert.equal(leadImportBatchSchema.safeParse({ rows: rows(50000) }).success, false);
	assert.equal(leadImportBatchSchema.safeParse({ rows: [{ customer_name: 'x'.repeat(LEAD_FIELD_MAX.customer_name + 1), phone: '9000000001' }] }).success, false);
	assert.equal(leadImportBatchSchema.safeParse({ rows: rows(1), row_offset: -1 }).success, false);
	assert.deepEqual(Object.keys(leadImportBatchSchema.parse({ rows: [{ ...lead(1), injected: 'x' }] }).rows[0]).sort(), ['customer_name', 'phone']);
});

// ---- body limit is computed, not guessed --------------------------------------------------------
// Worst case: every field at its max length, every character a control character (6 bytes once
// JSON-escaped as \u00XX). The limit mounted in app.js must exceed it, or the parser could reject a
// body that validation would have accepted.
test('worst-case lead batch (100 rows, all fields at max) fits under the body limit AND passes the schema', () => {
	const worstRow = Object.fromEntries(Object.entries(LEAD_FIELD_MAX).map(([field, max]) => [field, '\u0001'.repeat(max)]));
	const body = { rows: Array.from({ length: MAX_LEAD_BATCH_ROWS }, () => worstRow), row_offset: 1_000_000 };
	const bytes = Buffer.byteLength(JSON.stringify(body));
	assert.ok(bytes < BULK_BODY_LIMIT_BYTES, `${bytes} bytes >= limit ${BULK_BODY_LIMIT_BYTES}`);
	assert.equal(leadImportBatchSchema.safeParse(body).success, true);
});

test('worst-case Solar Mitra batch (50 rows, all fields at max) fits under the body limit', () => {
	const VENDOR_BATCH_SIZE = 50; // keep in sync with frontend/src/lib/batch-upload.js
	const worstRow = Object.fromEntries(Object.entries(VENDOR_ROW_FIELD_MAX).map(([field, max]) => [field, '\u0001'.repeat(max)]));
	const bytes = Buffer.byteLength(JSON.stringify({ rows: Array.from({ length: VENDOR_BATCH_SIZE }, () => worstRow), state: 'Himachal Pradesh' }));
	assert.ok(bytes < BULK_BODY_LIMIT_BYTES, `${bytes} bytes >= limit ${BULK_BODY_LIMIT_BYTES}`);
});
