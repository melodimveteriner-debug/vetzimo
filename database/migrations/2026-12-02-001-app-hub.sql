-- Yeni uygulama merkezi: cihazlar, bildirim merkezi, push gönderimleri, politikalar, şablonlar, sürümler, hatalar, hesap silme
CREATE TABLE IF NOT EXISTS account_deletion_request (
  account_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  requested_at bigint NOT NULL,
  status enum('pending','done','rejected') NOT NULL DEFAULT 'pending',
  note varchar(300) NOT NULL DEFAULT '',
  processed_at bigint DEFAULT NULL,
  PRIMARY KEY (account_id),
  KEY deletion_status (status,requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO account_deletion_request(account_id,requested_at,status) SELECT account_id,requested_at,'pending' FROM native_deletion_request;

CREATE TABLE IF NOT EXISTS app_device (
  id char(32) NOT NULL,
  account_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  membership_id varchar(80) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  session_device varchar(64) COLLATE utf8mb4_bin NOT NULL,
  platform enum('android','ios','web','windows','macos','linux') NOT NULL,
  provider enum('fcm','apns','webpush','desktop') NOT NULL,
  token_hash char(64) NOT NULL,
  token text COLLATE utf8mb4_bin NOT NULL,
  app_version varchar(32) NOT NULL DEFAULT '',
  os_version varchar(40) NOT NULL DEFAULT '',
  model varchar(60) NOT NULL DEFAULT '',
  locale char(2) NOT NULL DEFAULT 'tr',
  sound varchar(16) NOT NULL DEFAULT 'default',
  muted varchar(400) NOT NULL DEFAULT '[]',
  created_at bigint NOT NULL,
  seen_at bigint NOT NULL,
  revoked_at bigint DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY app_device_token (token_hash),
  KEY app_device_account (account_id,revoked_at),
  KEY app_device_session (session_device),
  KEY app_device_seen (revoked_at,seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_preference (
  account_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  muted varchar(400) NOT NULL DEFAULT '[]',
  sound varchar(16) NOT NULL DEFAULT 'default',
  quiet varchar(80) DEFAULT NULL,
  PRIMARY KEY (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_notification (
  id bigint NOT NULL AUTO_INCREMENT,
  account_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  membership_id varchar(80) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  category varchar(24) NOT NULL,
  title varchar(160) NOT NULL,
  body varchar(400) NOT NULL DEFAULT '',
  href varchar(500) NOT NULL DEFAULT '/app',
  dedupe binary(32) NOT NULL,
  created_at bigint NOT NULL,
  read_at bigint DEFAULT NULL,
  cleared_at bigint DEFAULT NULL,
  pushed tinyint NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY app_notification_once (account_id,dedupe),
  KEY app_notification_list (account_id,cleared_at,id),
  KEY app_notification_unread (account_id,read_at,cleared_at),
  KEY app_notification_push (pushed,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_push (
  notification_id bigint NOT NULL,
  device_id char(32) NOT NULL,
  status enum('queued','retry','sent','failed','invalid','skipped','muted','quiet') NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_at bigint NOT NULL,
  error varchar(200) DEFAULT NULL,
  created_at bigint NOT NULL,
  sent_at bigint DEFAULT NULL,
  PRIMARY KEY (notification_id,device_id),
  KEY app_push_due (status,next_at),
  KEY app_push_age (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_policy (
  category varchar(24) NOT NULL,
  role varchar(16) NOT NULL,
  enabled tinyint NOT NULL,
  PRIMARY KEY (category,role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_template (
  category varchar(24) NOT NULL,
  title varchar(80) NOT NULL,
  body varchar(160) NOT NULL DEFAULT '',
  PRIMARY KEY (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_release (
  id int NOT NULL AUTO_INCREMENT,
  platform enum('android','ios','web','windows','macos','linux') NOT NULL,
  version varchar(32) NOT NULL,
  build int NOT NULL,
  min_build int NOT NULL DEFAULT 0,
  url varchar(300) NOT NULL DEFAULT '',
  notes varchar(1000) NOT NULL DEFAULT '',
  published_at bigint DEFAULT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY app_release_build (platform,build)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_error (
  hash binary(32) NOT NULL,
  platform varchar(16) NOT NULL,
  version varchar(32) NOT NULL DEFAULT '',
  message varchar(500) NOT NULL,
  stack text,
  page varchar(300) NOT NULL DEFAULT '',
  reporter char(64) NOT NULL,
  role varchar(16) NOT NULL DEFAULT '',
  first_at bigint NOT NULL,
  last_at bigint NOT NULL,
  count int NOT NULL DEFAULT 1,
  PRIMARY KEY (hash),
  KEY app_error_last (last_at),
  KEY app_error_reporter (reporter,last_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ev ziyareti olayları artık genel adla tutulur
UPDATE clinic_delivery_notice SET kind='visit_clinic' WHERE kind='native_visit_clinic';
UPDATE clinic_delivery_notice SET kind='visit_owner' WHERE kind='native_visit_owner';

-- İlk yedekten gelen eski uygulama arayüzünün tabloları
DROP TABLE IF EXISTS native_push_delivery;
DROP TABLE IF EXISTS native_notice_read;
DROP TABLE IF EXISTS native_read;
DROP TABLE IF EXISTS native_push_policy;
DROP TABLE IF EXISTS native_visit_owner;
DROP TABLE IF EXISTS native_visit_clinic;
DROP TABLE IF EXISTS native_device;
DROP TABLE IF EXISTS native_deletion_request;
