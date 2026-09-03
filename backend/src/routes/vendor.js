import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireVendor } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import {
	clearSessionCookie,
	createVendorSession,
	hashPassword,
	normalizeLoginIdentifier,
	publicVendor,
	setSessionCookie,
	verifyPassword,
} from '../services/auth.js';
import { createVendorDocumentUrl, removeVendorDocument, uploadVendorDocument } from '../services/vendor-documents.js';

export const vendorRoutes = Router();

const loginSchema = z.object({
	login_identifier: z.string().trim().min(1),
	password: z.string().min(1),
});

const passwordSchema = z.object({
	current_password: z.string().min(1),
	new_password: z.string().min(8),
});
const bankDetailsSchema = z.object({
	upi_number: z.string().optional(),
	upi_id: z.string().optional(),
	account_holder_name: z.string().optional(),
	account_number: z.string().optional(),
	ifsc_code: z.string().optional(),
});
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 } });

function pagination(query) {
	const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
	const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100);
	return { page, limit, skip: (page - 1) * limit };
}

function invalidCredentials() {
	const error = new Error('Invalid credentials.');
	error.statusCode = 401;
	error.code = 'INVALID_CREDENTIALS';
	return error;
}

vendorRoutes.post('/login', authRateLimit, async (request, response, next) => {
	try {
		const input = loginSchema.parse(request.body);
		const identifier = normalizeLoginIdentifier(input.login_identifier);
		const vendor = await prisma.vendor.findFirst({
			where: { OR: [{ loginIdentifier: identifier }, { mobileNumber: input.login_identifier.trim() }] },
		});

		if (!vendor || vendor.status !== 'ACTIVE' || !vendor.passwordHash || !(await verifyPassword(input.password, vendor.passwordHash))) {
			return next(invalidCredentials());
		}

		const token = await createVendorSession(vendor.id);
		setSessionCookie(response, token, 'VENDOR');
		return response.json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.post('/logout', requireAuth, requireVendor, async (request, response, next) => {
	try {
		await prisma.session.update({ where: { id: request.auth.sessionId }, data: { revokedAt: new Date() } });
		clearSessionCookie(response, 'VENDOR');
		return response.json({ success: true });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.post('/change-password', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const input = passwordSchema.parse(request.body);
		if (!(await verifyPassword(input.current_password, request.auth.vendor.passwordHash))) {
			return next(invalidCredentials());
		}
		const vendor = await prisma.vendor.update({
			where: { id: request.auth.vendor.id },
			data: { passwordHash: await hashPassword(input.new_password), mustChangePassword: false },
		});
		return response.json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.get('/profile', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const { vendor } = request.auth;
		const assignment = await prisma.qrAssignment.findFirst({
			where: { vendorId: vendor.id, unassignedAt: null },
			select: { qrCode: { select: { code: true } } },
		});
		return response.json({
			success: true,
			vendor: publicVendor(vendor),
			currentQr: assignment?.qrCode.code || null,
			qrAssigned: Boolean(assignment),
		});
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.get('/bank-details', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const details = await prisma.vendorBankDetails.findUnique({ where: { vendorId: request.auth.vendor.id } });
		if (!details) return response.json({ success: true, bank_details: null });
		const [passbookUrl, chequeUrl] = await Promise.all([
			createVendorDocumentUrl(details.passbookObjectKey),
			createVendorDocumentUrl(details.chequeObjectKey),
		]);
		return response.json({ success: true, bank_details: { ...details, passbookObjectKey: undefined, chequeObjectKey: undefined, passbookUrl, chequeUrl } });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.patch('/bank-details', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const input = bankDetailsSchema.parse(request.body);
		const details = await prisma.vendorBankDetails.upsert({
			where: { vendorId: request.auth.vendor.id },
			create: { vendorId: request.auth.vendor.id, upiNumber: input.upi_number, upiId: input.upi_id, accountHolderName: input.account_holder_name, accountNumber: input.account_number, ifscCode: input.ifsc_code },
			update: { upiNumber: input.upi_number, upiId: input.upi_id, accountHolderName: input.account_holder_name, accountNumber: input.account_number, ifscCode: input.ifsc_code },
		});
		return response.json({ success: true, bank_details: { ...details, passbookObjectKey: undefined, chequeObjectKey: undefined } });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.post('/bank-details/:documentType', requireAuth, requireVendor, documentUpload.single('file'), async (request, response, next) => {
	try {
		const type = request.params.documentType;
		if (!['passbook', 'cheque'].includes(type)) {
			const error = new Error('Document type must be passbook or cheque.');
			error.statusCode = 400;
			error.code = 'INVALID_DOCUMENT_TYPE';
			throw error;
		}
		const uploaded = await uploadVendorDocument(request.auth.vendor.id, type, request.file);
		const existing = await prisma.vendorBankDetails.findUnique({ where: { vendorId: request.auth.vendor.id } });
		const data = type === 'passbook'
			? { passbookObjectKey: uploaded.objectKey, passbookFileName: uploaded.fileName, passbookFileSize: uploaded.fileSize, passbookContentType: uploaded.contentType }
			: { chequeObjectKey: uploaded.objectKey, chequeFileName: uploaded.fileName, chequeFileSize: uploaded.fileSize, chequeContentType: uploaded.contentType };
		await prisma.vendorBankDetails.upsert({ where: { vendorId: request.auth.vendor.id }, create: { vendorId: request.auth.vendor.id, ...data }, update: data });
		const previousKey = type === 'passbook' ? existing?.passbookObjectKey : existing?.chequeObjectKey;
		await removeVendorDocument(previousKey);
		return response.json({ success: true, document: { type, fileName: uploaded.fileName, fileSize: uploaded.fileSize } });
	} catch (error) {
		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			error.statusCode = 413;
			error.code = 'DOCUMENT_TOO_LARGE';
			error.message = 'Documents must be 200 KB or smaller.';
		}
		return next(error);
	}
});

vendorRoutes.get('/leads', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const vendorId = request.auth.vendor.id;
		const [leads, total] = await Promise.all([
			prisma.lead.findMany({
				where: { vendorId },
				select: { id: true, customerName: true, email: true, location: true, pincode: true, averageElectricityBill: true, solarSize: true, status: true, createdAt: true, qr: { select: { code: true } } },
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
			}),
			prisma.lead.count({ where: { vendorId } }),
		]);
		return response.json({ success: true, leads, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.get('/payouts', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const vendorId = request.auth.vendor.id;
		const [payouts, total] = await Promise.all([
			prisma.payout.findMany({
				where: { vendorId },
				select: { id: true, leadId: true, status: true, paidAt: true, paidReference: true, createdAt: true },
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
			}),
			prisma.payout.count({ where: { vendorId } }),
		]);
		return response.json({ success: true, payouts, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});
