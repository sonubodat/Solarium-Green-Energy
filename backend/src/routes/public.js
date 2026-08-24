import { Router } from 'express';

export const publicRoutes = Router();
publicRoutes.all('*', (_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Public referral flow is scaffolded but not implemented.' } }));
