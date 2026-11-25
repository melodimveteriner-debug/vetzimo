-- Cihaz entegrasyonu: laboratuvar ve görüntüleme cihazları, gelen sonuçlar, dosyalar
CREATE TABLE IF NOT EXISTS clinic_device (
  id char(32) NOT NULL,
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  branch_id varchar(80) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  name varchar(80) NOT NULL,
  kind varchar(20) NOT NULL,
  vendor varchar(60) NOT NULL DEFAULT '',
  model varchar(60) NOT NULL DEFAULT '',
  connection varchar(12) NOT NULL,
  settings varchar(2000) NOT NULL DEFAULT '{}',
  active tinyint NOT NULL DEFAULT 1,
  created_at bigint NOT NULL,
  last_seen bigint DEFAULT NULL,
  last_error varchar(300) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY clinic_device_partner (partner_id,active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clinic_device_result (
  id char(32) NOT NULL,
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  branch_id varchar(80) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  device_id char(32) NOT NULL,
  kind varchar(20) NOT NULL,
  received_at bigint NOT NULL,
  sample varchar(80) NOT NULL DEFAULT '',
  hint varchar(1000) NOT NULL DEFAULT '{}',
  data mediumtext NOT NULL,
  file_id char(32) DEFAULT NULL,
  status enum('pending','matched','imported','ignored') NOT NULL DEFAULT 'pending',
  patient_id varchar(80) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  client_id varchar(80) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  match_by varchar(20) NOT NULL DEFAULT '',
  candidates varchar(3000) NOT NULL DEFAULT '[]',
  lab_id varchar(80) NOT NULL DEFAULT '',
  hash char(64) NOT NULL,
  matched_at bigint DEFAULT NULL,
  imported_at bigint DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY device_result_once (partner_id,hash),
  KEY device_result_state (partner_id,status,received_at),
  KEY device_result_patient (partner_id,patient_id,received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clinic_device_file (
  id char(32) NOT NULL,
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  name varchar(180) NOT NULL,
  type varchar(80) NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  chunks int NOT NULL,
  received int NOT NULL DEFAULT 0,
  sha256 char(64) NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  PRIMARY KEY (id),
  KEY device_file_partner (partner_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clinic_device_file_chunk (
  file_id char(32) NOT NULL,
  idx int NOT NULL,
  data mediumblob NOT NULL,
  PRIMARY KEY (file_id,idx)
) ENGINE=InnoDB;

-- Hasta ve hasta sahibi araması için ad, mikroçip ve protokol indeksleri (milyonlarca kayıtta tam tarama olmaz)
ALTER TABLE clinic_record
  ADD COLUMN IF NOT EXISTS name_key varchar(120) AS (CASE WHEN collection IN ('patients','clients') THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.name')),120) END) VIRTUAL,
  ADD COLUMN IF NOT EXISTS chip_key varchar(40) AS (CASE WHEN collection='patients' THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.chip')),40) END) VIRTUAL,
  ADD COLUMN IF NOT EXISTS protocol_key varchar(40) AS (CASE WHEN collection IN ('patients','clients') THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.protocol')),40) END) VIRTUAL;
ALTER TABLE clinic_record ADD INDEX IF NOT EXISTS clinic_record_name (set_id,collection,name_key);
ALTER TABLE clinic_record ADD INDEX IF NOT EXISTS clinic_record_chip (set_id,chip_key);
ALTER TABLE clinic_record ADD INDEX IF NOT EXISTS clinic_record_protocol (set_id,collection,protocol_key);
