-- Ek paketler: satın alınan SMS / WhatsApp kredisi ve sınır artışlarının defteri (uygulama ilk kullanımda da kurar).
CREATE TABLE IF NOT EXISTS clinic_addon_ledger (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  kind varchar(12) CHARACTER SET ascii NOT NULL,
  delta int NOT NULL,
  reason varchar(240) NOT NULL DEFAULT '',
  ref varchar(200) NOT NULL DEFAULT '',
  actor varchar(120) NOT NULL DEFAULT '',
  created_at int unsigned NOT NULL,
  PRIMARY KEY (id),
  KEY clinic_addon_ledger_partner (partner_id, kind, created_at),
  KEY clinic_addon_ledger_ref (partner_id, ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
