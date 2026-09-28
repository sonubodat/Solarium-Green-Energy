import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { parseApplication, normalizeMobile, isValidIndianMobile } from '../src/routes/registrations.js';

const valid = { business_name: 'Sunrise Traders', owner_name: 'Asha Patel', mobile_number: '98765 43210', state: 'Gujarat' };

test('parseApplication: mobile is normalized, login is the mobile, state is kept', () => {
	const { mobileNumber, data, honeypot } = parseApplication({ ...valid, mobile_number: '+91 98765 43210' });
	assert.equal(mobileNumber, '9876543210');
	assert.equal(data.loginIdentifier, '9876543210');
	assert.equal(data.mobileNumber, '9876543210');
	assert.equal(data.state, 'Gujarat');
	assert.equal(honeypot, false);
});

test('parseApplication: a login_identifier sent by an old client is ignored', () => {
	const { data } = parseApplication({ ...valid, login_identifier: 'my-shop' });
	assert.equal(data.loginIdentifier, '9876543210');
});

test('parseApplication: bad mobile is a coded 400, missing or unknown state fails validation', () => {
	assert.throws(() => parseApplication({ ...valid, mobile_number: '1234567890' }), (error) => error.statusCode === 400 && error.code === 'INVALID_MOBILE_NUMBER');
	assert.throws(() => parseApplication({ ...valid, mobile_number: '98765' }), (error) => error.name === 'ZodError');
	const { state, ...withoutState } = valid;
	assert.ok(state);
	assert.throws(() => parseApplication(withoutState), (error) => error.name === 'ZodError');
	assert.throws(() => parseApplication({ ...valid, state: 'Atlantis' }), (error) => error.name === 'ZodError');
	assert.throws(() => parseApplication({ ...valid, business_name: 'x' }), (error) => error.name === 'ZodError');
});

test('parseApplication: the hidden website field marks a bot', () => {
	assert.equal(parseApplication({ ...valid, website: 'http://spam.example' }).honeypot, true);
	assert.equal(parseApplication({ ...valid, website: '   ' }).honeypot, false);
});

test('normalizeMobile / isValidIndianMobile', () => {
	assert.equal(normalizeMobile('0091 98765-43210'), '9876543210');
	assert.equal(normalizeMobile(undefined), '');
	assert.equal(isValidIndianMobile('9876543210'), true);
	assert.equal(isValidIndianMobile('5876543210'), false);
});

// Without a session every real Admin route answers 401 (auth runs first); a public caller can never approve.
test('the Admin application routes are reachable and closed to the public', async () => {
	const server = app.listen(0);
	const base = `http://localhost:${server.address().port}`;
	const status = async (method, path) => (await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })).status;
	try {
		assert.equal(await status('GET', '/api/admin/vendor-applications'), 401);
		assert.equal(await status('POST', '/api/admin/vendor-applications/x/approve'), 401);
		assert.equal(await status('POST', '/api/admin/vendor-applications/x/reject'), 401);
	} finally {
		server.close();
	}
});
