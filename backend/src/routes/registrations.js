import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { INDIAN_STATES } from '../lib/indian-states.js';
import { registerRateLimit } from '../middleware/rate-limit.js';

export const registrationRoutes = Router();

// Public "Apply for Solar Mitra". Writes a PENDING row in vendor_registrations; nothing is created or
// activated until Admin approves it (routes/admin.js). login_identifier is still accepted so the old
// contract does not break, but it is ignored: an applicant's login is always their mobile number.
const registrationSchema = z.object({
  business_name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().min(2).max(120),
  mobile_number: z.string().trim().min(10).max(20),
  state: z.enum(INDIAN_STATES),
  login_identifier: z.string().optional(),
  // Hidden "website" field: people never fill it, form-filling bots do.
  website: z.string().optional(),
});

export function normalizeMobile(value) {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/\D/g, '');
  // Handles +91/91/0091-prefixed and pasted/formatted Indian numbers
  // (+91 98765 43210, 0091 9876543210, etc.) down to the bare 10 digits.
  if (digits.startsWith('0091') && digits.length === 14) return digits.slice(4);
  if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
  return digits;
}

export function isValidIndianMobile(mobileNumber) {
  return /^[6-9]\d{9}$/.test(mobileNumber);
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// Pure: validates and normalizes a submission. Throws a coded 400 for a bad mobile; zod errors bubble to the
// shared error handler as before.
export function parseApplication(body) {
  const input = registrationSchema.parse(body);
  const mobileNumber = normalizeMobile(input.mobile_number);
  if (!isValidIndianMobile(mobileNumber)) {
    throw httpError(400, 'INVALID_MOBILE_NUMBER', 'Enter a valid Indian mobile number.');
  }
  return {
    honeypot: Boolean(input.website && input.website.trim()),
    mobileNumber,
    data: {
      businessName: input.business_name,
      ownerName: input.owner_name,
      mobileNumber,
      loginIdentifier: mobileNumber,
      state: input.state,
    },
  };
}

const alreadyPending = (response) => response.status(200).json({ success: true, registration: { status: 'PENDING' }, already_submitted: true });
const created = (response, registration) => response.status(201).json({ success: true, registration: { id: registration.id, status: registration.status } });
const alreadyMitra = () => httpError(409, 'ALREADY_A_SOLAR_MITRA', 'This number is already a Solar Mitra. Please sign in.');

registrationRoutes.post('/register', registerRateLimit, async (request, response, next) => {
  try {
    const { honeypot, mobileNumber, data } = parseApplication(request.body);

    // A bot gets the same answer as a person and nothing is stored.
    if (honeypot) return response.status(201).json({ success: true, registration: { status: 'PENDING' } });

    // Already a Solar Mitra (by mobile or by login): they should sign in, not apply.
    const existingVendor = await prisma.vendor.findFirst({
      where: { OR: [{ mobileNumber }, { loginIdentifier: mobileNumber }] },
      select: { id: true },
    });
    if (existingVendor) throw alreadyMitra();

    // Old rows may carry a login identifier other than the mobile, so look at both.
    const findExisting = () => prisma.vendorRegistration.findFirst({
      where: { OR: [{ mobileNumber }, { loginIdentifier: mobileNumber }] },
      select: { id: true, status: true },
    });
    const existing = await findExisting();

    if (existing?.status === 'PENDING') return alreadyPending(response);
    if (existing?.status === 'ONBOARDED') throw alreadyMitra();

    if (existing?.status === 'REJECTED') {
      // Re-application: the same row goes back to PENDING. The condition means two simultaneous
      // re-applications cannot fight over it. Nothing about the earlier decision is returned.
      const reset = await prisma.vendorRegistration.updateMany({
        where: { id: existing.id, status: 'REJECTED' },
        data: { ...data, status: 'PENDING', rejectionReason: null, reviewedById: null, reviewedAt: null },
      });
      if (reset.count === 1) return created(response, { id: existing.id, status: 'PENDING' });
      const now = await findExisting();
      if (now?.status === 'PENDING') return alreadyPending(response);
      throw alreadyMitra();
    }

    try {
      const registration = await prisma.vendorRegistration.create({ data });
      return created(response, registration);
    } catch (error) {
      // Two identical submissions raced: the unique login_identifier let one through. The other is a repeat.
      if (error.code !== 'P2002') throw error;
      const now = await findExisting();
      if (now?.status === 'PENDING') return alreadyPending(response);
      throw alreadyMitra();
    }
  } catch (error) {
    return next(error);
  }
});
