import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireVendor } from '../middleware/auth.js';
import {
	clearSessionCookie,
	createVendorSession,
	hashPassword,
	normalizeLoginIdentifier,
	publicVendor,
	setSessionCookie,
	verifyPassword,
} from '../services/auth.js';

export const vendorRoutes = Router();

const loginSchema = z.object({
	login_identifier: z.string().trim().min(1),
	password: z.string().min(1),
});

const passwordSchema = z.object({
	current_password: z.string().min(1),
	new_password: z.string().min(8),
});

function invalidCredentials() {
	const error = new Error('Invalid credentials.');
	error.statusCode = 401;
	error.code = 'INVALID_CREDENTIALS';
	return error;
}

vendorRoutes.post('/login', async (request, response, next) => {
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
		setSessionCookie(response, token);
		return response.json({ success: true, vendor: publicVendor(vendor) });
	} catch (error) {
		return next(error);
	}
});

vendorRoutes.post('/logout', requireAuth, requireVendor, async (request, response, next) => {
	try {
		await prisma.session.update({ where: { id: request.auth.sessionId }, data: { revokedAt: new Date() } });
		clearSessionCookie(response);
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
