-- Klinik ekibi için iki adımlı doğrulama (telefonla giriş yapan hesaplar). Anahtar şifreli saklanır.
CREATE TABLE IF NOT EXISTS identity_phone_totp (
  account_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  seed text DEFAULT NULL,
  pending_seed text DEFAULT NULL,
  step bigint NOT NULL DEFAULT -1,
  enabled_at bigint DEFAULT NULL,
  recovery text DEFAULT NULL,
  PRIMARY KEY (account_id),
  CONSTRAINT identity_phone_totp_account FOREIGN KEY (account_id) REFERENCES identity_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
