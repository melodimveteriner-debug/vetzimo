-- Hasta sahibi portalı ve tek hastaya bakan ekranlar için hasta ve müşteri dizinleri.
-- Sanal sütunlardır, mevcut satırlar için ek veri yazılmaz.
ALTER TABLE clinic_record
  ADD COLUMN IF NOT EXISTS patient_key varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin AS (NULLIF(LEFT(JSON_VALUE(record_data,'$.patient'),191),'')) VIRTUAL,
  ADD COLUMN IF NOT EXISTS client_key varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin AS (NULLIF(LEFT(JSON_VALUE(record_data,'$.client'),191),'')) VIRTUAL;

CREATE INDEX IF NOT EXISTS clinic_record_patient ON clinic_record (set_id, collection, patient_key);

CREATE INDEX IF NOT EXISTS clinic_record_client ON clinic_record (set_id, collection, client_key)
