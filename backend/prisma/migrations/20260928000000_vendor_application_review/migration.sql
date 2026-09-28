-- Public "Apply for Solar Mitra": the applicant's state and the Admin review record on the existing
-- vendor_registrations table. All four columns are nullable and additive, so every existing row keeps
-- working untouched. No enum change and no new unique index (an index on mobile_number could fail on
-- existing rows; the unique login_identifier, set to the normalized mobile for new applications, is the
-- database backstop against duplicate applications).
ALTER TABLE "vendor_registrations" ADD COLUMN "state" TEXT;
ALTER TABLE "vendor_registrations" ADD COLUMN "reviewed_by_id" TEXT;
ALTER TABLE "vendor_registrations" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "vendor_registrations" ADD COLUMN "rejection_reason" TEXT;
