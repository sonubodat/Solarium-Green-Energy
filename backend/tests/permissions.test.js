import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ALL_PERMISSIONS, expandPermissions, findUnknownPermissions, hasAnyPermission, hasPermission, normalizePermissions, permissionsOf,
} from '../src/lib/permissions.js';
import { LEAD_STATUSES, SALES_LOCKED_STATUSES, SALES_SETTABLE_STATUSES } from '../src/lib/lead-status.js';
import { sessionCookieName, publicStaff } from '../src/services/auth.js';

const staff = (permissions) => ({ id: 'u1', name: 'Test', role: 'STAFF', accessRole: { name: 'Manager', permissions } });

test('every permission on a screen implies that screen view; convert also implies edit', () => {
	assert.deepEqual(normalizePermissions(['leads.assign']), ['leads.view', 'leads.assign']);
	assert.deepEqual(normalizePermissions(['leads.export']), ['leads.view', 'leads.export']);
	assert.deepEqual(normalizePermissions(['leads.convert']), ['leads.view', 'leads.edit', 'leads.convert']);
	assert.deepEqual(normalizePermissions(['vendors.edit']), ['vendors.view', 'vendors.edit']);
	assert.deepEqual(normalizePermissions(['qr.assign']), ['qr.view', 'qr.assign']);
	assert.deepEqual(normalizePermissions(['applications.review']), ['applications.view', 'applications.review']);
	assert.deepEqual(normalizePermissions(['payouts.mark_paid']), ['payouts.view', 'payouts.mark_paid']);
	// order is stable and duplicates collapse
	assert.deepEqual(normalizePermissions(['leads.assign', 'leads.view', 'leads.assign']), ['leads.view', 'leads.assign']);
});

test('unknown permissions are reported and never stored', () => {
	assert.deepEqual(findUnknownPermissions(['leads.view', 'vendors.delete', 'qr.purge']), ['vendors.delete', 'qr.purge']);
	assert.deepEqual(normalizePermissions(['vendors.delete', 'staff.edit']), []);
});

test('there is no delegable delete or system permission', () => {
	for (const permission of ALL_PERMISSIONS) {
		assert.ok(!/\.(delete|purge)$/.test(permission), `${permission} must not exist: permanent deletion is super-admin only`);
		assert.ok(!/^(staff|roles|audit|templates|printing|retention)\./.test(permission), `${permission} must not exist: system areas are super-admin only`);
	}
});

test('hasPermission: ADMIN has everything, STAFF only its role, SALES nothing', () => {
	assert.equal(hasPermission({ role: 'ADMIN' }, 'vendors.reset_password'), true);
	assert.equal(hasPermission({ role: 'SALES' }, 'leads.view'), false);
	assert.equal(hasPermission(null, 'leads.view'), false);
	const manager = staff(['vendors.view', 'vendors.edit']);
	assert.equal(hasPermission(manager, 'vendors.edit'), true);
	assert.equal(hasPermission(manager, 'vendors.create'), false);
	assert.equal(hasPermission(manager, 'vendors.reset_password'), false);
	assert.equal(hasAnyPermission(manager, ['qr.assign', 'vendors.view']), true);
	assert.equal(hasAnyPermission(manager, ['qr.assign', 'qr.reassign']), false);
});

test('hasPermission expands implied permissions even if a stored list lacks them (defence in depth)', () => {
	const broken = staff(['leads.assign']);
	assert.equal(hasPermission(broken, 'leads.view'), true);
	assert.deepEqual([...permissionsOf(broken)].sort(), ['leads.assign', 'leads.view']);
	assert.ok(expandPermissions(['leads.convert']).has('leads.edit'));
});

test('a STAFF user without a role, or with an empty role, has no permissions', () => {
	assert.equal(permissionsOf({ role: 'STAFF', accessRole: null }).size, 0);
	assert.equal(permissionsOf(staff([])).size, 0);
});

test('STAFF signs in through the Admin portal cookie; SALES and VENDOR keep their own', () => {
	assert.equal(sessionCookieName('STAFF'), sessionCookieName('ADMIN'));
	assert.notEqual(sessionCookieName('SALES'), sessionCookieName('ADMIN'));
	assert.notEqual(sessionCookieName('VENDOR'), sessionCookieName('ADMIN'));
});

test('publicStaff exposes the role name and permission list', () => {
	const view = publicStaff(staff(['leads.view']));
	assert.equal(view.role, 'STAFF');
	assert.equal(view.roleName, 'Manager');
	assert.deepEqual(view.permissions, ['leads.view']);
	assert.equal(publicStaff({ id: 'a', name: 'A', role: 'ADMIN' }).permissions.length, ALL_PERMISSIONS.length);
	assert.deepEqual(publicStaff({ id: 's', name: 'S', role: 'SALES' }).permissions, []);
});

test('lead statuses: Sales may only set four, and can never touch the three decided ones', () => {
	assert.deepEqual(SALES_SETTABLE_STATUSES, ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST']);
	assert.deepEqual(SALES_LOCKED_STATUSES, ['CONVERTED', 'REJECTED', 'DUPLICATE']);
	for (const status of [...SALES_SETTABLE_STATUSES, ...SALES_LOCKED_STATUSES]) assert.ok(LEAD_STATUSES.includes(status));
	assert.equal(SALES_SETTABLE_STATUSES.filter((status) => SALES_LOCKED_STATUSES.includes(status)).length, 0);
	assert.equal(LEAD_STATUSES.length, SALES_SETTABLE_STATUSES.length + SALES_LOCKED_STATUSES.length);
});
