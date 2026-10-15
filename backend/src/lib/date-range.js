import { z } from 'zod';

// Optional "from" and "to" dates (YYYY-MM-DD) for the CSV exports. The product is India-only and the server runs in
// UTC, so a day always means an Indian (IST, +05:30) calendar day: "2026-10-01" starts at 00:00 IST on 1 Oct, and a
// "to" date includes that whole day. Either bound may be left out. Returns null when neither is given (all time).
const IST = '+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;

const dateString = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
	const date = new Date(`${value}T00:00:00${IST}`);
	// Rejects impossible dates such as 2026-02-31 or 2026-13-01 (JavaScript would otherwise roll them over).
	return !Number.isNaN(date.getTime()) && new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().startsWith(value);
}, 'Not a real date.');

const rangeSchema = z.object({ from: dateString.optional(), to: dateString.optional() }).refine(
	(range) => !range.from || !range.to || range.from <= range.to,
	{ message: 'The From date must not be after the To date.' },
);

export function parseDateRange(query = {}) {
	const result = rangeSchema.safeParse({ from: query.from || undefined, to: query.to || undefined });
	if (!result.success) {
		const error = new Error(result.error.issues[0]?.message === 'The From date must not be after the To date.'
			? 'The From date must not be after the To date.'
			: 'Dates must be real dates in the form YYYY-MM-DD.');
		error.statusCode = 400;
		error.code = 'INVALID_DATE_RANGE';
		throw error;
	}
	const { from, to } = result.data;
	if (!from && !to) return null;
	return {
		gte: from ? new Date(`${from}T00:00:00${IST}`) : undefined,
		lt: to ? new Date(new Date(`${to}T00:00:00${IST}`).getTime() + DAY_MS) : undefined,
		from,
		to,
	};
}

// Prisma filter for a date column, or {} for all time.
export function dateRangeFilter(range) {
	return range ? { ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) } : undefined;
}

// "_2026-10-01_to_2026-10-07", "_from_2026-10-01" or "_until_2026-10-07"; '' for all time.
export function dateRangeFileSuffix(range) {
	if (!range) return '';
	if (range.from && range.to) return `_${range.from}_to_${range.to}`;
	return range.from ? `_from_${range.from}` : `_until_${range.to}`;
}
