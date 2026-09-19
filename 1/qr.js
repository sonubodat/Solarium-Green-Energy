import { prisma } from '../lib/prisma.js';

function conflict(message, code = 'QR_CONFLICT') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

export async function generateQrCodes(quantity, actorUserId) {
  return prisma.$transaction(async (transaction) => {
    // Was `V-${Date.now()}-${index+1}` — ugly on a printed sticker (e.g. "V-1787651347011-1"
    // instead of "V-0004"), inconsistent with the seeded V-0001/V-0002/V-0003 codes, and a real
    // duplicate-batch bug: Date.now() often returns the same millisecond across two close-together
    // requests (a double-click on "Generate", or two admins generating at once), and since index
    // restarts at 1 each call, two batches could mint the exact same code set, failing the whole
    // createMany on QrCode.code's unique constraint. Continuing a real sequential counter (read
    // from the highest existing V-#### code) fixes both — clean codes and no timestamp collision.
    const [{ max_number: maxNumber }] = await transaction.$queryRaw`
      SELECT COALESCE(MAX((regexp_match(code, '^V-(\\d+)$'))[1]::int), 0) AS max_number
      FROM qr_codes
      WHERE code ~ '^V-\\d+$'
    `;
    const start = Number(maxNumber);
    const codes = Array.from({ length: quantity }, (_, index) => `V-${String(start + index + 1).padStart(4, '0')}`);
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

export async function assignUnassignedQr({ code, vendorId, assignedById, assignedByRole }) {
  return prisma.$transaction(async (transaction) => {
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
    const existingActive = await transaction.qrAssignment.findFirst({ where: { vendorId, unassignedAt: null } });
    if (existingActive) throw conflict('This Vendor already holds an active QR. Reassign or unassign it first.', 'VENDOR_ALREADY_HAS_ACTIVE_QR');

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
  });
}

export async function reassignQr({ qrId, vendorId, assignedById }) {
  return prisma.$transaction(async (transaction) => {
    const qr = await transaction.qrCode.findUnique({ where: { id: qrId } });
    const vendor = await transaction.vendor.findUnique({ where: { id: vendorId } });
    const current = await transaction.qrAssignment.findFirst({ where: { qrCodeId: qrId, unassignedAt: null } });
    if (!qr) throw conflict('QR code was not found.', 'QR_NOT_FOUND');
    if (!vendor) throw conflict('Vendor was not found.', 'VENDOR_NOT_FOUND');
    if (!current || qr.status !== 'ACTIVE') throw conflict('Only an active QR can be reassigned.', 'QR_NOT_ACTIVE');
    if (current.vendorId === vendorId) throw conflict('QR is already assigned to this Vendor.', 'QR_ALREADY_ASSIGNED');

    // Same missing check as assignUnassignedQr had — the target vendor could already hold a
    // different active QR, and nothing stopped them from silently ending up with two at once.
    const targetAlreadyActive = await transaction.qrAssignment.findFirst({ where: { vendorId, unassignedAt: null } });
    if (targetAlreadyActive) throw conflict('This Vendor already holds a different active QR. Reassign or unassign it first.', 'VENDOR_ALREADY_HAS_ACTIVE_QR');

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
  });
}
