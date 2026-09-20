import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVendorPassword, hashPassword } from '../src/services/auth.js';

test('phone-number password works, also typed with +91 / spaces', async () => {
	const vendor = { mobileNumber: '9876543210', passwordHash: await hashPassword('9876543210') };
	assert.equal((await checkVendorPassword(vendor, '9876543210')).ok, true);
	assert.equal((await checkVendorPassword(vendor, '+91 98765 43210')).ok, true);
	assert.equal((await checkVendorPassword(vendor, '9876543211')).ok, false);
});

test('a password the vendor chose is not replaced by the phone shortcut', async () => {
	const vendor = { mobileNumber: '9876543210', passwordHash: await hashPassword('MyOwnPass1') };
	assert.equal((await checkVendorPassword(vendor, 'MyOwnPass1')).ok, true);
	assert.equal((await checkVendorPassword(vendor, '9876543210')).ok, false);
});

test('no stored password: phone number is the password and needs a hash', async () => {
	const vendor = { mobileNumber: '9876543210', passwordHash: null };
	assert.deepEqual(await checkVendorPassword(vendor, '9876543210'), { ok: true, needsHash: true });
	assert.equal((await checkVendorPassword(vendor, 'wrong')).ok, false);
	assert.equal((await checkVendorPassword({ mobileNumber: '', passwordHash: null }, '')).ok, false);
});
