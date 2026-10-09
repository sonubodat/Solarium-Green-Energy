-- The template a Solar Mitra's own "Download poster" uses, chosen by Admin. Additive: existing rows get false,
-- so nothing changes until Admin picks one (until then the newest published template is used, as before).
ALTER TABLE "qr_print_templates" ADD COLUMN "vendor_poster" BOOLEAN NOT NULL DEFAULT false;

-- At most one template can be the Solar Mitra poster template.
CREATE UNIQUE INDEX "qr_print_templates_one_vendor_poster" ON "qr_print_templates" ((true)) WHERE "vendor_poster";
