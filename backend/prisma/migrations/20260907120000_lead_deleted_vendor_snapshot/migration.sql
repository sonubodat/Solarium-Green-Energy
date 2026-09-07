ALTER TABLE "leads"
  ADD COLUMN "vendor_name_snapshot" TEXT;

UPDATE "leads" AS leads
SET "vendor_name_snapshot" = vendors."business_name"
FROM "vendors" AS vendors
WHERE leads."vendor_id" = vendors."id";

ALTER TABLE "leads"
  ALTER COLUMN "vendor_name_snapshot" SET NOT NULL,
  ALTER COLUMN "vendor_id" DROP NOT NULL,
  ALTER COLUMN "qr_assignment_id" DROP NOT NULL,
  ALTER COLUMN "scan_id" DROP NOT NULL;
