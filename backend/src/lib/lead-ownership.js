import { Prisma } from '@prisma/client';

// Everything that changes who owns a lead goes through here, so the locking and the history are identical
// for a single assignment, a bulk assignment, and the release of a leaving or deactivated salesperson.
//
// Lock order, always: the assignee's / leaving user's row first, then the lead rows in ascending id order.
// A fixed order means two of these running together wait for each other instead of deadlocking, and each one
// reads the owner that is really current (rows are read AFTER the lock), so the history is a true chain.

function httpError(statusCode, code, message, details) {
	const error = new Error(message);
	error.statusCode = statusCode;
	error.code = code;
	if (details) error.details = details;
	return error;
}

const sameOwner = (first, second) => (first || null) === (second || null);

function auditRow(actor, action, entityId, metadata) {
	return { actorUserId: actor.id, actorRole: actor.role, action, entity: 'Lead', entityId, metadata };
}

// Locks the given leads (id order) and returns their current owners.
export async function lockLeads(transaction, leadIds) {
	if (!leadIds.length) return [];
	return transaction.$queryRaw`
		SELECT id, assigned_to_id AS "assignedToId"
		FROM leads
		WHERE id IN (${Prisma.join(leadIds)})
		ORDER BY id
		FOR UPDATE`;
}

async function writeChanges(transaction, actor, changed, assigneeId) {
	const now = new Date();
	await transaction.lead.updateMany({
		where: { id: { in: changed.map((lead) => lead.id) } },
		data: { assignedToId: assigneeId, assignedAt: assigneeId ? now : null },
	});
	await transaction.leadAssignmentHistory.createMany({
		data: changed.map((lead) => ({ leadId: lead.id, fromUserId: lead.assignedToId, toUserId: assigneeId, changedById: actor.id, changedAt: now })),
	});
}

// Assigns (assigneeId) or unassigns (null) the leads. All or nothing: every requested id must still exist, or the
// whole transaction is rolled back with LEADS_CHANGED listing the missing ones. Leads already owned by the
// assignee are skipped (no history row). Returns how many actually changed.
export async function assignLeads(transaction, actor, requestedIds, assigneeId) {
	const leadIds = [...new Set(requestedIds)].sort();
	if (assigneeId) {
		await transaction.$queryRaw`SELECT id FROM users WHERE id = ${assigneeId} FOR SHARE`;
		const assignee = await transaction.user.findUnique({ where: { id: assigneeId }, select: { id: true, role: true, status: true } });
		if (!assignee || assignee.status !== 'ACTIVE' || assignee.role !== 'SALES') {
			throw httpError(400, 'INVALID_ASSIGNEE', 'Leads can only be assigned to an active BDE / Sales user.');
		}
	}
	const locked = await lockLeads(transaction, leadIds);
	if (locked.length !== leadIds.length) {
		const found = new Set(locked.map((lead) => lead.id));
		throw httpError(409, 'LEADS_CHANGED', 'Some leads no longer exist. Refresh the list and try again.', { missing: leadIds.filter((id) => !found.has(id)) });
	}
	const changed = locked.filter((lead) => !sameOwner(lead.assignedToId, assigneeId));
	if (changed.length) {
		await writeChanges(transaction, actor, changed, assigneeId);
		await transaction.auditLog.create({
			data: auditRow(actor, assigneeId ? 'LEAD_ASSIGNED' : 'LEAD_UNASSIGNED', changed.length === 1 ? changed[0].id : 'bulk', {
				assigneeId,
				count: changed.length,
				leadIds: changed.map((lead) => lead.id),
			}),
		});
	}
	return { changed: changed.length, total: leadIds.length };
}

// Returns every lead a salesperson owns to the unassigned pool (used when they are deactivated or stop being
// SALES). The user row is locked first, then their leads in id order, exactly like an assignment.
export async function releaseLeadsOfUser(transaction, actor, userId) {
	await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
	const owned = await transaction.$queryRaw`
		SELECT id, assigned_to_id AS "assignedToId"
		FROM leads
		WHERE assigned_to_id = ${userId}
		ORDER BY id
		FOR UPDATE`;
	if (owned.length) {
		await writeChanges(transaction, actor, owned, null);
		await transaction.auditLog.create({
			data: auditRow(actor, 'LEADS_RETURNED_TO_POOL', userId, { userId, count: owned.length, leadIds: owned.map((lead) => lead.id) }),
		});
	}
	return owned.length;
}
