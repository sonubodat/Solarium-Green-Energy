import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { assignLeads } from '../lib/lead-ownership.js';

// Admin side of lead assignment: who can be assigned, single and bulk assignment, ownership history and notes.
// Registered on adminRoutes from routes/admin.js. The locking rules live in lib/lead-ownership.js.

const singleSchema = z.object({ assigned_to_id: z.string().trim().min(1).nullable() });
const bulkSchema = z.object({
	lead_ids: z.array(z.string().trim().min(1)).min(1).max(200),
	assigned_to_id: z.string().trim().min(1).nullable(),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

function notFound() {
	const error = new Error('Lead was not found.');
	error.statusCode = 404;
	error.code = 'LEAD_NOT_FOUND';
	return error;
}

function noteView(note) {
	return { id: note.id, body: note.body, createdAt: note.createdAt, author: { id: note.author.id, name: note.author.name, role: note.author.role } };
}

export function registerLeadAssignmentRoutes(router) {
	// Only active BDE / Sales users can own a lead.
	router.get('/staff/assignable', requireAuth, requirePermission('leads.assign'), async (_request, response, next) => {
		try {
			const users = await prisma.user.findMany({
				where: { role: 'SALES', status: 'ACTIVE' },
				orderBy: { name: 'asc' },
				select: { id: true, name: true },
			});
			return response.json({ success: true, users });
		} catch (error) {
			return next(error);
		}
	});

	router.patch('/leads/:leadId/assignment', requireAuth, requirePermission('leads.assign'), async (request, response, next) => {
		try {
			const { assigned_to_id: assigneeId } = singleSchema.parse(request.body);
			const leadId = request.params.leadId;
			const changed = await prisma.$transaction(async (transaction) => {
				try {
					return await assignLeads(transaction, request.auth.user, [leadId], assigneeId);
				} catch (error) {
					if (error.code === 'LEADS_CHANGED') throw notFound();
					throw error;
				}
			});
			const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true, assignedAt: true, assignedTo: { select: { id: true, name: true } } } });
			return response.json({ success: true, lead, changed: changed.changed });
		} catch (error) {
			return next(error);
		}
	});

	router.post('/leads/assign-bulk', requireAuth, requirePermission('leads.assign'), async (request, response, next) => {
		try {
			const { lead_ids: leadIds, assigned_to_id: assigneeId } = bulkSchema.parse(request.body);
			const result = await prisma.$transaction((transaction) => assignLeads(transaction, request.auth.user, leadIds, assigneeId));
			return response.json({ success: true, changed: result.changed, total: result.total });
		} catch (error) {
			return next(error);
		}
	});

	router.get('/leads/:leadId/assignments', requireAuth, requirePermission('leads.view'), async (request, response, next) => {
		try {
			const exists = await prisma.lead.findUnique({ where: { id: request.params.leadId }, select: { id: true } });
			if (!exists) throw notFound();
			const rows = await prisma.leadAssignmentHistory.findMany({ where: { leadId: request.params.leadId }, orderBy: { changedAt: 'desc' }, take: 100 });
			const ids = [...new Set(rows.flatMap((row) => [row.fromUserId, row.toUserId, row.changedById]).filter(Boolean))];
			const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
			const nameOf = new Map(users.map((user) => [user.id, user.name]));
			const history = rows.map((row) => ({
				id: row.id,
				changedAt: row.changedAt,
				from: row.fromUserId ? { id: row.fromUserId, name: nameOf.get(row.fromUserId) || 'Removed user' } : null,
				to: row.toUserId ? { id: row.toUserId, name: nameOf.get(row.toUserId) || 'Removed user' } : null,
				changedBy: { id: row.changedById, name: nameOf.get(row.changedById) || 'Removed user' },
			}));
			return response.json({ success: true, history });
		} catch (error) {
			return next(error);
		}
	});

	router.get('/leads/:leadId/notes', requireAuth, requirePermission('leads.view'), async (request, response, next) => {
		try {
			const exists = await prisma.lead.findUnique({ where: { id: request.params.leadId }, select: { id: true } });
			if (!exists) throw notFound();
			const notes = await prisma.leadNote.findMany({
				where: { leadId: request.params.leadId },
				orderBy: { createdAt: 'desc' },
				take: 200,
				include: { author: { select: { id: true, name: true, role: true } } },
			});
			return response.json({ success: true, notes: notes.map(noteView) });
		} catch (error) {
			return next(error);
		}
	});

	// A note from Admin or a role with leads.edit: on any lead, no ownership needed (unlike the Sales portal).
	router.post('/leads/:leadId/notes', requireAuth, requirePermission('leads.edit'), async (request, response, next) => {
		try {
			const { body } = noteSchema.parse(request.body);
			const note = await prisma.$transaction(async (transaction) => {
				const exists = await transaction.lead.findUnique({ where: { id: request.params.leadId }, select: { id: true } });
				if (!exists) throw notFound();
				const created = await transaction.leadNote.create({
					data: { leadId: exists.id, authorId: request.auth.user.id, body },
					include: { author: { select: { id: true, name: true, role: true } } },
				});
				await transaction.auditLog.create({
					data: { actorUserId: request.auth.user.id, actorRole: request.auth.user.role, action: 'LEAD_NOTE_ADDED', entity: 'Lead', entityId: exists.id, metadata: { noteId: created.id } },
				});
				return created;
			});
			return response.status(201).json({ success: true, note: noteView(note) });
		} catch (error) {
			return next(error);
		}
	});
}
