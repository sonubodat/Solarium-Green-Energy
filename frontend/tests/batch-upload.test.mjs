// Run: node --test frontend/tests/batch-upload.test.mjs   (no browser, no backend: the server is a fake)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = path.join(os.tmpdir(), `batch-upload-under-test-${process.pid}.mjs`);
fs.copyFileSync(path.join(here, '../src/lib/batch-upload.js'), copy); // .js is CommonJS here; .mjs loads as ESM
const {
  MAX_BULK_ROWS, VENDOR_BATCH_SIZE, LEAD_BATCH_SIZE, LEAD_FIELD_MAX,
  isRetryableError, splitIntoBatches, runBatches, verifyVendorBatch, verifyLeadBatch,
  mergeVendorRun, mergeLeadRun, toLeadUploadItem, friendlyBatchError,
} = await import(pathToFileURL(copy));

const noSleep = () => Promise.resolve();
const rows = (count) => Array.from({ length: count }, (_, index) => ({ phone: String(9000000000 + index) }));
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test('constants: 2,000-row cap, 40 vendor batches and 20 lead batches', () => {
  assert.equal(MAX_BULK_ROWS, 2000);
  assert.equal(splitIntoBatches(rows(MAX_BULK_ROWS), VENDOR_BATCH_SIZE).length, 40);
  assert.equal(splitIntoBatches(rows(MAX_BULK_ROWS), LEAD_BATCH_SIZE).length, 20);
});

test('splitIntoBatches: offsets, indexes, and the body is frozen once per batch', () => {
  let calls = 0;
  const batches = splitIntoBatches(rows(250), 100, (batch) => { calls += 1; return `body-${batch.index}`; });
  assert.deepEqual(batches.map((batch) => [batch.index, batch.offset, batch.items.length, batch.body]), [[0, 0, 100, 'body-0'], [1, 100, 100, 'body-1'], [2, 200, 50, 'body-2']]);
  assert.equal(calls, 3);
});

test('isRetryableError: network/timeout/5xx yes, 4xx and flagged errors never', () => {
  assert.equal(isRetryableError(new TypeError('Failed to fetch')), true);
  assert.equal(isRetryableError(Object.assign(new Error('t'), { name: 'TimeoutError' })), true);
  assert.equal(isRetryableError(httpError(500)), true);
  assert.equal(isRetryableError(httpError(502)), true);
  assert.equal(isRetryableError(httpError(400)), false);
  assert.equal(isRetryableError(httpError(401)), false);
  assert.equal(isRetryableError(httpError(413)), false);
  assert.equal(isRetryableError(Object.assign(new Error('x'), { retryable: false })), false);
});

test('progress: done advances only after a batch succeeds; the current batch number is 1-based', async () => {
  const seen = [];
  const run = await runBatches({
    items: rows(250), batchSize: 100, sleep: noSleep,
    send: async (batch) => ({ n: batch.items.length }),
    onProgress: (progress) => seen.push([progress.done, progress.batch, progress.batches]),
  });
  assert.deepEqual(seen, [[0, 1, 3], [100, 2, 3], [200, 3, 3], [250, 3, 3]]);
  assert.equal(run.failed, null);
  assert.equal(run.done, 250);
});

test('retry resends the EXACT same batch (same object, same body) and counts attempts', async () => {
  const sent = [];
  let failedOnce = false;
  const sleeps = [];
  const run = await runBatches({
    items: rows(200), batchSize: 100, serialize: (batch) => JSON.stringify(batch.items), sleep: async (ms) => { sleeps.push(ms); },
    send: async (batch) => {
      sent.push(batch);
      if (batch.index === 1 && !failedOnce) { failedOnce = true; throw new TypeError('Failed to fetch'); }
      return { ok: true };
    },
  });
  assert.equal(run.failed, null);
  assert.equal(sent.length, 3); // batch 0, batch 1 (fails), batch 1 again
  assert.equal(sent[1], sent[2]); // identical object, not a rebuilt copy
  assert.equal(sent[1].body, sent[2].body);
  assert.deepEqual(run.completed.map((entry) => entry.attempts), [1, 2]);
  assert.deepEqual(sleeps, [2000]);
});

test('a 4xx is never retried: the run stops and no later batch is sent', async () => {
  const sent = [];
  const run = await runBatches({
    items: rows(300), batchSize: 100, sleep: noSleep,
    send: async (batch) => { sent.push(batch.index); if (batch.index === 1) throw httpError(400); return {}; },
  });
  assert.deepEqual(sent, [0, 1]);
  assert.equal(run.failed.batch.index, 1);
  assert.equal(run.failed.attempts, 1);
  assert.equal(run.done, 100); // progress did not advance for the failed batch
});

test('a persistent 5xx is retried twice (3 attempts) and then stops; later batches are not sent', async () => {
  const sent = [];
  const run = await runBatches({
    items: rows(300), batchSize: 100, sleep: noSleep,
    send: async (batch) => { sent.push(batch.index); if (batch.index === 1) throw httpError(503); return {}; },
  });
  assert.deepEqual(sent, [0, 1, 1, 1]);
  assert.equal(run.failed.attempts, 3);
  assert.equal(run.done, 100);
  assert.equal(run.completed.length, 1);
});

test('verify: a batch whose rows do not add up stops the run without a retry', async () => {
  const sent = [];
  const run = await runBatches({
    items: rows(200), batchSize: 100, sleep: noSleep,
    send: async (batch) => { sent.push(batch.index); return { requested: 100, imported: 90, duplicates: [], invalid: [] }; },
    verify: verifyLeadBatch,
  });
  assert.deepEqual(sent, [0]);
  assert.match(run.failed.error.message, /unexpected result/);
  assert.equal(run.done, 0);
});

test('verifyVendorBatch / verifyLeadBatch: created+failed and imported+duplicates+invalid must equal the input', () => {
  const batch = { items: rows(10) };
  assert.equal(verifyVendorBatch(batch, { totalRows: 10, created: 7, failed: 3 }), true);
  assert.equal(verifyVendorBatch(batch, { totalRows: 10, created: 7, failed: 2 }), false);
  assert.equal(verifyVendorBatch(batch, { totalRows: 9, created: 9, failed: 0 }), false);
  assert.equal(verifyLeadBatch(batch, { requested: 10, imported: 6, duplicates: [1, 2], invalid: [3, 4] }), true);
  assert.equal(verifyLeadBatch(batch, { requested: 10, imported: 6, duplicates: [1], invalid: [3, 4] }), false);
  assert.equal(verifyLeadBatch(batch, null), false);
});

// ---- row numbering ---------------------------------------------------------------------------
test('mergeVendorRun: batch-relative rows become list-wide (batch 2 of 50 starts at row 51)', () => {
  const batches = splitIntoBatches(rows(100), 50);
  const run = {
    done: 100, total: 100, batches: 2, failed: null,
    completed: [
      { batch: batches[0], attempts: 1, summary: { totalRows: 50, created: 49, failed: 1, failures: [{ row: 1, businessName: 'A', reason: 'INVALID_MOBILE_NUMBER' }], warnings: [] } },
      { batch: batches[1], attempts: 1, summary: { totalRows: 50, created: 49, failed: 1, failures: [{ row: 3, businessName: 'B', reason: 'PHONE_ALREADY_USED' }], warnings: [{ row: 2, field: 'ifsc_code', code: 'INVALID_FORMAT', reason: 'x' }] } },
    ],
  };
  const merged = mergeVendorRun(run, 100);
  assert.deepEqual(merged.failures.map((failure) => failure.row), [1, 53]);
  assert.deepEqual(merged.warnings.map((warning) => warning.row), [52]);
  assert.equal(merged.created, 98);
  assert.equal(merged.failed, 2);
  assert.equal(merged.stopped, null);
});

test('mergeLeadRun: server rows are already absolute (batch 2 = 102-201), over-length rows are relabelled', () => {
  const batches = splitIntoBatches(rows(200), 100);
  const run = {
    done: 200, total: 200, batches: 2, failed: null,
    completed: [
      { batch: batches[0], attempts: 1, summary: { requested: 100, imported: 99, duplicates: [], invalid: [{ row: 2, reason: 'Missing or invalid customer name / phone number.' }] } },
      { batch: batches[1], attempts: 1, summary: { requested: 100, imported: 98, duplicates: [{ row: 102, phone: '9000000001' }], invalid: [{ row: 201, reason: 'Missing or invalid customer name / phone number.' }] } },
    ],
  };
  const merged = mergeLeadRun(run, 200, new Set([201]));
  assert.deepEqual(merged.duplicates, [{ row: 102, phone: '9000000001' }]);
  assert.deepEqual(merged.invalid.map((item) => [item.row, item.reason]), [[2, 'Missing or invalid customer name / phone number.'], [201, 'A field in this row is too long.']]);
  assert.equal(merged.imported, 197);
});

test('a stopped run reports how far it got and where to resume', async () => {
  const run = await runBatches({
    items: rows(300), batchSize: 100, sleep: noSleep,
    send: async (batch) => { if (batch.index === 2) throw httpError(400); return { totalRows: 100, created: 100, failed: 0, failures: [], warnings: [] }; },
    verify: verifyVendorBatch,
  });
  const merged = mergeVendorRun(run, 300);
  assert.equal(merged.processed, 200);
  assert.deepEqual(merged.stopped, { batch: 3, batches: 3, firstRow: 201, message: 'HTTP 400', processed: 200 });
});

// ---- CSV records -> upload items ---------------------------------------------------------------
test('toLeadUploadItem: aliases are mapped, empty fields dropped, values trimmed', () => {
  const { item, tooLong } = toLeadUploadItem({ name: '  Jane ', mobile: '9876543210', date: '2026-01-15', email: '', extra: 'ignored' });
  assert.equal(tooLong, false);
  assert.deepEqual(item, { customer_name: 'Jane', phone: '9876543210', created_at: '2026-01-15' });
});

test('toLeadUploadItem: a field over the server limit becomes an empty placeholder that keeps its row position', () => {
  const { item, tooLong } = toLeadUploadItem({ customer_name: 'x'.repeat(LEAD_FIELD_MAX.customer_name + 1), phone: '9876543210' });
  assert.equal(tooLong, true);
  assert.deepEqual(item, {});
});

// ---- the architecture's promises, against a fake idempotent server -----------------------------
function fakeLeadServer() {
  const leads = new Set();
  return {
    leads,
    // Mirrors POST /admin/leads/import-batch: first occurrence wins, existing phones are duplicates.
    async importBatch(batch, { commitThenDropResponse = false } = {}) {
      const duplicates = [];
      let imported = 0;
      batch.items.forEach((item, index) => {
        const row = batch.offset + index + 2;
        if (leads.has(item.phone)) duplicates.push({ row, phone: item.phone });
        else { leads.add(item.phone); imported += 1; }
      });
      if (commitThenDropResponse) throw new TypeError('Failed to fetch'); // committed, response lost
      return { requested: batch.items.length, imported, duplicates, invalid: [] };
    },
  };
}

test('2,000 rows in 20 batches; re-uploading the same list creates nothing new (idempotent)', async () => {
  const server = fakeLeadServer();
  const items = rows(MAX_BULK_ROWS);
  const upload = () => runBatches({ items, batchSize: LEAD_BATCH_SIZE, sleep: noSleep, send: (batch) => server.importBatch(batch), verify: verifyLeadBatch });

  const first = mergeLeadRun(await upload(), items.length);
  assert.equal(first.imported, 2000);
  assert.equal(server.leads.size, 2000);

  const second = mergeLeadRun(await upload(), items.length);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates.length, 2000);
  assert.equal(server.leads.size, 2000);
  assert.equal(second.duplicates[101].row, 103); // absolute CSV row numbers survive batching
});

test('commit-then-lost-response: the retry creates nothing twice and is reported as "already existing after a retry"', async () => {
  const server = fakeLeadServer();
  const items = rows(200);
  let dropped = false;
  const run = await runBatches({
    items, batchSize: 100, sleep: noSleep, verify: verifyLeadBatch,
    send: async (batch) => {
      const dropThis = batch.index === 1 && !dropped;
      if (dropThis) dropped = true;
      return server.importBatch(batch, { commitThenDropResponse: dropThis });
    },
  });
  const merged = mergeLeadRun(run, items.length);
  assert.equal(server.leads.size, 200); // no duplicate records
  assert.equal(merged.imported, 100); // batch 2's rows were created by the FIRST attempt
  assert.equal(merged.duplicates.length, 100);
  assert.deepEqual(merged.retried, [{ firstRow: 102, lastRow: 201, alreadyExisting: 100 }]); // CSV rows: header = row 1
});

test('friendlyBatchError: timeouts and network failures get readable messages, HTTP errors keep the server message', () => {
  assert.equal(friendlyBatchError(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })), 'The server took too long to respond.');
  assert.equal(friendlyBatchError(new TypeError('Failed to fetch')), 'Network problem: could not reach the server.');
  assert.equal(friendlyBatchError(httpError(502)), 'HTTP 502');
});

test('a stopped lead run reports the CSV row to resume from (header = row 1)', async () => {
  const run = await runBatches({
    items: rows(300), batchSize: 100, sleep: noSleep,
    send: async (batch) => { if (batch.index === 1) throw httpError(400); return { requested: 100, imported: 100, duplicates: [], invalid: [] }; },
    verify: verifyLeadBatch,
  });
  assert.equal(mergeLeadRun(run, 300).stopped.firstRow, 102);
  assert.equal(mergeVendorRun(run, 300).stopped.firstRow, 101);
});
