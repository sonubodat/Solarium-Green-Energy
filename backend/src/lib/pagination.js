// `max` is 100 unless a table route opts in to 200 (the page-size selector's largest option).
// Missing, non-numeric or < 1 limits fall back to the 50 default; anything above `max` clamps to it.
export function pagination(query, max = 100) {
	const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
	const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), max);
	return { page, limit, skip: (page - 1) * limit };
}
