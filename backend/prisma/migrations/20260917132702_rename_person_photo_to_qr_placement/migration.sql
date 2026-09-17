/*
  Warnings:

  - You are about to drop the column `person_photo_content_type` on the `vendor_onboarding_media` table. All the data in the column will be lost.
  - You are about to drop the column `person_photo_file_name` on the `vendor_onboarding_media` table. All the data in the column will be lost.
  - You are about to drop the column `person_photo_file_size` on the `vendor_onboarding_media` table. All the data in the column will be lost.
  - You are about to drop the column `person_photo_object_key` on the `vendor_onboarding_media` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "vendor_onboarding_media" DROP COLUMN "person_photo_content_type",
DROP COLUMN "person_photo_file_name",
DROP COLUMN "person_photo_file_size",
DROP COLUMN "person_photo_object_key",
ADD COLUMN     "qr_placement_photo_content_type" TEXT,
ADD COLUMN     "qr_placement_photo_file_name" TEXT,
ADD COLUMN     "qr_placement_photo_file_size" INTEGER,
ADD COLUMN     "qr_placement_photo_object_key" TEXT;
