import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit, passwordResetRateLimit } from '../middleware/rate-limit.js';
import { env } from '../config/env.js';
import { consumePasswordResetToken, createPasswordResetToken } from '../services/password-reset.js';
import {
	createStaffSession,
	hashPassword,
	normalizeLoginIdentifier,
	publicStaff,
	publicVendor,
	setSessionCookie,
	clearSessionCookie,
	verifyPassword,
} from '../services/auth.js';

export const authRoutes = Router();

const loginSchema = z.object({
	username_or_mobile: z.string().trim().min(1),
	password: z.string().min(1),
});

const passwordSchema = z.object({
	current_password: z.string().min(1),
	new_password: z.string().min(8),
});

const resetRequestSchema = z.object({
	account_type: z.enum(['staff', 'vendor']),
	identifier: z.string().trim().min(1),
});

const resetCompletionSchema = z.object({
	reset_token: z.string().min(1),
	new_password: z.string().min(8),
});

function invalidCredentials() {
	const error = new Error('Invalid credentials.');
	error.statusCode = 401;
	error.code = 'INVALID_CREDENTIALS';
	return error;
}

authRoutes.post('/login', authRateLimit, async (request, response, next) => {
	try {
		const input = loginSchema.parse(request.body);
		const user = await prisma.user.findUnique({
			where: { usernameMobile: normalizeLoginIdentifier(input.username_or_mobile) },
		});

		if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(input.password, user.passwordHash))) {
			return next(invalidCredentials());
		}

		const token = await createStaffSession(user.id);
		setSessionCookie(response, token);
		return response.json({ success: true, user: publicStaff(user) });
	} catch (error) {
		return next(error);
	}
});

authRoutes.get('/session', requireAuth, async (request, response, next) => {
	try {
		if (request.auth.type === 'vendor') {
			return response.json({ success: true, type: 'vendor', role: 'VENDOR', account: publicVendor(request.auth.vendor) });
		}
		return response.json({ success: true, type: 'staff', role: request.auth.role, account: publicStaff(request.auth.user) });
	} catch (error) {
		return next(error);
	}
});

authRoutes.post('/logout', requireAuth, async (request, response, next) => {
	try {
		await prisma.session.update({ where: { id: request.auth.sessionId }, data: { revokedAt: new Date() } });
		clearSessionCookie(response);
		return response.json({ success: true });
	} catch (error) {
		return next(error);
	}
});

authRoutes.post('/change-password', requireAuth, async (request, response, next) => {
	try {
		const input = passwordSchema.parse(request.body);
		if (request.auth.type !== 'staff') {
			return response.status(403).json({ success: false, error: { code: 'USE_VENDOR_PASSWORD_ROUTE', message: 'Use the Vendor password route.' } });
		}
		if (!(await verifyPassword(input.current_password, request.auth.user.passwordHash))) {
			return next(invalidCredentials());
		}
		const user = await prisma.user.update({
			where: { id: request.auth.user.id },
			data: { passwordHash: await hashPassword(input.new_password) },
		});
		return response.json({ success: true, user: publicStaff(user) });
	} catch (error) {
		return next(error);
	}
});

authRoutes.post('/forgot-password', passwordResetRateLimit, async (request, response, next) => {
	try {
		const input = resetRequestSchema.parse(request.body);
		const identifier = normalizeLoginIdentifier(input.identifier);
		const account = input.account_type === 'staff'
			? await prisma.user.findUnique({ where: { usernameMobile: identifier } })
			: await prisma.vendor.findFirst({ where: { OR: [{ loginIdentifier: identifier }, { mobileNumber: input.identifier.trim() }] } });
		let token;
		if (account) {
			token = await createPasswordResetToken(input.account_type === 'staff' ? { userId: account.id } : { vendorId: account.id });
		}
		const result = { success: true, message: 'If the account exists, reset instructions have been issued.' };
		if (token && env.nodeEnv !== 'production') {
			result.reset_token = token;
		}
		return response.json(result);
	} catch (error) {
		return next(error);
	}
});

authRoutes.post('/reset-password', passwordResetRateLimit, async (request, response, next) => {
	try {
		const input = resetCompletionSchema.parse(request.body);
		const resetToken = await consumePasswordResetToken(input.reset_token);
		if (!resetToken) {
			const error = new Error('Reset token is invalid or expired.');
			error.statusCode = 400;
			error.code = 'INVALID_RESET_TOKEN';
			return next(error);
		}

		const passwordHash = await hashPassword(input.new_password);
		await prisma.$transaction(async (transaction) => {
			const claimed = await transaction.passwordResetToken.updateMany({
				where: { id: resetToken.id, usedAt: null, expiresAt: { gt: new Date() } },
				data: { usedAt: new Date() },
			});
			if (claimed.count !== 1) {
				const error = new Error('Reset token is invalid or expired.');
				error.statusCode = 400;
				error.code = 'INVALID_RESET_TOKEN';
				throw error;
			}
			if (resetToken.userId) {
				await transaction.user.update({ where: { id: resetToken.userId }, data: { passwordHash } });
			} else {
				await transaction.vendor.update({ where: { id: resetToken.vendorId }, data: { passwordHash, mustChangePassword: false } });
			}
		});
		return response.json({ success: true, message: 'Password reset successfully.' });
	} catch (error) {
		return next(error);
	}
});
