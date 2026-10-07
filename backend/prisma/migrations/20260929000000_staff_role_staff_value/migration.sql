-- New account type for back-office users whose permissions come from an Admin-defined role.
-- Kept in its own migration: a value added to an enum cannot be used (for example in the CHECK constraint
-- of the next migration) inside the same transaction that adds it.
ALTER TYPE "StaffRole" ADD VALUE 'STAFF';
