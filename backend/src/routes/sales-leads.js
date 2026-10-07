import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSales } from '../middleware/auth.js';
import { pagination } from '../lib/pagination.js';
import { LEAD_STATUSES, SALES_SETTABLE_STATUSES } from '../lib/lead-status.js';

// "My leads" for a BDE / field salesperson (role SALES): only leads assigned to them, with contact details, the
// customer's requirements, status and a notes log. Registered on salesRoutes from routes/sales.js.
//
// Someone else's lead always answers 404, never 403, so ids cannot be probed. Commission and payout data is never
// returned here, and a BDE can never set (or undo) CONVERTED, REJECTED or DUPLICATE: those decisions stay with Admin.

const statusSchema = z.object({ status: z.enum(LEAD_STATUSES) });
const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

const NOT_FOUND = () => {
	const error = new Error('Lead was not found.');
	error.statusCode = 404;
	error.code = 'LEAD_NOT_FOUND';
	return error;
};

const LIST_SELECT = {
	id: true,
	customerName: true,
	phone: true,
	location: true,
	status: true,
	createdAt: true,
	assignedAt: true,
};

export function registerSalesLeadRoutes(router) {
	router.get('/leads', requireAuth, requireSales, async (request, response, next) => {
		try {
			const { page, limit, skip } = pagination(request.query);
			const where = { assignedToId: request.auth.user.id };
			const status = String(request.query.status || '').trim().toUpperCase();
			if (status) {
				if (!LEAD_STATUSES.includes(status)) {
					return response.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Unknown lead status.' } });
				}
				where.status = status;
			}
			const [leads, total] = await Promise.all([
				prisma.lead.findMany({ where, orderBy: [{ assignedAt: 'desc' }, { id: 'asc' }], skip, take: limit, select: LIST_SELECT }),
				prisma.lead.count({ where }),
			]);
			return response.json({ success: true, leads, pagination: { page, limit, total } });
		} catch (error) {
			return next(error);
		}
	});

	router.get('/leads/:leadId', requireAuth, requireSales, async (request, response, next) => {
		try {
			const lead = await prisma.lead.findFirst({
				where: { id: request.params.leadId, assignedToId: request.auth.user.id },
				select: {
					...LIST_SELECT,
					email: true,
					pincode: true,
					averageElectricityBill: true,
					solarSize: true,
					vendorNameSnapshot: true,
					geoLocation: { select: { latitude: true, longitude: true } },
					notes: {
						orderBy: { createdAt: 'desc' },
						take: 200,
						select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, role: true } } },
					},
				},
			});
			if (!lead) throw NOT_FOUND();
			const { vendorNameSnapshot, ...rest } = lead;
			return response.json({ success: true, lead: { ...rest, referredBy: vendorNameSnapshot } });
		} catch (error) {
			return next(error);
		}
	});

	router.patch('/leads/:leadId', requireAuth, requireSales, async (request, response, next) => {
		try {
			const { status } = statusSchema.parse(request.body);
			if (!SALES_SETTABLE_STATUSES.includes(status)) {
				const error = new Error('You can set New, Contacted, Qualified or Lost. Other statuses are set by the office.');
				error.statusCode = 403;
				error.code = 'STATUS_NOT_ALLOWED';
				throw error;
			}
			const leadId = request.params.leadId;
			const me = request.auth.user;
			await prisma.$transaction(async (transaction) => {
				// Only my own lead, and only while it is still in a status a BDE may change: a converted, rejected or
				// duplicate lead is out of a BDE's hands. Losing a race with a reassignment simply matches nothing.
				const result = await transaction.lead.updateMany({
					where: { id: leadId, assignedToId: me.id, status: { in: SALES_SETTABLE_STATUSES } },
					data: { status },
				});
				if (result.count === 1) {
					await transaction.auditLog.create({
						data: { actorUserId: me.id, actorRole: me.role, action: 'LEAD_STATUS_CHANGED', entity: 'Lead', entityId: leadId, metadata: { status } },
					});
					return;
				}
				const mine = await transaction.lead.findFirst({ where: { id: leadId, assignedToId: me.id }, select: { id: true } });
				if (!mine) throw NOT_FOUND();
				const error = new Error('This lead has been decided by the office and can no longer be changed here.');
				error.statusCode = 409;
				error.code = 'STATUS_LOCKED';
				throw error;
			});
			return response.json({ success: true, lead: { id: leadId, status } });
		} catch (error) {
			return next(error);
		}
	});

	router.post('/leads/:leadId/notes', requireAuth, requireSales, async (request, response, next) => {
		try {
			const { body } = noteSchema.parse(request.body);
			const leadId = request.params.leadId;
			const me = request.auth.user;
			const note = await prisma.$transaction(async (transaction) => {
				// Ownership and the write are one unit: this conditional update takes the row lock, so a concurrent
				// reassignment waits until the note is in, and a lead that is no longer mine matches nothing.
				const owned = await transaction.lead.updateMany({ where: { id: leadId, assignedToId: me.id }, data: { updatedAt: new Date() } });
				if (owned.count !== 1) throw NOT_FOUND();
				const created = await transaction.leadNote.create({
					data: { leadId, authorId: me.id, body },
					select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, role: true } } },
				});
				await transaction.auditLog.create({
					data: { actorUserId: me.id, actorRole: me.role, action: 'LEAD_NOTE_ADDED', entity: 'Lead', entityId: leadId, metadata: { noteId: created.id } },
				});
				return created;
			});
			return response.status(201).json({ success: true, note });
		} catch (error) {
			return next(error);
		}
	});
}
