-- Bakanlık köprüsü: klinik bilgisayarındaki ajan, veterinerin kendi e-Devlet oturumunda reçete ve aşı belgesi girer.
-- Sunucu yalnız iş kuyruğunu, ilaç eşleştirmelerini ve kliniğin öğrettiği ekran tariflerini tutar. Şifre saklanmaz.
CREATE TABLE IF NOT EXISTS clinic_bridge_agent (
  id char(32) CHARACTER SET ascii NOT NULL,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name varchar(80) NOT NULL DEFAULT '',
  token_hash char(64) CHARACTER SET ascii DEFAULT NULL,
  pair_hash char(64) CHARACTER SET ascii DEFAULT NULL,
  pair_expires bigint DEFAULT NULL,
  created_at bigint NOT NULL,
  paired_at bigint DEFAULT NULL,
  last_seen bigint DEFAULT NULL,
  version varchar(20) NOT NULL DEFAULT '',
  ministry varchar(12) CHARACTER SET ascii NOT NULL DEFAULT 'unknown',
  ministry_at bigint DEFAULT NULL,
  command varchar(20) CHARACTER SET ascii NOT NULL DEFAULT '',
  revoked_at bigint DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY bridge_agent_token (token_hash),
  KEY bridge_agent_partner (partner_id, revoked_at),
  CONSTRAINT bridge_agent_partner_fk FOREIGN KEY (partner_id) REFERENCES partner_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS clinic_bridge_job (
  id char(32) CHARACTER SET ascii NOT NULL,
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  branch_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  kind varchar(16) CHARACTER SET ascii NOT NULL,
  record_key varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  patient_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payload mediumtext NOT NULL,
  status varchar(12) CHARACTER SET ascii NOT NULL DEFAULT 'queued',
  phase varchar(12) CHARACTER SET ascii NOT NULL DEFAULT '',
  attempts int unsigned NOT NULL DEFAULT 0,
  agent_id char(32) CHARACTER SET ascii DEFAULT NULL,
  claimed_at bigint DEFAULT NULL,
  heartbeat_at bigint DEFAULT NULL,
  finished_at bigint DEFAULT NULL,
  document_no varchar(64) NOT NULL DEFAULT '',
  error varchar(500) NOT NULL DEFAULT '',
  created_by varchar(120) NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (id),
  KEY bridge_job_queue (partner_id, status, created_at),
  KEY bridge_job_record (partner_id, kind, record_key),
  CONSTRAINT bridge_job_partner_fk FOREIGN KEY (partner_id) REFERENCES partner_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS clinic_bridge_map (
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  kind varchar(10) CHARACTER SET ascii NOT NULL,
  local_key varchar(191) NOT NULL,
  code varchar(80) NOT NULL DEFAULT '',
  name varchar(200) NOT NULL DEFAULT '',
  updated_at bigint NOT NULL,
  PRIMARY KEY (partner_id, kind, local_key),
  CONSTRAINT bridge_map_partner_fk FOREIGN KEY (partner_id) REFERENCES partner_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS clinic_bridge_recipe (
  partner_id varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  kind varchar(16) CHARACTER SET ascii NOT NULL,
  recipe mediumtext NOT NULL,
  version int unsigned NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL,
  updated_by varchar(120) NOT NULL DEFAULT '',
  PRIMARY KEY (partner_id, kind),
  CONSTRAINT bridge_recipe_partner_fk FOREIGN KEY (partner_id) REFERENCES partner_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
