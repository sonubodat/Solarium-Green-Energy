// Client-driven batches for the two bulk flows (Solar Mitra bulk create, customer/lead CSV import).
// The browser splits the list and sends small batches one after another: nothing is kept on the
// server between batches (a Render sleep/restart cannot lose a "job") and server memory per request
// stays small and constant. Both endpoints are idempotent by phone number, so a retried batch or a
// re-uploaded list never creates a second record.
//
// The 2,000 cap is a UI limit only: the server independently caps every request (see
// backend/src/lib/bulk-limits.js, keep the numbers below in sync with it).
export const MAX_BULK_ROWS = 2000;
export const VENDOR_BATCH_SIZE = 50; // scrypt password hashing is the cost per Solar Mitra row
export const LEAD_BATCH_SIZE = 100; // backend MAX_LEAD_BATCH_ROWS
export const BATCH_TIMEOUT_MS = 120000; // per attempt: covers a Render cold start plus a slow batch

// Same maxima as LEAD_FIELD_MAX in backend/src/lib/bulk-limits.js.
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

const RETRY_DELAYS_MS = [2000, 5000]; // 2 retries -> 3 attempts per batch
const ALREADY_EXISTS_REASONS = new Set(['PHONE_ALREADY_USED', 'LOGIN_IDENTIFIER_TAKEN']);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Automatic retry is only for failures a retry can plausibly fix: no HTTP status at all (network
// failure, timeout) or a 5xx. Never a 4xx: the same request would fail the same way (bad input, session expired).
export function isRetryableError(error) {
  if (error?.retryable === false) return false;
  if (typeof error?.status === 'number') return error.status >= 500;
  return true;
}

// Builds the batches ONCE. `serialize` (optional) freezes each batch's request body up front, so a
// retry resends the byte-identical body instead of rebuilding it.
export function splitIntoBatches(items, batchSize, serialize) {
  const batches = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = { index: batches.length, offset, items: items.slice(offset, offset + batchSize) };
    if (serialize) batch.body = serialize(batch);
    batches.push(batch);
  }
  return batches;
}

// Sends the batches strictly one at a time.
//  - `done` advances only after a batch got a successful (and verified) response;
//  - a failed batch is retried up to twice with the SAME batch object, then the run STOPS: no later batch is sent;
//  - verify(batch, summary) must return true, else the run stops (an unexpected result is never trusted).
// Returns { completed: [{ batch, summary, attempts }], failed: { batch, error, attempts } | null, done, total, batches }.
export async function runBatches({ items, batchSize, serialize, send, verify, onProgress = () => {}, sleep = defaultSleep, retryDelays = RETRY_DELAYS_MS }) {
  const batches = splitIntoBatches(items, batchSize, serialize);
  const completed = [];
  let done = 0;
  const report = (extra) => onProgress({ done, total: items.length, batch: Math.min(completed.length + 1, batches.length), batches: batches.length, attempt: 1, ...extra });
  const result = (failed) => ({ completed, failed, done, total: items.length, batches: batches.length });

  report();
  for (const batch of batches) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const summary = await send(batch);
        if (verify && !verify(batch, summary)) {
          const mismatch = new Error('The server returned an unexpected result for this batch.');
          mismatch.retryable = false;
          throw mismatch;
        }
        completed.push({ batch, summary, attempts: attempt });
        done += batch.items.length;
        report();
        break;
      } catch (error) {
        if (!isRetryableError(error) || attempt > retryDelays.length) return result({ batch, error, attempts: attempt });
        report({ attempt: attempt + 1 });
        await sleep(retryDelays[attempt - 1]);
      }
    }
  }
  return result(null);
}

// Every completed batch must account for every row it was given.
export const verifyVendorBatch = (batch, summary) => Boolean(summary)
  && summary.totalRows === batch.items.length
  && summary.created + summary.failed === summary.totalRows;

export const verifyLeadBatch = (batch, summary) => Boolean(summary)
  && summary.requested === batch.items.length
  && summary.imported + summary.duplicates.length + summary.invalid.length === summary.requested;

export function friendlyBatchError(error) {
  if (error?.name === 'TimeoutError') return 'The server took too long to respond.';
  if (typeof error?.status !== 'number' && error instanceof TypeError) return 'Network problem: could not reach the server.';
  return error?.message || 'The request failed.';
}

// firstRowNumber is the row number of a batch's first row when offset = 0: 1 for the Solar Mitra
// list (no header row), 2 for a lead CSV (row 1 is the header).
function stoppedInfo(run, firstRowNumber) {
  if (!run.failed) return null;
  return {
    batch: run.failed.batch.index + 1,
    batches: run.batches,
    firstRow: run.failed.batch.offset + firstRowNumber,
    message: friendlyBatchError(run.failed.error),
    processed: run.done,
  };
}

// A batch that needed a retry may have been committed by the FIRST attempt whose response was lost.
// Rows the retry reports as "already exists" are then most likely ours, so they are surfaced
// separately instead of being presented as ordinary duplicates.
function retriedInfo(batch, alreadyExisting, firstRowNumber) {
  return { firstRow: batch.offset + firstRowNumber, lastRow: batch.offset + batch.items.length + firstRowNumber - 1, alreadyExisting };
}

// Solar Mitra: the server numbers rows 1-based within each batch (header, if any, already stripped),
// so the batch offset makes them list-wide (batch 2 of 50 starts at row 51).
export function mergeVendorRun(run, totalRows) {
  const failures = [];
  const warnings = [];
  const retried = [];
  let created = 0;
  for (const { batch, summary, attempts } of run.completed) {
    created += summary.created;
    const batchFailures = summary.failures || [];
    for (const failure of batchFailures) failures.push({ ...failure, row: failure.row + batch.offset });
    for (const warning of summary.warnings || []) warnings.push({ ...warning, row: warning.row + batch.offset });
    if (attempts > 1) retried.push(retriedInfo(batch, batchFailures.filter((failure) => ALREADY_EXISTS_REASONS.has(failure.reason)).length, 1));
  }
  return { totalRows, created, failed: failures.length, failures, warnings, processed: run.done, retried, stopped: stoppedInfo(run, 1) };
}

// Leads: the server already reports absolute CSV row numbers (header = row 1, first data row = row 2)
// from the row_offset it is sent, so nothing is added here. `overLengthRows` holds rows the client
// replaced with an empty placeholder (a field over the server's limit); the server reports those as
// invalid at the right row number and this relabels them.
export function mergeLeadRun(run, totalRows, overLengthRows = new Set()) {
  const duplicates = [];
  const invalid = [];
  const retried = [];
  let imported = 0;
  for (const { batch, summary, attempts } of run.completed) {
    imported += summary.imported;
    duplicates.push(...summary.duplicates);
    for (const item of summary.invalid) {
      invalid.push(overLengthRows.has(item.row) ? { ...item, reason: 'A field in this row is too long.' } : item);
    }
    if (attempts > 1) retried.push(retriedInfo(batch, summary.duplicates.length, 2));
  }
  return { totalRows, imported, duplicates, invalid, processed: run.done, retried, stopped: stoppedInfo(run, 2) };
}

// Maps a parsed CSV record (keys already normalized to lower_snake_case) to the fields the backend
// accepts, including the aliases the server's own CSV path accepts. A record with a field over the
// server's limit becomes an empty placeholder: it keeps its position (so every later row keeps its
// right row number) and the server reports it as invalid, which mergeLeadRun then relabels.
export function toLeadUploadItem(record) {
  const value = (...keys) => {
    for (const key of keys) {
      const text = record[key] == null ? '' : String(record[key]).trim();
      if (text) return text;
    }
    return '';
  };
  const item = {
    customer_name: value('customer_name', 'name'),
    phone: value('phone', 'mobile', 'mobile_number'),
    email: value('email'),
    location: value('location'),
    pincode: value('pincode'),
    average_electricity_bill: value('average_electricity_bill'),
    solar_size: value('solar_size'),
    status: value('status'),
    created_at: value('created_at', 'date', 'lead_date'),
  };
  const tooLong = Object.entries(LEAD_FIELD_MAX).some(([field, max]) => item[field].length > max);
  if (tooLong) return { item: {}, tooLong: true };
  return { item: Object.fromEntries(Object.entries(item).filter(([, text]) => text)), tooLong: false };
}
