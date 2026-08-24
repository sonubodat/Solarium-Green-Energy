import { Router } from 'express';

export const authRoutes = Router();
authRoutes.all('*', (_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Authentication is scaffolded but not implemented.' } }));
