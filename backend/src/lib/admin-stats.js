// Dashboard and QR-inventory numbers. Queries run one after another (never a burst of parallel
// counts against the small DB pool). Takes the prisma client as an argument so tests can stub it.

const sumOf = (groups, statuses) => groups
	.filter((group) => !statuses || statuses.includes(group.status))
	.reduce((total, group) => total + group._count._all, 0);
const countOf = (groups, status) => sumOf(groups, [status]);

export async function computeDashboardCounts(db) {
	const vendorGroups = await db.vendor.groupBy({ by: ['status'], _count: { _all: true } });
	const qrGroups = await db.qrCode.groupBy({ by: ['status'], _count: { _all: true } });
	const assignedQrCodes = await db.qrCode.count({ where: { assignments: { some: { unassignedAt: null } } } });
	const leadGroups = await db.lead.groupBy({ by: ['status'], _count: { _all: true } });
	const payoutGroups = await db.payout.groupBy({ by: ['status'], _count: { _all: true } });
	const totalScans = await db.scan.count();
	const uniqueCustomers = await db.customerIdentity.count();
	const scanLinkedLeads = await db.lead.count({ where: { scanId: { not: null } } });

	const totalQrCodes = sumOf(qrGroups);
	const unassignedQrCodes = countOf(qrGroups, 'UNASSIGNED');
	return {
		totalVendors: sumOf(vendorGroups, ['ACTIVE', 'INACTIVE']), // every status except DELETED
		activeVendors: countOf(vendorGroups, 'ACTIVE'),
		totalQrCodes,
		unassignedQrCodes,
		totalScans,
		uniqueCustomers,
		totalLeads: sumOf(leadGroups),
		qualifiedLeads: countOf(leadGroups, 'QUALIFIED'),
		convertedLeads: countOf(leadGroups, 'CONVERTED'),
		// Counts only, no amounts (plan.md rule).
		pendingCommission: sumOf(payoutGroups, ['UNPAID', 'PARTIAL']),
		paidCommission: countOf(payoutGroups, 'PAID'),
		// New, additive fields.
		assignedQrCodes,
		scanLinkedLeads,
		// Status-based unassigned vs assignment-based assigned disagree only on inconsistent data.
		qrStatusMismatch: totalQrCodes - assignedQrCodes !== unassignedQrCodes,
	};
}

// Whole-inventory QR numbers, independent of any list filter or page.
export async function computeQrSummary(db, log = console) {
	const total = await db.qrCode.count();
	const assigned = await db.qrCode.count({ where: { assignments: { some: { unassignedAt: null } } } });
	const unassigned = await db.qrCode.count({ where: { assignments: { none: { unassignedAt: null } } } });
	const consistent = total === assigned + unassigned;
	if (!consistent) log.warn?.(`[QrSummary] inconsistent inventory: total=${total} assigned=${assigned} unassigned=${unassigned}`);
	return { total, assigned, unassigned, consistent };
}
