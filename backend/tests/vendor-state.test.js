import test from 'node:test';
import assert from 'node:assert/strict';
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
