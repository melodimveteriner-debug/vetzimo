CREATE TABLE IF NOT EXISTS clinic_client_permit (
  id char(32) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  branch_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  client_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  client_name varchar(160) NOT NULL DEFAULT '',
  phone varchar(20) NOT NULL DEFAULT '',
  token_hash char(64) CHARACTER SET ascii DEFAULT NULL,
  expires_at int unsigned NOT NULL,
  status varchar(10) CHARACTER SET ascii NOT NULL DEFAULT 'pending',
  method varchar(10) CHARACTER SET ascii NOT NULL DEFAULT 'link',
  doc mediumtext NOT NULL,
  doc_hash char(64) CHARACTER SET ascii NOT NULL,
  choices varchar(300) NOT NULL DEFAULT '',
  signer_name varchar(120) NOT NULL DEFAULT '',
  signer_ip varchar(64) CHARACTER SET ascii NOT NULL DEFAULT '',
  signer_agent varchar(255) NOT NULL DEFAULT '',
  signature mediumtext DEFAULT NULL,
  created_by varchar(120) NOT NULL DEFAULT '',
  created_at int unsigned NOT NULL,
  opened_at int unsigned DEFAULT NULL,
  decided_at int unsigned DEFAULT NULL,
  applied_at int unsigned DEFAULT NULL,
  UNIQUE KEY permit_token (token_hash),
  KEY permit_client (partner_id,client_id,created_at),
  KEY permit_status (partner_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS clinic_permit_setting (
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  notice mediumtext NOT NULL,
  updated_at int unsigned NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
