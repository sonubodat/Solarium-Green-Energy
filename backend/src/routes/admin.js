import { Router } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createPasswordResetToken, resetTokenResponse } from '../services/password-reset.js';
import { assignUnassignedQr, generateQrCodes, reassignQr } from '../services/qr.js';
import { generateQrPng, generateQrSvg } from '../services/qr-image.js';
import PDFDocument from 'pdfkit';
import { randomUUID } from 'node:crypto';
import { hashPassword, normalizeLoginIdentifier, publicVendor, slugifyVendorName, autoPasswordFor } from '../services/auth.js';
import { z } from 'zod';
import { createQrArtworkUrl, createVendorDocumentUrl, removeQrArtwork, removeVendorDocument, uploadQrArtwork, uploadQrProof, uploadVendorPhoto, removeVendorPhoto, createVendorPhotoUrl } from '../services/vendor-documents.js';
import { generateQrProof, generateQrTemplatePdf } from '../services/qr-proof.js';
import { QR_ARTWORK_MAX_BYTES } from '../lib/qr-artwork-limits.js';
import { artworkSizeWarning } from '../services/qr-artwork.js';
import { vendorSearchWhere, normalizeSearchInput, pickerPagination, PICKER_VENDOR_SELECT } from '../lib/vendor-search.js';
import { buildQrCodeSequence, normalizeQrCode, parseQrRange } from '../services/qr-print.js';
import { env } from '../config/env.js';
import { normalizePhone, customerHashFor, findExistingLeadByHash } from '../lib/customer-identity.js';
import { geoTagFields, resolveGeoTag } from '../lib/geo-tag.js';
import { billBands, solarSizeBands } from './public.js';
import { checkAuditLogRetention, acknowledgeAuditLogRetentionWarning } from '../lib/audit-retention.js';

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
const vendorCreateSchema = vendorSchema.extend(geoTagFields);
const vendorUpdateSchema = vendorSchema.partial().extend({
	status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']).optional(),
});
// Admin's geo-tag isn't live device GPS (typed or pasted instead — see PATCH
// .../vendors/:vendorId/location below), so the same field shape works for both create and
// "set/fix later," unlike Sales where only the latter has its own dedicated endpoint.
const vendorLocationSchema = z.object(geoTagFields);
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const leadStatusSchema = z.object({ status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'REJECTED', 'DUPLICATE']) });
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
const bulkDeleteSchema = z.object({
	ids: z.array(z.string().trim().min(1)).min(1).max(100),
});
// Two mutually exclusive modes: `names` (legacy, name-only, placeholder phones) or `rows`
// (real phone per row). Row-level problems in `rows` mode (missing/invalid phone, short
// password) are reported per row rather than failing the whole request, so the fields are
// loose here and validated row by row in the route.
const bulkCreateVendorsSchema = z.object({
	names: z.array(z.string().trim().min(2).max(160)).min(1).max(500).optional(),
	rows: z.array(z.object({
		name: z.string().trim().min(2).max(160),
		phone: z.string().max(40).optional(),
		password: z.string().max(200).optional(),
	})).min(1).max(500).optional(),
	auto_password: z.boolean().optional().default(false),
}).refine((value) => Boolean(value.names) !== Boolean(value.rows), {
	message: 'Provide either names or rows, not both.',
});
const BULK_VENDOR_MOBILE_RANGE_START = '9000010000';
const BULK_VENDOR_MOBILE_RANGE_END = '9000020000';
const vendorPurgeSchema = z.object({ confirm_vendor_name: z.string().trim().min(1).max(160) });
const importRowSchema = z.object({
	customer_name: z.string().trim().min(2).max(120),
	phone: z.string().trim().min(1),
});
const LEAD_STATUS_VALUES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'REJECTED', 'DUPLICATE'];
const MAX_IMPORT_ROWS = 2000;
const COMPANY_IMPORT_QR_CODE = 'COMPANY-IMPORT';
const COMPANY_IMPORT_VENDOR_LOGIN = 'company-import';

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

// Every CONVERTED lead must have exactly one UNPAID payout row. Shared by the manual status
// change below and by CSV import, so the invariant can't drift between the two entry points.
async function ensurePayoutForConvertedLead(transaction, request, lead) {
	const existingPayout = await transaction.payout.findUnique({ where: { leadId: lead.id }, select: { id: true } });
	if (existingPayout) return;
	const payout = await transaction.payout.create({
		data: { leadId: lead.id, vendorId: lead.vendorId, status: 'UNPAID' },
		select: { id: true },
	});
	await writeAudit(transaction, request, 'PAYOUT_CREATED_FOR_CONVERTED_LEAD', 'Payout', payout.id, { leadId: lead.id });
}

// A CSV-imported lead didn't come from any real QR scan or vendor referral, but Lead.qrId and
// Lead.vendorId (needed so the CONVERTED->Payout invariant above works unmodified) are still
// required. This mirrors ensureGeneralAssignment() in public.js (the existing "Solarium Direct"
// fallback for scanless public submissions) with one dedicated, lazily-upserted sentinel vendor
// + QR code — but skips creating a Scan/QrAssignment, since no scan ever happened and those FKs
// are nullable on Lead.
async function ensureCompanyImportVendor(transaction) {
	const vendor = await transaction.vendor.upsert({
		where: { loginIdentifier: COMPANY_IMPORT_VENDOR_LOGIN },
		create: {
			businessName: 'Company Uploaded Leads',
			ownerName: 'Solarium Team',
			loginIdentifier: COMPANY_IMPORT_VENDOR_LOGIN,
			mobileNumber: '9000000001',
			mustChangePassword: false,
			status: 'ACTIVE',
		},
		update: {},
		select: { id: true, businessName: true },
	});
	const qr = await transaction.qrCode.upsert({
		where: { code: COMPANY_IMPORT_QR_CODE },
		create: { code: COMPANY_IMPORT_QR_CODE, status: 'ACTIVE' },
		update: {},
		select: { id: true },
	});
	return { vendorId: vendor.id, businessName: vendor.businessName, qrId: qr.id };
}

function normalizeImportStatus(rawStatus) {
	if (!rawStatus) return 'NEW';
	const trimmed = String(rawStatus).trim().toLowerCase();
	return LEAD_STATUS_VALUES.find((value) => value.toLowerCase() === trimmed) || 'NEW';
}

function normalizeImportBand(rawValue, allowedValues) {
	if (!rawValue) return null;
	const trimmed = String(rawValue).trim().toLowerCase();
	return allowedValues.find((value) => value.toLowerCase() === trimmed) || null;
}

function parseImportDate(rawValue) {
	if (!rawValue) return new Date();
	const parsed = new Date(rawValue);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeMobile(value) {
	if (typeof value !== 'string') return '';
	const digits = value.replace(/\D/g, '');
	// Handles +91/91/0091-prefixed and pasted/formatted Indian numbers
	// (+91 98765 43210, 0091 9876543210, etc.) down to the bare 10 digits.
	if (digits.startsWith('0091') && digits.length === 14) return digits.slice(4);
	if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
	return digits;
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

		const retention = await checkAuditLogRetention(prisma);

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
			retention,
		});
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/vendors', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = vendorCreateSchema.parse(request.body);
		const mobileNumber = normalizeMobile(input.mobile_number);
		if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
			return response.status(400).json({ success: false, error: { code: 'INVALID_MOBILE_NUMBER', message: 'Enter a valid Indian mobile number.' } });
		}
		// Never blocks creation — a missing/incomplete geo-tag is fine, only a half-supplied
		// one (lat without lng or vice versa) is rejected, before anything is written.
		const geoTag = resolveGeoTag(input);
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
			if (geoTag) {
				await transaction.vendorOnboardingMedia.create({ data: { vendorId: created.id, ...geoTag } });
			}
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
			if (!/^[6-9]\d{9}$/.test(data.mobileNumber)) return response.status(400).json({ success: false, error: { code: 'INVALID_MOBILE_NUMBER', message: 'Enter a valid Indian mobile number.' } });
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

adminRoutes.post('/vendors/:vendorId/purge', requireAuth, requireAdmin, async (request, response, next) => {
	let bankDocumentKeys = [];
	let photoKeys = [];
	try {
		const { confirm_vendor_name: confirmation } = vendorPurgeSchema.parse(request.body);
		const vendor = await prisma.vendor.findUnique({
			where: { id: request.params.vendorId },
			include: { bankDetails: true, onboardingMedia: true },
		});
		if (!vendor) return response.status(404).json({ success: false, error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor was not found.' } });
		if (confirmation !== vendor.businessName) {
			return response.status(409).json({ success: false, error: { code: 'VENDOR_PURGE_CONFIRMATION_MISMATCH', message: 'Type the exact Vendor business name to confirm permanent cleanup.' } });
		}
		const payoutCount = await prisma.payout.count({ where: { vendorId: vendor.id } });
		if (payoutCount) {
			return response.status(409).json({ success: false, error: { code: 'VENDOR_PURGE_FINANCIAL_HISTORY', message: 'This Vendor has payout history. Financial records are preserved, so deactivate the Vendor instead.' } });
		}
		const [leadCount, scanCount, assignmentCount, registrationCount, sessionCount, resetTokenCount] = await Promise.all([
			prisma.lead.count({ where: { vendorId: vendor.id } }),
			prisma.scan.count({ where: { vendorId: vendor.id } }),
			prisma.qrAssignment.count({ where: { vendorId: vendor.id } }),
			prisma.vendorRegistration.count({ where: { vendorId: vendor.id } }),
			prisma.session.count({ where: { vendorId: vendor.id } }),
			prisma.passwordResetToken.count({ where: { vendorId: vendor.id } }),
		]);
		bankDocumentKeys = [vendor.bankDetails?.passbookObjectKey, vendor.bankDetails?.chequeObjectKey].filter(Boolean);
		photoKeys = [vendor.onboardingMedia?.shopPhotoObjectKey, vendor.onboardingMedia?.qrPlacementPhotoObjectKey].filter(Boolean);

		await prisma.$transaction(async (transaction) => {
			await transaction.lead.updateMany({
				where: { vendorId: vendor.id },
				data: { vendorNameSnapshot: vendor.businessName, vendorId: null, qrAssignmentId: null, scanId: null },
			});
			await transaction.scan.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.qrAssignment.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.vendorRegistration.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.session.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.passwordResetToken.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.vendorBankDetails.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.vendorOnboardingMedia.deleteMany({ where: { vendorId: vendor.id } });
			await transaction.vendor.delete({ where: { id: vendor.id } });
			await writeAudit(transaction, request, 'VENDOR_PURGED', 'Vendor', vendor.id, { businessName: vendor.businessName, preservedLeadName: vendor.businessName });
		});

		for (const objectKey of bankDocumentKeys) {
			try {
				await removeVendorDocument(objectKey);
			} catch (cleanupError) {
				console.error('Vendor purge document cleanup failed.', cleanupError);
			}
		}
		for (const objectKey of photoKeys) {
			try {
				await removeVendorPhoto(objectKey);
			} catch (cleanupError) {
				console.error('Vendor purge photo cleanup failed.', cleanupError);
			}
		}
		return response.json({ success: true, vendor_id: vendor.id, preserved_lead_vendor_name: vendor.businessName, removed: { leadsPreserved: leadCount, scans: scanCount, assignments: assignmentCount, registrations: registrationCount, sessions: sessionCount, resetTokens: resetTokenCount } });
	} catch (error) {
		if (error.code === 'P2003') {
			error.statusCode = 409;
			error.code = 'VENDOR_PURGE_RELATIONSHIP_BLOCKED';
			error.message = 'Vendor cleanup was blocked by a related record. No changes were committed; deactivate the Vendor instead.';
		}
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'VENDOR_NOT_FOUND';
			error.message = 'Vendor was not found or was already purged.';
		}
		return next(error);
	}
});

adminRoutes.post('/vendors/bulk-delete', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { ids } = bulkDeleteSchema.parse(request.body);
		const vendorIds = [...new Set(ids)];
		const vendors = await prisma.vendor.findMany({
			where: { id: { in: vendorIds } },
			select: {
				id: true,
				businessName: true,
				_count: { select: { leads: true, scans: true, payouts: true, assignments: true } },
				assignments: { where: { unassignedAt: null }, select: { id: true }, take: 1 },
			},
		});
		const byId = new Map(vendors.map((vendor) => [vendor.id, vendor]));
		const blocked = vendorIds.filter((id) => {
			const vendor = byId.get(id);
			return !vendor || vendor._count.leads > 0 || vendor._count.scans > 0 || vendor._count.payouts > 0 || vendor._count.assignments > 0;
		}).map((id) => {
			const vendor = byId.get(id);
			if (!vendor) return { id, name: id, reasons: ['VENDOR_NOT_FOUND'], message: 'Vendor was not found.' };
			const reasons = [];
			if (vendor.assignments.length) reasons.push('ACTIVE_QR_ASSIGNMENT');
			if (vendor._count.assignments) reasons.push('ASSIGNMENT_HISTORY');
			if (vendor._count.leads) reasons.push('LEAD_HISTORY');
			if (vendor._count.scans) reasons.push('SCAN_HISTORY');
			if (vendor._count.payouts) reasons.push('PAYOUT_HISTORY');
			return { id: vendor.id, name: vendor.businessName, reasons, message: 'This Vendor cannot be deleted. Deactivate it, and unlink or reassign its QR first if assigned.' };
		});
		if (blocked.length) {
			return response.status(409).json({ success: false, error: { code: 'BULK_DELETE_BLOCKED', message: 'No Vendors were deleted because one or more selected Vendors have protected history.', details: blocked } });
		}
		await prisma.$transaction(async (transaction) => {
			const current = await transaction.vendor.findMany({
				where: { id: { in: vendorIds } },
				select: { id: true, _count: { select: { leads: true, scans: true, payouts: true, assignments: true } } },
			});
			if (current.length !== vendorIds.length || current.some((vendor) => vendor._count.leads || vendor._count.scans || vendor._count.payouts || vendor._count.assignments)) {
				const error = new Error('A selected Vendor changed while the delete was being prepared. Refresh and try again.');
				error.statusCode = 409;
				error.code = 'BULK_DELETE_CONFLICT';
				throw error;
			}
			await transaction.vendor.updateMany({ where: { id: { in: vendorIds } }, data: { status: 'DELETED' } });
			await Promise.all(vendorIds.map((id) => writeAudit(transaction, request, 'VENDOR_DELETED', 'Vendor', id, { bulk: true, selectedCount: vendorIds.length })));
		});
		return response.json({ success: true, deleted: vendorIds, count: vendorIds.length });
	} catch (error) {
		return next(error);
	}
});

// Rows mode: a real phone number per Solar Mitra. The normalized phone is both the login
// identifier and the mobile number, so "phone as username" is literally true and the
// unique constraint on login_identifier backs up the duplicate check. The password is the
// row's own (trimmed) password, or the phone number when blank. must_change_password keeps
// its schema default (true), and the vendor routes refuse data access until it is cleared.
async function bulkCreateVendorsFromRows(request, response, rows) {
	const failures = [];
	const candidates = [];
	const seenPhones = new Set();

	rows.forEach((row, index) => {
		const rowNumber = index + 1;
		const fail = (reason) => failures.push({ row: rowNumber, businessName: row.name, reason });
		const phone = normalizeMobile(row.phone ?? '');
		if (!phone) return fail('MOBILE_REQUIRED');
		if (!/^[6-9]\d{9}$/.test(phone)) return fail('INVALID_MOBILE_NUMBER');
		const password = row.password?.trim() || phone;
		if (password.length < 8) return fail('PASSWORD_TOO_SHORT');
		if (seenPhones.has(phone)) return fail('PHONE_ALREADY_USED');
		seenPhones.add(phone);
		return candidates.push({ rowNumber, name: row.name, phone, password });
	});

	if (candidates.length) {
		const phones = candidates.map((candidate) => candidate.phone);
		const phoneSet = new Set(phones);
		// A DELETED vendor's mobile number may be reused, but login_identifier is unique
		// regardless of status, so an identifier equal to the phone still blocks the row.
		const existing = await prisma.vendor.findMany({
			where: { OR: [{ mobileNumber: { in: phones }, status: { not: 'DELETED' } }, { loginIdentifier: { in: phones } }] },
			select: { mobileNumber: true, loginIdentifier: true, status: true },
		});
		const taken = new Set();
		for (const vendor of existing) {
			if (phoneSet.has(vendor.loginIdentifier)) taken.add(vendor.loginIdentifier);
			if (vendor.status !== 'DELETED' && phoneSet.has(vendor.mobileNumber)) taken.add(vendor.mobileNumber);
		}
		for (let index = candidates.length - 1; index >= 0; index -= 1) {
			if (taken.has(candidates[index].phone)) {
				const [dropped] = candidates.splice(index, 1);
				failures.push({ row: dropped.rowNumber, businessName: dropped.name, reason: 'PHONE_ALREADY_USED' });
			}
		}
	}

	let createdCount = 0;
	if (candidates.length) {
		// scrypt is CPU-bound, not a DB round trip, so hashing the whole batch concurrently
		// never touches the connection pool.
		const data = await Promise.all(candidates.map(async (candidate) => ({
			businessName: candidate.name,
			ownerName: candidate.name,
			loginIdentifier: candidate.phone,
			mobileNumber: candidate.phone,
			passwordHash: await hashPassword(candidate.password),
		})));

		const result = await prisma.vendor.createMany({ data, skipDuplicates: true });
		createdCount = result.count;

		// Attribute rows to this request by phone + name so a row that lost a race to another
		// request claiming the same phone is reported rather than mistaken for ours.
		const inserted = await prisma.vendor.findMany({
			where: { loginIdentifier: { in: data.map((row) => row.loginIdentifier) } },
			select: { id: true, loginIdentifier: true, businessName: true, mobileNumber: true },
		});
		const insertedByPhone = new Map(inserted.map((row) => [row.loginIdentifier, row]));
		const created = [];
		candidates.forEach((candidate) => {
			const row = insertedByPhone.get(candidate.phone);
			if (row && row.businessName === candidate.name && row.mobileNumber === candidate.phone && created.length < createdCount) {
				created.push(row);
			} else {
				failures.push({ row: candidate.rowNumber, businessName: candidate.name, reason: 'PHONE_ALREADY_USED' });
			}
		});

		if (created.length) {
			await prisma.auditLog.createMany({
				data: created.map((row) => ({
					actorUserId: request.auth.user.id,
					actorRole: request.auth.user.role,
					action: 'VENDOR_BULK_CREATED',
					entity: 'Vendor',
					entityId: row.id,
					metadata: { batchSize: rows.length },
				})),
			});
			checkAuditLogRetention(prisma).catch((error) => console.error('[AuditRetention] cleanup failed:', error));
		}
		createdCount = created.length;
	}

	failures.sort((first, second) => first.row - second.row);
	return response.status(201).json({
		success: true,
		summary: { totalRows: rows.length, created: createdCount, failed: failures.length, failures },
	});
}

adminRoutes.post('/vendors/bulk-create', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { names, rows: importRows, auto_password: autoPassword } = bulkCreateVendorsSchema.parse(request.body);
		if (importRows) return await bulkCreateVendorsFromRows(request, response, importRows);

		// Measured against the real dev database: one prisma.$transaction() per row (each an
		// interactive BEGIN/INSERT/INSERT/COMMIT round trip) cost ~0.8s/row here — a 500-row
		// batch would take several minutes. Every field below is fully resolvable in memory
		// before touching the database, so the whole batch is built up-front and written with a
		// small, fixed number of bulk statements instead — regardless of how many names there are.
		const baseSlugs = names.map((name) => slugifyVendorName(name));
		const existingRows = await prisma.vendor.findMany({
			where: { loginIdentifier: { in: [...new Set(baseSlugs)] } },
			select: { loginIdentifier: true },
		});
		const usedIdentifiers = new Set(existingRows.map((row) => row.loginIdentifier));

		function resolveLoginIdentifier(baseSlug) {
			let candidate = baseSlug;
			let suffix = 2;
			while (usedIdentifiers.has(candidate)) {
				candidate = `${baseSlug}-${suffix}`;
				suffix += 1;
			}
			usedIdentifiers.add(candidate);
			return candidate;
		}

		// Placeholder mobile numbers live in a reserved band, distinct from the fixed numbers
		// used by the PUBLIC-GENERAL/COMPANY-IMPORT sentinel vendors, so they're recognizable as
		// "needs a real number" rather than colliding with either sentinel's identity. Not a
		// uniqueness requirement (mobile_number has no unique constraint) — just admin clarity.
		const lastPlaceholder = await prisma.vendor.findFirst({
			where: { mobileNumber: { gte: BULK_VENDOR_MOBILE_RANGE_START, lt: BULK_VENDOR_MOBILE_RANGE_END } },
			orderBy: { mobileNumber: 'desc' },
			select: { mobileNumber: true },
		});
		let nextMobile = lastPlaceholder ? Number(lastPlaceholder.mobileNumber) + 1 : Number(BULK_VENDOR_MOBILE_RANGE_START) + 1;

		// Password hashing (scrypt) is CPU-bound, not a DB round trip, so it's safe to run
		// concurrently across the whole batch without touching the connection pool at all.
		const rows = await Promise.all(names.map(async (businessName, index) => {
			const loginIdentifier = resolveLoginIdentifier(baseSlugs[index]);
			const mobileNumber = String(nextMobile + index);
			const passwordHash = autoPassword ? await hashPassword(autoPasswordFor(businessName)) : null;
			return { businessName, ownerName: businessName, loginIdentifier, mobileNumber, passwordHash };
		}));

		// Every loginIdentifier was just resolved to be unique both against the DB and within
		// this batch, so skipDuplicates only ever matters for a genuine race (another request
		// claiming the same identifier between the read above and this write) — rare, and
		// detected below by diffing the requested identifiers against what actually landed.
		await prisma.vendor.createMany({ data: rows, skipDuplicates: true });

		const insertedRows = await prisma.vendor.findMany({
			where: { loginIdentifier: { in: rows.map((row) => row.loginIdentifier) } },
			select: { id: true, loginIdentifier: true },
		});
		const insertedIdByIdentifier = new Map(insertedRows.map((row) => [row.loginIdentifier, row.id]));

		if (insertedRows.length) {
			await prisma.auditLog.createMany({
				data: insertedRows.map((row) => ({
					actorUserId: request.auth.user.id,
					actorRole: request.auth.user.role,
					action: 'VENDOR_BULK_CREATED',
					entity: 'Vendor',
					entityId: row.id,
					metadata: { batchSize: names.length },
				})),
			});
			// A bulk create can burst thousands of audit rows in one request — check retention
			// immediately rather than waiting for the next dashboard/audit-logs visit. Fire-and-
			// forget-but-logged so a retention hiccup never fails this response.
			checkAuditLogRetention(prisma).catch((error) => console.error('[AuditRetention] cleanup failed:', error));
		}

		const created = [];
		const failures = [];
		rows.forEach((row, index) => {
			const id = insertedIdByIdentifier.get(row.loginIdentifier);
			if (id) {
				created.push({ row: index + 1, id, businessName: row.businessName, loginIdentifier: row.loginIdentifier });
			} else {
				failures.push({ row: index + 1, businessName: row.businessName, reason: 'LOGIN_IDENTIFIER_TAKEN' });
			}
		});

		return response.status(201).json({
			success: true,
			summary: { totalRows: names.length, created: created.length, failed: failures.length, failures },
		});
	} catch (error) {
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

const qrTemplateSchema = z.object({
	name: z.string().trim().min(2).max(120),
	page_width_mm: z.coerce.number().min(50).max(500),
	page_height_mm: z.coerce.number().min(50).max(500),
	dpi: z.coerce.number().int().min(72).max(1200).default(300),
	qr_x: z.coerce.number().min(0).max(4000),
	qr_y: z.coerce.number().min(0).max(4000),
	qr_width: z.coerce.number().min(10).max(2000),
	qr_height: z.coerce.number().min(10).max(2000),
	label_enabled: z.coerce.boolean().default(false),
	label_text_x: z.coerce.number().min(0).max(4000).optional(),
	label_text_y: z.coerce.number().min(0).max(4000).optional(),
	label_font_size: z.coerce.number().min(8).max(80).optional(),
}).superRefine((value, context) => {
	if (value.qr_width !== value.qr_height) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['qr_width'], message: 'QR width and height must be equal.' });
	}
	if (value.qr_x + value.qr_width > value.page_width_mm) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['qr_x'], message: 'QR must fit inside the page width.' });
	}
	if (value.qr_y + value.qr_height > value.page_height_mm) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['qr_y'], message: 'QR must fit inside the page height.' });
	}
});

const qrBatchSchema = z.object({
	template_id: z.string().trim().min(1),
	range_start: z.string().trim().min(1),
	range_end: z.string().trim().min(1),
	idempotency_key: z.string().trim().min(1).optional(),
});
// busboy flags a file as over-limit when it reaches fileSize bytes *exactly*, so a limit of
// MAX would also reject a file of exactly MAX bytes. MAX + 1 makes the limit inclusive; the
// service-level check (file.size > MAX) is the exact gate.
const qrArtworkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: QR_ARTWORK_MAX_BYTES + 1 } });

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
		// One extra query for the codes on this page (<=100), newest print first, reduced to the
		// latest per code — the same shape as the active-assignment include above, not an N+1.
		const latestByQrCode = new Map();
		if (qrCodes.length) {
			const printed = await prisma.qrPrintJobItem.findMany({
				where: { qrCodeId: { in: qrCodes.map((qr) => qr.id) } },
				orderBy: { printJob: { createdAt: 'desc' } },
				select: {
					qrCodeId: true,
					printJob: { select: { id: true, kind: true, createdAt: true, generatedAt: true, template: { select: { id: true, name: true } } } },
				},
			});
			for (const item of printed) {
				if (latestByQrCode.has(item.qrCodeId)) continue;
				latestByQrCode.set(item.qrCodeId, {
					jobId: item.printJob.id,
					kind: item.printJob.kind,
					templateId: item.printJob.template.id,
					templateName: item.printJob.template.name,
					printedAt: item.printJob.generatedAt || item.printJob.createdAt,
				});
			}
		}
		const data = qrCodes.map((qr) => ({ ...qr, latestPrint: latestByQrCode.get(qr.id) || null }));
		return response.json({ success: true, data, pagination: { page, limit, total } });
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

adminRoutes.get('/qr/templates', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const templates = await prisma.qrPrintTemplate.findMany({
			orderBy: { createdAt: 'desc' },
			include: {
				createdBy: { select: { id: true, name: true, role: true } },
				// Surfaced as printJobCount below so the admin can "check by template" before
				// deciding whether Delete (safe, unused) or Archive (has history) applies.
				_count: { select: { printJobs: true } },
			},
		});
		// Split by kind in one grouped query so the usage label can say which prints exist
		// ("2 batches, 5 single prints") rather than an unexplained total.
		const kindCounts = await prisma.qrPrintJob.groupBy({ by: ['templateId', 'kind'], _count: { _all: true } });
		const countsByTemplate = new Map();
		for (const row of kindCounts) {
			const entry = countsByTemplate.get(row.templateId) || { batch: 0, single: 0 };
			entry[row.kind === 'SINGLE' ? 'single' : 'batch'] += row._count._all;
			countsByTemplate.set(row.templateId, entry);
		}
		const templatesWithArtwork = await Promise.all(templates.map(async ({ _count, ...template }) => ({
			...template,
			printJobCount: _count.printJobs,
			printJobCounts: countsByTemplate.get(template.id) || { batch: 0, single: 0 },
			artworkUrl: await createQrArtworkUrl(template.artworkPath),
		})));
		return response.json({ success: true, templates: templatesWithArtwork });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/templates', requireAuth, requireAdmin, qrArtworkUpload.single('artwork'), async (request, response, next) => {
	let uploadedArtwork = null;
	try {
		const input = qrTemplateSchema.parse(request.body);
		uploadedArtwork = request.file ? await uploadQrArtwork(request.auth.user.id, request.file) : null;
		const template = await prisma.qrPrintTemplate.create({
			data: {
				createdById: request.auth.user.id,
				name: input.name,
				artworkFileName: uploadedArtwork?.fileName ?? null,
				artworkPath: uploadedArtwork?.objectKey ?? null,
				artworkMimeType: uploadedArtwork?.contentType ?? null,
				pageWidthMm: input.page_width_mm,
				pageHeightMm: input.page_height_mm,
				dpi: input.dpi,
				qrX: input.qr_x,
				qrY: input.qr_y,
				qrWidth: input.qr_width,
				qrHeight: input.qr_height,
				labelEnabled: Boolean(input.label_enabled),
				labelTextX: input.label_text_x ?? null,
				labelTextY: input.label_text_y ?? null,
				labelFontSize: input.label_font_size ?? null,
				status: 'DRAFT',
			},
		});
		// Non-blocking: artwork is always stretched to the template page, so a size mismatch
		// distorts the design. The admin is told rather than silently given a stretched print.
		const artworkWarning = artworkSizeWarning(uploadedArtwork?.inspection, input.page_width_mm, input.page_height_mm);
		return response.status(201).json({ success: true, template, ...(artworkWarning ? { artworkWarning } : {}) });
	} catch (error) {
		if (uploadedArtwork?.objectKey) {
			try {
				await removeQrArtwork(uploadedArtwork.objectKey);
			} catch (cleanupError) {
				console.error('QR artwork cleanup failed after template creation error.', cleanupError);
			}
		}
		return next(error);
	}
});

adminRoutes.post('/qr/templates/:templateId/publish', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const template = await prisma.qrPrintTemplate.update({
			where: { id: request.params.templateId },
			data: { status: 'PUBLISHED' },
		});
		return response.json({ success: true, template });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'QR_TEMPLATE_NOT_FOUND';
			error.message = 'QR print template was not found.';
		}
		return next(error);
	}
});

// Only safe to hard-delete when nothing references it — QrPrintJob.templateId is a required
// FK with no cascade, and each job's own templateSnapshot (not the live template) is what
// actually renders its PDF/proof, so deleting an unused template can never break history.
// The usage check and the delete happen inside one transaction so a print job created by a
// different concurrent request between the two can't slip through undetected; if it still
// does (P2003 from the delete itself), that's caught below the same way.
adminRoutes.post('/qr/templates/:templateId/delete', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		let artworkPath = null;
		await prisma.$transaction(async (transaction) => {
			const template = await transaction.qrPrintTemplate.findUnique({ where: { id: request.params.templateId } });
			if (!template) {
				const error = new Error('QR print template was not found.');
				error.statusCode = 404;
				error.code = 'QR_TEMPLATE_NOT_FOUND';
				throw error;
			}
			const [batchCount, singleCount] = await Promise.all([
				transaction.qrPrintJob.count({ where: { templateId: template.id, kind: 'BATCH' } }),
				transaction.qrPrintJob.count({ where: { templateId: template.id, kind: 'SINGLE' } }),
			]);
			const printJobCount = batchCount + singleCount;
			if (printJobCount > 0) {
				// Single-code designed downloads count too: deleting the template would mean
				// destroying that print history, so archiving is offered instead.
				const parts = [batchCount ? `${batchCount} print batch(es)` : null, singleCount ? `${singleCount} single print(s)` : null].filter(Boolean);
				const error = new Error(`This template is used by ${parts.join(' and ')} and can't be deleted — archive it instead to remove it from future use.`);
				error.statusCode = 409;
				error.code = 'QR_TEMPLATE_HAS_PRINT_JOBS';
				error.details = { printJobCount, batchCount, singleCount };
				throw error;
			}
			artworkPath = template.artworkPath;
			await transaction.qrPrintTemplate.delete({ where: { id: template.id } });
			await writeAudit(transaction, request, 'QR_TEMPLATE_DELETED', 'QrPrintTemplate', template.id, { templateName: template.name, printJobCount: 0 });
		});

		// Only after the transaction has committed — a storage cleanup failure here must never
		// be reported as a delete failure, since the database row really is gone at this point.
		// Logged rather than silently swallowed, matching this session's established convention.
		if (artworkPath) {
			removeQrArtwork(artworkPath).catch((error) => console.error('[QrTemplate] artwork cleanup failed:', error));
		}

		return response.json({ success: true });
	} catch (error) {
		if (error.code === 'P2003') {
			error.statusCode = 409;
			error.code = 'QR_TEMPLATE_HAS_PRINT_JOBS';
			error.message = "This template is used by a print job and can't be deleted — archive it instead to remove it from future use.";
		}
		return next(error);
	}
});

// Archiving is reversible (see .../restore below) — the client may want an old design back in
// rotation later, and neither its artwork nor its past print jobs' rendering data are touched.
// Both /admin/qr/template-pdf and /admin/qr/print-batch already reject any non-PUBLISHED
// template independently of the admin UI's picker filtering, so this alone is a real,
// backend-enforced removal from future use, not just a UI-level hide.
adminRoutes.post('/qr/templates/:templateId/archive', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const template = await prisma.$transaction(async (transaction) => {
			const printJobCount = await transaction.qrPrintJob.count({ where: { templateId: request.params.templateId } });
			const updated = await transaction.qrPrintTemplate.update({
				where: { id: request.params.templateId },
				data: { status: 'ARCHIVED' },
			});
			await writeAudit(transaction, request, 'QR_TEMPLATE_ARCHIVED', 'QrPrintTemplate', updated.id, { templateName: updated.name, printJobCount });
			return updated;
		});
		return response.json({ success: true, template });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'QR_TEMPLATE_NOT_FOUND';
			error.message = 'QR print template was not found.';
		}
		return next(error);
	}
});

adminRoutes.post('/qr/templates/:templateId/restore', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const template = await prisma.$transaction(async (transaction) => {
			const updated = await transaction.qrPrintTemplate.update({
				where: { id: request.params.templateId },
				data: { status: 'PUBLISHED' },
			});
			await writeAudit(transaction, request, 'QR_TEMPLATE_RESTORED', 'QrPrintTemplate', updated.id, { templateName: updated.name });
			return updated;
		});
		return response.json({ success: true, template });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'QR_TEMPLATE_NOT_FOUND';
			error.message = 'QR print template was not found.';
		}
		return next(error);
	}
});

const printJobFilterSchema = z.object({
	template_id: z.string().trim().min(1).optional(),
	kind: z.enum(['BATCH', 'SINGLE']).optional(),
	code: z.string().trim().min(1).optional(),
	vendor_id: z.string().trim().min(1).optional(),
	vendor: z.string().trim().min(1).max(160).optional(),
});

// Shared by the print-history list and its CSV export so the two can never disagree.
function printJobWhere(query) {
	const filters = printJobFilterSchema.parse({
		template_id: query.template_id || undefined,
		kind: query.kind || undefined,
		code: query.code || undefined,
		vendor_id: query.vendor_id || undefined,
		vendor: query.vendor || undefined,
	});
	const and = [];
	if (filters.template_id) and.push({ templateId: filters.template_id });
	if (filters.kind) and.push({ kind: filters.kind });
	if (filters.code) and.push({ items: { some: { expectedCode: normalizeQrCode(filters.code) } } });
	if (filters.vendor_id) {
		and.push({ items: { some: { qrCode: { assignments: { some: { vendorId: filters.vendor_id, unassignedAt: null } } } } } });
	}
	// Name search rather than a picker: /admin/vendors/lookup deliberately excludes vendors that
	// already hold an active QR, which is exactly the set this filter is about. Prefix match keeps
	// it index-friendly as the vendor table grows, per plan.md's search rule.
	if (filters.vendor) {
		and.push({
			items: {
				some: {
					qrCode: {
						assignments: {
							some: { unassignedAt: null, vendor: { businessName: { startsWith: filters.vendor, mode: 'insensitive' } } },
						},
					},
				},
			},
		});
	}
	return and.length ? { AND: and } : {};
}

function currentVendorOf(qrCode) {
	const assignment = qrCode?.assignments?.[0];
	return assignment ? { id: assignment.vendor.id, businessName: assignment.vendor.businessName } : null;
}

adminRoutes.get('/qr/print-jobs', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const where = printJobWhere(request.query);
		const [jobs, total] = await Promise.all([
			prisma.qrPrintJob.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
				include: {
					template: { select: { id: true, name: true, status: true } },
					createdBy: { select: { id: true, name: true } },
				},
			}),
			prisma.qrPrintJob.count({ where }),
		]);
		return response.json({ success: true, print_jobs: jobs, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/print-jobs/:jobId', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const job = await prisma.qrPrintJob.findUnique({
			where: { id: request.params.jobId },
			include: {
				template: { select: { id: true, name: true, status: true } },
				createdBy: { select: { id: true, name: true } },
				items: {
					orderBy: { sequence: 'asc' },
					include: {
						qrCode: {
							select: {
								id: true,
								code: true,
								status: true,
								assignments: { where: { unassignedAt: null }, take: 1, include: { vendor: { select: { id: true, businessName: true } } } },
							},
						},
					},
				},
			},
		});
		if (!job) {
			return response.status(404).json({ success: false, error: { code: 'QR_PRINT_JOB_NOT_FOUND', message: 'Print job was not found.' } });
		}
		const { items, ...rest } = job;
		return response.json({
			success: true,
			print_job: rest,
			items: items.map((item) => ({
				sequence: item.sequence,
				qrId: item.qrCodeId,
				code: item.expectedCode,
				qrStatus: item.qrCode?.status || null,
				currentVendor: currentVendorOf(item.qrCode),
			})),
		});
	} catch (error) {
		return next(error);
	}
});

// Bounded like every other export in this API; a print history larger than this is paged
// through the list endpoint rather than returned unbounded in one response.
const PRINT_HISTORY_EXPORT_LIMIT = 5000;

adminRoutes.get('/qr/print-history/export', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const items = await prisma.qrPrintJobItem.findMany({
			where: { printJob: printJobWhere(request.query) },
			orderBy: [{ printJob: { createdAt: 'desc' } }, { sequence: 'asc' }],
			take: PRINT_HISTORY_EXPORT_LIMIT,
			include: {
				printJob: { include: { template: { select: { id: true, name: true } }, createdBy: { select: { name: true } } } },
				qrCode: {
					select: {
						id: true,
						code: true,
						status: true,
						assignments: { where: { unassignedAt: null }, take: 1, include: { vendor: { select: { id: true, businessName: true } } } },
					},
				},
			},
		});
		const csv = toCsv(
			['QR Code', 'QR ID', 'Template', 'Template ID', 'Print Type', 'Print Job ID', 'Printed At', 'Printed By', 'Current Vendor', 'Vendor ID', 'QR Status'],
			items.map((item) => {
				const vendor = currentVendorOf(item.qrCode);
				return [
					item.expectedCode,
					item.qrCodeId,
					item.printJob.template?.name || '',
					item.printJob.templateId,
					item.printJob.kind,
					item.printJob.id,
					(item.printJob.generatedAt || item.printJob.createdAt).toISOString(),
					item.printJob.createdBy?.name || '',
					vendor?.businessName || '',
					vendor?.id || '',
					item.qrCode?.status || '',
				];
			}),
		);
		response.setHeader('Content-Type', 'text/csv; charset=utf-8');
		response.setHeader('Content-Disposition', 'attachment; filename="qr-print-history.csv"');
		return response.send(csv);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/:qrId/print-history', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const qr = await prisma.qrCode.findUnique({
			where: { id: request.params.qrId },
			select: {
				id: true,
				code: true,
				status: true,
				assignments: { where: { unassignedAt: null }, take: 1, include: { vendor: { select: { id: true, businessName: true } } } },
			},
		});
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'QR code was not found.' } });
		}
		// Every print of this code, newest first. Reprints add rows and never replace one.
		const prints = await prisma.qrPrintJobItem.findMany({
			where: { qrCodeId: qr.id },
			orderBy: { printJob: { createdAt: 'desc' } },
			include: { printJob: { include: { template: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } } } },
		});
		return response.json({
			success: true,
			qr: { id: qr.id, code: qr.code, status: qr.status },
			currentVendor: currentVendorOf(qr),
			prints: prints.map((item) => ({
				jobId: item.printJob.id,
				kind: item.printJob.kind,
				jobStatus: item.printJob.status,
				templateId: item.printJob.templateId,
				templateName: item.printJob.template?.name || null,
				printedAt: item.printJob.generatedAt || item.printJob.createdAt,
				printedBy: item.printJob.createdBy?.name || null,
				sequence: item.sequence,
			})),
		});
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/print-batch', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = qrBatchSchema.parse(request.body);
		const template = await prisma.qrPrintTemplate.findUnique({ where: { id: input.template_id } });
		if (!template) {
			return response.status(404).json({ success: false, error: { code: 'QR_TEMPLATE_NOT_FOUND', message: 'QR template was not found.' } });
		}
		if (template.status !== 'PUBLISHED') {
			return response.status(409).json({ success: false, error: { code: 'QR_TEMPLATE_NOT_PUBLISHED', message: 'Only published templates can be used to batch print QR codes.' } });
		}

		const range = parseQrRange(input.range_start, input.range_end);
		const codes = buildQrCodeSequence(range.start, range.end);
		const foundQrCodes = await prisma.qrCode.findMany({
			where: { code: { in: codes } },
			select: { id: true, code: true },
			orderBy: { code: 'asc' },
		});
		const foundByCode = new Map(foundQrCodes.map((qr) => [qr.code, qr]));
		const missing = codes.filter((code) => !foundByCode.has(code));
		if (missing.length) {
			if (env.nodeEnv !== 'development') {
				return response.status(409).json({ success: false, error: { code: 'QR_RANGE_MISSING_CODES', message: `The selected QR range is missing valid codes: ${missing.slice(0, 10).join(', ')}` } });
			}
			await prisma.qrCode.createMany({ data: missing.map((code) => ({ code })), skipDuplicates: true });
			const provisionedQrCodes = await prisma.qrCode.findMany({
				where: { code: { in: missing } },
				select: { id: true, code: true },
			});
			provisionedQrCodes.forEach((qr) => foundByCode.set(qr.code, qr));
		}

		const idempotencyKey = (input.idempotency_key || `qr-print-${randomUUID()}`).trim();
		const existing = await prisma.qrPrintJob.findUnique({ where: { idempotencyKey } });
		if (existing) {
			return response.status(200).json({ success: true, job: existing, duplicate: true });
		}

		const job = await prisma.$transaction(async (transaction) => {
			const created = await transaction.qrPrintJob.create({
				data: {
					templateId: template.id,
					createdById: request.auth.user.id,
					idempotencyKey,
					status: 'PENDING_APPROVAL',
					rangeStart: range.start,
					rangeEnd: range.end,
					itemCount: codes.length,
					templateSnapshot: {
						id: template.id,
						version: template.version,
						name: template.name,
						artworkPath: template.artworkPath,
						artworkMimeType: template.artworkMimeType,
						pageWidthMm: template.pageWidthMm,
						pageHeightMm: template.pageHeightMm,
						dpi: template.dpi,
						qrX: template.qrX,
						qrY: template.qrY,
						qrWidth: template.qrWidth,
						qrHeight: template.qrHeight,
						labelEnabled: template.labelEnabled,
						labelTextX: template.labelTextX,
						labelTextY: template.labelTextY,
						labelFontSize: template.labelFontSize,
					},
					proofSummary: { previewCodes: [codes[0], codes[Math.floor(codes.length / 2)], codes[codes.length - 1]], decoded: false },
				},
			});

			await Promise.all(codes.map((code, index) => transaction.qrPrintJobItem.create({
				data: {
					printJobId: created.id,
					qrCodeId: foundByCode.get(code).id,
					sequence: index + 1,
					expectedCode: code,
					expectedUrl: `${process.env.APP_BASE_URL || 'https://solariumenergy.in'}/v/${encodeURIComponent(code)}`,
					status: 'PROOF_READY',
				},
			}))); 

			return created;
		});

		return response.status(201).json({ success: true, job, proofCodes: [codes[0], codes[Math.floor(codes.length / 2)], codes[codes.length - 1]] });
	} catch (error) {
		if (error.code === 'P2002' && error.meta?.target?.includes('idempotency_key')) {
			error.statusCode = 409;
			error.code = 'QR_PRINT_DUPLICATE';
			error.message = 'A print batch with this idempotency key already exists.';
		}
		return next(error);
	}
});

adminRoutes.post('/qr/print-batch/:jobId/approve', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const existing = await prisma.qrPrintJob.findUnique({ where: { id: request.params.jobId }, select: { status: true, proofCheckedAt: true } });
		if (!existing) {
			return response.status(404).json({ success: false, error: { code: 'QR_PRINT_JOB_NOT_FOUND', message: 'QR print job was not found.' } });
		}
		if (existing.status !== 'PENDING_APPROVAL' || !existing.proofCheckedAt) {
			return response.status(409).json({ success: false, error: { code: 'QR_PROOF_APPROVAL_REQUIRED', message: 'A verified proof is required before approving this print job.' } });
		}
		const job = await prisma.qrPrintJob.update({
			where: { id: request.params.jobId },
			data: { status: 'APPROVED', approvedAt: new Date() },
		});
		return response.json({ success: true, job });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'QR_PRINT_JOB_NOT_FOUND';
			error.message = 'QR print job was not found.';
		}
		return next(error);
	}
});

adminRoutes.get('/qr/print-batch/:jobId/pdf', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const job = await prisma.qrPrintJob.findUnique({ where: { id: request.params.jobId }, include: { items: { orderBy: { sequence: 'asc' } } } });
		if (!job) return response.status(404).json({ success: false, error: { code: 'QR_PRINT_JOB_NOT_FOUND', message: 'Print batch was not found.' } });
		if (job.status !== 'APPROVED' && env.nodeEnv !== 'development') {
			return response.status(409).json({ success: false, error: { code: 'QR_PRINT_APPROVAL_REQUIRED', message: 'Approve the verified proof before downloading the production PDF.' } });
		}
		const pdf = await generateQrTemplatePdf(job);
		response.setHeader('Content-Type', 'application/pdf');
		response.setHeader('Content-Disposition', `${request.query.inline === 'true' ? 'inline' : 'attachment'}; filename="${safeFilenameSegment(job.rangeStart || job.id)}-template.pdf"`);
		return response.send(pdf);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/template-pdf', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const templateId = String(request.query.template_id || '').trim();
		const code = normalizeQrCode(request.query.code);
		if (!templateId || !code) {
			return response.status(400).json({ success: false, error: { code: 'QR_TEMPLATE_INPUT_REQUIRED', message: 'Select a template and enter a QR code.' } });
		}
		const [template, qr] = await Promise.all([
			prisma.qrPrintTemplate.findUnique({ where: { id: templateId } }),
			prisma.qrCode.findUnique({ where: { code }, select: { id: true, code: true } }),
		]);
		if (!template) return response.status(404).json({ success: false, error: { code: 'QR_TEMPLATE_NOT_FOUND', message: 'QR print template was not found.' } });
		if (template.status !== 'PUBLISHED' && env.nodeEnv !== 'development') {
			return response.status(409).json({ success: false, error: { code: 'QR_TEMPLATE_NOT_PUBLISHED', message: 'Only published templates can generate designed PDFs.' } });
		}
		if (!qr) return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: `No QR code matching "${code}" was found.` } });

		const job = {
			templateSnapshot: {
				version: template.version,
				name: template.name,
				artworkPath: template.artworkPath,
				artworkMimeType: template.artworkMimeType,
				pageWidthMm: template.pageWidthMm,
				pageHeightMm: template.pageHeightMm,
				dpi: template.dpi,
				qrX: template.qrX,
				qrY: template.qrY,
				qrWidth: template.qrWidth,
				qrHeight: template.qrHeight,
				labelEnabled: template.labelEnabled,
				labelTextX: template.labelTextX,
				labelTextY: template.labelTextY,
				labelFontSize: template.labelFontSize,
			},
			items: [{ sequence: 1, qrCodeId: qr.id, expectedCode: qr.code, expectedUrl: `${env.appBaseUrl}/v/${encodeURIComponent(qr.code)}` }],
		};
		const pdf = await generateQrTemplatePdf(job);

		// Recorded only once the PDF actually generated, so a failed download never writes
		// false print history. Stored as a one-item print job so batch and single prints share
		// a single history shape; a reprint adds another record and never overwrites this one.
		await prisma.$transaction(async (transaction) => {
			const printJob = await transaction.qrPrintJob.create({
				data: {
					templateId: template.id,
					createdById: request.auth.user.id,
					idempotencyKey: `single-${randomUUID()}`,
					kind: 'SINGLE',
					status: 'COMPLETED',
					rangeStart: qr.code,
					rangeEnd: qr.code,
					itemCount: 1,
					generatedAt: new Date(),
					templateSnapshot: job.templateSnapshot,
				},
			});
			await transaction.qrPrintJobItem.create({
				data: {
					printJobId: printJob.id,
					qrCodeId: qr.id,
					sequence: 1,
					expectedCode: qr.code,
					expectedUrl: job.items[0].expectedUrl,
					status: 'GENERATED',
				},
			});
		});

		response.setHeader('Content-Type', 'application/pdf');
		response.setHeader('Content-Disposition', `${request.query.inline === 'true' ? 'inline' : 'attachment'}; filename="${safeFilenameSegment(code)}-template.pdf"`);
		return response.send(pdf);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/print-batch/:jobId/proof', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const job = await prisma.qrPrintJob.findUnique({ where: { id: request.params.jobId }, include: { items: { orderBy: { sequence: 'asc' } } } });
		if (!job) return response.status(404).json({ success: false, error: { code: 'QR_PRINT_JOB_NOT_FOUND', message: 'QR print job was not found.' } });
		if (job.status !== 'PENDING_APPROVAL' && job.status !== 'PROOF_READY') {
			return response.status(409).json({ success: false, error: { code: 'QR_PROOF_INVALID_STATE', message: 'This print job is not waiting for proof generation.' } });
		}
		const proof = await generateQrProof(job);
		const uploaded = await uploadQrProof(job.id, proof.buffer);
		let updated;
		try {
			updated = await prisma.qrPrintJob.update({
				where: { id: job.id },
				data: {
					status: 'PENDING_APPROVAL',
					proofPath: uploaded.objectKey,
					proofFileName: uploaded.fileName,
					proofCheckedAt: new Date(),
					proofError: null,
					proofSummary: { representativeSequences: proof.verification.map((item) => item.sequence), verification: proof.verification },
				},
			});
		} catch (error) {
			try {
				await removeQrArtwork(uploaded.objectKey);
			} catch (cleanupError) {
				console.error('QR proof cleanup failed after job update error.', cleanupError);
			}
			throw error;
		}
		return response.status(201).json({ success: true, job: updated, verification: proof.verification });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/qr/print-batch/:jobId/proof', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const job = await prisma.qrPrintJob.findUnique({ where: { id: request.params.jobId }, select: { proofPath: true } });
		if (!job) return response.status(404).json({ success: false, error: { code: 'QR_PRINT_JOB_NOT_FOUND', message: 'Print batch was not found.' } });
		if (!job.proofPath) return response.status(404).json({ success: false, error: { code: 'QR_PROOF_NOT_READY', message: 'Proof has not been generated yet.' } });
		const proofUrl = await createQrArtworkUrl(job.proofPath);
		return response.json({ success: true, proof_url: proofUrl });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.post('/qr/:qrId/delete', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const qrId = request.params.qrId;
		await prisma.$transaction(async (transaction) => {
			const qr = await transaction.qrCode.findUnique({ where: { id: qrId } });
			if (!qr) {
				const error = new Error('QR code was not found.');
				error.statusCode = 404;
				error.code = 'QR_NOT_FOUND';
				throw error;
			}
			if (qr.status !== 'UNASSIGNED') {
				const error = new Error('Only an unassigned QR code can be deleted.');
				error.statusCode = 409;
				error.code = 'QR_NOT_UNASSIGNED';
				throw error;
			}

			// An unassigned QR can still be referenced by closed assignments, scans, leads,
			// or designed print history. Preserve those records instead of attempting a
			// delete that would either destroy attribution or fail on a foreign key.
			const [assignmentCount, scanCount, leadCount, printJobItemCount] = await Promise.all([
				transaction.qrAssignment.count({ where: { qrCodeId: qrId } }),
				transaction.scan.count({ where: { qrId } }),
				transaction.lead.count({ where: { qrId } }),
				transaction.qrPrintJobItem.count({ where: { qrCodeId: qrId } }),
			]);
			const history = { assignmentCount, scanCount, leadCount, printJobItemCount };
			if (Object.values(history).some((count) => count > 0)) {
				const error = new Error('This QR code has history and cannot be deleted.');
				error.statusCode = 409;
				error.code = 'QR_HAS_HISTORY';
				error.details = history;
				throw error;
			}

			await transaction.qrCode.delete({ where: { id: qrId } });
			await writeAudit(transaction, request, 'QR_DELETED', 'QrCode', qrId, { qrCode: qr.code });
		});
		return response.json({ success: true });
	} catch (error) {
		// The checks above make this unlikely, but keep a concurrent insert or a
		// production schema mismatch from leaking as a generic 500.
		if (error.code === 'P2003') {
			error.statusCode = 409;
			error.code = 'QR_HAS_HISTORY';
			error.message = 'This QR code has history and cannot be deleted.';
		}
		return next(error);
	}
});

adminRoutes.get('/qr/lookup/:code', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const normalizedCode = normalizeQrCode(request.params.code);
		const qr = await prisma.qrCode.findUnique({
			where: { code: normalizedCode },
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

adminRoutes.get('/vendors/bulk-import-template', requireAuth, requireAdmin, (request, response) => {
	// The password column header carries its own rule; the parser matches it by prefix, so a
	// plain "password" header works too. A blank password cell means "use the phone number".
	const csv = toCsv(['name', 'phone', 'password=phonenumber'], [['Ram Store', '9876543210', '']]);
	response.setHeader('Content-Type', 'text/csv; charset=utf-8');
	response.setHeader('Content-Disposition', 'attachment; filename="solar-mitras-import-template.csv"');
	return response.send(csv);
});

adminRoutes.get('/vendors/lookup', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { page, limit, skip } = pickerPagination(request.query);
		const search = vendorSearchWhere(request.query.search);
		// A Vendor already holding an active QR is excluded — the picker is for choosing a
		// vendor to assign/reassign an active QR to, and one active QR per Vendor is enforced here.
		const where = {
			status: 'ACTIVE',
			assignments: { none: { unassignedAt: null } },
			...(search ? { AND: [search] } : {}),
		};
		const [vendors, total] = await Promise.all([
			prisma.vendor.findMany({ where, orderBy: [{ businessName: 'asc' }, { id: 'asc' }], skip, take: limit, select: PICKER_VENDOR_SELECT }),
			prisma.vendor.count({ where }),
		]);
		return response.json({ success: true, vendors, pagination: { page, limit, total } });
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
		filters.code = filters.code ? normalizeQrCode(filters.code) : filters.code;
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
		filters.code = filters.code ? normalizeQrCode(filters.code) : filters.code;

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
		const search = vendorSearchWhere(request.query.search);
		// An exact vendor id also matches, so an id copied from Print History or an audit log
		// still finds its Solar Mitra (the previous client-side filter matched ids too).
		const where = {
			status: { not: 'DELETED' },
			...(search ? { AND: [{ OR: [...search.OR, { id: normalizeSearchInput(request.query.search) }] }] } : {}),
		};
		const [vendors, total] = await Promise.all([
			prisma.vendor.findMany({
				where,
				orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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
						vendorNameSnapshot: true,
						qrId: true,
						qrAssignmentId: true,
						scanId: true,
						customerName: true,
						phone: true,
						email: true,
						location: true,
						pincode: true,
						averageElectricityBill: true,
						solarSize: true,
						status: true,
						createdAt: true,
						vendor: { select: { businessName: true } },
						qr: { select: { code: true } },
											payout: { select: { id: true, status: true, paidAt: true, paidReference: true, vendorId: true } },
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
				pincode: true,
				averageElectricityBill: true,
				solarSize: true,
				status: true,
				createdAt: true,
				vendor: { select: { businessName: true, mobileNumber: true } },
				qr: { select: { code: true } },
				payout: { select: { status: true, paidReference: true } },
				geoLocation: { select: { latitude: true, longitude: true, accuracy: true } },
			},
		});

		const csv = toCsv(
			['Customer Name', 'Customer Phone', 'Customer Email', 'Location', 'Pincode', 'Average Electricity Bill', 'Solar Size', 'GPS Latitude', 'GPS Longitude', 'GPS Accuracy (m)', 'Lead Status', 'Vendor Name', 'Vendor Mobile Number', 'QR Code', 'Payout Status', 'Payout Reference', 'Created At'],
			leads.map((lead) => [
				lead.customerName,
				lead.phone,
				lead.email,
				lead.location,
				lead.pincode,
				lead.averageElectricityBill,
				lead.solarSize,
				lead.geoLocation?.latitude,
				lead.geoLocation?.longitude,
				lead.geoLocation?.accuracy,
				lead.status,
				lead.vendor?.businessName || `Deleted Vendor: ${lead.vendorNameSnapshot}`,
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

adminRoutes.get('/leads/import-template', requireAuth, requireAdmin, (request, response) => {
	const csv = toCsv(
		['customer_name', 'phone', 'email', 'location', 'pincode', 'average_electricity_bill', 'solar_size', 'status', 'created_at'],
		[['Jane Doe', '9876543210', 'jane@example.com', 'Pune, Maharashtra', '411001', '3-4k', '3-4 kW', 'NEW', '2026-01-15']]
	);
	response.setHeader('Content-Type', 'text/csv; charset=utf-8');
	response.setHeader('Content-Disposition', 'attachment; filename="leads-import-template.csv"');
	return response.send(csv);
});

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

adminRoutes.post('/leads/import', requireAuth, requireAdmin, csvUpload.single('file'), async (request, response, next) => {
	try {
		if (!request.file) {
			const error = new Error('Upload a CSV file.');
			error.statusCode = 400;
			error.code = 'CSV_FILE_REQUIRED';
			throw error;
		}
		if (!/\.csv$/i.test(request.file.originalname || '')) {
			const error = new Error('Upload a .csv file.');
			error.statusCode = 400;
			error.code = 'INVALID_CSV_FILE';
			throw error;
		}

		let records;
		try {
			records = parseCsv(request.file.buffer.toString('utf-8'), {
				columns: (headerRow) => headerRow.map((header) => header.trim().toLowerCase().replace(/\s+/g, '_')),
				trim: true,
				skip_empty_lines: true,
			});
		} catch (parseError) {
			const error = new Error('Could not read the CSV file. Check the format and try again.');
			error.statusCode = 400;
			error.code = 'CSV_PARSE_FAILED';
			throw error;
		}

		if (records.length === 0) {
			const error = new Error('The CSV file has no data rows.');
			error.statusCode = 400;
			error.code = 'CSV_EMPTY';
			throw error;
		}
		if (records.length > MAX_IMPORT_ROWS) {
			const error = new Error(`Import is limited to ${MAX_IMPORT_ROWS} rows per file. Split the file and try again.`);
			error.statusCode = 400;
			error.code = 'CSV_TOO_MANY_ROWS';
			throw error;
		}

		const companyVendor = await prisma.$transaction((transaction) => ensureCompanyImportVendor(transaction));

		const duplicates = [];
		const invalid = [];
		let imported = 0;

		for (let index = 0; index < records.length; index += 1) {
			const rowNumber = index + 2; // header is row 1
			const record = records[index];
			const nameInput = record.customer_name || record.name || '';
			const phoneInput = record.phone || record.mobile || record.mobile_number || '';

			const rowResult = importRowSchema.safeParse({ customer_name: nameInput, phone: phoneInput });
			if (!rowResult.success) {
				invalid.push({ row: rowNumber, reason: 'Missing or invalid customer name / phone number.' });
				continue;
			}

			const normalizedPhone = normalizePhone(rowResult.data.phone);
			if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
				invalid.push({ row: rowNumber, reason: 'Phone number is not a valid Indian mobile number.' });
				continue;
			}

			const customerHash = customerHashFor(normalizedPhone);
			const existingLead = await findExistingLeadByHash(customerHash);
			if (existingLead) {
				duplicates.push({ row: rowNumber, phone: normalizedPhone });
				continue;
			}

			const status = normalizeImportStatus(record.status);
			const email = record.email ? String(record.email).trim() || null : null;
			const location = record.location ? String(record.location).trim() || null : null;
			const pincode = record.pincode ? String(record.pincode).trim() || null : null;
			const averageElectricityBill = normalizeImportBand(record.average_electricity_bill, billBands);
			const solarSize = normalizeImportBand(record.solar_size, solarSizeBands);
			const createdAt = parseImportDate(record.created_at || record.date || record.lead_date);

			try {
				await prisma.$transaction(async (transaction) => {
					const customerIdentity = await transaction.customerIdentity.upsert({
						where: { hash: customerHash },
						create: { hash: customerHash },
						update: {},
						select: { id: true },
					});
					const createdLead = await transaction.lead.create({
						data: {
							vendorId: companyVendor.vendorId,
							vendorNameSnapshot: companyVendor.businessName,
							qrId: companyVendor.qrId,
							qrAssignmentId: null,
							scanId: null,
							customerIdentityId: customerIdentity.id,
							customerName: rowResult.data.customer_name,
							phone: normalizedPhone,
							email,
							location,
							pincode,
							averageElectricityBill,
							solarSize,
							status,
							createdAt,
						},
						select: { id: true, vendorId: true, status: true },
					});
					await writeAudit(transaction, request, 'LEAD_CSV_IMPORTED', 'Lead', createdLead.id, { phone: normalizedPhone, status });
					if (status === 'CONVERTED') {
						await ensurePayoutForConvertedLead(transaction, request, createdLead);
					}
				});
				imported += 1;
			} catch (rowError) {
				if (rowError.code === 'P2002') {
					duplicates.push({ row: rowNumber, phone: normalizedPhone });
				} else {
					invalid.push({ row: rowNumber, reason: 'Could not save this row.' });
				}
			}
		}

		// A CSV import can burst up to MAX_IMPORT_ROWS audit rows in one request — check
		// retention immediately rather than waiting for the next dashboard/audit-logs visit.
		// Fire-and-forget-but-logged so a retention hiccup never fails this response.
		if (imported > 0) {
			checkAuditLogRetention(prisma).catch((error) => console.error('[AuditRetention] cleanup failed:', error));
		}

		return response.status(201).json({
			success: true,
			summary: { totalRows: records.length, imported, duplicates, invalid },
		});
	} catch (error) {
		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			error.statusCode = 413;
			error.code = 'CSV_FILE_TOO_LARGE';
			error.message = 'CSV file must be 5 MB or smaller.';
		}
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
			prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit, include: { vendor: { select: { id: true, businessName: true } }, lead: { select: { customerName: true, status: true } } } }),
			prisma.payout.count(),
		]);
		return response.json({ success: true, payouts, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/audit-logs', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		// Run retention first so, if it trims anything, the list/count below already
		// reflects the post-cleanup state rather than momentarily showing stale rows.
		const retention = await checkAuditLogRetention(prisma);
		const { page, limit, skip } = pagination(request.query);
		const [auditLogs, total] = await Promise.all([
			prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' }, skip, take: limit, include: { actor: { select: { name: true } } } }),
			prisma.auditLog.count(),
		]);
		return response.json({ success: true, audit_logs: auditLogs, pagination: { page, limit, total }, retention });
	} catch (error) {
		return next(error);
	}
});

adminRoutes.get('/audit-logs/export', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const logs = await prisma.auditLog.findMany({
			orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
			include: { actor: { select: { name: true } } },
		});
		const csv = toCsv(
			['Timestamp', 'Action', 'Entity', 'Entity ID', 'Actor Name', 'Actor Role', 'Metadata'],
			logs.map((log) => [
				log.timestamp.toISOString(),
				log.action,
				log.entity,
				log.entityId,
				log.actor?.name,
				log.actorRole,
				log.metadata ? JSON.stringify(log.metadata) : '',
			])
		);
		// The download itself is the acknowledgment — only after the CSV has actually
		// been built, so a request that fails before this point never falsely acknowledges.
		await acknowledgeAuditLogRetentionWarning(prisma);
		response.setHeader('Content-Type', 'text/csv; charset=utf-8');
		response.setHeader('Content-Disposition', 'attachment; filename="solarium-audit-logs.csv"');
		return response.send(csv);
	} catch (error) {
		return next(error);
	}
});

adminRoutes.patch('/leads/:leadId', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const { status } = leadStatusSchema.parse(request.body);
		const lead = await prisma.$transaction(async (transaction) => {
			const current = await transaction.lead.findUnique({ where: { id: request.params.leadId }, select: { id: true, status: true, vendorId: true } });
			if (!current) {
				const error = new Error('Lead was not found.');
				error.statusCode = 404;
				error.code = 'LEAD_NOT_FOUND';
				throw error;
			}
			const updated = await transaction.lead.update({
				where: { id: request.params.leadId },
				data: { status },
				select: { id: true, status: true, vendorId: true },
			});

			if (status === 'CONVERTED') {
				await ensurePayoutForConvertedLead(transaction, request, updated);
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

adminRoutes.post('/leads/:leadId/delete', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const lead = await prisma.lead.findUnique({
			where: { id: request.params.leadId },
			select: { id: true, customerName: true, payout: { select: { status: true } } },
		});
		if (!lead) {
			return response.status(404).json({ success: false, error: { code: 'LEAD_NOT_FOUND', message: 'Lead was not found.' } });
		}
		// A payout that already recorded a real payment is financial history — protect it the
		// same way vendor/QR deletion protects their own history. An UNPAID payout carries no
		// such record yet, so it's safe to remove along with the lead.
		if (lead.payout && lead.payout.status !== 'UNPAID') {
			return response.status(409).json({
				success: false,
				error: { code: 'LEAD_PAYOUT_NOT_UNPAID', message: 'This lead has a paid or partially-paid payout and cannot be deleted.' },
			});
		}
		await prisma.$transaction(async (transaction) => {
			if (lead.payout) {
				await transaction.payout.delete({ where: { leadId: lead.id } });
			}
			await transaction.leadLocation.deleteMany({ where: { leadId: lead.id } });
			await transaction.lead.delete({ where: { id: lead.id } });
			await writeAudit(transaction, request, 'LEAD_DELETED', 'Lead', lead.id, { customerName: lead.customerName });
		});
		return response.json({ success: true });
	} catch (error) {
		if (error.code === 'P2025') {
			error.statusCode = 404;
			error.code = 'LEAD_NOT_FOUND';
			error.message = 'Lead was not found.';
		}
		return next(error);
	}
});

adminRoutes.get('/vendors/:vendorId/bank-details', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const details = await prisma.vendorBankDetails.findUnique({ where: { vendorId: request.params.vendorId }, include: { vendor: { select: { id: true, businessName: true } } } });
		if (!details) return response.json({ success: true, bank_details: null });
		const [passbookUrl, chequeUrl] = await Promise.all([
			createVendorDocumentUrl(details.passbookObjectKey),
			createVendorDocumentUrl(details.chequeObjectKey),
		]);
		return response.json({
			success: true,
			bank_details: {
				...details,
				passbookObjectKey: undefined,
				chequeObjectKey: undefined,
				passbookUrl,
				chequeUrl,
			},
		});
	} catch (error) {
		return next(error);
	}
});

// Coordinates plus signed URLs for both photos, mirroring GET .../bank-details.
adminRoutes.get('/vendors/:vendorId/onboarding-media', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const media = await prisma.vendorOnboardingMedia.findUnique({ where: { vendorId: request.params.vendorId } });
		if (!media) return response.json({ success: true, onboarding_media: null });
		const [shopPhotoUrl, qrPlacementPhotoUrl] = await Promise.all([
			createVendorPhotoUrl(media.shopPhotoObjectKey),
			createVendorPhotoUrl(media.qrPlacementPhotoObjectKey),
		]);
		return response.json({
			success: true,
			onboarding_media: {
				latitude: media.latitude,
				longitude: media.longitude,
				accuracy: media.accuracy,
				capturedAt: media.capturedAt,
				shopPhotoUrl,
				qrPlacementPhotoUrl,
			},
		});
	} catch (error) {
		return next(error);
	}
});

// "Set/fix later" for the geo-tag — unlike Sales' equivalent, this isn't live device GPS;
// Admin types or pastes coordinates (e.g. relayed by the Sales rep, or copied from Google
// Maps), so there's no ownership restriction, matching Admin's other vendor-mutation routes.
adminRoutes.patch('/vendors/:vendorId/location', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const input = vendorLocationSchema.parse(request.body);
		const geoTag = resolveGeoTag(input);
		if (!geoTag) {
			const error = new Error('Provide both latitude and longitude.');
			error.statusCode = 400;
			error.code = 'INVALID_LOCATION';
			throw error;
		}
		const vendor = await prisma.vendor.findUnique({ where: { id: request.params.vendorId }, select: { id: true } });
		if (!vendor) {
			return response.status(404).json({ success: false, error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor was not found.' } });
		}
		await prisma.vendorOnboardingMedia.upsert({
			where: { vendorId: vendor.id },
			create: { vendorId: vendor.id, ...geoTag },
			update: geoTag,
		});
		return response.json({ success: true });
	} catch (error) {
		return next(error);
	}
});

// Attaches (or replaces) a shop photo or a QR-placement photo (where the QR code sticker is
// placed in the shop) — used both right after creation and to complete/fix onboarding media
// later. No ownership restriction, matching Admin's other vendor-mutation routes (Admin
// doesn't scope by salesUserId the way Sales does).
adminRoutes.post('/vendors/:vendorId/photos/:photoType', requireAuth, requireAdmin, photoUpload.single('photo'), async (request, response, next) => {
	try {
		const type = request.params.photoType;
		if (!['shop', 'qr-placement'].includes(type)) {
			const error = new Error('Photo type must be shop or qr-placement.');
			error.statusCode = 400;
			error.code = 'INVALID_PHOTO_TYPE';
			throw error;
		}
		const vendor = await prisma.vendor.findUnique({ where: { id: request.params.vendorId }, select: { id: true } });
		if (!vendor) {
			return response.status(404).json({ success: false, error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor was not found.' } });
		}
		const uploaded = await uploadVendorPhoto(vendor.id, type, request.file);
		try {
			const existing = await prisma.vendorOnboardingMedia.findUnique({ where: { vendorId: vendor.id } });
			const data = type === 'shop'
				? { shopPhotoObjectKey: uploaded.objectKey, shopPhotoFileName: uploaded.fileName, shopPhotoFileSize: uploaded.fileSize, shopPhotoContentType: uploaded.contentType }
				: { qrPlacementPhotoObjectKey: uploaded.objectKey, qrPlacementPhotoFileName: uploaded.fileName, qrPlacementPhotoFileSize: uploaded.fileSize, qrPlacementPhotoContentType: uploaded.contentType };
			await prisma.vendorOnboardingMedia.upsert({ where: { vendorId: vendor.id }, create: { vendorId: vendor.id, ...data }, update: data });
			const previousKey = type === 'shop' ? existing?.shopPhotoObjectKey : existing?.qrPlacementPhotoObjectKey;
			await removeVendorPhoto(previousKey);
		} catch (dbError) {
			await removeVendorPhoto(uploaded.objectKey);
			throw dbError;
		}
		return response.json({ success: true, photo: { type, fileName: uploaded.fileName, fileSize: uploaded.fileSize } });
	} catch (error) {
		// A multer size-limit error never reaches here — it's thrown by multer's own
		// middleware before this handler runs, so Express routes it straight to the global
		// errorHandler (which distinguishes it by the 'photo' field name). Nothing to remap.
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
			if (current.status === 'PAID' && status !== 'PAID') {
				const error = new Error('A paid commission cannot be changed back without a reversal process.');
				error.statusCode = 409;
				error.code = 'PAYOUT_ALREADY_PAID';
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
