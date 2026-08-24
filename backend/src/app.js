import express from 'express';
import helmet from 'helmet';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { vendorRoutes } from './routes/vendor.js';
import { salesRoutes } from './routes/sales.js';
import { adminRoutes } from './routes/admin.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';

export const app = express();

app.use(helmet());
app.use(express.json());
app.get('/health', (_request, response) => response.json({ success: true, status: 'ok' }));
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/admin', adminRoutes);
app.use(notFoundHandler);
app.use(errorHandler);
