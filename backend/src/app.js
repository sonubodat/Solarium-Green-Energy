import express from 'express';
import helmet from 'helmet';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { vendorRoutes } from './routes/vendor.js';
import { salesRoutes } from './routes/sales.js';
import { adminRoutes } from './routes/admin.js';
import { registrationRoutes } from './routes/registrations.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { env } from './config/env.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use((request, response, next) => {
	const origin = request.headers.origin;
	if (origin && env.corsOrigins.includes(origin)) {
		response.setHeader('Access-Control-Allow-Origin', origin);
		response.setHeader('Access-Control-Allow-Credentials', 'true');
		response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
		response.setHeader('Vary', 'Origin');
	}

	if (request.method === 'OPTIONS' && origin && env.corsOrigins.includes(origin)) {
		return response.sendStatus(204);
	}

	return next();
});
app.use(express.json());
app.get('/health', (_request, response) => response.json({ success: true, status: 'ok' }));
app.get('/v/:qrCode', (request, response) => response.redirect(`/api/public/qr/${encodeURIComponent(request.params.qrCode)}`));
app.use('/api/public', publicRoutes);
app.use('/api/vendors', registrationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/admin', adminRoutes);
app.use(notFoundHandler);
app.use(errorHandler);
