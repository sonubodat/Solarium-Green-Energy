import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSales } from '../middleware/auth.js';
import { hashPassword, defaultVendorPassword, normalizeLoginIdentifier, publicVendor } from '../services/auth.js';
import { assignUnassignedQr } from '../services/qr.js';
import { uploadVendorPhoto, removeVendorPhoto, uploadVendorDocument, removeVendorDocument, createVendorDocumentUrl } from '../services/vendor-documents.js';
import { geoTagFields, resolveGeoTag } from '../lib/geo-tag.js';
import { INDIAN_STATES } from '../lib/indian-states.js';
import { bankDetailsSchema, isBankDetailsSet } from '../lib/vendor-bank-details.js';
import { vendorSearchWhere, pickerPagination, PICKER_VENDOR_SELECT } from '../lib/vendor-search.js';

export const salesRoutes = Router();

// Blank/omitted password -> the vendor's phone number is their password until they change it.
const optionalPassword = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().min(8).optional());
const onboardingSchema = z.object({
	password: optionalPassword,
});

const qrAssignmentSchema = z.object({
	code: z.string().trim().min(1),
	vendor_id: z.string().trim().min(1),
});

const vendorCreateSchema = z.object({
	business_name: z.string().trim().min(2).max(160),
	owner_name: z.string().trim().min(2).max(120),
	login_identifier: z.string().trim().min(3).max(120),
	mobile_number: z.string().trim().min(10).max(20),
	password: optionalPassword,
	state: z.enum(INDIAN_STATES).optional(),
	...geoTagFields,
});

const vendorLocationSchema = z.object(geoTagFields);

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function pagination(query) {
	const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
	const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100);
	return { page, limit, skip: (page - 1) * limit };
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

async function writeAudit(transaction, request, action, entity, entityId, metadata = {}) {
	await transaction.auditLog.create({
		data: { actorUserId: request.auth.user.id, actorRole: request.auth.user.role, action, entity, entityId, metadata },
	});
}

salesRoutes.get('/qr/:code', requireAuth, requireSales, async (request, response, next) => {
	try {
		const qr = await prisma.qrCode.findUnique({ where: { code: request.params.code } });
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'QR code was not found.' } });
		}
		return response.json({ success: true, qr: { id: qr.id, code: qr.code, status: qr.status } });
	} catch (error) {
		return next(error);
	}
});

salesRoutes.post('/qr/assign', requireAuth, requireSales, async (request, response, next) => {
	try {
		const input = qrAssignmentSchema.parse(request.body);
		// Same OR-with-null ownership rule as GET /sales/vendors — a vendor with no salesUserId
		// isn't owned by anyone, so it must be assignable by any Sales user, not rejected here
		// after already being offered in that same user's picker.
		const vendor = await prisma.vendor.findFirst({
			where: { id: input.vendor_id, OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }] },
		});
		if (!vendor) {
			return response.status(403).json({ success: false, error: { code: 'VENDOR_NOT_ASSIGNED', message: 'Vendor is not assigned to this Sales user.' } });
		}
		const result = await assignUnassignedQr({
			code: input.code,
			vendorId: vendor.id,
			assignedById: request.auth.user.id,
			assignedByRole: request.auth.user.role,
		});
		return response.status(201).json({ success: true, qr: result.qr, assignment: result.assignment, vendor: publicVendor(result.vendor) });
	} catch (error) {
		return next(error);
	}
});

salesRoutes.get('/vendors', requireAuth, requireSales, async (request, response, next) => {
	try {
		const { page, limit, skip } = pickerPagination(request.query);
		const search = vendorSearchWhere(request.query.search);
		// Only the "Complete onboarding" picker asks for vendors that already hold a QR (shop
		// photos and the geo-tag are added after the QR is assigned); the QR-assign picker never
		// does, so one active QR per Vendor is still enforced there.
		const includeAssigned = request.query.include_assigned === 'true';
		// A Vendor with no salesUserId (e.g. created directly by Admin, not through any Sales
		// rep's onboarding flow) isn't owned by anyone — matches the same OR-with-null pattern
		// GET /sales/registrations uses, so an unclaimed resource is visible to every Sales user.
		// This is only what the picker OFFERS: the ownership checks on POST /sales/qr/assign and
		// the location/photo routes stay the real authorization boundary, because a caller can
		// always skip the picker and hit those endpoints directly.
		const where = {
			AND: [
				{ OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }] },
				{ status: 'ACTIVE' },
				...(includeAssigned ? [] : [{ assignments: { none: { unassignedAt: null } } }]),
				...(search ? [search] : []),
			],
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

salesRoutes.get('/registrations', requireAuth, requireSales, async (request, response, next) => {
	try {
		const { page, limit, skip } = pagination(request.query);
		const where = {
			status: 'PENDING',
			OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }],
		};
		const [registrations, total] = await Promise.all([
			prisma.vendorRegistration.findMany({
				where,
				orderBy: { createdAt: 'asc' },
				skip,
				take: limit,
			}),
			prisma.vendorRegistration.count({ where }),
		]);
		return response.json({ success: true, registrations, pagination: { page, limit, total } });
	} catch (error) {
		return next(error);
	}
});

salesRoutes.post('/vendors/:vendorId/onboard', requireAuth, requireSales, async (request, response, next) => {
	try {
		const input = onboardingSchema.parse(request.body);
		const registration = await prisma.vendorRegistration.findUnique({ where: { id: request.params.vendorId } });
		if (!registration || registration.status !== 'PENDING') {
			return response.status(404).json({ success: false, error: { code: 'REGISTRATION_NOT_FOUND', message: 'Pending registration was not found.' } });
		}
		if (registration.salesUserId && registration.salesUserId !== request.auth.user.id) {
			return response.status(403).json({ success: false, error: { code: 'REGISTRATION_NOT_ASSIGNED', message: 'This registration is assigned to another Sales user.' } });
		}

		const vendor = await prisma.$transaction(async (transaction) => {
			const createdVendor = await transaction.vendor.create({
				data: {
					businessName: registration.businessName,
					ownerName: registration.ownerName,
					loginIdentifier: registration.loginIdentifier,
					mobileNumber: registration.mobileNumber,
					passwordHash: await hashPassword(input.password || defaultVendorPassword(registration.mobileNumber)),
					mustChangePassword: true,
					salesUserId: request.auth.user.id,
				},
			});
			await transaction.vendorRegistration.update({
				where: { id: registration.id },
				data: { vendorId: createdVendor.id, salesUserId: request.auth.user.id, status: 'ONBOARDED' },
			});
			await writeAudit(transaction, request, 'VENDOR_CREATED', 'Vendor', createdVendor.id, { source: 'REGISTRATION' });
			return createdVendor;
		});

		return response.status(201).json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		if (error.code === 'P2002') {
			error.statusCode = 409;
			error.code = 'VENDOR_ALREADY_EXISTS';
			error.message = 'A Vendor already exists for these registration details.';
		}
		return next(error);
	}
});

// Lets a Sales user create a Vendor directly (the third path onto the platform, alongside
// self-registration-then-onboard and Admin's direct create) — no OTP/mobile verification,
// matching Admin's own direct-create route. Ownership is set to the creating Sales user,
// same as onboarding, so it respects the same visibility scoping everywhere else in this app.
salesRoutes.post('/vendors', requireAuth, requireSales, async (request, response, next) => {
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
					passwordHash: await hashPassword(input.password || mobileNumber),
					mustChangePassword: true,
					salesUserId: request.auth.user.id,
					state: input.state ?? null,
				},
			});
			if (geoTag) {
				await transaction.vendorOnboardingMedia.create({ data: { vendorId: created.id, ...geoTag } });
			}
			await writeAudit(transaction, request, 'VENDOR_CREATED', 'Vendor', created.id, { source: 'SALES_DIRECT' });
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

// "Complete later" for the geo-tag half of onboarding media — capturing GPS only means
// something if the capturing device is actually at the shop, so this stays Sales-only (no
// Admin equivalent). Same OR-with-null ownership rule as GET /vendors and POST /qr/assign:
// an unclaimed vendor (e.g. created directly by Admin) is completable by any Sales user.
salesRoutes.patch('/vendors/:vendorId/location', requireAuth, requireSales, async (request, response, next) => {
	try {
		const input = vendorLocationSchema.parse(request.body);
		const geoTag = resolveGeoTag(input);
		if (!geoTag) {
			const error = new Error('Provide both latitude and longitude.');
			error.statusCode = 400;
			error.code = 'INVALID_LOCATION';
			throw error;
		}
		const vendor = await prisma.vendor.findFirst({
			where: { id: request.params.vendorId, OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }] },
			select: { id: true },
		});
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
// placed in the shop) — used both right after creation and to complete onboarding media
// later. Same ownership rule as above.
salesRoutes.post('/vendors/:vendorId/photos/:photoType', requireAuth, requireSales, photoUpload.single('photo'), async (request, response, next) => {
	try {
		const type = request.params.photoType;
		if (!['shop', 'qr-placement'].includes(type)) {
			const error = new Error('Photo type must be shop or qr-placement.');
			error.statusCode = 400;
			error.code = 'INVALID_PHOTO_TYPE';
			throw error;
		}
		const vendor = await prisma.vendor.findFirst({
			where: { id: request.params.vendorId, OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }] },
			select: { id: true },
		});
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


// Sales fills bank details on the Solar Mitra's behalf (same fields and 200 KB documents as the
// vendor's own form, stored in the same VendorBankDetails row). Same ownership rule as above.
// Once anything has been saved, only Admin may change it (see isBankDetailsSet below) — Sales
// gets a locked, read-only view instead of silently overwriting what may already be verified.
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 } });

function bankDetailsLockedError() {
	const error = new Error('Bank details are already set for this Solar Mitra. Ask an Admin to change them.');
	error.statusCode = 403;
	error.code = 'BANK_DETAILS_LOCKED';
	return error;
}

async function ownedVendor(request) {
	return prisma.vendor.findFirst({
		where: { id: request.params.vendorId, OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }] },
		select: { id: true },
	});
}

function vendorNotFound(response) {
	return response.status(404).json({ success: false, error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor was not found.' } });
}

salesRoutes.get('/vendors/:vendorId/bank-details', requireAuth, requireSales, async (request, response, next) => {
	try {
		const vendor = await ownedVendor(request);
		if (!vendor) return vendorNotFound(response);
		const details = await prisma.vendorBankDetails.findUnique({ where: { vendorId: vendor.id } });
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

salesRoutes.patch('/vendors/:vendorId/bank-details', requireAuth, requireSales, async (request, response, next) => {
	try {
		const input = bankDetailsSchema.parse(request.body);
		const vendor = await ownedVendor(request);
		if (!vendor) return vendorNotFound(response);
		const existing = await prisma.vendorBankDetails.findUnique({ where: { vendorId: vendor.id } });
		if (isBankDetailsSet(existing)) throw bankDetailsLockedError();
		const fields = { upiNumber: input.upi_number, upiId: input.upi_id, accountHolderName: input.account_holder_name, accountNumber: input.account_number, ifscCode: input.ifsc_code };
		const details = await prisma.$transaction(async (transaction) => {
			const saved = await transaction.vendorBankDetails.upsert({ where: { vendorId: vendor.id }, create: { vendorId: vendor.id, ...fields }, update: fields });
			await writeAudit(transaction, request, 'VENDOR_BANK_DETAILS_UPDATED', 'Vendor', vendor.id, { source: 'SALES' });
			return saved;
		});
		return response.json({ success: true, bank_details: { ...details, passbookObjectKey: undefined, chequeObjectKey: undefined } });
	} catch (error) {
		return next(error);
	}
});

salesRoutes.post('/vendors/:vendorId/bank-details/:documentType', requireAuth, requireSales, documentUpload.single('file'), async (request, response, next) => {
	try {
		const type = request.params.documentType;
		if (!['passbook', 'cheque'].includes(type)) {
			const error = new Error('Document type must be passbook or cheque.');
			error.statusCode = 400;
			error.code = 'INVALID_DOCUMENT_TYPE';
			throw error;
		}
		const vendor = await ownedVendor(request);
		if (!vendor) return vendorNotFound(response);
		const existingBeforeUpload = await prisma.vendorBankDetails.findUnique({ where: { vendorId: vendor.id } });
		if (isBankDetailsSet(existingBeforeUpload)) throw bankDetailsLockedError();
		const uploaded = await uploadVendorDocument(vendor.id, type, request.file);
		try {
			const existing = await prisma.vendorBankDetails.findUnique({ where: { vendorId: vendor.id } });
			const data = type === 'passbook'
				? { passbookObjectKey: uploaded.objectKey, passbookFileName: uploaded.fileName, passbookFileSize: uploaded.fileSize, passbookContentType: uploaded.contentType }
				: { chequeObjectKey: uploaded.objectKey, chequeFileName: uploaded.fileName, chequeFileSize: uploaded.fileSize, chequeContentType: uploaded.contentType };
			await prisma.vendorBankDetails.upsert({ where: { vendorId: vendor.id }, create: { vendorId: vendor.id, ...data }, update: data });
			await removeVendorDocument(type === 'passbook' ? existing?.passbookObjectKey : existing?.chequeObjectKey);
		} catch (dbError) {
			await removeVendorDocument(uploaded.objectKey);
			throw dbError;
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

// Must stay LAST: anything registered after this never matches.
salesRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Sales route is scaffolded but not implemented.' } }));
