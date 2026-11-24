-- Büyük klinikler: kaydederken yalnız ilgili satırları okuyabilmek için bağlantı dizini.
-- Sanal sütundur, mevcut satırlar için ek veri yazılmaz, değer kayıt içeriğinden hesaplanır.
-- Kontrol randevusu -> muayene, tahsilat -> satış, ödeme -> alış bağlantıları.
ALTER TABLE clinic_record ADD COLUMN IF NOT EXISTS link_key varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin AS (
  CASE collection
    WHEN 'appointments' THEN NULLIF(LEFT(JSON_VALUE(record_data,'$.controlExamId'),191),'')
    WHEN 'collections' THEN NULLIF(LEFT(JSON_VALUE(record_data,'$.sale'),191),'')
    WHEN 'payments' THEN NULLIF(LEFT(JSON_VALUE(record_data,'$.purchase'),191),'')
    ELSE NULL
  END) VIRTUAL;

CREATE INDEX IF NOT EXISTS clinic_record_link ON clinic_record (set_id, collection, link_key)
