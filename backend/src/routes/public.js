import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { publicRateLimit } from '../middleware/rate-limit.js';

export const publicRoutes = Router();

const GENERAL_QR_CODE = 'PUBLIC-GENERAL';
const GENERAL_VENDOR_LOGIN = 'public-general';

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
		const assignment = await prisma.qrAssignment.findFirst({
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
		});

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

publicRoutes.post('/leads', publicRateLimit, async (request, response, next) => {
	try {
		const input = z.object({
			scan_id: z.string().trim().min(1).optional(),
			referral_qr: z.string().trim().min(1).optional(),
			customer_name: z.string().trim().min(2).max(120),
			phone: z.string().trim().min(10).max(20),
			email: z.string().trim().email().max(160).optional(),
			location: z.string().trim().max(160).optional(),
		}).parse(request.body);
		const normalizedPhone = input.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
		if (!/^\d{10}$/.test(normalizedPhone)) {
			const error = new Error('Enter a valid mobile number.');
			error.statusCode = 400;
			error.code = 'INVALID_MOBILE_NUMBER';
			return next(error);
		}
		if (!env.customerHashSecret) {
			const error = new Error('Customer identity protection is not configured.');
			error.statusCode = 503;
			error.code = 'CUSTOMER_IDENTITY_UNAVAILABLE';
			return next(error);
		}

		const customerHash = createHmac('sha256', env.customerHashSecret).update(normalizedPhone).digest('hex');
		const lead = await prisma.$transaction(async (transaction) => {
			let scan = null;

			if (input.scan_id) {
				scan = await transaction.scan.findUnique({
					where: { id: input.scan_id },
					select: { id: true, vendorId: true, qrId: true, qrAssignmentId: true },
				});
				if (!scan) {
					const error = new Error('Scan session was not found.');
					error.statusCode = 400;
					error.code = 'SCAN_NOT_FOUND';
					throw error;
				}
			} else {
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
			const customerIdentity = await transaction.customerIdentity.upsert({
				where: { hash: customerHash },
				create: { hash: customerHash },
				update: {},
				select: { id: true },
			});
			const previousLead = await transaction.lead.findFirst({
				where: { customerIdentityId: customerIdentity.id },
				select: { id: true },
			});
			return transaction.lead.create({
				data: {
					vendorId: scan.vendorId,
					qrId: scan.qrId,
					qrAssignmentId: scan.qrAssignmentId,
					scanId: scan.id,
					customerIdentityId: customerIdentity.id,
					customerName: input.customer_name,
					phone: normalizedPhone,
					email: input.email,
					location: input.location,
					status: previousLead ? 'DUPLICATE' : 'NEW',
				},
				select: { id: true, status: true },
			});
		});

		return response.status(201).json({
			success: true,
			lead: { id: lead.id, status: lead.status },
			message: lead.status === 'DUPLICATE' ? 'This customer has already been referred.' : 'Enquiry submitted successfully.',
		});
	} catch (error) {
		return next(error);
	}
});

publicRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Public referral flow is scaffolded but not implemented.' } }));
