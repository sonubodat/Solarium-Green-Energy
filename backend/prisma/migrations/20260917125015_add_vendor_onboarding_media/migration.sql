-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_qr_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_vendor_id_fkey";

-- CreateTable
CREATE TABLE "vendor_onboarding_media" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "captured_at" TIMESTAMP(3),
    "shop_photo_object_key" TEXT,
    "shop_photo_file_name" TEXT,
    "shop_photo_file_size" INTEGER,
    "shop_photo_content_type" TEXT,
    "person_photo_object_key" TEXT,
    "person_photo_file_name" TEXT,
    "person_photo_file_size" INTEGER,
    "person_photo_content_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_onboarding_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_onboarding_media_vendor_id_key" ON "vendor_onboarding_media"("vendor_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_qr_assignment_id_fkey" FOREIGN KEY ("qr_assignment_id") REFERENCES "qr_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_onboarding_media" ADD CONSTRAINT "vendor_onboarding_media_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
