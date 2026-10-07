-- Lead assignment (a lead can be owned by one SALES user), a work log of notes, a permanent ownership
-- history, and Admin-defined back-office roles. All additive: no existing row is rewritten.

-- Admin-defined roles: a name and a list of permission keys.
CREATE TABLE "staff_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);

-- Role names are unique ignoring case.
CREATE UNIQUE INDEX "staff_roles_name_lower_key" ON "staff_roles" (lower("name"));

-- A user's role reference. Existing ADMIN and SALES users keep it NULL, which already satisfies the constraint.
ALTER TABLE "users" ADD COLUMN "staff_role_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_staff_role_id_fkey" FOREIGN KEY ("staff_role_id") REFERENCES "staff_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One source of truth for the portal: STAFF must have a role, ADMIN and SALES must not.
ALTER TABLE "users" ADD CONSTRAINT "users_role_access_role_ck" CHECK (
    ("role" = 'STAFF' AND "staff_role_id" IS NOT NULL)
    OR ("role" IN ('ADMIN', 'SALES') AND "staff_role_id" IS NULL)
);

-- Lead ownership.
ALTER TABLE "leads" ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "assigned_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "leads_assigned_to_id_status_idx" ON "leads"("assigned_to_id", "status");

-- Work log on a lead.
CREATE TABLE "lead_notes" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lead_notes_lead_id_created_at_idx" ON "lead_notes"("lead_id", "created_at");
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permanent ownership history (the audit log is pruned; this is not). User ids are plain text on purpose.
CREATE TABLE "lead_assignment_history" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_user_id" TEXT,
    "to_user_id" TEXT,
    "changed_by_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_assignment_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lead_assignment_history_lead_id_changed_at_idx" ON "lead_assignment_history"("lead_id", "changed_at");
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
