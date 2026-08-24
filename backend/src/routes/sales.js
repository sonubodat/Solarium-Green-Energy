import { Router } from 'express';

export const salesRoutes = Router();
salesRoutes.use((_request, response) => response.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Sales routes are scaffolded but not implemented.' } }));
