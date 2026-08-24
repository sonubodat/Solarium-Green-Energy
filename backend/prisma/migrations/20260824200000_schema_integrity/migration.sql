-- Add a controlled lifecycle for vendor registrations.
CREATE TYPE "VendorRegistrationStatus" AS ENUM ('PENDING', 'ONBOARDED', 'REJECTED');

ALTER TABLE "vendor_registrations"
  ALTER COLUMN "status" TYPE "VendorRegistrationStatus"
  USING CASE UPPER("status")
    WHEN 'PENDING' THEN 'PENDING'::"VendorRegistrationStatus"
    WHEN 'ONBOARDED' THEN 'ONBOARDED'::"VendorRegistrationStatus"
    WHEN 'REJECTED' THEN 'REJECTED'::"VendorRegistrationStatus"
    ELSE 'PENDING'::"VendorRegistrationStatus"
  END,
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- A QR can have many historical assignments, but only one current assignment.
CREATE UNIQUE INDEX "qr_assignments_one_active_per_qr"
  ON "qr_assignments"("qr_code_id")
  WHERE "unassigned_at" IS NULL;
