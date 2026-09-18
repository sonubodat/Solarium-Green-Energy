-- CreateTable
CREATE TABLE "audit_log_retention_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cleanupCycle" INTEGER NOT NULL DEFAULT 0,
    "lastAcknowledgedCycle" INTEGER NOT NULL DEFAULT -1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_log_retention_state_pkey" PRIMARY KEY ("id")
);
