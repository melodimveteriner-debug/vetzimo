-- Hasta sahibi borç ödemeleri: bayinin kendi PayTR hesabıyla kartla (otomatik tahsilat) veya bayinin IBAN'ına havale (klinik onaylar).
CREATE TABLE IF NOT EXISTS owner_payment (
  id char(32) COLLATE ascii_bin NOT NULL,
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  branch_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  customer_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  membership_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  customer_name varchar(160) NOT NULL DEFAULT '',
  amount int unsigned NOT NULL,
  method varchar(8) COLLATE ascii_bin NOT NULL,
  status varchar(12) COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  reference varchar(120) NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  paid_at bigint DEFAULT NULL,
  decided_by varchar(120) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY partner_status (partner_id,status,created_at),
  KEY customer (partner_id,customer_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
