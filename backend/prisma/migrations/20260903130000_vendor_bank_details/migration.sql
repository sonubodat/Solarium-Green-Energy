CREATE TABLE "vendor_bank_details" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "upi_number" TEXT,
    "upi_id" TEXT,
    "account_holder_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "passbook_object_key" TEXT,
    "passbook_file_name" TEXT,
    "passbook_file_size" INTEGER,
    "passbook_content_type" TEXT,
    "cheque_object_key" TEXT,
    "cheque_file_name" TEXT,
    "cheque_file_size" INTEGER,
    "cheque_content_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vendor_bank_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_bank_details_vendor_id_key" ON "vendor_bank_details"("vendor_id");
ALTER TABLE "vendor_bank_details" ADD CONSTRAINT "vendor_bank_details_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;