// Limits for the batched bulk-create / lead-import endpoints, in one place so the body-size limit,
// the zod schemas and the worst-case-payload test can never drift apart.

// Mounted in app.js BEFORE the global express.json() (which would otherwise reject the body at its
// 100 kb default before any route or validation runs). Sized from the worst case: every field at
// its max length, each character a control character (6 bytes once JSON-escaped as \u00XX):
//   leads:   502 chars x 6 B x 100 rows ~ 302 kb      vendors: 780 chars x 6 B x 50 rows ~ 234 kb
export const BULK_BODY_LIMIT = '512kb';
export const BULK_BODY_LIMIT_BYTES = 512 * 1024;

// Server-side per-request caps. The 2,000-row total is a UI limit only (see frontend/src/lib/batch-upload.js,
// keep these in sync): the server never sees the whole list, so it bounds each request itself.
export const MAX_LEAD_BATCH_ROWS = 100;
export const MAX_VENDOR_REQUEST_ROWS = 500;

// Interactive transactions default to 15 s (lib/prisma.js), sized for 2-5 statements. A batch does
// a few more statements, and Supabase round trips are measured at up to several seconds each.
export const BULK_TRANSACTION_OPTIONS = { timeout: 60000, maxWait: 8000 };

export const LEAD_FIELD_MAX = {
	customer_name: 120,
	phone: 20,
	email: 120,
	location: 120,
	pincode: 12,
	average_electricity_bill: 30,
	solar_size: 30,
	status: 20,
	created_at: 30,
};

export const VENDOR_ROW_FIELD_MAX = {
	name: 160,
	phone: 40,
	password: 200,
	upi_number: 40,
	upi_id: 120,
	account_holder_name: 160,
	account_number: 40,
	ifsc_code: 20,
};
