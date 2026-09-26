// Pure (no database) parts of automatic QR provisioning, so they can be tested without a server.
//
// The rule that governs all of it: existing V-#### QR records are protected inventory (many are
// already printed). Automatic provisioning only ever CREATES a new code above the highest existing
// one; it never reuses, modifies, renumbers or assigns an existing QR.

// The two system vendors (Solarium Direct / Company Uploaded Leads). Same identifiers as
// PROTECTED_DIRECT_VENDOR_LOGINS in routes/admin.js.
export const SENTINEL_VENDOR_LOGINS = ['company-import', 'public-general'];

// Advisory-lock keys. Namespaced strings so they cannot collide with any other advisory lock; the
// database turns them into a bigint with hashtextextended(key, 0). ORDER OF ACQUISITION IS FIXED:
// vendor lock(s) first (sorted by vendor id), the numbering lock last, never the reverse.
export const QR_NUMBERING_LOCK_KEY = 'solar-mitra-qr-numbering';
export const vendorQrLockKey = (vendorId) => `solar-mitra-qr-vendor:${vendorId}`;

// Every vendor whose active QR an operation can change, de-duplicated and in deterministic order.
export function sortedVendorLockIds(vendorIds) {
	return [...new Set(vendorIds.filter(Boolean))].sort();
}

export function formatQrCode(number) {
	return `V-${String(number).padStart(4, '0')}`;
}

// A QR created by automatic provisioning has NO assigning staff member (assignedById is null: the
// column is nullable and every manual assignment records who made it) and belongs to a real,
// non-system vendor. Checked against live data before this was written: zero assignments with a
// null assigned_by existed, so nothing legacy can be mistaken for an automatic one.
export function isAutoCreatedQrAssignment(assignment) {
	return Boolean(assignment)
		&& assignment.assignedById == null
		&& !SENTINEL_VENDOR_LOGINS.includes(assignment.vendor?.loginIdentifier)
		&& /^V-\d+$/.test(assignment.qrCode?.code || '');
}

// Print jobs whose posters were actually produced (approved for production, being generated, or
// done). A QR that appears on such a poster is out in the world exactly like a printed sticker, so it
// counts as used. A batch that was only created or proofed does not.
export const POSTER_PRODUCED_JOB_STATUSES = ['APPROVED', 'GENERATING', 'COMPLETED'];

// An automatic QR may be replaced by a printed one only while nobody has used it: not one scan, not
// one lead, and no produced poster. `_count` is Prisma's relation count on the QrCode; the
// printJobItems count must be the FILTERED one (only items of jobs in POSTER_PRODUCED_JOB_STATUSES).
export function isReplaceableAutoQr(assignment) {
	const counts = assignment?.qrCode?._count;
	return isAutoCreatedQrAssignment(assignment) && Boolean(counts)
		&& counts.scans === 0 && counts.leads === 0 && counts.printJobItems === 0;
}

// isAutoCreatedQrAssignment as a Prisma `where` on QrAssignment (add `unassignedAt: null` for "current").
export const AUTO_CREATED_ASSIGNMENT_WHERE = {
	assignedById: null,
	vendor: { loginIdentifier: { notIn: SENTINEL_VENDOR_LOGINS } },
	qrCode: { code: { startsWith: 'V-' } },
};

// The same definition as isReplaceableAutoQr, as a `where`, so the Sales and Admin pickers can never
// disagree with the replace rule: automatic, no scans, no leads, no produced poster.
export const REPLACEABLE_AUTO_ASSIGNMENT_WHERE = {
	...AUTO_CREATED_ASSIGNMENT_WHERE,
	qrCode: {
		...AUTO_CREATED_ASSIGNMENT_WHERE.qrCode,
		scans: { none: {} },
		leads: { none: {} },
		printJobItems: { none: { printJob: { status: { in: POSTER_PRODUCED_JOB_STATUSES } } } },
	},
};

// Vendor `where`: "no active QR that staff cannot replace". A vendor with no QR matches, and so
// does one whose only active QR is an automatic, unused one. Replaces the old
// `assignments: { none: { unassignedAt: null } }` in the assign pickers.
export const VENDOR_WITHOUT_LOCKED_QR_WHERE = {
	assignments: { none: { unassignedAt: null, NOT: REPLACEABLE_AUTO_ASSIGNMENT_WHERE } },
};
