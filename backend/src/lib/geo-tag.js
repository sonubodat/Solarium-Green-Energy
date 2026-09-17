import { z } from 'zod';

// Shared shape for "optional GPS coordinates" fields, reused by every place that accepts a
// geo-tag (Sales/Admin vendor creation, Sales' complete-later location endpoint) — mirrors
// the validation already proven for LeadLocation in routes/public.js.
export const geoTagFields = {
	latitude: z.number().min(-90).max(90).optional(),
	longitude: z.number().min(-180).max(180).optional(),
	accuracy: z.number().min(0).optional(),
	captured_at: z.string().datetime().optional(),
};

// Enforces "both or neither" and returns the Prisma-ready data shape for
// VendorOnboardingMedia's geo fields, or null if no coordinates were sent at all.
export function resolveGeoTag(input) {
	const hasLat = input.latitude !== undefined;
	const hasLng = input.longitude !== undefined;
	if (hasLat !== hasLng) {
		const error = new Error('Location requires both latitude and longitude.');
		error.statusCode = 400;
		error.code = 'INVALID_LOCATION';
		throw error;
	}
	if (!hasLat) return null;
	return {
		latitude: input.latitude,
		longitude: input.longitude,
		accuracy: input.accuracy,
		capturedAt: input.captured_at ? new Date(input.captured_at) : new Date(),
	};
}
