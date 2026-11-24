-- Köprü kuyruğu: aynı saniyede açılan işler de kesin geliş sırasıyla alınır.
ALTER TABLE clinic_bridge_job ADD COLUMN IF NOT EXISTS seq bigint unsigned NOT NULL AUTO_INCREMENT UNIQUE
