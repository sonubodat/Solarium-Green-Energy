import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireVendor, requireVendorReady } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import {
	clearSessionCookie,
	createVendorSession,
	checkVendorPassword,
	defaultVendorPassword,
	hashPassword,
	normalizeLoginIdentifier,
	publicVendor,
	setSessionCookie,
	verifyPassword,
} from '../services/auth.js';
import { createVendorDocumentUrl, removeVendorDocument, uploadVendorDocument } from '../services/vendor-documents.js';
import { ensureVendorQrWithin } from '../services/qr.js';
import { generateQrPng, generateQrSvg, publicReferralUrl } from '../services/qr-image.js';
import { generateQrTemplatePdf } from '../services/qr-proof.js';
import { buildTemplateSnapshot } from '../lib/auto-poster.js';
import { resolveVendorPosterTemplate } from '../services/vendor-poster.js';
import { runHeavy } from '../lib/heavy-queue.js';

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
		const typed = input.login_identifier.trim();
		const digits = defaultVendorPassword(typed);
		const phoneLike = digits.length === 10 && /^[+\d\s-]+$/.test(typed);
		// mobile_number is not unique and old/test/deleted vendors can share a phone, so every ACTIVE
		// vendor matching this identifier is tried and the first whose password matches signs in.
		const candidates = await prisma.vendor.findMany({
			where: {
				status: 'ACTIVE',
				OR: [{ loginIdentifier: identifier }, { mobileNumber: typed }, ...(phoneLike ? [{ mobileNumber: digits }, { loginIdentifier: digits }] : [])],
			},
			orderBy: { createdAt: 'desc' },
			take: 5,
		});

		let vendor = null;
		let needsHash = false;
		for (const candidate of candidates) {
			// eslint-disable-next-line no-await-in-loop
			const result = await checkVendorPassword(candidate, input.password);
			if (result.ok) {
				vendor = candidate;
				needsHash = result.needsHash;
				break;
			}
		}
		if (!vendor) return next(invalidCredentials());
		// No password was ever set: the phone number was the password. Store it now.
		if (needsHash) {
			await prisma.vendor.updateMany({ where: { id: vendor.id, passwordHash: null }, data: { passwordHash: await hashPassword(defaultVendorPassword(vendor.mobileNumber)) } });
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

// Runs on every login and session restore (the workspace loads it first), so it is also the lazy
// trigger for automatic QR provisioning: a Solar Mitra with no active QR gets a brand-new one
// (ensureVendorQr never touches an existing QR). That makes this GET perform an idempotent write,
// on purpose: no extra login API, and a failed attempt is simply retried by the next load.
// Provisioning failure NEVER blocks the profile: qrProvisioning reports 'failed' and the rest is normal.
vendorRoutes.get('/profile', requireAuth, requireVendor, async (request, response, next) => {
	try {
		const { vendor } = request.auth;
		const assignment = await prisma.qrAssignment.findFirst({
			where: { vendorId: vendor.id, unassignedAt: null },
			select: { qrCode: { select: { code: true } } },
		});
		let code = assignment?.qrCode.code || null;
		let qrProvisioning = 'ok';
		if (!code) {
			try {
				code = (await ensureVendorQrWithin(vendor.id)).code;
			} catch (error) {
				qrProvisioning = 'failed'; // failures are logged by the provisioning code; a slow run keeps going and the next load finds its QR
			}
		}
		return response.json({
			success: true,
			vendor: publicVendor(vendor),
			currentQr: code,
			qrAssigned: Boolean(code),
			qrProvisioning,
			...(code ? { referralUrl: publicReferralUrl(code), qrSvg: await generateQrSvg(code) } : {}),
		});
	} catch (error) {
		return next(error);
	}
});

// The caller's OWN active QR as a poster-ready PNG download (2048 px). There is deliberately no code
// parameter: the QR comes from the authenticated vendor's assignment, so no vendor can ever fetch
// another vendor's, or any inventory, QR. (SVG was removed from the vendor side on request.)
vendorRoutes.get('/qr/image', requireAuth, requireVendorReady, async (request, response, next) => {
	try {
		if (request.query.format !== 'png') {
			return response.status(400).json({ success: false, error: { code: 'INVALID_FORMAT', message: 'format must be png.' } });
		}
		const assignment = await prisma.qrAssignment.findFirst({
			where: { vendorId: request.auth.vendor.id, unassignedAt: null },
			select: { qrCode: { select: { code: true } } },
		});
		if (!assignment) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_ASSIGNED', message: 'You do not have a QR yet.' } });
		}
		const { code } = assignment.qrCode;
		response.setHeader('Content-Disposition', `attachment; filename="Solarium-QR-${code.replace(/[^A-Za-z0-9._-]/g, '-')}.png"`);
		response.setHeader('Content-Type', 'image/png');
		// A 2048 px PNG takes real CPU: queue it with the PDFs so many vendors at once never run in parallel.
		return response.send(await runHeavy(`png:${code}`, () => generateQrPng(code, 2048), 50));
	} catch (error) {
		return next(error);
	}
});

// The caller's OWN QR placed on the poster template Admin chose for Solar Mitras (set from Auto-QR posters or the
// Templates page; falls back to the newest published one, see services/vendor-poster.js), as a one-page PDF. Same rules as /qr/image: no code
// parameter, so a vendor can only ever get their own QR. It records no print job: this is a vendor
// self-download, and a job would count as "poster produced" for the QR replace rule.
vendorRoutes.get('/qr/poster', requireAuth, requireVendorReady, async (request, response, next) => {
	try {
		const assignment = await prisma.qrAssignment.findFirst({
			where: { vendorId: request.auth.vendor.id, unassignedAt: null },
			select: { qrCode: { select: { code: true } } },
		});
		if (!assignment) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_ASSIGNED', message: 'You do not have a QR yet.' } });
		}
		const template = await resolveVendorPosterTemplate();
		if (!template) {
			return response.status(404).json({ success: false, error: { code: 'POSTER_TEMPLATE_NOT_AVAILABLE', message: 'The poster is not available yet. Please try again later.' } });
		}
		const { code } = assignment.qrCode;
		// Queued one at a time like every PDF job; the same vendor double-clicking shares one run, and a burst of
		// vendors waits (up to 50) instead of getting "server busy".
		const pdf = await runHeavy(`poster:${template.id}:${code}`, () => generateQrTemplatePdf({
			templateSnapshot: buildTemplateSnapshot(template),
			items: [{ sequence: 1, expectedCode: code, expectedUrl: publicReferralUrl(code) }],
		}), 50);
		response.setHeader('Content-Disposition', `attachment; filename="Solarium-Poster-${code.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf"`);
		response.setHeader('Content-Type', 'application/pdf');
		return response.send(pdf);
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.get('/bank-details', requireAuth, requireVendorReady, async (request, response, next) => {
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

vendorRoutes.patch('/bank-details', requireAuth, requireVendorReady, async (request, response, next) => {
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

vendorRoutes.post('/bank-details/:documentType', requireAuth, requireVendorReady, documentUpload.single('file'), async (request, response, next) => {
	try {
		const type = request.params.documentType;
		if (!['passbook', 'cheque'].includes(type)) {
			const error = new Error('Document type must be passbook or cheque.');
			error.statusCode = 400;
			error.code = 'INVALID_DOCUMENT_TYPE';
			throw error;
		}
		const uploaded = await uploadVendorDocument(request.auth.vendor.id, type, request.file);
		try {
			const existing = await prisma.vendorBankDetails.findUnique({ where: { vendorId: request.auth.vendor.id } });
			const data = type === 'passbook'
				? { passbookObjectKey: uploaded.objectKey, passbookFileName: uploaded.fileName, passbookFileSize: uploaded.fileSize, passbookContentType: uploaded.contentType }
				: { chequeObjectKey: uploaded.objectKey, chequeFileName: uploaded.fileName, chequeFileSize: uploaded.fileSize, chequeContentType: uploaded.contentType };
			await prisma.vendorBankDetails.upsert({ where: { vendorId: request.auth.vendor.id }, create: { vendorId: request.auth.vendor.id, ...data }, update: data });
			const previousKey = type === 'passbook' ? existing?.passbookObjectKey : existing?.chequeObjectKey;
			await removeVendorDocument(previousKey);
		} catch (error) {
			await removeVendorDocument(uploaded.objectKey);
			throw error;
		}
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

vendorRoutes.get('/leads', requireAuth, requireVendorReady, async (request, response, next) => {
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

vendorRoutes.get('/payouts', requireAuth, requireVendorReady, async (request, response, next) => {
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
