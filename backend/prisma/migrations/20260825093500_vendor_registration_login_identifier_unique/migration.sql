-- Enforce uniqueness of vendor_registrations.login_identifier at the database level,
-- matching Vendor.login_identifier and closing a gap where duplicate pending
-- registrations could be created for the same identifier (the application layer
-- already expected this constraint to exist via its P2002 conflict handling).
CREATE UNIQUE INDEX "vendor_registrations_login_identifier_key"
  ON "vendor_registrations"("login_identifier");
