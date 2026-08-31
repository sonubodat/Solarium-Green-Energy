-- Pilot scope: optional 1:1 GPS location per lead, captured client-side and submitted
-- only as part of that lead's own creation request (never attachable to another lead_id).
CREATE TABLE "lead_locations" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_locations_lead_id_key" ON "lead_locations"("lead_id");

ALTER TABLE "lead_locations" ADD CONSTRAINT "lead_locations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
