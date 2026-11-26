-- Hasta sahibine gönderilen hesapsız ödeme bağlantıları (/p/…) (uygulama ilk kullanımda da kurar).
CREATE TABLE IF NOT EXISTS owner_pay_link (
  token_hash char(64) CHARACTER SET ascii NOT NULL,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  customer_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  branch_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  amount int unsigned NOT NULL DEFAULT 0,
  created_by varchar(120) NOT NULL DEFAULT '',
  created_at int unsigned NOT NULL,
  expires_at int unsigned NOT NULL,
  PRIMARY KEY (token_hash),
  KEY owner_pay_link_customer (partner_id, customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
