-- Enforce global one-lead-per-customer at the database level (business rule confirmed:
-- global uniqueness, not per-vendor). Application-level checks alone cannot prevent a
-- second lead for the same customer under concurrent requests. Replaces the plain index
-- with a unique constraint on the same column.
DROP INDEX "leads_customer_identity_id_idx";

CREATE UNIQUE INDEX "leads_customer_identity_id_key"
  ON "leads"("customer_identity_id");
