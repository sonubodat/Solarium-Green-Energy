export const AUDIT_LOG_CAP = 5000;
export const AUDIT_LOG_WARNING_THRESHOLD = 4000;

// Single-instance in-process guard: a second concurrent request awaits the same
// in-flight result instead of racing its own count()+deleteMany() against the same
// rows. Does NOT protect across multiple backend instances/processes — acceptable for
// this single-instance pilot; a real multi-instance deployment would need a DB-level
// (e.g. advisory) lock instead.
let inFlight = null;

export function checkAuditLogRetention(prisma) {
  if (!inFlight) {
    inFlight = runRetentionCheck(prisma).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runRetentionCheck(prisma) {
  let count = await prisma.auditLog.count();
  let deleted = 0;
  let state = await prisma.auditLogRetentionState.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  if (count > AUDIT_LOG_CAP) {
    const excess = count - AUDIT_LOG_CAP;
    // Order by timestamp THEN id so rows sharing a timestamp (routine during bulk
    // vendor-create/CSV-import bursts) still produce an exact, deterministic set of N
    // oldest rows — a plain `timestamp <= cutoff` filter would instead delete every row
    // at that instant, which can overshoot well past the intended count.
    const oldest = await prisma.auditLog.findMany({
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: excess,
      select: { id: true },
    });
    const result = await prisma.auditLog.deleteMany({ where: { id: { in: oldest.map((row) => row.id) } } });
    deleted = result.count;
    count -= deleted;
    if (deleted > 0) {
      state = await prisma.auditLogRetentionState.update({
        where: { id: 1 },
        data: { cleanupCycle: { increment: 1 } },
      });
    }
  }

  const warning = count >= AUDIT_LOG_WARNING_THRESHOLD && count < AUDIT_LOG_CAP;
  return {
    count,
    cap: AUDIT_LOG_CAP,
    warningThreshold: AUDIT_LOG_WARNING_THRESHOLD,
    warning,
    atCapacity: count >= AUDIT_LOG_CAP, // mutually exclusive with `warning`
    deleted,
    needsAcknowledgment: warning && state.lastAcknowledgedCycle < state.cleanupCycle,
  };
}

export async function acknowledgeAuditLogRetentionWarning(prisma) {
  const state = await prisma.auditLogRetentionState.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  await prisma.auditLogRetentionState.update({
    where: { id: 1 },
    data: { lastAcknowledgedCycle: state.cleanupCycle },
  });
}
