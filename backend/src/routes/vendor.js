import { Router } from 'express';

export const vendorRoutes = Router();
vendorRoutes.all('*', (_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Vendor routes are scaffolded but not implemented.' } }));
