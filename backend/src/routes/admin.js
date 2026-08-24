import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createPasswordResetToken, resetTokenResponse } from '../services/password-reset.js';

export const adminRoutes = Router();
adminRoutes.post('/vendors/:vendorId/reset-password', requireAuth, requireAdmin, async (request, response, next) => {
	try {
		const vendor = await prisma.vendor.findUnique({ where: { id: request.params.vendorId } });
		if (!vendor) {
			return response.status(404).json({ success: false, error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor was not found.' } });
		}
		const token = await createPasswordResetToken({ vendorId: vendor.id });
		return response.json(resetTokenResponse(token, 'Vendor password reset issued.'));
	} catch (error) {
		return next(error);
	}
});

adminRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Admin route is scaffolded but not implemented.' } }));
