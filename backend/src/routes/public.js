import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { cached } from '../lib/response-cache.js';
import { publicRateLimit } from '../middleware/rate-limit.js';
import { normalizePhone, customerHashFor, customerAlreadyExistsError, findExistingLeadByHash } from '../lib/customer-identity.js';

export const publicRoutes = Router();

const GENERAL_QR_CODE = 'PUBLIC-GENERAL';
const GENERAL_VENDOR_LOGIN = 'public-general';
export const billBands = ['1-2k', '2-3k', '3-4k', '4-5k', '5-6k', '6-7k', '7-8k', '8-9k', '9-10k', '10k+'];
export const solarSizeBands = ['1-2 kW', '2-3 kW', '3-4 kW', '4-5 kW', '5-6 kW', '6-7 kW', '7-8 kW', '8-9 kW', '9-10 kW', '10+ kW'];

async function resolveActiveAssignmentByQrCode(transaction, qrCode) {
	return transaction.qrAssignment.findFirst({
		where: {
			unassignedAt: null,
			qrCode: { code: qrCode, status: 'ACTIVE' },
		},
		select: {
			id: true,
			vendorId: true,
			qrCode: { select: { id: true, code: true } },
		},
	});
}

async function ensureGeneralAssignment(transaction) {
	let assignment = await resolveActiveAssignmentByQrCode(transaction, GENERAL_QR_CODE);
	if (assignment) return assignment;

	const vendor = await transaction.vendor.upsert({
		where: { loginIdentifier: GENERAL_VENDOR_LOGIN },
		create: {
			businessName: 'Solarium Direct',
			ownerName: 'Solarium Team',
			loginIdentifier: GENERAL_VENDOR_LOGIN,
			mobileNumber: '9000000000',
			mustChangePassword: false,
			status: 'ACTIVE',
		},
		update: { status: 'ACTIVE' },
		select: { id: true },
	});

	const qr = await transaction.qrCode.upsert({
		where: { code: GENERAL_QR_CODE },
		create: { code: GENERAL_QR_CODE, status: 'ACTIVE' },
		update: { status: 'ACTIVE' },
		select: { id: true, code: true },
	});

	await transaction.qrAssignment.updateMany({
		where: { qrCodeId: qr.id, unassignedAt: null, vendorId: { not: vendor.id } },
		data: { unassignedAt: new Date() },
	});

	const active = await transaction.qrAssignment.findFirst({
		where: { qrCodeId: qr.id, unassignedAt: null, vendorId: vendor.id },
		select: { id: true, vendorId: true, qrCode: { select: { id: true, code: true } } },
	});

	if (active) return active;

	const created = await transaction.qrAssignment.create({
		data: { qrCodeId: qr.id, vendorId: vendor.id },
		select: { id: true, vendorId: true, qrCode: { select: { id: true, code: true } } },
	});

	return created;
}

publicRoutes.get('/qr/:qrCode', publicRateLimit, async (request, response, next) => {
	try {
		// Same QR scanned again within 30 s reuses the lookup; any successful write through the API (reassign, retire,
		// deactivate ...) clears it, so Admin changes apply at once. Only hits are kept; the scan row below is always written.
		const assignment = await cached(`qr:${request.params.qrCode}`, 30000, () => prisma.qrAssignment.findFirst({
			where: {
				unassignedAt: null,
				qrCode: { code: request.params.qrCode, status: 'ACTIVE' },
			},
			select: {
				id: true,
				vendorId: true,
				vendor: { select: { businessName: true } },
				qrCode: { select: { id: true, code: true } },
			},
		}));

		if (!assignment) {
			const qr = await prisma.qrCode.findUnique({
				where: { code: request.params.qrCode },
				select: { status: true },
			});
			if (!qr) {
				return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'This referral QR was not found.' } });
			}
			if (qr.status === 'INACTIVE' || qr.status === 'RETIRED') {
				return response.status(410).json({ success: false, error: { code: 'QR_INACTIVE', message: 'This referral QR is currently inactive.' } });
			}
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_ACTIVE', message: 'This referral QR is not currently active.' } });
		}

		const scan = await prisma.scan.create({
			data: { qrId: assignment.qrCode.id, qrAssignmentId: assignment.id, vendorId: assignment.vendorId },
			select: { id: true },
		});
		return response.json({
			success: true,
			referral: { qr_code: assignment.qrCode.code, vendor_name: assignment.vendor.businessName, scan_id: scan.id },
		});
	} catch (error) {
		return next(error);
	}
});

publicRoutes.post('/leads/check-phone', publicRateLimit, async (request, response, next) => {
	try {
		const input = z.object({ phone: z.string().trim().min(1) }).parse(request.body);
		const normalizedPhone = normalizePhone(input.phone);

		// The customer/frontend never receives the HMAC hash itself — only an availability
		// result. The hash exists purely as a privacy-preserving server-side lookup key.
		const customerHash = customerHashFor(normalizedPhone);
		const existingLead = await findExistingLeadByHash(customerHash);
		if (existingLead) {
			return next(customerAlreadyExistsError());
		}
		return response.json({ success: true, available: true });
	} catch (error) {
		return next(error);
	}
});

publicRoutes.post('/leads', publicRateLimit, async (request, response, next) => {
	try {
		const input = z.object({
			scan_id: z.string().trim().min(1).optional(),
			referral_qr: z.string().trim().min(1).optional(),
			customer_name: z.string().trim().min(2).max(120),
			phone: z.string().trim().min(1),
			email: z.string().trim().email().max(160).optional(),
			location: z.string().trim().max(160).optional(),
			pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid six-digit pincode.'),
			average_electricity_bill: z.enum(billBands).optional(),
			solar_size: z.enum(solarSizeBands).optional(),
			// Optional GPS captured client-side via the "Use my location" button (pilot scope —
			// see LeadLocation in schema.prisma). Never trust the browser's own numbers as safe:
			// enforce real coordinate/accuracy ranges here regardless of what was sent.
			location_lat: z.number().min(-90).max(90).optional(),
			location_lng: z.number().min(-180).max(180).optional(),
			location_accuracy: z.number().min(0).optional(),
			location_captured_at: z.string().datetime().optional(),
		}).parse(request.body);
		const normalizedPhone = normalizePhone(input.phone);

		const hasLat = input.location_lat !== undefined;
		const hasLng = input.location_lng !== undefined;
		if (hasLat !== hasLng) {
			const error = new Error('Location requires both latitude and longitude.');
			error.statusCode = 400;
			error.code = 'INVALID_LOCATION';
			return next(error);
		}

		const customerHash = customerHashFor(normalizedPhone);
		// Fast pre-check outside the transaction — handles the common case (customer already
		// exists) without ever opening a transaction. This alone is NOT the real protection:
		// two concurrent requests can both pass this check before either creates a row. The
		// database's unique constraint (caught as P2002 below) is what actually prevents that.
		const existingLead = await findExistingLeadByHash(customerHash);
		if (existingLead) {
			return next(customerAlreadyExistsError());
		}

		// Scan rows are immutable once created (never updated or deleted), so looking this up
		// before opening the transaction is safe and shortens how long the transaction below
		// holds a pooled connection — every extra query inside it is time another request can't
		// get a connection from Supabase's shared pooler.
		let existingScan = null;
		if (input.scan_id) {
			existingScan = await prisma.scan.findUnique({
				where: { id: input.scan_id },
				select: { id: true, vendorId: true, qrId: true, qrAssignmentId: true },
			});
			if (!existingScan) {
				const error = new Error('Scan session was not found.');
				error.statusCode = 400;
				error.code = 'SCAN_NOT_FOUND';
				return next(error);
			}
		}
		const lead = await prisma.$transaction(async (transaction) => {
			let scan = existingScan;

			if (!scan) {
				const assignment = input.referral_qr
					? await resolveActiveAssignmentByQrCode(transaction, input.referral_qr)
					: await ensureGeneralAssignment(transaction);

				if (!assignment) {
					const error = new Error('This referral QR is not currently active.');
					error.statusCode = 404;
					error.code = 'QR_NOT_ACTIVE';
					throw error;
				}

				scan = await transaction.scan.create({
					data: { qrId: assignment.qrCode.id, qrAssignmentId: assignment.id, vendorId: assignment.vendorId },
					select: { id: true, vendorId: true, qrId: true, qrAssignmentId: true },
				});
			}
			const leadVendor = await transaction.vendor.findUnique({ where: { id: scan.vendorId }, select: { businessName: true } });
			if (!leadVendor) {
				const error = new Error('The referral Vendor no longer exists.');
				error.statusCode = 409;
				error.code = 'VENDOR_NOT_FOUND';
				throw error;
			}
			const customerIdentity = await transaction.customerIdentity.upsert({
				where: { hash: customerHash },
				create: { hash: customerHash },
				update: {},
				select: { id: true },
			});
			// No DUPLICATE-status fallback here — a repeat submission must never become a second
			// Lead row (that produces garbage data: broken counts, exports, and payout tracking).
			// If a concurrent request created a lead for this identity between the pre-check
			// above and here, Lead.customerIdentityId's unique constraint rejects this insert
			// with P2002, caught below and mapped to the same 409 CUSTOMER_ALREADY_EXISTS.
			const createdLead = await transaction.lead.create({
				data: {
					vendorId: scan.vendorId,
					vendorNameSnapshot: leadVendor.businessName,
					qrId: scan.qrId,
					qrAssignmentId: scan.qrAssignmentId,
					scanId: scan.id,
					customerIdentityId: customerIdentity.id,
					customerName: input.customer_name,
					phone: normalizedPhone,
					email: input.email,
					location: input.location,
					pincode: input.pincode,
					averageElectricityBill: input.average_electricity_bill,
					solarSize: input.solar_size,
					status: 'NEW',
				},
				select: { id: true, status: true },
			});

			// Only ever created as part of this lead's own creation — there is no separate
			// endpoint that attaches a location to an arbitrary lead_id, so a client can never
			// point a location at someone else's lead. Only created once real, valid
			// coordinates were actually received (not just because the button was clicked).
			if (hasLat && hasLng) {
				await transaction.leadLocation.create({
					data: {
						leadId: createdLead.id,
						latitude: input.location_lat,
						longitude: input.location_lng,
						accuracy: input.location_accuracy,
						capturedAt: input.location_captured_at ? new Date(input.location_captured_at) : new Date(),
					},
				});
			}

			return createdLead;
		});

		return response.status(201).json({
			success: true,
			lead: { id: lead.id, status: lead.status },
			message: 'Enquiry submitted successfully.',
		});
	} catch (error) {
		if (error.code === 'P2002') {
			return next(customerAlreadyExistsError());
		}
		return next(error);
	}
});

publicRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Public referral flow is scaffolded but not implemented.' } }));
