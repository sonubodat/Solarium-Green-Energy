-- Prevent one registration from being converted into multiple vendors.
CREATE UNIQUE INDEX "vendor_registrations_vendor_id_key"
  ON "vendor_registrations"("vendor_id");

ALTER TABLE "vendor_registrations"
  ADD CONSTRAINT "vendor_registrations_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_registrations"
  ADD CONSTRAINT "vendor_registrations_sales_user_id_fkey"
  FOREIGN KEY ("sales_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
