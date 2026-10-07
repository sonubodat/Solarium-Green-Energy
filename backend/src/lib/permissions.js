// Permission catalog for Admin-defined back-office roles (users with role STAFF).
//
// A super-admin (role ADMIN) always has everything and is never limited. SALES users (BDE / field staff)
// have no matrix: their rights are fixed to their own assigned leads (routes/sales-leads.js).
//
// Deliberately NOT in this catalog, so they stay super-admin only and cannot be delegated: permanent deletion
// of Solar Mitras, leads and QR codes, staff users and roles, audit logs, templates and printing, retention.
// Any Admin route that is not explicitly mapped to a permission keeps requireAdmin, so a new route is closed by default.
//
// The Admin screens get this catalog from GET /admin/roles, so there is no second copy to keep in sync.

export const PERMISSION_SCREENS = [
	{ key: 'dashboard', label: 'Dashboard', permissions: [['dashboard.view', 'View']] },
	{
		key: 'leads',
		label: 'Leads',
		permissions: [
			['leads.view', 'View'],
			['leads.edit', 'Edit status and add notes'],
			['leads.convert', 'Mark converted (creates commission)'],
			['leads.assign', 'Assign to BDE'],
			['leads.export', 'Export'],
			['leads.import', 'Import'],
		],
	},
	{
		key: 'vendors',
		label: 'Solar Mitras',
		permissions: [
			['vendors.view', 'View'],
			['vendors.create', 'Create'],
			['vendors.edit', 'Edit, deactivate and reactivate'],
			['vendors.reset_password', 'Reset password'],
			['vendors.bank_details', 'Bank details and documents'],
			['vendors.bulk_create', 'Bulk create'],
			['vendors.export', 'Export'],
		],
	},
	{
		key: 'applications',
		label: 'Applications',
		permissions: [
			['applications.view', 'View'],
			['applications.review', 'Approve or reject'],
		],
	},
	{
		key: 'qr',
		label: 'QR codes',
		permissions: [
			['qr.view', 'View'],
			['qr.create', 'Generate'],
			['qr.assign', 'Assign an unassigned QR'],
			['qr.reassign', 'Move an active QR'],
			['qr.repair', 'Repair status'],
		],
	},
	{ key: 'scans', label: 'Scans', permissions: [['scans.view', 'View']] },
	{
		key: 'payouts',
		label: 'Commissions',
		permissions: [
			['payouts.view', 'View'],
			['payouts.mark_paid', 'Mark paid'],
		],
	},
];

export const ALL_PERMISSIONS = PERMISSION_SCREENS.flatMap((screen) => screen.permissions.map(([key]) => key));
const KNOWN = new Set(ALL_PERMISSIONS);

// Every permission on a screen needs that screen's view; leads.convert also needs leads.edit.
const IMPLIES = { 'leads.convert': ['leads.edit'] };

function screenViewOf(permission) {
	return `${permission.split('.')[0]}.view`;
}

export function isKnownPermission(permission) {
	return KNOWN.has(permission);
}

// Adds everything a permission implies (its screen's view, and leads.edit for leads.convert).
export function expandPermissions(permissions) {
	const result = new Set();
	for (const permission of permissions || []) {
		if (!KNOWN.has(permission)) continue;
		result.add(permission);
		result.add(screenViewOf(permission));
		for (const implied of IMPLIES[permission] || []) {
			result.add(implied);
			result.add(screenViewOf(implied));
		}
	}
	return result;
}

// Stored form of a role's permissions: known keys only, dependencies added, stable order.
export function normalizePermissions(permissions) {
	const expanded = expandPermissions(permissions);
	return ALL_PERMISSIONS.filter((permission) => expanded.has(permission));
}

export function findUnknownPermissions(permissions) {
	return (permissions || []).filter((permission) => !KNOWN.has(permission));
}

// The account's effective permission list. ADMIN: everything. STAFF: its role's list (expanded again here
// as defence in depth, in case a stored list ever lacks an implied entry). Everyone else: nothing.
export function permissionsOf(user) {
	if (!user) return new Set();
	if (user.role === 'ADMIN') return new Set(ALL_PERMISSIONS);
	if (user.role === 'STAFF') return expandPermissions(user.accessRole?.permissions);
	return new Set();
}

export function hasPermission(user, permission) {
	return permissionsOf(user).has(permission);
}

export function hasAnyPermission(user, permissions) {
	const owned = permissionsOf(user);
	return permissions.some((permission) => owned.has(permission));
}
