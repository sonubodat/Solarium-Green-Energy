import { z } from 'zod';
import { normalizePhone } from './customer-identity.js';
import { LEAD_FIELD_MAX, MAX_LEAD_BATCH_ROWS } from './bulk-limits.js';

// Pure (no database) parts of the customer/lead import, so they can be tested without a server.

export const LEAD_STATUS_VALUES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'REJECTED', 'DUPLICATE'];

const importRowSchema = z.object({
	customer_name: z.string().trim().min(2).max(120),
	phone: z.string().trim().min(1),
});

// Request body of POST /admin/leads/import-batch. Every field is optional and length-capped here so
// the worst-case body is provable (see bulk-limits.js); per-row problems (a name of 1 character, a
// bad phone) are NOT schema errors, they come back as `invalid` rows so one bad row never stops a batch.
export const leadImportBatchSchema = z.object({
	rows: z.array(z.object(Object.fromEntries(
		Object.entries(LEAD_FIELD_MAX).map(([field, max]) => [field, z.string().max(max).optional()]),
	))).min(1).max(MAX_LEAD_BATCH_ROWS),
	row_offset: z.number().int().min(0).max(1_000_000).default(0),
});

export function normalizeImportStatus(rawStatus) {
	if (!rawStatus) return 'NEW';
	const trimmed = String(rawStatus).trim().toLowerCase();
	return LEAD_STATUS_VALUES.find((value) => value.toLowerCase() === trimmed) || 'NEW';
}

export function normalizeImportBand(rawValue, allowedValues) {
	if (!rawValue) return null;
	const trimmed = String(rawValue).trim().toLowerCase();
	return allowedValues.find((value) => value.toLowerCase() === trimmed) || null;
}

export function parseImportDate(rawValue) {
	if (!rawValue) return new Date();
	const parsed = new Date(rawValue);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

// Validates and normalizes one batch in memory. Row numbers follow the CSV convention: row 1 is the
// header, so the first data row is row 2. For batch k (0-based) of size S, rowOffset = k * S and the
// reported row is rowOffset + indexInBatch + 2 (batch 1 reports 2-101, batch 2 reports 102-201).
// A phone repeated inside the batch: the FIRST occurrence is eligible, later ones are duplicates.
// hashFor(phone) is injected so this stays pure (the real one needs a server secret).
export function prepareLeadRows(records, { rowOffset = 0, hashFor, billBands, solarSizeBands }) {
	const valid = [];
	const invalid = [];
	const duplicates = [];
	const seen = new Set();

	records.forEach((record, index) => {
		const row = rowOffset + index + 2;
		const rowResult = importRowSchema.safeParse({
			customer_name: record.customer_name || record.name || '',
			phone: record.phone || record.mobile || record.mobile_number || '',
		});
		if (!rowResult.success) {
			invalid.push({ row, reason: 'Missing or invalid customer name / phone number.' });
			return;
		}
		const phone = normalizePhone(rowResult.data.phone);
		if (!/^[6-9]\d{9}$/.test(phone)) {
			invalid.push({ row, reason: 'Phone number is not a valid Indian mobile number.' });
			return;
		}
		if (seen.has(phone)) {
			duplicates.push({ row, phone });
			return;
		}
		seen.add(phone);
		valid.push({
			row,
			phone,
			hash: hashFor(phone),
			customerName: rowResult.data.customer_name,
			email: record.email ? String(record.email).trim() || null : null,
			location: record.location ? String(record.location).trim() || null : null,
			pincode: record.pincode ? String(record.pincode).trim() || null : null,
			averageElectricityBill: normalizeImportBand(record.average_electricity_bill, billBands),
			solarSize: normalizeImportBand(record.solar_size, solarSizeBands),
			status: normalizeImportStatus(record.status),
			createdAt: parseImportDate(record.created_at || record.date || record.lead_date),
		});
	});

	return { valid, invalid, duplicates };
}

// True ONLY for a unique-constraint violation on the customer-identity hash / the lead's
// customer_identity_id: the race where the same phone is claimed by another request between this
// batch's read and its write. Any other P2002, any other error, or an error whose constraint cannot
// be identified is NOT this race and must fail the batch rather than be retried and hidden.
export function isCustomerIdentityRace(error) {
	if (error?.code !== 'P2002') return false;
	let where;
	try {
		where = JSON.stringify(error.meta ?? {}).toLowerCase();
	} catch {
		return false;
	}
	return where.includes('customer_hash') || where.includes('customer_identity_id');
}
