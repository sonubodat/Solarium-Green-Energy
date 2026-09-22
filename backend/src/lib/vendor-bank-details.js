import { z } from 'zod';

// Shared by Admin's and Sales' bank-details routes (routes/admin.js, routes/sales.js) so the two
// can never drift apart on what fields exist or what counts as "already filled in".
export const bankDetailsSchema = z.object({
	upi_number: z.string().trim().max(40).optional(),
	upi_id: z.string().trim().max(120).optional(),
	account_holder_name: z.string().trim().max(160).optional(),
	account_number: z.string().trim().max(40).optional(),
	ifsc_code: z.string().trim().max(20).optional(),
});

// True once any bank field or document has been saved for a Vendor — the single definition of
// "already there" that gates whether Sales may still write to it (Admin is never gated).
export function isBankDetailsSet(details) {
	if (!details) return false;
	return Boolean(
		details.upiNumber
		|| details.upiId
		|| details.accountHolderName
		|| details.accountNumber
		|| details.ifscCode
		|| details.passbookObjectKey
		|| details.chequeObjectKey,
	);
}
