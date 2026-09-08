import { createHmac } from 'node:crypto';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';

export function normalizePhone(rawPhone) {
	if (typeof rawPhone !== 'string') return '';
	const digits = rawPhone.replace(/\D/g, '');
	// Handles +91/91/0091-prefixed and pasted/formatted Indian numbers
	// (+91 98765 43210, 0091 9876543210, etc.) down to the bare 10 digits — same convention
	// as the staff-facing normalizeMobile() in admin.js/sales.js/registrations.js.
	if (digits.startsWith('0091') && digits.length === 14) return digits.slice(4);
	if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
	return digits || rawPhone.trim();
}

export function customerHashFor(normalizedPhone) {
	if (!env.customerHashSecret) {
		const error = new Error('Customer identity protection is not configured.');
		error.statusCode = 503;
		error.code = 'CUSTOMER_IDENTITY_UNAVAILABLE';
		throw error;
	}
	return createHmac('sha256', env.customerHashSecret).update(normalizedPhone).digest('hex');
}

export function customerAlreadyExistsError() {
	const error = new Error('This phone number has already been used to submit an enquiry.');
	error.statusCode = 409;
	error.code = 'CUSTOMER_ALREADY_EXISTS';
	return error;
}

// Business rule: one phone number can create at most one lead across the entire system
// (global uniqueness, not per-vendor) — confirmed explicitly, not assumed. A customer already
// attributed to one vendor cannot generate a second lead under a different vendor's QR.
// The database's unique constraint on Lead.customerIdentityId is the real enforcement (see the
// migration and the P2002 handling in callers); this lookup is purely a fast, non-transactional
// pre-check so the common "already submitted" case never needs to open a transaction or hold a
// pooled connection at all.
export async function findExistingLeadByHash(customerHash) {
	return prisma.lead.findFirst({
		where: { customerIdentity: { hash: customerHash } },
		select: { id: true },
	});
}
