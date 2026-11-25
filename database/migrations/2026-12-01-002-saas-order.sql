-- Abonelik siparişleri: kartla (PayTR) veya havaleyle paket satın alma ve yenileme
CREATE TABLE IF NOT EXISTS saas_order (
  id char(32) NOT NULL,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  plan_id varchar(32) NOT NULL,
  plan_name varchar(120) NOT NULL,
  period varchar(8) NOT NULL,
  amount int unsigned NOT NULL,
  method varchar(8) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending',
  reference varchar(100) NOT NULL DEFAULT '',
  instruction varchar(400) NOT NULL DEFAULT '',
  created_by varchar(120) NOT NULL DEFAULT '',
  created_at int unsigned NOT NULL,
  paid_at int unsigned DEFAULT NULL,
  starts_on date DEFAULT NULL,
  ends_on date DEFAULT NULL,
  PRIMARY KEY (id),
  KEY saas_order_partner (partner_id,created_at),
  KEY saas_order_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
