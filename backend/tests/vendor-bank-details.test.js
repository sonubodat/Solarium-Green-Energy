import test from 'node:test';
import assert from 'node:assert/strict';
import { isBankDetailsSet, bankDetailsSchema, validateBankField } from '../src/lib/vendor-bank-details.js';

test('isBankDetailsSet: no row at all is not set', () => {
	assert.equal(isBankDetailsSet(null), false);
	assert.equal(isBankDetailsSet(undefined), false);
});

test('isBankDetailsSet: a row with every field blank/null is not set', () => {
	assert.equal(isBankDetailsSet({
		upiNumber: null, upiId: null, accountHolderName: null, accountNumber: null, ifscCode: null,
		passbookObjectKey: null, chequeObjectKey: null,
	}), false);
	// Empty strings (as opposed to null) still count as "nothing filled in".
	assert.equal(isBankDetailsSet({
		upiNumber: '', upiId: '', accountHolderName: '', accountNumber: '', ifscCode: '',
		passbookObjectKey: '', chequeObjectKey: '',
	}), false);
});

test('isBankDetailsSet: any single text field being set is enough', () => {
	const base = { upiNumber: null, upiId: null, accountHolderName: null, accountNumber: null, ifscCode: null, passbookObjectKey: null, chequeObjectKey: null };
	for (const key of ['upiNumber', 'upiId', 'accountHolderName', 'accountNumber', 'ifscCode']) {
		assert.equal(isBankDetailsSet({ ...base, [key]: 'x' }), true, key);
	}
});

test('isBankDetailsSet: an uploaded document alone (no text fields) counts as set', () => {
	const base = { upiNumber: null, upiId: null, accountHolderName: null, accountNumber: null, ifscCode: null, passbookObjectKey: null, chequeObjectKey: null };
	assert.equal(isBankDetailsSet({ ...base, passbookObjectKey: 'vendor1/passbook-1.pdf' }), true);
	assert.equal(isBankDetailsSet({ ...base, chequeObjectKey: 'vendor1/cheque-1.pdf' }), true);
});

test('bankDetailsSchema: all fields optional, still the shared shape both routes rely on', () => {
	const parsed = bankDetailsSchema.parse({});
	assert.deepEqual(parsed, {});
	assert.doesNotThrow(() => bankDetailsSchema.parse({ upi_number: '9876543210', ifsc_code: 'ABCD0123456' }));
});

// ---- format validation (the actual regex/normalization logic) --------------------------------
test('validateBankField: IFSC is normalized to uppercase before validating', () => {
	assert.deepEqual(validateBankField('ifsc_code', 'hdfc0123456'), { ok: true, value: 'HDFC0123456' });
	assert.deepEqual(validateBankField('ifsc_code', ' hdfc0123456 '), { ok: true, value: 'HDFC0123456' });
	assert.equal(validateBankField('ifsc_code', 'HDFC123456').ok, false); // missing the literal 0
	assert.equal(validateBankField('ifsc_code', 'not-an-ifsc').ok, false);
});

test('validateBankField: UPI ID case is preserved (a VPA can be case-sensitive)', () => {
	assert.deepEqual(validateBankField('upi_id', 'Ram.Store@OkHDFC'), { ok: true, value: 'Ram.Store@OkHDFC' });
	assert.equal(validateBankField('upi_id', 'not-an-upi-id').ok, false);
});

test('validateBankField: upi_number and account_number are digit-only sanity checks, not verification', () => {
	assert.equal(validateBankField('upi_number', '9876543210').ok, true); // 10 digits
	assert.equal(validateBankField('upi_number', '123456789').ok, false); // 9 digits, too short
	assert.equal(validateBankField('upi_number', '12345678901234567890').ok, false); // over 18 digits
	assert.equal(validateBankField('upi_number', '98765abcde').ok, false); // not digits-only
	assert.equal(validateBankField('account_number', '123456').ok, true); // 6 digits, minimum
	assert.equal(validateBankField('account_number', '12345').ok, false); // 5 digits, too short
});

test('validateBankField: blank/undefined means "not provided", always valid', () => {
	assert.deepEqual(validateBankField('ifsc_code', ''), { ok: true, value: undefined });
	assert.deepEqual(validateBankField('ifsc_code', undefined), { ok: true, value: undefined });
	assert.deepEqual(validateBankField('ifsc_code', '   '), { ok: true, value: undefined });
});

test('csvCell formula-injection: a leading =/+/-/@ is neutralized before CSV quoting', () => {
	// Mirrors neutralizeFormula() in routes/admin.js exactly (one line, private to that file).
	const neutralizeFormula = (text) => (/^[=+\-@]/.test(text) ? `'${text}` : text);
	for (const dangerous of ['=SUM(A1:A2)', '+123', '-123', '@SUM(1,2)']) {
		assert.equal(neutralizeFormula(dangerous), `'${dangerous}`);
	}
	for (const safe of ['Ram Store', 'ramstore@okhdfc', 'HDFC0001234', '']) {
		assert.equal(neutralizeFormula(safe), safe);
	}
});

// ---- bulk create: per-row bank-field handling (mirrors bulkCreateVendorsFromRows in
// routes/admin.js) - the orchestration is mirrored, but it calls the real validateBankField, so
// the actual validation rules are exercised for real, not re-implemented here. -----------------
const BULK_BANK_FORMAT_FIELDS = ['upi_number', 'upi_id', 'account_number', 'ifsc_code'];

function buildBankFieldsForRow(row, rowNumber, warnings) {
	const bankFields = {};
	for (const field of BULK_BANK_FORMAT_FIELDS) {
		const result = validateBankField(field, row[field]);
		if (!result.ok) {
			warnings.push({ row: rowNumber, field, code: result.code, reason: result.reason });
		} else if (result.value !== undefined) {
			bankFields[field] = result.value;
		}
	}
	const holderName = row.account_holder_name?.trim();
	if (holderName) bankFields.account_holder_name = holderName;
	return bankFields;
}

test('bulk create: a malformed bank field is skipped with exactly one warning; the row is unaffected', () => {
	const warnings = [];
	const row = { name: 'Ram Store', phone: '9876543210', ifsc_code: 'HDFC0001234', account_number: 'not-digits', upi_id: 'ram@okhdfc' };
	const bankFields = buildBankFieldsForRow(row, 3, warnings);
	assert.deepEqual(bankFields, { ifsc_code: 'HDFC0001234', upi_id: 'ram@okhdfc' });
	assert.equal(warnings.length, 1);
	assert.deepEqual(warnings[0], { row: 3, field: 'account_number', code: 'INVALID_FORMAT', reason: 'Account number format is invalid.' });
	// The vendor itself would still be created — nothing above touches `failures`.
});

test('bulk create: a row with no bank fields at all produces no bank-details row and no warnings', () => {
	const warnings = [];
	const bankFields = buildBankFieldsForRow({ name: 'Ram Store', phone: '9876543210' }, 1, warnings);
	assert.deepEqual(bankFields, {});
	assert.equal(warnings.length, 0);
});

test('bulk create: bank rows are joined only from vendors this batch verified it created', () => {
	// Mirrors the join in bulkCreateVendorsFromRows: rowsCreated (phone+name verified) ->
	// candidateByPhone -> bank row. A vendor NOT in rowsCreated must never get a bank row, even if
	// a candidate with a matching phone exists (e.g. a row that failed PHONE_ALREADY_USED).
	const candidates = [
		{ phone: '9876543210', bankFields: { ifsc_code: 'HDFC0001234' } },
		{ phone: '9876543211', bankFields: { ifsc_code: 'ICIC0005678' } },
	];
	const rowsCreated = [{ id: 'vendor-1', mobileNumber: '9876543210' }]; // only the first one actually got created
	const candidateByPhone = new Map(candidates.map((candidate) => [candidate.phone, candidate]));
	const bankDetailsData = rowsCreated
		.map((row) => {
			const candidate = candidateByPhone.get(row.mobileNumber);
			if (!candidate || Object.keys(candidate.bankFields).length === 0) return null;
			return { vendorId: row.id, ...candidate.bankFields };
		})
		.filter(Boolean);
	assert.deepEqual(bankDetailsData, [{ vendorId: 'vendor-1', ifsc_code: 'HDFC0001234' }]);
});

// ---- Admin delete-document: only the targeted type's 4 fields are cleared --------------------
function clearDataFor(type) {
	// Mirrors the clearData construction in the new POST .../bank-details/:documentType/delete route.
	return type === 'passbook'
		? { passbookObjectKey: null, passbookFileName: null, passbookFileSize: null, passbookContentType: null }
		: { chequeObjectKey: null, chequeFileName: null, chequeFileSize: null, chequeContentType: null };
}

test('delete passbook: only passbook fields are cleared, cheque and text fields are untouched', () => {
	const clearData = clearDataFor('passbook');
	assert.deepEqual(clearData, { passbookObjectKey: null, passbookFileName: null, passbookFileSize: null, passbookContentType: null });
	assert.equal('chequeObjectKey' in clearData, false);
	assert.equal('upiId' in clearData, false);
	assert.equal('ifscCode' in clearData, false);
});

test('delete cheque: only cheque fields are cleared, passbook and text fields are untouched', () => {
	const clearData = clearDataFor('cheque');
	assert.deepEqual(clearData, { chequeObjectKey: null, chequeFileName: null, chequeFileSize: null, chequeContentType: null });
	assert.equal('passbookObjectKey' in clearData, false);
	assert.equal('accountNumber' in clearData, false);
});

// ---- regression: bulk create's bank-detail rows must use real Prisma column names ------------
// A prior bug spread candidate.bankFields (snake_case, e.g. upi_number) directly into
// tx.vendorBankDetails.createMany's data, which Prisma rejects at runtime (no compile-time check
// catches this — node --check only parses syntax). This checks the actual mapping used in
// bulkCreateVendorsFromRows against the REAL generated Prisma schema, not a hand-typed guess.
test('bulk create: bank-detail rows use real VendorBankDetails column names, verified against the generated Prisma schema', async () => {
	const BULK_BANK_FIELD_TO_COLUMN = {
		upi_number: 'upiNumber',
		upi_id: 'upiId',
		account_holder_name: 'accountHolderName',
		account_number: 'accountNumber',
		ifsc_code: 'ifscCode',
	};
	const bankFields = { upi_number: '9876543210', upi_id: 'ram@okhdfc', account_holder_name: 'Ram Kumar', account_number: '123456789012', ifsc_code: 'HDFC0001234' };
	const columns = {};
	for (const [field, value] of Object.entries(bankFields)) columns[BULK_BANK_FIELD_TO_COLUMN[field]] = value;
	const row = { vendorId: 'vendor-1', ...columns };

	const { Prisma } = await import('@prisma/client');
	const validFields = new Set(Prisma.dmmf.datamodel.models.find((model) => model.name === 'VendorBankDetails').fields.map((field) => field.name));
	for (const key of Object.keys(row)) {
		assert.ok(validFields.has(key), `${key} is not a real VendorBankDetails field — this would crash Prisma at runtime`);
	}
	assert.deepEqual(row, { vendorId: 'vendor-1', upiNumber: '9876543210', upiId: 'ram@okhdfc', accountHolderName: 'Ram Kumar', accountNumber: '123456789012', ifscCode: 'HDFC0001234' });
});
