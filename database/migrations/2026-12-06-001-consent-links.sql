-- Onam formları: SMS / WhatsApp / e-posta ile gönderilen tek kullanımlık hesapsız imza bağlantıları.
-- (Uygulama bu tabloyu ilk kullanımda kendisi de kurar.)
CREATE TABLE IF NOT EXISTS clinic_consent_link (
  token_hash char(64) CHARACTER SET ascii NOT NULL,
  consent_id char(32) CHARACTER SET ascii NOT NULL,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  method varchar(10) CHARACTER SET ascii NOT NULL,
  target varchar(160) NOT NULL DEFAULT '',
  expires_at int unsigned NOT NULL,
  created_at int unsigned NOT NULL,
  PRIMARY KEY (token_hash),
  KEY clinic_consent_link_consent (consent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
