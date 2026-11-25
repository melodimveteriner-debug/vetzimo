-- Otomatik demo: başvurudaki telefon numarasına gelen kod ve telefondan imzalanan sözleşme ile 14 günlük demo kendiliğinden açılır.
CREATE TABLE IF NOT EXISTS demo_verification (
  lead_id char(36) COLLATE ascii_bin NOT NULL,
  phone varchar(24) COLLATE ascii_bin NOT NULL,
  code_hash char(64) COLLATE ascii_bin NOT NULL,
  expires bigint NOT NULL,
  attempts tinyint unsigned NOT NULL DEFAULT 0,
  sends tinyint unsigned NOT NULL DEFAULT 1,
  sent_at bigint NOT NULL,
  verified_at bigint DEFAULT NULL,
  partner_id varchar(80) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (lead_id),
  KEY phone (phone,sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
