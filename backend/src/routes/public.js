import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { publicRateLimit } from '../middleware/rate-limit.js';

export const publicRoutes = Router();

publicRoutes.get('/qr/:qrCode', publicRateLimit, async (request, response, next) => {
	try {
		const qr = await prisma.qrCode.findUnique({ where: { code: request.params.qrCode } });
		if (!qr) {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_FOUND', message: 'This referral QR was not found.' } });
		}
		if (qr.status === 'INACTIVE' || qr.status === 'RETIRED') {
			return response.status(410).json({ success: false, error: { code: 'QR_INACTIVE', message: 'This referral QR is currently inactive.' } });
		}

		const assignment = await prisma.qrAssignment.findFirst({
			where: { qrCodeId: qr.id, unassignedAt: null },
			include: { vendor: true },
		});
		if (!assignment || qr.status !== 'ACTIVE') {
			return response.status(404).json({ success: false, error: { code: 'QR_NOT_ACTIVE', message: 'This referral QR is not currently active.' } });
		}

		const scan = await prisma.scan.create({
			data: { qrId: qr.id, qrAssignmentId: assignment.id, vendorId: assignment.vendorId },
		});
		return response.json({
			success: true,
			referral: { qr_code: qr.code, vendor_name: assignment.vendor.businessName, scan_id: scan.id },
		});
	} catch (error) {
		return next(error);
	}
});

publicRoutes.post('/leads', publicRateLimit, async (request, response, next) => {
	try {
		const input = z.object({
			scan_id: z.string().trim().min(1),
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
			const scan = await transaction.scan.findUnique({ where: { id: input.scan_id } });
			if (!scan) {
				const error = new Error('Scan session was not found.');
				error.statusCode = 400;
				error.code = 'SCAN_NOT_FOUND';
				throw error;
			}
			const customerIdentity = await transaction.customerIdentity.upsert({
				where: { hash: customerHash },
				create: { hash: customerHash },
				update: {},
			});
			const previousLead = await transaction.lead.findFirst({ where: { customerIdentityId: customerIdentity.id } });
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
