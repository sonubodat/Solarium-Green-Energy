import { z } from 'zod';

// Shared by Admin's and Sales' bank-details routes (routes/admin.js, routes/sales.js) and by bulk
// create's per-row bank fields, so all three can never drift apart on what "valid" means.
//
// Format sanity checks only. None of this verifies a real account/IFSC/UPI exists, belongs to
// the vendor, or is reachable — it only rejects obviously malformed input before it's stored.
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_ID_PATTERN = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;
// Digits-only numeric contact/handle field, 10-18 digits. Format sanity check only; not UPI
// verification. Kept as `upi_number` to match the existing DB column and single-entry form — not
// renamed here, to avoid an unrelated migration/regression risk.
const UPI_NUMBER_PATTERN = /^\d{10,18}$/;
// Character/length pattern only — never verifies the account exists or belongs to the vendor.
const ACCOUNT_NUMBER_PATTERN = /^\d{6,18}$/;

// One place per validated field: how to normalize before storing, and what "valid" means.
// `account_holder_name` has no format below — it's free text, length-capped only.
export const BANK_FIELD_VALIDATORS = {
	ifsc_code: {
		label: 'IFSC code',
		// Normalize to uppercase, then validate against IFSC_PATTERN — so a pasted "hdfc0123456"
		// is accepted and stored as "HDFC0123456".
		normalize: (raw) => String(raw ?? '').trim().toUpperCase(),
		isValid: (value) => IFSC_PATTERN.test(value),
	},
	upi_id: {
		label: 'UPI ID',
		normalize: (raw) => String(raw ?? '').trim(), // case preserved — a VPA can be case-sensitive
		isValid: (value) => UPI_ID_PATTERN.test(value),
	},
	upi_number: {
		label: 'UPI number',
		normalize: (raw) => String(raw ?? '').trim(),
		isValid: (value) => UPI_NUMBER_PATTERN.test(value),
	},
	account_number: {
		label: 'Account number',
		normalize: (raw) => String(raw ?? '').trim(),
		isValid: (value) => ACCOUNT_NUMBER_PATTERN.test(value),
	},
};

// Validates and normalizes one optional field. Blank/undefined -> "not provided" (always valid,
// nothing to store). A non-blank value must match the field's format, or this reports a
// machine-stable code + a human reason. The caller decides what to do with a failure: the
// single-entry schema below turns it into a hard validation error; bulk create (routes/admin.js)
// instead skips just that field and records a warning, so one malformed field never loses an
// otherwise-good row.
export function validateBankField(field, rawValue) {
	const validator = BANK_FIELD_VALIDATORS[field];
	if (!validator) throw new Error(`Unknown bank field: ${field}`);
	const value = validator.normalize(rawValue);
	if (!value) return { ok: true, value: undefined };
	if (!validator.isValid(value)) {
		return { ok: false, code: 'INVALID_FORMAT', reason: `${validator.label} format is invalid.` };
	}
	return { ok: true, value };
}

function bankFieldSchema(field, maxLength) {
	return z.string().max(maxLength).optional().transform((raw, ctx) => {
		if (raw === undefined) return undefined; // key omitted entirely -> leave the stored value unchanged
		const result = validateBankField(field, raw);
		if (!result.ok) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason });
			return z.NEVER;
		}
		// Key present but blank ('') -> explicit clear, matching this schema's existing PATCH
		// behavior (the Admin/Sales forms always send all 5 keys, so clearing a field means
		// sending it blank, not omitting it).
		return result.value ?? '';
	});
}

export const bankDetailsSchema = z.object({
	upi_number: bankFieldSchema('upi_number', 40),
	upi_id: bankFieldSchema('upi_id', 120),
	account_holder_name: z.string().trim().max(160).optional(),
	account_number: bankFieldSchema('account_number', 40),
	ifsc_code: bankFieldSchema('ifsc_code', 20),
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
