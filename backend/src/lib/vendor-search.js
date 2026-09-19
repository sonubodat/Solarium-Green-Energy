// One place defines how Solar Mitra search behaves, so the Admin list, the Admin picker and
// the Sales picker cannot disagree with each other.

const MAX_SEARCH_LENGTH = 80;
const MIN_PHONE_DIGITS = 4;
const PHONE_LIKE = /^[+\d\s().-]+$/;

// Prisma's `contains` does NOT escape LIKE wildcards: probed against real rows, searching "%"
// returned every vendor and "foo_bar" also matched "fooXbar". Postgres LIKE treats a backslash
// as its escape character, so escaping \, % and _ makes the search literal (also probed).
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// Trim, collapse internal whitespace, cap the length. An empty result means "no filter".
export function normalizeSearchInput(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_LENGTH);
}

// The digits to look for in mobile numbers, or null when the input is not phone-shaped.
//   +91 98765 43210 -> 9876543210      98765-43210 -> 9876543210
//   919876543210    -> 9876543210      91          -> null (never "match every Indian number")
//   Store 12345     -> null            98765       -> 98765
// The country code is dropped only when unambiguous: an explicit leading +91 or 0091, or a
// bare 91 on 12+ digits. Anything shorter than 4 digits is too weak to be a phone search.
export function phoneDigitsForSearch(raw) {
  const text = normalizeSearchInput(raw);
  if (!text || !PHONE_LIKE.test(text)) return null;
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+91') || digits.startsWith('0091')) {
    digits = digits.startsWith('0091') ? digits.slice(4) : digits.slice(2);
  } else if (digits.startsWith('91') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits.length >= MIN_PHONE_DIGITS ? digits : null;
}

// Prisma `where` fragment matching a Solar Mitra by business name, owner name, login ID or
// mobile number (substring, case-insensitive). Returns null for an empty search so callers
// can skip the clause entirely.
export function vendorSearchWhere(raw) {
  const text = normalizeSearchInput(raw);
  if (!text) return null;
  const needle = escapeLike(text);
  const clauses = [
    { businessName: { contains: needle, mode: 'insensitive' } },
    { ownerName: { contains: needle, mode: 'insensitive' } },
    { loginIdentifier: { contains: needle, mode: 'insensitive' } },
    { mobileNumber: { contains: needle } },
  ];
  const phoneDigits = phoneDigitsForSearch(text);
  if (phoneDigits && phoneDigits !== text) clauses.push({ mobileNumber: { contains: phoneDigits } });
  return { OR: clauses };
}

// Picker pages are small on purpose (a dropdown, not a table): default 10, capped at 50.
export function pickerPagination(query) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 10, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
}

// Fields a picker row needs to tell two similarly-named Solar Mitras apart.
export const PICKER_VENDOR_SELECT = { id: true, businessName: true, ownerName: true, loginIdentifier: true, mobileNumber: true };
