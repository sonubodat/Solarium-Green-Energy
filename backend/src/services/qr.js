import { prisma } from '../lib/prisma.js';
import { BULK_TRANSACTION_OPTIONS } from '../lib/bulk-limits.js';
import { POSTER_PRODUCED_JOB_STATUSES, QR_NUMBERING_LOCK_KEY, formatQrCode, isReplaceableAutoQr, sortedVendorLockIds, vendorQrLockKey } from '../lib/qr-provisioning.js';

function conflict(message, code = 'QR_CONFLICT') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

// Transaction-scoped advisory locks (released at COMMIT or ROLLBACK). Lock order is fixed everywhere:
// vendor lock(s) first, sorted by vendor id, then the numbering lock. Never the reverse.
async function advisoryLock(transaction, key) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

// Any operation that can change a vendor's active QR takes that vendor's lock first, so two
// requests (tabs, retries, automatic provisioning, staff replacement) can never both act on it.
async function lockVendorsQr(transaction, vendorIds) {
  for (const vendorId of sortedVendorLockIds(vendorIds)) {
    // eslint-disable-next-line no-await-in-loop
    await advisoryLock(transaction, vendorQrLockKey(vendorId));
  }
}

// Every path that picks a new V-#### number (Admin bulk generation, automatic provisioning) holds
// this, so two of them can never read the same maximum.
async function lockQrNumbering(transaction) {
  await advisoryLock(transaction, QR_NUMBERING_LOCK_KEY);
}

async function highestQrNumber(transaction) {
  const [{ max_number: maxNumber }] = await transaction.$queryRaw`
    SELECT COALESCE(MAX((regexp_match(code, '^V-(\\d+)$'))[1]::int), 0) AS max_number
    FROM qr_codes
    WHERE code ~ '^V-\\d+$'
  `;
  return Number(maxNumber);
}

export async function generateQrCodes(quantity, actorUserId) {
  return prisma.$transaction(async (transaction) => {
    await lockQrNumbering(transaction);
    // Was `V-${Date.now()}-${index+1}` — ugly on a printed sticker (e.g. "V-1787651347011-1"
    // instead of "V-0004"), inconsistent with the seeded V-0001/V-0002/V-0003 codes, and a real
    // duplicate-batch bug: Date.now() often returns the same millisecond across two close-together
    // requests (a double-click on "Generate", or two admins generating at once), and since index
    // restarts at 1 each call, two batches could mint the exact same code set, failing the whole
    // createMany on QrCode.code's unique constraint. Continuing a real sequential counter (read
    // from the highest existing V-#### code) fixes both — clean codes and no timestamp collision.
    const start = await highestQrNumber(transaction);
    const codes = Array.from({ length: quantity }, (_, index) => formatQrCode(start + index + 1));
    const created = await transaction.qrCode.createMany({ data: codes.map((code) => ({ code })) });
    await transaction.auditLog.create({
      data: {
        actorUserId,
        actorRole: 'ADMIN',
        action: 'QR_GENERATED',
        entity: 'QrCode',
        entityId: 'batch',
        metadata: { quantity: created.count },
      },
    });
    return { count: created.count, codes };
  });
}

// Fills an explicit, possibly gapped, set of codes (e.g. the missing codes inside a print
// range) rather than appending sequentially — generateQrCodes() always continues from the
// current max and cannot fill a gap. skipDuplicates guards a concurrent generate-range call
// racing for the same codes; the audit metadata's `mode: 'range'` distinguishes this from a
// sequential batch's `{ quantity }`-only metadata in the same 'QR_GENERATED' audit action.
export async function generateSpecificQrCodes(codes, actorUserId, { rangeStart, rangeEnd } = {}) {
  return prisma.$transaction(async (transaction) => {
    const created = await transaction.qrCode.createMany({ data: codes.map((code) => ({ code })), skipDuplicates: true });
    if (created.count) {
      await transaction.auditLog.create({
        data: {
          actorUserId,
          actorRole: 'ADMIN',
          action: 'QR_GENERATED',
          entity: 'QrCode',
          entityId: 'range',
          metadata: { mode: 'range', rangeStart, rangeEnd, quantity: created.count },
        },
      });
    }
    return { count: created.count, codes };
  });
}

// The vendor's active QR is an automatic one nobody has used: staff may replace it with a printed
// QR. Retires it (assignment ended, QR RETIRED) and writes an audit row. Any other active QR is a
// conflict, exactly as before. The caller holds this vendor's lock, so the re-read below is
// authoritative, and everything runs inside the caller's transaction: if a later step fails the
// whole replacement rolls back and the vendor keeps the original QR.
async function retireAutoQrOrConflict(transaction, { vendorId, actorUserId, actorRole, newQrCode, conflictMessage }) {
  const current = await transaction.qrAssignment.findFirst({
    where: { vendorId, unassignedAt: null },
    include: {
      vendor: { select: { loginIdentifier: true } },
      qrCode: {
        select: {
          id: true,
          code: true,
          _count: { select: { scans: true, leads: true, printJobItems: { where: { printJob: { status: { in: POSTER_PRODUCED_JOB_STATUSES } } } } } },
        },
      },
    },
  });
  if (!current) return;
  if (!isReplaceableAutoQr(current)) throw conflict(conflictMessage, 'VENDOR_ALREADY_HAS_ACTIVE_QR');
  await transaction.qrAssignment.update({ where: { id: current.id }, data: { unassignedAt: new Date() } });
  await transaction.qrCode.update({ where: { id: current.qrCode.id }, data: { status: 'RETIRED' } });
  await transaction.auditLog.create({
    data: {
      actorUserId,
      actorRole,
      action: 'QR_AUTO_REPLACED',
      entity: 'QrAssignment',
      entityId: current.id,
      metadata: { vendorId, retiredQr: current.qrCode.code, newQr: newQrCode },
    },
  });
}

export async function assignUnassignedQr({ code, vendorId, assignedById, assignedByRole }) {
  return prisma.$transaction(async (transaction) => {
    // Affects exactly one vendor (the target), so one vendor lock.
    await lockVendorsQr(transaction, [vendorId]);
    const qr = await transaction.qrCode.findUnique({ where: { code } });
    const vendor = await transaction.vendor.findUnique({ where: { id: vendorId } });
    if (!qr) throw conflict('QR code was not found.', 'QR_NOT_FOUND');
    if (!vendor) throw conflict('Vendor was not found.', 'VENDOR_NOT_FOUND');
    if (qr.status !== 'UNASSIGNED') throw conflict('Only an unassigned QR can be activated.', 'QR_NOT_UNASSIGNED');

    // The "one active QR per vendor" rule was previously only enforced by the vendor-lookup
    // picker excluding already-assigned vendors from the dropdown — a UI convenience, not real
    // enforcement. Nothing stopped this function itself from being called (directly, or via a
    // stale/cached picker) with a vendor that already held an active QR, silently giving that
    // vendor a second (or third) simultaneous active assignment. Found from exactly that: a
    // vendor with 3 concurrent active assignments, which is why the "assign" dropdown showed
    // almost no eligible vendors — most of them incorrectly already looked "assigned".
    // The one exception: an automatically created QR that nobody has used may be replaced.
    await retireAutoQrOrConflict(transaction, {
      vendorId, actorUserId: assignedById, actorRole: assignedByRole, newQrCode: code,
      conflictMessage: 'This Vendor already holds an active QR. Reassign or unassign it first.',
    });

    const assignment = await transaction.qrAssignment.create({
      data: { qrCodeId: qr.id, vendorId, assignedById, assignedAt: new Date() },
    });
    const updatedQr = await transaction.qrCode.update({ where: { id: qr.id }, data: { status: 'ACTIVE' } });
    await transaction.auditLog.create({
      data: {
        actorUserId: assignedById,
        actorRole: assignedByRole,
        action: 'QR_ASSIGNED',
        entity: 'QrAssignment',
        entityId: assignment.id,
        metadata: { qrCode: code, vendorId },
      },
    });
    return { qr: updatedQr, assignment, vendor };
  }, BULK_TRANSACTION_OPTIONS);
}

export async function reassignQr({ qrId, vendorId, assignedById }) {
  return prisma.$transaction(async (transaction) => {
    // Moving a QR affects TWO vendors: the one losing it (its assignment ends) and the one receiving
    // it. The unlocked read only learns the source vendor; both locks are then taken in sorted
    // order and the assignment is re-read, and if it changed in between the lock set was incomplete,
    // so the request is refused rather than run on stale information.
    const preview = await transaction.qrAssignment.findFirst({ where: { qrCodeId: qrId, unassignedAt: null }, select: { vendorId: true } });
    await lockVendorsQr(transaction, [vendorId, preview?.vendorId]);

    const qr = await transaction.qrCode.findUnique({ where: { id: qrId } });
    const vendor = await transaction.vendor.findUnique({ where: { id: vendorId } });
    const current = await transaction.qrAssignment.findFirst({ where: { qrCodeId: qrId, unassignedAt: null } });
    if ((current?.vendorId ?? null) !== (preview?.vendorId ?? null)) throw conflict('This QR was just changed by someone else. Refresh and try again.', 'QR_CHANGED');
    if (!qr) throw conflict('QR code was not found.', 'QR_NOT_FOUND');
    if (!vendor) throw conflict('Vendor was not found.', 'VENDOR_NOT_FOUND');
    if (!current || qr.status !== 'ACTIVE') throw conflict('Only an active QR can be reassigned.', 'QR_NOT_ACTIVE');
    if (current.vendorId === vendorId) throw conflict('QR is already assigned to this Vendor.', 'QR_ALREADY_ASSIGNED');

    // Same missing check as assignUnassignedQr had — the target vendor could already hold a
    // different active QR, and nothing stopped them from silently ending up with two at once.
    // An automatic, unused QR on the target may be replaced (see retireAutoQrOrConflict).
    await retireAutoQrOrConflict(transaction, {
      vendorId, actorUserId: assignedById, actorRole: 'ADMIN', newQrCode: qr.code,
      conflictMessage: 'This Vendor already holds a different active QR. Reassign or unassign it first.',
    });

    await transaction.qrAssignment.update({ where: { id: current.id }, data: { unassignedAt: new Date() } });
    const replacement = await transaction.qrAssignment.create({
      data: { qrCodeId: qrId, vendorId, assignedById, assignedAt: new Date() },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: assignedById,
        actorRole: 'ADMIN',
        action: 'QR_REASSIGNED',
        entity: 'QrAssignment',
        entityId: replacement.id,
        metadata: { oldVendorId: current.vendorId, newVendorId: vendorId, qrId },
      },
    });
    return { qr, previousAssignment: current, assignment: replacement, vendor };
  }, BULK_TRANSACTION_OPTIONS);
}

// Lazy automatic provisioning: make sure this Solar Mitra has exactly one active QR (provisionVendorQr;
// callers use ensureVendorQr / ensureVendorQrWithin below). Returns the
// existing one, or creates a BRAND-NEW code above the highest existing V-#### and assigns it
// (assignedById null marks it as automatic). It never searches for, reuses, modifies or assigns an
// existing QR: existing V-#### records may already be printed and distributed.
// Idempotent and safe under concurrency: the vendor lock makes same-vendor calls serialize, the
// numbering lock makes different vendors (and Admin bulk generation) pick different numbers.
async function provisionVendorQr(vendorId) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await prisma.$transaction(async (transaction) => {
        await lockVendorsQr(transaction, [vendorId]);
        const vendor = await transaction.vendor.findUnique({ where: { id: vendorId }, select: { status: true } });
        if (!vendor || vendor.status !== 'ACTIVE') throw conflict('Vendor was not found.', 'VENDOR_NOT_FOUND');

        const existing = await transaction.qrAssignment.findFirst({
          where: { vendorId, unassignedAt: null },
          orderBy: { assignedAt: 'desc' },
          select: { qrCode: { select: { code: true } } },
        });
        if (existing) return { code: existing.qrCode.code, created: false };

        await lockQrNumbering(transaction);
        const code = formatQrCode((await highestQrNumber(transaction)) + 1);
        const qr = await transaction.qrCode.create({ data: { code, status: 'ACTIVE' } });
        await transaction.qrAssignment.create({ data: { qrCodeId: qr.id, vendorId, assignedById: null, assignedAt: new Date() } });
        return { code, created: true };
      }, BULK_TRANSACTION_OPTIONS);
    } catch (error) {
      // A writer that ignores the numbering lock claimed this code first: try again with a fresh maximum.
      if (error?.code === 'P2002' && attempt < 3) continue;
      console.error(`[VendorQr] automatic QR provisioning failed (vendor ${vendorId}, attempt ${attempt}): ${error?.code || error?.message}`);
      throw error;
    }
  }
}

// A burst of first logins must not hurt everyone else. Provisioning transactions queue on the
// numbering lock, and a transaction blocked on a lock still occupies one of the few (5) database
// connections, so an unbounded burst would starve every other request. At most
// MAX_CONCURRENT_PROVISIONS run at once in this process, and the rest wait in memory, holding no
// connection. (Correctness never depends on this: the database locks above are what make it safe,
// this only smooths load. Measured at a simulated 300 ms round trip: without it a burst of 20 left
// 11 vendors with "Try again" and would have starved the pool.)
const MAX_CONCURRENT_PROVISIONS = 2;
let runningProvisions = 0;
const waitingProvisions = [];
const provisionsInFlight = new Map();

async function limitedProvision(vendorId) {
  if (runningProvisions >= MAX_CONCURRENT_PROVISIONS) {
    await new Promise((resolve) => waitingProvisions.push(resolve)); // the slot is handed over already counted
  } else {
    runningProvisions += 1;
  }
  try {
    return await provisionVendorQr(vendorId);
  } finally {
    const next = waitingProvisions.shift();
    if (next) next();
    else runningProvisions -= 1;
  }
}

// Same vendor asking again while a run is in flight (two tabs, a retry) shares that one run.
export function ensureVendorQr(vendorId) {
  let run = provisionsInFlight.get(vendorId);
  if (!run) {
    run = limitedProvision(vendorId);
    provisionsInFlight.set(vendorId, run);
    const clear = () => provisionsInFlight.delete(vendorId);
    run.then(clear, clear);
  }
  return run;
}

// How long GET /vendor/profile waits for provisioning before answering without a QR. The run keeps
// going in the background, so the next load simply finds the QR. Keeps a login from ever hanging.
export const VENDOR_QR_WAIT_MS = 20000;

export function ensureVendorQrWithin(vendorId, waitMs = VENDOR_QR_WAIT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const slow = new Error('QR provisioning is taking longer than expected.');
      slow.code = 'QR_PROVISIONING_SLOW';
      reject(slow);
    }, waitMs);
    ensureVendorQr(vendorId).then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
