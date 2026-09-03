CREATE TYPE "QrPrintTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "QrPrintJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'PROOF_READY', 'APPROVED', 'GENERATING', 'COMPLETED', 'FAILED');
CREATE TYPE "QrPrintItemStatus" AS ENUM ('PENDING', 'PROOF_READY', 'GENERATED', 'FAILED');

CREATE TABLE "qr_print_templates" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artwork_file_name" TEXT,
    "artwork_path" TEXT,
    "artwork_mime_type" TEXT,
    "page_width_mm" DOUBLE PRECISION NOT NULL,
    "page_height_mm" DOUBLE PRECISION NOT NULL,
    "dpi" INTEGER NOT NULL DEFAULT 300,
    "qr_x" DOUBLE PRECISION NOT NULL,
    "qr_y" DOUBLE PRECISION NOT NULL,
    "qr_width" DOUBLE PRECISION NOT NULL,
    "qr_height" DOUBLE PRECISION NOT NULL,
    "label_enabled" BOOLEAN NOT NULL DEFAULT false,
    "label_text_x" DOUBLE PRECISION,
    "label_text_y" DOUBLE PRECISION,
    "label_font_size" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QrPrintTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "qr_print_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qr_print_jobs" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "QrPrintJobStatus" NOT NULL DEFAULT 'QUEUED',
    "range_start" TEXT,
    "range_end" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "proof_summary" JSONB,
    "pdf_path" TEXT,
    "pdf_file_name" TEXT,
    "generated_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "qr_print_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qr_print_job_items" (
    "id" TEXT NOT NULL,
    "print_job_id" TEXT NOT NULL,
    "qr_code_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "expected_code" TEXT NOT NULL,
    "expected_url" TEXT NOT NULL,
    "preview_path" TEXT,
    "status" "QrPrintItemStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "qr_print_job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qr_print_jobs_idempotency_key_key" ON "qr_print_jobs"("idempotency_key");
CREATE UNIQUE INDEX "qr_print_job_items_print_job_id_sequence_key" ON "qr_print_job_items"("print_job_id", "sequence");
CREATE INDEX "qr_print_templates_status_created_at_idx" ON "qr_print_templates"("status", "created_at");
CREATE INDEX "qr_print_templates_created_by_id_idx" ON "qr_print_templates"("created_by_id");
CREATE INDEX "qr_print_jobs_status_created_at_idx" ON "qr_print_jobs"("status", "created_at");
CREATE INDEX "qr_print_jobs_template_id_created_at_idx" ON "qr_print_jobs"("template_id", "created_at");
CREATE INDEX "qr_print_job_items_print_job_id_status_idx" ON "qr_print_job_items"("print_job_id", "status");
CREATE INDEX "qr_print_job_items_qr_code_id_idx" ON "qr_print_job_items"("qr_code_id");

ALTER TABLE "qr_print_templates"
    ADD CONSTRAINT "qr_print_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qr_print_jobs"
    ADD CONSTRAINT "qr_print_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "qr_print_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "qr_print_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qr_print_job_items"
    ADD CONSTRAINT "qr_print_job_items_print_job_id_fkey" FOREIGN KEY ("print_job_id") REFERENCES "qr_print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "qr_print_job_items_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
