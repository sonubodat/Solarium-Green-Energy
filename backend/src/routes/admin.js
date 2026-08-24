import { Router } from 'express';

export const adminRoutes = Router();
adminRoutes.all('*', (_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Admin routes are scaffolded but not implemented.' } }));
