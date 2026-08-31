import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSales } from '../middleware/auth.js';
import { hashPassword, normalizeLoginIdentifier, publicVendor } from '../services/auth.js';
import { assignUnassignedQr } from '../services/qr.js';

export const salesRoutes = Router();

const onboardingSchema = z.object({
	password: z.string().min(8),
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
	password: z.string().min(8),
});

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
		const vendors = await prisma.vendor.findMany({
			// A Vendor with no salesUserId (e.g. created directly by Admin, not through any Sales
			// rep's onboarding flow) isn't owned by anyone — matches the same OR-with-null pattern
			// GET /sales/registrations already uses so an unclaimed resource is visible to every
			// Sales user, not invisible to all of them. Was strictly `salesUserId: <this user>`
			// with no null fallback, which silently hid every vendor a Sales rep didn't personally
			// onboard themselves — including ones Admin created directly — from the QR-assign picker.
			// Excludes a Vendor already holding an active QR — one active QR per Vendor is enforced here.
			where: {
				OR: [{ salesUserId: request.auth.user.id }, { salesUserId: null }],
				status: 'ACTIVE',
				assignments: { none: { unassignedAt: null } },
			},
			orderBy: { businessName: 'asc' },
			take: 100,
			select: { id: true, businessName: true, loginIdentifier: true },
		});
		return response.json({ success: true, vendors });
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
					passwordHash: await hashPassword(input.password),
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
		const vendor = await prisma.$transaction(async (transaction) => {
			const created = await transaction.vendor.create({
				data: {
					businessName: input.business_name,
					ownerName: input.owner_name,
					loginIdentifier: normalizeLoginIdentifier(input.login_identifier),
					mobileNumber,
					passwordHash: await hashPassword(input.password),
					mustChangePassword: true,
					salesUserId: request.auth.user.id,
				},
			});
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

salesRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Sales route is scaffolded but not implemented.' } }));
