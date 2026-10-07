import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { hashPassword, defaultVendorPassword } from '../services/auth.js';
import { INDIAN_STATES } from '../lib/indian-states.js';
import { normalizeMobile } from './registrations.js';

// Admin review of public "Apply for Solar Mitra" applications (vendor_registrations rows). Registered on
// adminRoutes from routes/admin.js, so it sits behind the same Admin authentication. Approving creates the
// real Solar Mitra (never automatic); every status change is a conditional update from PENDING, so two
// admins, or Admin and Sales, can never both act on the same application.

const APPLICATION_SELECT = {
	id: true,
	businessName: true,
	ownerName: true,
	mobileNumber: true,
	state: true,
	status: true,
	vendorId: true,
	rejectionReason: true,
	reviewedAt: true,
	createdAt: true,
};

const approveSchema = z.object({
	// Only used for an older application that has no state of its own; otherwise the applicant's state wins.
	state: z.enum(INDIAN_STATES).optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().max(500).optional() });

function httpError(statusCode, code, message, details) {
	const error = new Error(message);
	error.statusCode = statusCode;
	error.code = code;
	if (details) error.details = details;
	return error;
}

const STATUS_WORDS = { ONBOARDED: 'approved', REJECTED: 'rejected', PENDING: 'pending' };

// Thrown when the application is not PENDING any more. Carries the current status so the screen can say what happened.
async function alreadyReviewedError(db, id) {
	const current = await db.vendorRegistration.findUnique({ where: { id }, select: { status: true } });
	if (!current) return httpError(404, 'APPLICATION_NOT_FOUND', 'Application was not found.');
	return httpError(409, 'APPLICATION_ALREADY_REVIEWED', `This application was already ${STATUS_WORDS[current.status] || 'reviewed'}.`, { current_status: current.status });
}

function audit(db, actor, action, entity, entityId, metadata = {}) {
	return db.auditLog.create({ data: { actorUserId: actor.id, actorRole: actor.role, action, entity, entityId, metadata } });
}

// One transaction: claim the application (PENDING -> ONBOARDED), check the Solar Mitra does not exist yet,
// create it, link it, audit it. Any failure, including a unique-constraint clash on the Vendor, rolls back
// the whole thing, so the application stays PENDING and nothing half-created is left behind.
export async function approveApplication(db, actor, id, { state: stateOverride } = {}) {
	const application = await db.vendorRegistration.findUnique({ where: { id } });
	if (!application) throw httpError(404, 'APPLICATION_NOT_FOUND', 'Application was not found.');
	if (application.status !== 'PENDING') throw await alreadyReviewedError(db, id);

	const state = application.state || stateOverride;
	if (!state) throw httpError(400, 'STATE_REQUIRED', 'This application has no state. Choose one to approve it.');
	const mobileNumber = normalizeMobile(application.mobileNumber);
	// Hashed before the transaction so it stays short.
	const passwordHash = await hashPassword(defaultVendorPassword(mobileNumber));

	try {
		return await db.$transaction(async (transaction) => {
			const claimed = await transaction.vendorRegistration.updateMany({
				where: { id, status: 'PENDING' },
				data: { status: 'ONBOARDED', reviewedById: actor.id, reviewedAt: new Date() },
			});
			if (claimed.count === 0) throw await alreadyReviewedError(transaction, id);

			// Friendly early answer only: the Vendor unique constraints below remain the final authority.
			const clash = await transaction.vendor.findFirst({
				where: { OR: [{ mobileNumber }, { loginIdentifier: mobileNumber }, { loginIdentifier: application.loginIdentifier }] },
				select: { id: true },
			});
			if (clash) throw httpError(409, 'VENDOR_ALREADY_EXISTS', 'A Solar Mitra already exists with this mobile number or login.');

			const vendor = await transaction.vendor.create({
				data: {
					businessName: application.businessName,
					ownerName: application.ownerName,
					loginIdentifier: application.loginIdentifier,
					mobileNumber,
					passwordHash,
					mustChangePassword: true,
					state,
				},
			});
			await transaction.vendorRegistration.update({ where: { id }, data: { vendorId: vendor.id, state } });
			await audit(transaction, actor, 'VENDOR_APPLICATION_APPROVED', 'VendorRegistration', id, { vendorId: vendor.id });
			await audit(transaction, actor, 'VENDOR_CREATED', 'Vendor', vendor.id, { source: 'APPLICATION' });
			return vendor;
		});
	} catch (error) {
		if (error.code === 'P2002') {
			throw httpError(409, 'VENDOR_ALREADY_EXISTS', 'A Solar Mitra already exists with this mobile number or login.');
		}
		throw error;
	}
}

export async function rejectApplication(db, actor, id, { reason } = {}) {
	return db.$transaction(async (transaction) => {
		const claimed = await transaction.vendorRegistration.updateMany({
			where: { id, status: 'PENDING' },
			data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: reason || null },
		});
		if (claimed.count === 0) throw await alreadyReviewedError(transaction, id);
		await audit(transaction, actor, 'VENDOR_APPLICATION_REJECTED', 'VendorRegistration', id, reason ? { reason } : {});
	});
}

function pagination(query) {
	const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
	const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100);
	return { page, limit, skip: (page - 1) * limit };
}

export function registerVendorApplicationRoutes(router) {
	router.get('/vendor-applications', requireAuth, requirePermission('applications.view', 'applications.review'), async (request, response, next) => {
		try {
			const status = String(request.query.status || 'PENDING').toUpperCase();
			if (!['PENDING', 'ONBOARDED', 'REJECTED', 'ALL'].includes(status)) {
				return response.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'status must be PENDING, ONBOARDED, REJECTED or all.' } });
			}
			const { page, limit, skip } = pagination(request.query);
			const where = status === 'ALL' ? {} : { status };
			const [applications, total, pendingCount] = await Promise.all([
				prisma.vendorRegistration.findMany({
					where,
					orderBy: [{ createdAt: status === 'PENDING' ? 'asc' : 'desc' }, { id: 'asc' }],
					skip,
					take: limit,
					select: APPLICATION_SELECT,
				}),
				prisma.vendorRegistration.count({ where }),
				prisma.vendorRegistration.count({ where: { status: 'PENDING' } }),
			]);
			return response.json({ success: true, applications, pending_count: pendingCount, pagination: { page, limit, total } });
		} catch (error) {
			return next(error);
		}
	});

	router.post('/vendor-applications/:id/approve', requireAuth, requirePermission('applications.review'), async (request, response, next) => {
		try {
			const input = approveSchema.parse(request.body || {});
			const vendor = await approveApplication(prisma, request.auth.user, request.params.id, input);
			return response.status(201).json({ success: true, vendor_id: vendor.id, business_name: vendor.businessName });
		} catch (error) {
			return next(error);
		}
	});

	router.post('/vendor-applications/:id/reject', requireAuth, requirePermission('applications.review'), async (request, response, next) => {
		try {
			const input = rejectSchema.parse(request.body || {});
			await rejectApplication(prisma, request.auth.user, request.params.id, input);
			return response.json({ success: true });
		} catch (error) {
			return next(error);
		}
	});
}
