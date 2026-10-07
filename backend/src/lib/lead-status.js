// One definition of the lead statuses, shared by the Admin and Sales routes so they cannot drift.
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'REJECTED', 'DUPLICATE'];

// What a BDE (SALES user) may set. CONVERTED creates a commission payout, REJECTED and DUPLICATE are
// review decisions: those are never set from the Sales portal.
export const SALES_SETTABLE_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST'];

// A lead in one of these statuses is out of a BDE's hands (a BDE can never undo a conversion or a commission).
export const SALES_LOCKED_STATUSES = ['CONVERTED', 'REJECTED', 'DUPLICATE'];
