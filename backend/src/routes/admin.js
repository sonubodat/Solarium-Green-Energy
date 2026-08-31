import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createPasswordResetToken, resetTokenResponse } from '../services/password-reset.js';
import { assignUnassignedQr, generateQrCodes, reassignQr } from '../services/qr.js';
import { generateQrPng, generateQrSvg } from '../services/qr-image.js';
import PDFDocument from 'pdfkit';
import { hashPassword, normalizeLoginIdentifier, publicVendor } from '../services/auth.js';
import { z } from 'zod';

export const adminRoutes = Router();

const generateQrSchema = z.object({ quantity: z.number().int().min(1).max(5000) });
const reassignQrSchema = z.object({ vendor_id: z.string().trim().min(1) });
const vendorSchema = z.object({
	business_name: z.string().trim().min(2).max(160),
	owner_name: z.string().trim().min(2).max(120),
	login_identifier: z.string().trim().min(3).max(120),
	mobile_number: z.string().trim().min(10).max(20),
	password: z.string().min(8).optional(),
});
const vendorUpdateSchema = vendorSchema.partial().extend({
	status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']).optional(),
});
const leadStatusSchema = z.object({ status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'REJECTED', 'DUPLICATE']) });
const payoutStatusSchema = z.object({
	status: z.enum(['UNPAID', 'PAID', 'PARTIAL']),
	paid_reference: z.string().trim().max(160).optional(),
});
const userSchema = z.object({
	name: z.string().trim().min(2).max(120),
	username_or_mobile: z.string().trim().min(3).max(120),
	password: z.string().min(8),
	role: z.enum(['ADMIN', 'SALES']),
});
const userUpdateSchema = userSchema.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']).optional() });

function pagination(query) {
	const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
	const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 100);
	return { page, limit, skip: (page - 1) * limit };
}

async function writeAudit(transaction, request, action, entity, entityId, metadata = {}) {
	await transaction.auditLog.create({
		data: { actorUserId: request.auth.user.id, actorRole: request.auth.user.role, action, entity, entityId, metadata },
	});
}

function normalizeMobile(value) {
	const digits = value.replace(/\D/g, '');
	return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
}

function preventSelfLockout(request, targetUserId, changes) {
	if (targetUserId !== request.auth.user.id) return;
	const losesActive = changes.status !== undefined && changes.status !== 'ACTIVE';
	const losesAdmin = changes.role !== undefined && changes.role !== 'ADMIN';
	if (losesActive || losesAdmin) {
		const error = new Error('Admins cannot deactivate or demote their own account.');
		error.statusCode = 409;
		error.code = 'CANNOT_MODIFY_OWN_ACCOUNT';
		throw error;
	}
}

async function ensureActiveAdminRemains(transaction, userId, changes) {
	const user = await transaction.user.findUnique({ where: { id: userId } });
	if (!user || user.role !== 'ADMIN') return;
	const becomesInactive = changes.status && changes.status !== 'ACTIVE';
	const becomesNonAdmin = changes.role && changes.role !== 'ADMIN';
	if (becomesInactive || becomesNonAdmin) {
		const activeAdmins = await transaction.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: userId } } });
		if (activeAdmins === 0) {
			const error = new Error('At least one active Admin must remain.');
			error.statusCode = 409;
			error.code = 'LAST_ADMIN_PROTECTED';
			throw error;
		}
	}
}

// Parallelized via Promise.all — independent autocommit counts, no shared transaction,
// safe to run concurrently. Was sequential (~2.0s); now ~0.87s measured. See progress.md.
adminRoutes.get('/dashboard', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const [
			totalVendors,
			activeVendors,
			totalQrCodes,
			unassignedQrCodes,
			totalScans,
			uniqueCustomers,
			totalLeads,
			qualifiedLeads,
			convertedLeads,
			// Counts only — no amount/percentage is calculated anywhere, matching plan.md's rule
			// against commission calculation. This is the same kind of plain operational count as
			// every other tile on this dashboard (Total Leads, Qualified Leads, etc.), not a KPI.
			pendingCommission,
			paidCommission,
		] = await Promise.all([
			prisma.vendor.count({ where: { status: { not: 'DELETED' } } }),
			prisma.vendor.count({ where: { status: 'ACTIVE' } }),
			prisma.qrCode.count(),
			prisma.qrCode.count({ where: { status: 'UNASSIGNED' } }),
			prisma.scan.count(),
			prisma.customerIdentity.count(),
			prisma.lead.count(),
			prisma.lead.count({ where: { status: 'QUALIFIED' } }),
			prisma.lead.count({ where: { status: 'CONVERTED' } }),
			prisma.payout.count({ where: { status: { in: ['UNPAID', 'PARTIAL'] } } }),
			prisma.payout.count({ where: { status: 'PAID' } }),
		]);

		return response.json({
			success: true,
			totalVendors,
			activeVendors,
			totalQrCodes,
			unassignedQrCodes,
			totalScans,
			uniqueCustomers,
			totalLeads,
			qualifiedLeads,
			convertedLeads,
			pendingCommission,
			paidCommission,
		});
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/vendors', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = vendorSchema.parse(request.body);
		const mobileNumber = normalizeMobile(input.mobile_number);
		if (!/^\d{10}$/.test(mobileNumber)) {
			return response.status(400).json({ success: false, error: { code: 'INVALID_MOBILE_NUMBER', message: 'Enter a valid mobile number.' } });
		}
		const vendor = await prisma.$transaction(async (transaction) => {
			const created = await transaction.vendor.create({
				data: {
					businessName: input.business_name,
					ownerName: input.owner_name,
					loginIdentifier: normalizeLoginIdentifier(input.login_identifier),
					mobileNumber,
					passwordHash: input.password ? await hashPassword(input.password) : null,
				},
			});
			await writeAudit(transaction, request, 'VENDOR_CREATED', 'Vendor', created.id);
			return created;
		});
		return response.status(201).json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		if (error.code === 'P2002') {
			error.statusCode = 409;
			error.code = 'VENDOR_ALREADY_EXISTS';
			error.message = 'A Vendor already exists for these identifiers.';
		}
		return next(error);
	}
});

adminRoutes.get('/users', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const [users, total] = await Promise.all([
			prisma.user.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit, select: { id: true, name: true, usernameMobile: true, role: true, status: true, createdAt: true, updatedAt: true } }),
			prisma.user.count(),
		]);
		return response.json({ success: true, users, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/users', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = userSchema.parse(request.body);
		const user = await prisma.$transaction(async (transaction) => {
			const created = await transaction.user.create({
				data: { name: input.name, usernameMobile: normalizeLoginIdentifier(input.username_or_mobile), passwordHash: await hashPassword(input.password), role: input.role },
			});
			await writeAudit(transaction, request, 'STAFF_USER_CREATED', 'User', created.id, { role: created.role });
			return created;
		});
		return response.status(201).json({ success: true, user: { id: user.id, name: user.name, usernameMobile: user.usernameMobile, role: user.role, status: user.status } });
	} catch (error) {
		if (error.code === 'P2002') {
			error.statusCode = 409;
			error.code = 'STAFF_USER_ALREADY_EXISTS';
			error.message = 'A staff user already exists for this identifier.';
		}
		return next(error);
	}
});

adminRoutes.patch('/users/:userId', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = userUpdateSchema.parse(request.body);
		const data = {};
		if (input.name !== undefined) data.name = input.name;
		if (input.username_or_mobile !== undefined) data.usernameMobile = normalizeLoginIdentifier(input.username_or_mobile);
		if (input.password !== undefined) data.passwordHash = await hashPassword(input.password);
		if (input.role !== undefined) data.role = input.role;
		if (input.status !== undefined) data.status = input.status;
		preventSelfLockout(request, request.params.userId, data);
		const user = await prisma.$transaction(async (transaction) => {
			await ensureActiveAdminRemains(transaction, request.params.userId, data);
			const updated = await transaction.user.update({ where: { id: request.params.userId }, data });
			await writeAudit(transaction, request, 'STAFF_USER_UPDATED', 'User', updated.id, { changedFields: Object.keys(data) });
			return updated;
		});
		return response.json({ success: true, user: { id: user.id, name: user.name, usernameMobile: user.usernameMobile, role: user.role, status: user.status } });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'STAFF_USER_NOT_FOUND';
			error.message = 'Staff user was not found.';
		}
		return next(error);
	}
});

adminRoutes.post('/users/:userId/deactivate', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		preventSelfLockout(request, request.params.userId, { status: 'INACTIVE' });
		const user = await prisma.$transaction(async (transaction) => {
			await ensureActiveAdminRemains(transaction, request.params.userId, { status: 'INACTIVE' });
			const updated = await transaction.user.update({ where: { id: request.params.userId }, data: { status: 'INACTIVE' } });
			await writeAudit(transaction, request, 'STAFF_USER_DEACTIVATED', 'User', updated.id);
			return updated;
		});
		return response.json({ success: true, user: { id: user.id, name: user.name, role: user.role, status: user.status } });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'STAFF_USER_NOT_FOUND';
			error.message = 'Staff user was not found.';
		}
		return next(error);
	}
});

adminRoutes.patch('/vendors/:vendorId', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = vendorUpdateSchema.parse(request.body);
		const data = {};
		if (input.business_name !== undefined) data.businessName = input.business_name;
		if (input.owner_name !== undefined) data.ownerName = input.owner_name;
		if (input.login_identifier !== undefined) data.loginIdentifier = normalizeLoginIdentifier(input.login_identifier);
		if (input.mobile_number !== undefined) {
			data.mobileNumber = normalizeMobile(input.mobile_number);
			if (!/^\d{10}$/.test(data.mobileNumber)) return response.status(400).json({ success: false, error: { code: 'INVALID_MOBILE_NUMBER', message: 'Enter a valid mobile number.' } });
		}
		if (input.password !== undefined) data.passwordHash = await hashPassword(input.password);
		if (input.status !== undefined) data.status = input.status;
		const vendor = await prisma.$transaction(async (transaction) => {
			const updated = await transaction.vendor.update({ where: { id: request.params.vendorId }, data });
			await writeAudit(transaction, request, 'VENDOR_UPDATED', 'Vendor', updated.id, { changedFields: Object.keys(data) });
			return updated;
		});
		return response.json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'VENDOR_NOT_FOUND';
			error.message = 'Vendor was not found.';
		}
		return next(error);
	}
});

adminRoutes.post('/vendors/:vendorId/deactivate', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const vendor = await prisma.$transaction(async (transaction) => {
			const updated = await transaction.vendor.update({ where: { id: request.params.vendorId }, data: { status: 'INACTIVE' } });
			await writeAudit(transaction, request, 'VENDOR_DEACTIVATED', 'Vendor', updated.id);
			return updated;
		});
		return response.json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'VENDOR_NOT_FOUND';
			error.message = 'Vendor was not found.';
		}
		return next(error);
	}
});
adminRoutes.post('/vendors/:vendorId/delete', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const vendorId = request.params.vendorId;
		const [leadCount, scanCount, payoutCount, assignmentCount] = await Promise.all([
			prisma.lead.count({ where: { vendorId } }),
			prisma.scan.count({ where: { vendorId } }),
			prisma.payout.count({ where: { vendorId } }),
			prisma.qrAssignment.count({ where: { vendorId } }),
		]);
		if (leadCount || scanCount || payoutCount || assignmentCount) {
			return response.status(409).json({
				success: false,
				error: {
					code: 'VENDOR_HAS_HISTORY',
					message: 'This Vendor has historical leads, scans, payouts, or QR assignment records and cannot be deleted. Deactivate it instead.',
				},
			});
		}
		const vendor = await prisma.$transaction(async (transaction) => {
			const updated = await transaction.vendor.update({ where: { id: vendorId }, data: { status: 'DELETED' } });
			await writeAudit(transaction, request, 'VENDOR_DELETED', 'Vendor', updated.id);
			return updated;
		});
		return response.json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'VENDOR_NOT_FOUND';
			error.message = 'Vendor was not found.';
		}
		return next(error);
	}
});

adminRoutes.post('/vendors/:vendorId/reset-password', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const vendor = await prisma.vendor.findUnique({ where: { id: request.params.vendorId } });
		if (!vendor) {
			return response.status(404).json({ success: false, error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor was not found.' } });
		}
		const token = await createPasswordResetToken({ vendorId: vendor.id });
		await writeAudit(prisma, request, 'VENDOR_PASSWORD_RESET', 'Vendor', vendor.id);
		return response.json(resetTokenResponse(token, 'Vendor password reset issued.'));
	} catch (error) {
		return next(error);
	}
});

const qrListFilterSchema = z.object({
	status: z.enum(['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'RETIRED']).optional(),
	assignment: z.enum(['ASSIGNED', 'UNASSIGNED']).optional(),
});

adminRoutes.get('/qr', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { status, assignment } = qrListFilterSchema.parse({
			status: request.query.status || undefined,
			assignment: request.query.assignment || undefined,
		});
		const page = Math.max(Number.parseInt(request.query.page, 10) || 1, 1);
		const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 50, 1), 100);
		const where = {
			...(status ? { status } : {}),
			...(assignment === 'ASSIGNED' ? { assignments: { some: { unassignedAt: null } } } : {}),
			...(assignment === 'UNASSIGNED' ? { assignments: { none: { unassignedAt: null } } } : {}),
		};
		const [qrCodes, total] = await Promise.all([
			prisma.qrCode.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { assignments: { where: { unassignedAt: null }, include: { vendor: true }, take: 1 } } }),
			prisma.qrCode.count({ where }),
		]);
		return response.json({ success: true, data: qrCodes, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/generate', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { quantity } = generateQrSchema.parse(request.body);
		const result = await generateQrCodes(quantity, request.auth.user.id);
		return response.status(201).json({ success: true, ...result });
	} catch (error) {
		// Two batches generated at the exact same instant (two Admins clicking "Generate"
		// simultaneously) can still both compute the same starting sequence number before
		// either commits — rare, but the unique constraint on QrCode.code is what actually
		// prevents it from silently double-issuing codes. Surface it as a clean, retryable
		// conflict rather than a raw/opaque error.
		if (error.code === 'P2002') {
			error.statusCode = 409;
			error.code = 'QR_BATCH_CONFLICT';
			error.message = 'Another QR batch was generated at the same moment. Please try again.';
		}
		return next(error);
	}
});

adminRoutes.post('/qr/:qrId/delete', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const qrId = request.params.qrId;
		const qr = await prisma.qrCode.findUnique({ where: { id: qrId } });
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'QR code was not found.' } });
		}
		if (qr.status !== 'UNASSIGNED') {
			return response.status(409).json({
				success: false,
				error: { code: 'QR_NOT_UNASSIGNED', message: 'Only an unassigned QR code can be deleted.' },
			});
		}
		// Even an UNASSIGNED QR can carry assignment history (e.g. it was manually reset after
		// an earlier assignment was closed) — a hard delete here would either fail on the
		// QrAssignment foreign key or, worse, cascade away real historical attribution that
		// leads/scans/payouts still reference. Only ever delete a QR that was truly never used.
		const assignmentCount = await prisma.qrAssignment.count({ where: { qrCodeId: qrId } });
		if (assignmentCount) {
			return response.status(409).json({
				success: false,
				error: { code: 'QR_HAS_HISTORY', message: 'This QR code has assignment history and cannot be deleted.' },
			});
		}
		await prisma.$transaction(async (transaction) => {
			await transaction.qrCode.delete({ where: { id: qrId } });
			await writeAudit(transaction, request, 'QR_DELETED', 'QrCode', qrId, { qrCode: qr.code });
		});
		return response.json({ success: true });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/lookup/:code', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const qr = await prisma.qrCode.findUnique({
			where: { code: request.params.code },
			include: { assignments: { where: { unassignedAt: null }, include: { vendor: { select: { id: true, businessName: true } } }, take: 1 } },
		});
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'QR code was not found.' } });
		}
		const currentVendor = qr.assignments[0]?.vendor;
		return response.json({
			success: true,
			qr: { id: qr.id, code: qr.code, status: qr.status, currentVendor: currentVendor ? { id: currentVendor.id, businessName: currentVendor.businessName } : null },
		});
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/:qrId/reassign', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { vendor_id: vendorId } = reassignQrSchema.parse(request.body);
		const result = await reassignQr({ qrId: request.params.qrId, vendorId, assignedById: request.auth.user.id });
		return response.json({ success: true, qr: result.qr, assignment: result.assignment, vendor: publicVendor(result.vendor) });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/:qrId/assign', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { vendor_id: vendorId } = reassignQrSchema.parse(request.body);
		const qr = await prisma.qrCode.findUnique({ where: { id: request.params.qrId } });
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'QR code was not found.' } });
		}
		const result = await assignUnassignedQr({ code: qr.code, vendorId, assignedById: request.auth.user.id, assignedByRole: 'ADMIN' });
		return response.status(201).json({ success: true, qr: result.qr, assignment: result.assignment, vendor: publicVendor(result.vendor) });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/vendors/lookup', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const vendors = await prisma.vendor.findMany({
			// A Vendor already holding an active QR is excluded — the picker is for choosing
			// a vendor to assign/reassign an active QR to, and one active QR per Vendor is enforced here.
			where: { status: 'ACTIVE', assignments: { none: { unassignedAt: null } } },
			orderBy: { businessName: 'asc' },
			take: 200,
			select: { id: true, businessName: true, loginIdentifier: true },
		});
		return response.json({ success: true, vendors });
	} catch (error) {
		return next(error);
	}
});

function safeFilenameSegment(value) {
	return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const qrPrintFilterSchema = z.object({
	status: z.enum(['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'RETIRED']).optional(),
	vendor_id: z.string().trim().min(1).optional(),
	assignment: z.enum(['ASSIGNED', 'UNASSIGNED']).optional(),
	// Downloading a single named code (e.g. "V-0023") for the "just give me this one QR"
	// case — no need to page through or filter the whole batch to find one code.
	code: z.string().trim().min(1).optional(),
});

function qrAssignmentWhere(assignment) {
	if (assignment === 'ASSIGNED') return { assignments: { some: { unassignedAt: null } } };
	if (assignment === 'UNASSIGNED') return { assignments: { none: { unassignedAt: null } } };
	return {};
}

adminRoutes.get('/qr/:qrId/image', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const qr = await prisma.qrCode.findUnique({ where: { id: request.params.qrId } });
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'QR code was not found.' } });
		}
		const filename = safeFilenameSegment(qr.code);
		if (request.query.format === 'png') {
			const png = await generateQrPng(qr.code);
			response.setHeader('Content-Type', 'image/png');
			response.setHeader('Content-Disposition', `inline; filename="${filename}.png"`);
			return response.send(png);
		}
		const svg = await generateQrSvg(qr.code);
		response.setHeader('Content-Type', 'image/svg+xml');
		response.setHeader('Content-Disposition', `inline; filename="${filename}.svg"`);
		return response.send(svg);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/print', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const filters = qrPrintFilterSchema.parse({ status: request.query.status, vendor_id: request.query.vendor_id, assignment: request.query.assignment, code: request.query.code });
		const { page, limit, skip } = pagination(request.query);

		const where = {
			...(filters.code ? { code: filters.code } : {}),
			...(filters.status ? { status: filters.status } : {}),
			...(filters.vendor_id ? { assignments: { some: { vendorId: filters.vendor_id, unassignedAt: null } } } : {}),
			...qrAssignmentWhere(filters.assignment),
		};

		const [qrCodes, total] = await Promise.all([
			prisma.qrCode.findMany({
				where,
				skip,
				take: limit,
				orderBy: { code: 'asc' },
				include: { assignments: { where: { unassignedAt: null }, include: { vendor: { select: { businessName: true } } }, take: 1 } },
			}),
			prisma.qrCode.count({ where }),
		]);

		const cards = await Promise.all(qrCodes.map(async (qr) => {
			const vendor = qr.assignments[0]?.vendor;
			const svg = await generateQrSvg(qr.code);
			return `<div class="qr-card">${svg}<p class="qr-code">${escapeHtml(qr.code)}</p><p class="qr-status">${escapeHtml(qr.status)}</p><p class="qr-vendor">${vendor ? escapeHtml(vendor.businessName) : 'Unassigned'}</p></div>`;
		}));

		const totalPages = Math.max(Math.ceil(total / limit), 1);
		const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Solarium QR Print Sheet</title>
<style>
	body { background: #fffaf2; color: #18332d; font-family: Arial, sans-serif; margin: 2rem; }
	header { margin-bottom: 1.5rem; }
	header h1 { font-size: 1.4rem; margin: 0 0 .3rem; }
	header p { color: #597069; font-size: .85rem; margin: 0; }
	.qr-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
	.qr-card { border: 1px solid #cbd8cc; break-inside: avoid; page-break-inside: avoid; padding: .75rem; text-align: center; }
	.qr-card svg { height: auto; max-width: 160px; width: 100%; }
	.qr-code { font-weight: 700; margin: .5rem 0 .15rem; }
	.qr-status, .qr-vendor { color: #597069; font-size: .8rem; margin: 0; }
	.empty-state { color: #9a8f80; }
	@media print { body { margin: .5in; } }
</style>
</head>
<body>
	<header>
		<h1>Solarium QR Print Sheet</h1>
		<p>Status: ${filters.status ? escapeHtml(filters.status) : 'All'} &middot; Assignment: ${filters.assignment ? escapeHtml(filters.assignment) : 'All'} &middot; Vendor filter: ${filters.vendor_id ? escapeHtml(filters.vendor_id) : 'None'} &middot; Showing ${qrCodes.length} of ${total} (page ${page} of ${totalPages}, ${limit} per page) &middot; Generated ${new Date().toISOString()}</p>
	</header>
	${qrCodes.length ? `<div class="qr-grid">${cards.join('')}</div>` : '<p class="empty-state">No QR codes match this filter.</p>'}
</body>
</html>`;

		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		return response.send(html);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/pdf', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const filters = qrPrintFilterSchema.parse({ status: request.query.status, vendor_id: request.query.vendor_id, assignment: request.query.assignment, code: request.query.code });

		const where = {
			...(filters.code ? { code: filters.code } : {}),
			...(filters.status ? { status: filters.status } : {}),
			...(filters.vendor_id ? { assignments: { some: { vendorId: filters.vendor_id, unassignedAt: null } } } : {}),
			...qrAssignmentWhere(filters.assignment),
		};

		const qrCodes = await prisma.qrCode.findMany({
			where,
			orderBy: { code: 'asc' },
			take: 5000,
			select: { code: true },
		});

		if (!qrCodes.length) {
			const message = filters.code
				? `No QR code matching "${filters.code}" was found.`
				: 'No QR codes match this filter.';
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message } });
		}

		response.setHeader('Content-Type', 'application/pdf');
		response.setHeader(
			'Content-Disposition',
			`attachment; filename="${filters.code ? safeFilenameSegment(filters.code) : 'solarium-qr-codes'}.pdf"`
		);

		// Only the QR image itself goes on the page — no vendor name, status, or code text —
		// per explicit request that the PDF contain nothing but the scannable QR codes.
		const doc = new PDFDocument({ size: 'A4', margin: 24 });
		doc.pipe(response);

		const cols = 4;
		const cellSize = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / cols;
		const rowsPerPage = Math.floor((doc.page.height - doc.page.margins.top - doc.page.margins.bottom) / cellSize);
		const perPage = cols * rowsPerPage;
		const padding = 10;

		for (let index = 0; index < qrCodes.length; index += 1) {
			const positionOnPage = index % perPage;
			if (index > 0 && positionOnPage === 0) {
				doc.addPage();
			}
			const col = positionOnPage % cols;
			const row = Math.floor(positionOnPage / cols);
			const x = doc.page.margins.left + col * cellSize + padding / 2;
			const y = doc.page.margins.top + row * cellSize + padding / 2;
			const size = cellSize - padding;

			// eslint-disable-next-line no-await-in-loop
			const png = await generateQrPng(qrCodes[index].code);
			doc.image(png, x, y, { width: size, height: size });
		}

		doc.end();
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/vendors', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const where = { status: { not: 'DELETED' } };
		const [vendors, total] = await Promise.all([
			prisma.vendor.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
				select: {
					id: true,
					businessName: true,
					ownerName: true,
					loginIdentifier: true,
					mobileNumber: true,
					status: true,
					salesUserId: true,
					createdAt: true,
					_count: { select: { leads: true } },
					assignments: { where: { unassignedAt: null }, select: { qrCode: { select: { code: true } } }, take: 1 },
				},
			}),
			prisma.vendor.count({ where }),
		]);
		// Flatten Prisma's { _count: { leads } } shape to a plain leadCount field, and the
		// assignment relation to a plain currentQr/qrAssigned pair — the frontend previously
		// read a `vendor.currentQr` field that this endpoint never actually sent, so every
		// vendor silently showed "Unassigned" in the UI regardless of their real QR status.
		const vendorsWithExtras = vendors.map(({ _count, assignments, ...vendor }) => ({
			...vendor,
			leadCount: _count.leads,
			currentQr: assignments[0]?.qrCode.code || null,
			qrAssigned: assignments.length > 0,
		}));
		return response.json({ success: true, vendors: vendorsWithExtras, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/leads', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const [leads, total] = await Promise.all([
			prisma.lead.findMany({
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
					select: {
						id: true,
						vendorId: true,
						qrId: true,
						qrAssignmentId: true,
						scanId: true,
						customerName: true,
						phone: true,
						email: true,
						location: true,
						status: true,
						createdAt: true,
						vendor: { select: { businessName: true } },
						qr: { select: { code: true } },
						payout: { select: { id: true, status: true, paidAt: true, paidReference: true } },
						geoLocation: { select: { latitude: true, longitude: true, accuracy: true, capturedAt: true } },
					},
			}),
			prisma.lead.count(),
		]);
		return response.json({ success: true, leads, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

function csvCell(value) {
	const text = value === null || value === undefined ? '' : String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
	const lines = [headers.map(csvCell).join(',')];
	for (const row of rows) {
		lines.push(row.map(csvCell).join(','));
	}
	return lines.join('\r\n');
}

adminRoutes.get('/leads/export', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const leads = await prisma.lead.findMany({
			orderBy: { createdAt: 'desc' },
			select: {
				customerName: true,
				phone: true,
				email: true,
				location: true,
				status: true,
				createdAt: true,
				vendor: { select: { businessName: true, mobileNumber: true } },
				qr: { select: { code: true } },
				payout: { select: { status: true, paidReference: true } },
				geoLocation: { select: { latitude: true, longitude: true, accuracy: true } },
			},
		});

		const csv = toCsv(
			['Customer Name', 'Customer Phone', 'Customer Email', 'Location', 'GPS Latitude', 'GPS Longitude', 'GPS Accuracy (m)', 'Lead Status', 'Vendor Name', 'Vendor Mobile Number', 'QR Code', 'Payout Status', 'Payout Reference', 'Created At'],
			leads.map((lead) => [
				lead.customerName,
				lead.phone,
				lead.email,
				lead.location,
				lead.geoLocation?.latitude,
				lead.geoLocation?.longitude,
				lead.geoLocation?.accuracy,
				lead.status,
				lead.vendor?.businessName,
				lead.vendor?.mobileNumber,
				lead.qr?.code,
				lead.payout?.status,
				lead.payout?.paidReference,
				lead.createdAt.toISOString(),
			])
		);

		response.setHeader('Content-Type', 'text/csv; charset=utf-8');
		response.setHeader('Content-Disposition', 'attachment; filename="solarium-leads.csv"');
		return response.send(csv);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/scans', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const [scans, total] = await Promise.all([
			prisma.scan.findMany({
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
				select: { id: true, qrId: true, qrAssignmentId: true, vendorId: true, customerIdentityId: true, createdAt: true, qr: { select: { code: true } }, vendor: { select: { businessName: true } } },
			}),
			prisma.scan.count(),
		]);
		return response.json({ success: true, scans, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/payouts', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const [payouts, total] = await Promise.all([
			prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit, include: { vendor: { select: { businessName: true } } } }),
			prisma.payout.count(),
		]);
		return response.json({ success: true, payouts, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/audit-logs', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const [auditLogs, total] = await Promise.all([
			prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' }, skip, take: limit, include: { actor: { select: { name: true } } } }),
			prisma.auditLog.count(),
		]);
		return response.json({ success: true, audit_logs: auditLogs, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.patch('/leads/:leadId', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { status } = leadStatusSchema.parse(request.body);
		const lead = await prisma.$transaction(async (transaction) => {
			const updated = await transaction.lead.update({
				where: { id: request.params.leadId },
				data: { status },
				select: { id: true, status: true, vendorId: true },
			});

			if (status === 'CONVERTED') {
				const existingPayout = await transaction.payout.findUnique({ where: { leadId: updated.id }, select: { id: true } });
				if (!existingPayout) {
					const payout = await transaction.payout.create({
						data: {
							leadId: updated.id,
							vendorId: updated.vendorId,
							status: 'UNPAID',
						},
						select: { id: true },
					});
					await writeAudit(transaction, request, 'PAYOUT_CREATED_FOR_CONVERTED_LEAD', 'Payout', payout.id, { leadId: updated.id });
				}
			}

			await writeAudit(transaction, request, 'LEAD_STATUS_CHANGED', 'Lead', updated.id, { status });
			return updated;
		});
		return response.json({ success: true, lead: { id: lead.id, status: lead.status } });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'LEAD_NOT_FOUND';
			error.message = 'Lead was not found.';
		}
		return next(error);
	}
});

adminRoutes.post('/payouts/:payoutId/status', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { status, paid_reference: paidReference } = payoutStatusSchema.parse(request.body);
		const payout = await prisma.$transaction(async (transaction) => {
			const current = await transaction.payout.findUnique({ where: { id: request.params.payoutId } });
			if (!current) {
				const error = new Error('Payout was not found.');
				error.statusCode = 404;
				error.code = 'PAYOUT_NOT_FOUND';
				throw error;
			}

			if (status !== 'UNPAID' && !paidReference) {
				const error = new Error('Payment reference is required when marking a payout as partial or paid.');
				error.statusCode = 400;
				error.code = 'PAID_REFERENCE_REQUIRED';
				throw error;
			}

			const nextData = status === 'UNPAID'
				? { status: 'UNPAID', paidAt: null, paidById: null, paidReference: null }
				: {
					status,
					paidAt: status === 'PAID' ? new Date() : current.paidAt,
					paidById: request.auth.user.id,
					paidReference: paidReference || current.paidReference,
				};

			const updated = await transaction.payout.update({
				where: { id: current.id },
				// paid_at is only set once the payout reaches the final PAID state, not for a PARTIAL update.
				data: nextData,
			});
			await writeAudit(
				transaction,
				request,
				status === 'PAID' ? 'PAYOUT_MARKED_PAID' : status === 'PARTIAL' ? 'PAYOUT_MARKED_PARTIAL' : 'PAYOUT_MARKED_UNPAID',
				'Payout',
				updated.id,
				{ status, paidReference: status === 'UNPAID' ? null : paidReference }
			);
			return updated;
		});
		return response.json({ success: true, payout: { id: payout.id, status: payout.status, paidAt: payout.paidAt, paidReference: payout.paidReference } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Admin route is scaffolded but not implemented.' } }));
