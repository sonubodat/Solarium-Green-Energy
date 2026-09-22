-- Optional state field for a Vendor, set at creation time by Admin or Sales (never by bulk
-- create). Nullable, so every existing Vendor keeps working with a blank state.
ALTER TABLE "vendors" ADD COLUMN "state" TEXT;
