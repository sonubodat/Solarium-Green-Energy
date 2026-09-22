import test from 'node:test';
import assert from 'node:assert/strict';
import { isBankDetailsSet, bankDetailsSchema } from '../src/lib/vendor-bank-details.js';

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
	assert.doesNotThrow(() => bankDetailsSchema.parse({ upi_number: '123', ifsc_code: 'ABCD0123456' }));
});
