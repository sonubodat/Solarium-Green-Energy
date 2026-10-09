import test from 'node:test';
import assert from 'node:assert/strict';
import { adminRoutes } from '../src/routes/admin.js';
import { requireAdmin } from '../src/middleware/auth.js';
import { ALL_PERMISSIONS } from '../src/lib/permissions.js';

// The route inventory. Every Admin route is listed here with its guard: ADMIN = super-admin only (requireAdmin),
// otherwise the permission(s) that open it to a STAFF role (any one of them is enough). A route that is added
// without a line here, or whose guard changes, fails this test: that is what keeps custom roles from slowly
// becoming insecure as routes are added. Anything not delegated stays ADMIN.
const EXPECTED = `
GET /dashboard => dashboard.view
POST /vendors => vendors.create
GET /users => ADMIN
POST /users => ADMIN
PATCH /users/:userId => ADMIN
POST /users/:userId/deactivate => ADMIN
PATCH /vendors/:vendorId => vendors.edit
POST /vendors/:vendorId/deactivate => vendors.edit
POST /vendors/:vendorId/delete => ADMIN
POST /vendors/:vendorId/purge => ADMIN
POST /vendors/bulk-delete => ADMIN
POST /vendors/bulk-create => vendors.bulk_create
POST /vendors/:vendorId/reset-password => vendors.reset_password
GET /qr => qr.view
POST /qr/repair-status => qr.repair
POST /qr/generate => qr.create
GET /qr/templates => ADMIN
POST /qr/templates => ADMIN
POST /qr/templates/:templateId/publish => ADMIN
POST /qr/templates/:templateId/vendor-poster => ADMIN
POST /qr/templates/:templateId/delete => ADMIN
POST /qr/templates/:templateId/archive => ADMIN
POST /qr/templates/:templateId/restore => ADMIN
GET /qr/print-jobs => ADMIN
GET /qr/print-jobs/:jobId => ADMIN
GET /qr/print-history/export => ADMIN
GET /qr/:qrId/print-history => ADMIN
GET /qr/range-check => ADMIN
POST /qr/generate-range => ADMIN
POST /qr/print-batch => ADMIN
POST /qr/print-batch/:jobId/approve => ADMIN
GET /qr/print-batch/:jobId/pdf => ADMIN
GET /qr/template-pdf => ADMIN
POST /qr/print-batch/:jobId/proof => ADMIN
GET /qr/print-batch/:jobId/proof => ADMIN
POST /qr/:qrId/delete => ADMIN
POST /qr/:qrId/purge => ADMIN
GET /qr/lookup/:code => qr.view|qr.assign|qr.reassign
POST /qr/:qrId/reassign => qr.reassign
POST /qr/:qrId/assign => qr.assign
GET /vendors/bulk-import-template => vendors.bulk_create
GET /vendors/lookup => vendors.view|qr.assign|qr.reassign
GET /qr/:qrId/image => ADMIN
GET /qr/print => ADMIN
GET /qr/pdf => ADMIN
GET /vendors => vendors.view
GET /vendors/export => vendors.export
GET /leads => leads.view
GET /leads/export => leads.export
GET /leads/import-template => leads.import
POST /leads/import => leads.import
POST /leads/import-batch => leads.import
GET /scans => scans.view
GET /payouts => payouts.view
GET /audit-logs => ADMIN
GET /audit-logs/export => ADMIN
PATCH /leads/:leadId => leads.edit
POST /leads/:leadId/delete => ADMIN
GET /vendors/:vendorId/bank-details => vendors.bank_details
PATCH /vendors/:vendorId/bank-details => vendors.bank_details
POST /vendors/:vendorId/bank-details/:documentType => vendors.bank_details
POST /vendors/:vendorId/bank-details/:documentType/delete => vendors.bank_details
GET /vendors/:vendorId/onboarding-media => vendors.edit
PATCH /vendors/:vendorId/location => vendors.edit
POST /vendors/:vendorId/photos/:photoType => vendors.edit
POST /payouts/:payoutId/status => payouts.mark_paid
GET /auto-posters/summary => ADMIN
POST /auto-posters/batch => ADMIN
GET /vendor-applications => applications.view|applications.review
POST /vendor-applications/:id/approve => applications.review
POST /vendor-applications/:id/reject => applications.review
GET /roles => ADMIN
POST /roles => ADMIN
PATCH /roles/:roleId => ADMIN
DELETE /roles/:roleId => ADMIN
GET /staff/assignable => leads.assign
PATCH /leads/:leadId/assignment => leads.assign
POST /leads/assign-bulk => leads.assign
GET /leads/:leadId/assignments => leads.view
GET /leads/:leadId/notes => leads.view
POST /leads/:leadId/notes => leads.edit
`.trim().split('\n');

function actualRoutes() {
	const rows = [];
	for (const layer of adminRoutes.stack) {
		if (!layer.route) continue;
		const method = Object.keys(layer.route.methods)[0].toUpperCase();
		const guards = layer.route.stack.map((entry) => entry.handle).filter((handle) => handle === requireAdmin || handle.permissions);
		const guard = guards.map((handle) => (handle === requireAdmin ? 'ADMIN' : handle.permissions.join('|'))).join(',') || 'NONE';
		rows.push(`${method} ${layer.route.path} => ${guard}`);
	}
	return rows;
}

test('every Admin route is classified, and the classification matches the inventory', () => {
	const actual = actualRoutes();
	const unclassified = actual.filter((row) => row.endsWith('=> NONE'));
	assert.deepEqual(unclassified, [], 'a route without requireAdmin or requirePermission is open to any signed-in user');
	assert.deepEqual([...actual].sort(), [...EXPECTED].sort());
});

test('every permission a route asks for exists in the catalog', () => {
	const known = new Set(ALL_PERMISSIONS);
	for (const row of EXPECTED) {
		const guard = row.split(' => ')[1];
		if (guard === 'ADMIN') continue;
		for (const permission of guard.split('|')) assert.ok(known.has(permission), `${row}: unknown permission ${permission}`);
	}
});

test('destructive and system routes are super-admin only', () => {
	const mustBeAdmin = [
		'POST /vendors/:vendorId/delete', 'POST /vendors/:vendorId/purge', 'POST /vendors/bulk-delete',
		'POST /qr/:qrId/delete', 'POST /qr/:qrId/purge', 'POST /leads/:leadId/delete',
		'GET /users', 'POST /users', 'PATCH /users/:userId', 'POST /users/:userId/deactivate',
		'GET /roles', 'POST /roles', 'PATCH /roles/:roleId', 'DELETE /roles/:roleId',
		'GET /audit-logs', 'GET /qr/templates', 'POST /qr/print-batch',
	];
	for (const route of mustBeAdmin) assert.ok(EXPECTED.includes(`${route} => ADMIN`), `${route} must stay super-admin only`);
});
