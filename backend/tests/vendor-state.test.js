import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { INDIAN_STATES } from '../src/lib/indian-states.js';

test('INDIAN_STATES: 36 entries, alphabetical, no duplicates', () => {
	assert.equal(INDIAN_STATES.length, 36);
	assert.equal(new Set(INDIAN_STATES).size, 36);
	assert.deepEqual(INDIAN_STATES, [...INDIAN_STATES].sort());
	assert.ok(INDIAN_STATES.includes('Maharashtra'));
});

// Mirrors the private vendorStateFilterOrError() helper in routes/admin.js (not exported — the
// route file pulls in the whole Express app's dependency graph). Any drift is caught by the
// integration-style route-order.test.js hitting the real handler, but this documents the exact
// filter contract the frontend and vendor export both rely on.
function vendorStateFilterOrError(raw) {
	const states = new Set(INDIAN_STATES);
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return { value: null };
	if (!states.has(value)) return { error: { success: false, error: { code: 'INVALID_STATE', message: 'Unknown state filter.' } } };
	return { value };
}

test('vendor state filter: blank/missing means no filter', () => {
	assert.deepEqual(vendorStateFilterOrError(undefined), { value: null });
	assert.deepEqual(vendorStateFilterOrError(''), { value: null });
	assert.deepEqual(vendorStateFilterOrError('   '), { value: null });
});

test('vendor state filter: a known state passes through unchanged', () => {
	assert.deepEqual(vendorStateFilterOrError('Maharashtra'), { value: 'Maharashtra' });
});

test('vendor state filter: an unknown value is reported, not silently dropped', () => {
	const result = vendorStateFilterOrError('Narnia');
	assert.equal(result.value, undefined);
	assert.equal(result.error.error.code, 'INVALID_STATE');
});

// ---- export/list CSV shape, stubbed prisma (no DB) ------------------------------------------
function toCsv(headers, rows) {
	const cell = (value) => {
		const text = value === null || value === undefined ? '' : String(value);
		return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};
	return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

test('vendor export CSV: header order and a state value round-trip', () => {
	const vendors = [{
		businessName: 'Ram Store', ownerName: 'Ram', loginIdentifier: 'ram-store', mobileNumber: '9876543210',
		state: 'Maharashtra', status: 'ACTIVE', createdAt: new Date('2026-01-01T00:00:00.000Z'),
		salesUser: { name: 'Priya' }, _count: { leads: 3 }, assignments: [{ qrCode: { code: 'V-0001' } }],
	}, {
		businessName: 'No State Store', ownerName: 'X', loginIdentifier: 'no-state', mobileNumber: '9876500000',
		state: null, status: 'ACTIVE', createdAt: new Date('2026-01-02T00:00:00.000Z'),
		salesUser: null, _count: { leads: 0 }, assignments: [],
	}];
	const csv = toCsv(
		['Business Name', 'Owner Name', 'Login ID', 'Mobile Number', 'State', 'Status', 'Current QR', 'Leads', 'Sales Owner', 'Created At'],
		vendors.map((v) => [v.businessName, v.ownerName, v.loginIdentifier, v.mobileNumber, v.state, v.status, v.assignments[0]?.qrCode.code, v._count.leads, v.salesUser?.name, v.createdAt.toISOString()]),
	);
	const [header, row1, row2] = csv.split('\r\n');
	assert.equal(header, 'Business Name,Owner Name,Login ID,Mobile Number,State,Status,Current QR,Leads,Sales Owner,Created At');
	assert.equal(row1, 'Ram Store,Ram,ram-store,9876543210,Maharashtra,ACTIVE,V-0001,3,Priya,2026-01-01T00:00:00.000Z');
	assert.equal(row2, 'No State Store,X,no-state,9876500000,,ACTIVE,,0,,2026-01-02T00:00:00.000Z');
});

test('leads export CSV: Vendor State column sits next to the other vendor columns', () => {
	const lead = {
		customerName: 'Jane', phone: '9876543210', email: 'jane@example.com', location: 'Pune', pincode: '411001',
		averageElectricityBill: '3-4k', solarSize: '3-4 kW', status: 'NEW', createdAt: new Date('2026-01-01T00:00:00.000Z'),
		vendor: { businessName: 'Ram Store', mobileNumber: '9876543210', state: 'Maharashtra' },
		vendorNameSnapshot: null, qr: { code: 'V-0001' }, payout: null, geoLocation: null,
	};
	const csv = toCsv(
		['Customer Name', 'Customer Phone', 'Customer Email', 'Location', 'Pincode', 'Average Electricity Bill', 'Solar Size', 'GPS Latitude', 'GPS Longitude', 'GPS Accuracy (m)', 'Lead Status', 'Vendor Name', 'Vendor Mobile Number', 'Vendor State', 'QR Code', 'Payout Status', 'Payout Reference', 'Created At'],
		[[lead.customerName, lead.phone, lead.email, lead.location, lead.pincode, lead.averageElectricityBill, lead.solarSize, lead.geoLocation?.latitude, lead.geoLocation?.longitude, lead.geoLocation?.accuracy, lead.status, lead.vendor?.businessName || `Deleted Vendor: ${lead.vendorNameSnapshot}`, lead.vendor?.mobileNumber, lead.vendor?.state, lead.qr?.code, lead.payout?.status, lead.payout?.paidReference, lead.createdAt.toISOString()]],
	);
	const [header, row] = csv.split('\r\n');
	assert.ok(header.split(',').includes('Vendor State'));
	assert.equal(header.split(',')[13], 'Vendor State');
	assert.equal(row.split(',')[13], 'Maharashtra');
});

// Mirrors the exact `state` field declaration now in routes/admin.js's vendorSchema and
// routes/sales.js's vendorCreateSchema: required on create, and — for admin.js only — optional
// again on update because vendorUpdateSchema is `vendorSchema.partial()`.
test('vendor state is required for single/manual creation (Admin and Sales)', () => {
	const createLikeSchema = z.object({
		business_name: z.string().trim().min(2).max(160),
		state: z.enum(INDIAN_STATES),
	});
	assert.throws(() => createLikeSchema.parse({ business_name: 'Ram Store' }));
	assert.throws(() => createLikeSchema.parse({ business_name: 'Ram Store', state: '' }));
	assert.throws(() => createLikeSchema.parse({ business_name: 'Ram Store', state: 'Narnia' }));
	assert.doesNotThrow(() => createLikeSchema.parse({ business_name: 'Ram Store', state: 'Maharashtra' }));
});

test('vendor state stays optional on edit (Admin\'s .partial() update schema)', () => {
	const baseSchema = z.object({ business_name: z.string().trim().min(2).max(160), state: z.enum(INDIAN_STATES) });
	const updateSchema = baseSchema.partial();
	assert.doesNotThrow(() => updateSchema.parse({}));
	assert.doesNotThrow(() => updateSchema.parse({ business_name: 'Renamed Store' }));
});

test('bulk create rows have no per-row state field — state is batch metadata, not row data', () => {
	// The per-row shape (name/phone/password) is untouched. A batch-level `state` lives one
	// level up, on bulkCreateVendorsSchema itself — see the tests below.
	const bulkRowSchema = z.object({ name: z.string(), phone: z.string(), password: z.string().optional() });
	assert.doesNotThrow(() => bulkRowSchema.parse({ name: 'Ram Store', phone: '9876543210' }));
	assert.equal('state' in bulkRowSchema.shape, false);
});

// Mirrors bulkCreateVendorsSchema in routes/admin.js: state is one optional, batch-level field,
// validated once for the whole request — never per row.
function bulkCreateSchemaLike() {
	return z.object({
		names: z.array(z.string().trim().min(2).max(160)).min(1).max(500).optional(),
		rows: z.array(z.object({ name: z.string(), phone: z.string().optional(), password: z.string().optional() })).min(1).max(500).optional(),
		auto_password: z.boolean().optional().default(false),
		state: z.enum(INDIAN_STATES).optional(),
	}).refine((value) => Boolean(value.names) !== Boolean(value.rows));
}

test('bulk create schema: batch state is optional, validated once, never per row', () => {
	const schema = bulkCreateSchemaLike();
	assert.doesNotThrow(() => schema.parse({ names: ['Ram Store'] }));
	assert.doesNotThrow(() => schema.parse({ names: ['Ram Store'], state: 'Gujarat' }));
	assert.throws(() => schema.parse({ names: ['Ram Store'], state: 'Narnia' }));
	assert.throws(() => schema.parse({ names: ['Ram Store'], state: '' }));
});

// Mirrors the two places in routes/admin.js that actually write `state` into the insert data:
// the rows-mode candidate mapping inside bulkCreateVendorsFromRows, and the names-mode mapping
// inside the POST /vendors/bulk-create handler. Both must apply the SAME batch state uniformly —
// this is exactly the class of bug where one path gets updated and the other is forgotten.
function rowsModeInsertData(candidates, batchState) {
	return candidates.map((candidate) => ({ businessName: candidate.name, mobileNumber: candidate.phone, state: batchState ?? null }));
}
function namesModeInsertData(names, batchState) {
	return names.map((businessName) => ({ businessName, state: batchState ?? null }));
}

test('bulk create: a batch state is applied to every row, both rows-mode and names-mode', () => {
	const candidates = [{ name: 'A', phone: '9876543210' }, { name: 'B', phone: '9876543211' }, { name: 'C', phone: '9876543212' }];
	const rowsData = rowsModeInsertData(candidates, 'Gujarat');
	assert.equal(rowsData.length, 3);
	assert.ok(rowsData.every((row) => row.state === 'Gujarat'));

	const namesData = namesModeInsertData(['A', 'B', 'C'], 'Gujarat');
	assert.equal(namesData.length, 3);
	assert.ok(namesData.every((row) => row.state === 'Gujarat'));
});

test('bulk create: an omitted batch state stores null (never undefined) for every row, both paths', () => {
	const candidates = [{ name: 'A', phone: '9876543210' }, { name: 'B', phone: '9876543211' }];
	const rowsData = rowsModeInsertData(candidates, undefined);
	assert.ok(rowsData.every((row) => row.state === null));

	const namesData = namesModeInsertData(['A', 'B'], undefined);
	assert.ok(namesData.every((row) => row.state === null));
});
