// Read-only check: the old 11 dashboard counts vs the new grouped ones, computed inside ONE
// REPEATABLE READ transaction so both see the same snapshot. Issues SELECT counts only.
// Run (uses the DATABASE_URL in your env, so it reads that database):  node scripts/compare-dashboard.mjs
import { prisma } from '../src/lib/prisma.js';
import { computeDashboardCounts } from '../src/lib/admin-stats.js';

const legacy = async (db) => ({
	totalVendors: await db.vendor.count({ where: { status: { not: 'DELETED' } } }),
	activeVendors: await db.vendor.count({ where: { status: 'ACTIVE' } }),
	totalQrCodes: await db.qrCode.count(),
	unassignedQrCodes: await db.qrCode.count({ where: { status: 'UNASSIGNED' } }),
	totalScans: await db.scan.count(),
	uniqueCustomers: await db.customerIdentity.count(),
	totalLeads: await db.lead.count(),
	qualifiedLeads: await db.lead.count({ where: { status: 'QUALIFIED' } }),
	convertedLeads: await db.lead.count({ where: { status: 'CONVERTED' } }),
	pendingCommission: await db.payout.count({ where: { status: { in: ['UNPAID', 'PARTIAL'] } } }),
	paidCommission: await db.payout.count({ where: { status: 'PAID' } }),
});

try {
	const { before, after } = await prisma.$transaction(async (tx) => ({ before: await legacy(tx), after: await computeDashboardCounts(tx) }), { isolationLevel: 'RepeatableRead', timeout: 30000 });
	let bad = 0;
	for (const [key, value] of Object.entries(before)) {
		const same = after[key] === value;
		if (!same) bad += 1;
		console.log(`${same ? 'OK ' : 'DIFF'} ${key}: old=${value} new=${after[key]}`);
	}
	console.log(`new-only: assignedQrCodes=${after.assignedQrCodes} scanLinkedLeads=${after.scanLinkedLeads} qrStatusMismatch=${after.qrStatusMismatch}`);
	console.log(bad ? `${bad} field(s) differ` : 'All existing fields match.');
	process.exitCode = bad ? 1 : 0;
} finally {
	await prisma.$disconnect();
}
