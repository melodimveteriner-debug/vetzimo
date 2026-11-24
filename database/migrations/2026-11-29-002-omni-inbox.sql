CREATE TABLE IF NOT EXISTS inbox_channel (
  id char(32) NOT NULL PRIMARY KEY,
  partner_id varchar(80) NOT NULL,
  kind varchar(16) NOT NULL,
  label varchar(80) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'active',
  hook_key char(40) NOT NULL,
  external_id varchar(190) NOT NULL DEFAULT '',
  config text NOT NULL,
  last_error varchar(300) NOT NULL DEFAULT '',
  last_event_at bigint DEFAULT NULL,
  poll_state varchar(190) NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  UNIQUE KEY hook_key (hook_key),
  KEY partner_kind (partner_id,kind),
  KEY kind_external (kind,external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS inbox_conversation (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_id varchar(80) NOT NULL,
  channel_id char(32) NOT NULL,
  contact_key varchar(190) NOT NULL,
  contact_name varchar(120) NOT NULL DEFAULT '',
  contact_handle varchar(190) NOT NULL DEFAULT '',
  client_id varchar(80) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'open',
  snooze_until bigint DEFAULT NULL,
  assignee_id varchar(64) NOT NULL DEFAULT '',
  assignee_name varchar(120) NOT NULL DEFAULT '',
  assigned_at bigint DEFAULT NULL,
  last_message_at bigint NOT NULL,
  last_inbound_at bigint DEFAULT NULL,
  last_preview varchar(200) NOT NULL DEFAULT '',
  last_direction varchar(6) NOT NULL DEFAULT 'in',
  unread int unsigned NOT NULL DEFAULT 0,
  tags varchar(400) NOT NULL DEFAULT '',
  subject varchar(200) NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  UNIQUE KEY channel_contact (channel_id,contact_key),
  KEY partner_status (partner_id,status,last_message_at),
  KEY partner_assignee (partner_id,assignee_id,status),
  KEY partner_client (partner_id,client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS inbox_message (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id bigint unsigned NOT NULL,
  partner_id varchar(80) NOT NULL,
  channel_id char(32) NOT NULL,
  direction varchar(6) NOT NULL,
  body text NOT NULL,
  media varchar(400) NOT NULL DEFAULT '',
  external_id varchar(190) DEFAULT NULL,
  author_id varchar(64) NOT NULL DEFAULT '',
  author_name varchar(120) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT '',
  error varchar(300) NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  UNIQUE KEY channel_external (channel_id,external_id),
  KEY conversation_time (conversation_id,id),
  KEY partner_time (partner_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS inbox_quick_reply (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_id varchar(80) NOT NULL,
  shortcut varchar(40) NOT NULL,
  body varchar(1000) NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE KEY partner_shortcut (partner_id,shortcut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
CREATE TABLE IF NOT EXISTS inbox_setting (
  partner_id varchar(80) NOT NULL PRIMARY KEY,
  data text NOT NULL,
  updated_at bigint NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
