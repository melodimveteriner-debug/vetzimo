-- VetZimo Kullanım Sözleşmesi elektronik onay ve imza kayıtları
CREATE TABLE IF NOT EXISTS dealer_agreement (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  partner_id varchar(80) NOT NULL,
  account_id varchar(80) NOT NULL,
  version int unsigned NOT NULL,
  text_hash char(64) NOT NULL,
  signer_name varchar(120) NOT NULL,
  signer_title varchar(120) NOT NULL DEFAULT '',
  signature mediumtext NOT NULL,
  ip varchar(64) NOT NULL DEFAULT '',
  user_agent varchar(300) NOT NULL DEFAULT '',
  signed_at int unsigned NOT NULL,
  PRIMARY KEY (id),
  KEY dealer_agreement_partner (partner_id,signed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
