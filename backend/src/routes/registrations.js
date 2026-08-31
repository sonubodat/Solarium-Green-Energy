import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export const registrationRoutes = Router();

const registrationSchema = z.object({
  business_name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().min(2).max(120),
  mobile_number: z.string().trim().min(10).max(20),
  login_identifier: z.string().trim().min(3).max(120),
});

function normalizeMobile(value) {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/\D/g, '');
  // Handles +91/91/0091-prefixed and pasted/formatted Indian numbers
  // (+91 98765 43210, 0091 9876543210, etc.) down to the bare 10 digits.
  if (digits.startsWith('0091') && digits.length === 14) return digits.slice(4);
  if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
  return digits;
}

function normalizeLoginIdentifier(value) {
  return value.trim().toLowerCase();
}

registrationRoutes.post('/register', async (request, response, next) => {
  try {
    const input = registrationSchema.parse(request.body);
    const mobileNumber = normalizeMobile(input.mobile_number);
    const loginIdentifier = normalizeLoginIdentifier(input.login_identifier);

    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      const error = new Error('Enter a valid Indian mobile number.');
      error.statusCode = 400;
      error.code = 'INVALID_MOBILE_NUMBER';
      return next(error);
    }

    const registration = await prisma.vendorRegistration.create({
      data: {
        businessName: input.business_name,
        ownerName: input.owner_name,
        mobileNumber,
        loginIdentifier,
      },
    });

    return response.status(201).json({
      success: true,
      registration: { id: registration.id, status: registration.status },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      error.statusCode = 409;
      error.code = 'REGISTRATION_ALREADY_EXISTS';
      error.message = 'A registration already exists for these details.';
    }
    return next(error);
  }
});
