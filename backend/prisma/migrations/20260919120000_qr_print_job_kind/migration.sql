-- Distinguish a multi-code print batch from a single-code designed PDF download.
-- Existing rows are all batches, which the default records correctly.
CREATE TYPE "QrPrintKind" AS ENUM ('BATCH', 'SINGLE');

ALTER TABLE "qr_print_jobs" ADD COLUMN "kind" "QrPrintKind" NOT NULL DEFAULT 'BATCH';
