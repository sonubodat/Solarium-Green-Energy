import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';

// A route registered after a router's 501 catch-all never matches. Without a session every real
// route answers 401 (auth runs first); only a path nothing handles may answer 501.
test('real sales/admin routes are reachable, unknown paths hit the 501 catch-all', async () => {
	const server = app.listen(0);
	const base = `http://localhost:${server.address().port}`;
	const status = async (method, path) => (await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })).status;
	try {
		for (const [method, path] of [
			['GET', '/api/sales/vendors/x/bank-details'],
			['PATCH', '/api/sales/vendors/x/bank-details'],
			['POST', '/api/sales/vendors/x/bank-details/passbook'],
			['PATCH', '/api/sales/vendors/x/location'],
			['POST', '/api/admin/qr/repair-status'],
			['GET', '/api/admin/dashboard'],
			['GET', '/api/admin/vendors/export'],
			['POST', '/api/sales/vendors'],
			['PATCH', '/api/admin/vendors/x/bank-details'],
			['POST', '/api/admin/vendors/x/bank-details/passbook'],
			['POST', '/api/admin/vendors/x/bank-details/passbook/delete'],
		]) {
			assert.equal(await status(method, path), 401, `${method} ${path} should be reachable (401), not swallowed by the catch-all`);
		}
		assert.equal(await status('GET', '/api/sales/does-not-exist'), 501);
	} finally {
		server.close();
	}
});
