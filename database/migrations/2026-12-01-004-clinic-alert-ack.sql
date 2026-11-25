-- Klinik uyarıları: kişinin tamamlandı işaretlediği uyarılar (30 gün saklanır)
CREATE TABLE IF NOT EXISTS clinic_alert_ack (
  membership_id varchar(80) NOT NULL,
  alert_key varchar(160) CHARACTER SET ascii NOT NULL,
  created_at int unsigned NOT NULL,
  PRIMARY KEY (membership_id,alert_key),
  KEY alert_ack_age (membership_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
