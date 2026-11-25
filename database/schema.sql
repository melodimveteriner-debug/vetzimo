-- VetZimo temel veritabanı yapısı (veri içermez). Sonraki değişiklikler database/migrations/ altındadır.
SET FOREIGN_KEY_CHECKS=0;
CREATE TABLE `center_audit` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `account_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `action` varchar(60) NOT NULL,
  `target_id` varchar(80) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `center_audit_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `center_management` (
  `id` char(32) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `center_management_kind` (`kind`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_appointment_reminder` (
  `dispatch_key` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` enum('sending','accepted','rejected','unknown') NOT NULL,
  `provider_reference` varchar(191) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`dispatch_key`),
  KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_audit` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) NOT NULL,
  `account_id` varchar(80) NOT NULL,
  `action` varchar(60) NOT NULL,
  `revision` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `clinic_audit_partner` (`partner_id`,`created_at`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `clinic_audit_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`),
  CONSTRAINT `clinic_audit_ibfk_2` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_bulk_message` (
  `id` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data_branch` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `membership_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `channel` enum('sms','whatsapp') NOT NULL,
  `client_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `masked_phone` varchar(32) NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `units` int(10) unsigned NOT NULL,
  `status` enum('queued','sending','accepted','rejected','unknown') NOT NULL DEFAULT 'queued',
  `provider_ref` varchar(191) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `bulk_history` (`partner_id`,`branch_id`,`channel`,`created_at`,`id`),
  KEY `bulk_balance` (`partner_id`,`channel`,`status`),
  KEY `bulk_pending` (`status`,`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_contact` (
  `membership_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `email` varchar(254) NOT NULL DEFAULT '',
  `pending_email` varchar(254) NOT NULL DEFAULT '',
  `token_hash` char(64) DEFAULT NULL,
  `expires` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`membership_id`),
  CONSTRAINT `clinic_contact_ibfk_1` FOREIGN KEY (`membership_id`) REFERENCES `identity_membership` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_delivery_notice` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) NOT NULL,
  `branch_id` varchar(80) NOT NULL,
  `customer_id` varchar(80) NOT NULL DEFAULT '',
  `membership_id` varchar(80) NOT NULL DEFAULT '',
  `recipient_email` varchar(254) NOT NULL DEFAULT '',
  `kind` varchar(24) NOT NULL,
  `dedupe` char(64) NOT NULL,
  `title` varchar(180) NOT NULL,
  `target` varchar(300) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `read_at` bigint(20) DEFAULT NULL,
  `next_at` bigint(20) NOT NULL,
  `sent_at` bigint(20) DEFAULT NULL,
  `attempts` smallint(5) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `delivery_once` (`partner_id`,`dedupe`),
  KEY `delivery_owner` (`partner_id`,`branch_id`,`customer_id`,`id`),
  KEY `delivery_pending` (`sent_at`,`next_at`),
  CONSTRAINT `clinic_delivery_notice_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_directory` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `revision` bigint(20) unsigned NOT NULL,
  `active` tinyint(3) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clinic_directory_workspace` (`workspace_id`),
  CONSTRAINT `clinic_directory_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `clinic_workspace` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_directory_owner` (
  `directory_id` bigint(20) unsigned NOT NULL,
  `record_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` int(10) unsigned NOT NULL,
  `record_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`record_data`)),
  PRIMARY KEY (`directory_id`,`record_id`),
  UNIQUE KEY `clinic_directory_owner_branch` (`directory_id`,`branch_id`,`record_id`),
  CONSTRAINT `clinic_directory_owner_fk` FOREIGN KEY (`directory_id`) REFERENCES `clinic_directory` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_directory_patient` (
  `directory_id` bigint(20) unsigned NOT NULL,
  `record_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `position` int(10) unsigned NOT NULL,
  `record_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`record_data`)),
  PRIMARY KEY (`directory_id`,`record_id`),
  KEY `clinic_directory_patient_owner` (`directory_id`,`branch_id`,`owner_id`,`position`,`record_id`),
  CONSTRAINT `clinic_directory_patient_fk` FOREIGN KEY (`directory_id`) REFERENCES `clinic_directory` (`id`),
  CONSTRAINT `clinic_directory_patient_owner_fk` FOREIGN KEY (`directory_id`, `branch_id`, `owner_id`) REFERENCES `clinic_directory_owner` (`directory_id`, `branch_id`, `record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_esmm_portal` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `provider` varchar(12) NOT NULL,
  `label` varchar(100) NOT NULL,
  PRIMARY KEY (`partner_id`,`branch_id`),
  CONSTRAINT `clinic_esmm_portal_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_exam_photos` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `exam_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `photos` mediumtext NOT NULL,
  PRIMARY KEY (`partner_id`,`exam_id`),
  CONSTRAINT `clinic_exam_photos_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `clinic_homecare_checkin` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `customer_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `submitted_by` varchar(80) NOT NULL,
  `created_at` datetime NOT NULL,
  `observation` varchar(20) NOT NULL,
  `note` text NOT NULL,
  `decision` varchar(20) DEFAULT NULL,
  `response` text DEFAULT NULL,
  `reviewed_by` varchar(80) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`partner_id`,`id`),
  KEY `patient_history` (`partner_id`,`patient_id`,`customer_id`,`branch_id`,`created_at`),
  KEY `clinic_queue` (`partner_id`,`branch_id`,`decision`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_homecare_checkin_detail` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `checkin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `submitted_name` varchar(160) DEFAULT NULL,
  `reviewed_name` varchar(160) DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  PRIMARY KEY (`partner_id`,`checkin_id`),
  CONSTRAINT `clinic_homecare_checkin_detail_ibfk_1` FOREIGN KEY (`partner_id`, `checkin_id`) REFERENCES `clinic_homecare_checkin` (`partner_id`, `id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_homecare_plan` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `patient_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `customer_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `instructions` text NOT NULL,
  `active` tinyint(1) NOT NULL,
  `updated_by` varchar(80) NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`partner_id`,`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_lab_attachment` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `lab_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `photo` mediumtext NOT NULL,
  PRIMARY KEY (`partner_id`,`lab_id`),
  CONSTRAINT `clinic_lab_attachment_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `clinic_lead` (
  `id` char(36) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `name` varchar(120) NOT NULL,
  `clinic` varchar(160) NOT NULL,
  `email` varchar(254) NOT NULL,
  `phone` varchar(24) NOT NULL,
  `message` text NOT NULL,
  `current_program` varchar(160) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `billing` varchar(12) NOT NULL,
  `notice_version` varchar(20) NOT NULL,
  `stage` varchar(16) NOT NULL DEFAULT 'new',
  `fingerprint` char(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_lead_review` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `lead_id` char(36) NOT NULL,
  `actor` varchar(254) NOT NULL,
  `stage` varchar(16) NOT NULL,
  `note` text NOT NULL,
  `trial_partner` varchar(80) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `lead_history` (`lead_id`,`id`),
  CONSTRAINT `clinic_lead_review_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `clinic_lead` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_package_settings` (
  `plan_id` varchar(32) NOT NULL,
  `settings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`settings`)),
  PRIMARY KEY (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_portal_share` (
  `membership_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `category` varchar(20) NOT NULL,
  `record_id` varchar(80) NOT NULL,
  `summary` text NOT NULL,
  `photo` mediumtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`membership_id`,`category`,`record_id`),
  CONSTRAINT `clinic_portal_share_ibfk_1` FOREIGN KEY (`membership_id`) REFERENCES `identity_membership` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_print_template` (
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `title` varchar(120) NOT NULL,
  `category` varchar(16) NOT NULL,
  `body` text NOT NULL,
  `active` tinyint(1) NOT NULL,
  PRIMARY KEY (`partner_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `clinic_record` (
  `set_id` bigint(20) unsigned NOT NULL,
  `collection` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `row_key` varbinary(81) NOT NULL,
  `ordinal` bigint(20) NOT NULL,
  `record_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `branch_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `owner_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `record_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`record_data`)),
  `content_hash` binary(32) NOT NULL,
  PRIMARY KEY (`set_id`,`collection`,`row_key`),
  KEY `clinic_record_order` (`set_id`,`collection`,`ordinal`),
  KEY `clinic_record_lookup` (`set_id`,`collection`,`record_id`),
  KEY `clinic_record_owner` (`set_id`,`collection`,`branch_id`,`owner_id`,`ordinal`),
  CONSTRAINT `clinic_record_set_fk` FOREIGN KEY (`set_id`) REFERENCES `clinic_record_set` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_record_set` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `client_count` bigint(20) unsigned NOT NULL DEFAULT 0,
  `patient_count` bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clinic_record_set_workspace` (`workspace_id`),
  CONSTRAINT `clinic_record_set_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `clinic_workspace` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_staff_plan` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) NOT NULL,
  `account_id` varchar(80) NOT NULL,
  `member_id` varchar(80) NOT NULL,
  `branch_id` varchar(80) NOT NULL,
  `kind` enum('shift','leave') NOT NULL,
  `status` enum('pending','approved','declined','cancelled') NOT NULL,
  `starts` datetime NOT NULL,
  `ends` datetime NOT NULL,
  `created_by` varchar(80) NOT NULL,
  `changed_by` varchar(80) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `scope_date` (`partner_id`,`starts`,`ends`),
  KEY `member_time` (`partner_id`,`account_id`,`status`,`ends`,`starts`),
  KEY `member_id` (`member_id`),
  CONSTRAINT `clinic_staff_plan_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `identity_membership` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_subscription` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `plan_name` varchar(120) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `starts_on` date NOT NULL,
  `ends_on` date NOT NULL,
  PRIMARY KEY (`id`),
  KEY `clinic_subscription_scope` (`partner_id`,`starts_on`,`ends_on`),
  CONSTRAINT `clinic_subscription_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_support` (
  `id` char(32) NOT NULL,
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch_name` varchar(160) NOT NULL,
  `subject` varchar(160) NOT NULL,
  `department` varchar(40) NOT NULL,
  `urgency` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'Açık',
  `updated_at` varchar(30) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `clinic_support_scope` (`partner_id`,`branch`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_support_attachment` (
  `id` char(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reply_id` bigint(20) unsigned NOT NULL,
  `name` varchar(180) NOT NULL,
  `bytes` mediumblob NOT NULL,
  `size_bytes` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `support_attachment_reply` (`reply_id`,`id`),
  CONSTRAINT `clinic_support_attachment_ibfk_1` FOREIGN KEY (`reply_id`) REFERENCES `clinic_support_reply` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_support_reply` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ticket_id` char(32) NOT NULL,
  `author` varchar(160) NOT NULL,
  `side` varchar(16) NOT NULL,
  `body` text NOT NULL,
  `created_at` varchar(30) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `clinic_support_reply_ibfk_1` FOREIGN KEY (`ticket_id`) REFERENCES `clinic_support` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `clinic_visit_event` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `visit_id` char(32) NOT NULL,
  `partner_id` varchar(80) NOT NULL,
  `revision` int(10) unsigned NOT NULL,
  `status` varchar(24) NOT NULL,
  `author` varchar(80) NOT NULL,
  `action` varchar(32) NOT NULL,
  `detail` mediumtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `visit_revision` (`visit_id`,`revision`),
  KEY `event_partner` (`partner_id`,`id`),
  CONSTRAINT `clinic_visit_event_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `clinic_visit_request` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_mail` (
  `event_id` bigint(20) unsigned NOT NULL,
  `audience` enum('clinic','owner') NOT NULL,
  `secret` mediumtext DEFAULT NULL,
  `attempts` smallint(5) unsigned NOT NULL DEFAULT 0,
  `sent_at` bigint(20) DEFAULT NULL,
  `retry_at` bigint(20) NOT NULL,
  `failure` varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (`event_id`,`audience`),
  KEY `visit_mail_pending` (`sent_at`,`retry_at`),
  CONSTRAINT `clinic_visit_mail_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `clinic_visit_event` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_package` (
  `plan_id` varchar(80) NOT NULL,
  `enabled` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_payment` (
  `visit_id` char(32) NOT NULL,
  `quote_version` int(10) unsigned NOT NULL,
  `method` varchar(24) NOT NULL,
  `status` varchar(24) NOT NULL,
  `total` bigint(20) unsigned NOT NULL,
  `destination` text DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  `verified_by` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`visit_id`),
  KEY `visit_id` (`visit_id`,`quote_version`),
  CONSTRAINT `clinic_visit_payment_ibfk_1` FOREIGN KEY (`visit_id`, `quote_version`) REFERENCES `clinic_visit_quote` (`visit_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_quote` (
  `visit_id` char(32) NOT NULL,
  `version` int(10) unsigned NOT NULL,
  `details` longtext NOT NULL CHECK (json_valid(`details`)),
  `total` bigint(20) unsigned NOT NULL,
  `valid_until` datetime NOT NULL,
  `created_by` varchar(80) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`visit_id`,`version`),
  CONSTRAINT `clinic_visit_quote_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `clinic_visit_request` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_read` (
  `membership_id` varchar(80) NOT NULL,
  `event_id` bigint(20) unsigned NOT NULL,
  PRIMARY KEY (`membership_id`,`event_id`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `clinic_visit_read_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `clinic_visit_event` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_request` (
  `id` char(32) NOT NULL,
  `partner_id` varchar(80) NOT NULL,
  `branch_id` varchar(80) NOT NULL,
  `customer_id` varchar(80) NOT NULL,
  `patient_id` varchar(80) NOT NULL,
  `status` varchar(24) NOT NULL,
  `revision` int(10) unsigned NOT NULL DEFAULT 1,
  `snapshot` mediumtext NOT NULL,
  `request_hash` char(64) NOT NULL,
  `token_hash` char(64) DEFAULT NULL,
  `token_expires` bigint(20) DEFAULT NULL,
  `guest_hash` char(64) DEFAULT NULL,
  `guest_expires` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `visit_dedup` (`partner_id`,`request_hash`),
  UNIQUE KEY `token_hash` (`token_hash`),
  UNIQUE KEY `guest_hash` (`guest_hash`),
  KEY `visit_scope` (`partner_id`,`branch_id`,`status`,`created_at`),
  KEY `visit_customer` (`partner_id`,`customer_id`,`created_at`),
  KEY `visit_partner_recent` (`partner_id`,`created_at`,`id`),
  KEY `visit_branch_recent` (`partner_id`,`branch_id`,`created_at`,`id`),
  CONSTRAINT `clinic_visit_request_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_settings` (
  `partner_id` varchar(80) NOT NULL,
  `settings` longtext NOT NULL CHECK (json_valid(`settings`)),
  PRIMARY KEY (`partner_id`),
  CONSTRAINT `clinic_visit_settings_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_visit_slot` (
  `visit_id` char(32) NOT NULL,
  `partner_id` varchar(80) NOT NULL,
  `clinician` varchar(80) NOT NULL,
  `assistant` varchar(80) NOT NULL,
  `vehicle` varchar(80) NOT NULL,
  `starts` datetime NOT NULL,
  `ends` datetime NOT NULL,
  `released` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`visit_id`),
  KEY `visit_schedule` (`partner_id`,`starts`,`ends`,`released`),
  CONSTRAINT `clinic_visit_slot_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `clinic_visit_request` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_appointment` (
  `partner_id` varchar(80) NOT NULL,
  `id` varchar(80) NOT NULL,
  `visit_branch` varchar(80) NOT NULL,
  `visitor` longtext NOT NULL CHECK (json_valid(`visitor`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`partner_id`,`id`),
  CONSTRAINT `clinic_web_appointment_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `clinic_web_site` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_appointment_event` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) NOT NULL,
  `appointment_id` varchar(80) NOT NULL,
  `account_id` varchar(80) NOT NULL,
  `actor_name` varchar(160) NOT NULL,
  `actor_role` varchar(24) NOT NULL,
  `event` longtext NOT NULL CHECK (json_valid(`event`)),
  `occurred_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `web_event_lookup` (`partner_id`,`appointment_id`,`id`),
  CONSTRAINT `clinic_web_appointment_event_ibfk_1` FOREIGN KEY (`partner_id`, `appointment_id`) REFERENCES `clinic_web_appointment` (`partner_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_daily` (
  `partner_id` varchar(80) NOT NULL,
  `day` date NOT NULL,
  `metric` varchar(90) NOT NULL,
  `n` bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`partner_id`,`day`,`metric`),
  CONSTRAINT `clinic_web_daily_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `clinic_web_site` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_inbox` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) NOT NULL,
  `message` longtext NOT NULL CHECK (json_valid(`message`)),
  `notify_at` bigint(20) DEFAULT NULL,
  `notify_attempts` int(10) unsigned NOT NULL DEFAULT 0,
  `notified_at` bigint(20) DEFAULT NULL,
  `notify_error` varchar(120) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `web_inbox_partner` (`partner_id`,`id`),
  KEY `web_inbox_notify` (`notified_at`,`notify_at`),
  CONSTRAINT `clinic_web_inbox_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `clinic_web_site` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_mail` (
  `partner_id` varchar(80) NOT NULL,
  `appointment_id` varchar(80) NOT NULL,
  `attempts` int(10) unsigned NOT NULL DEFAULT 0,
  `next_at` bigint(20) NOT NULL,
  `sent_at` bigint(20) DEFAULT NULL,
  `last_error` varchar(120) NOT NULL DEFAULT '',
  PRIMARY KEY (`partner_id`,`appointment_id`),
  KEY `pending_mail` (`sent_at`,`next_at`),
  CONSTRAINT `clinic_web_mail_ibfk_1` FOREIGN KEY (`partner_id`, `appointment_id`) REFERENCES `clinic_web_appointment` (`partner_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_media` (
  `partner_id` varchar(80) NOT NULL,
  `id` char(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `bytes` mediumblob NOT NULL,
  `byte_size` int(10) unsigned GENERATED ALWAYS AS (octet_length(`bytes`)) VIRTUAL,
  PRIMARY KEY (`partner_id`,`id`),
  KEY `web_media_usage` (`partner_id`,`byte_size`),
  CONSTRAINT `clinic_web_media_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `clinic_web_site` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_package` (
  `plan_id` varchar(80) NOT NULL,
  `enabled` tinyint(4) NOT NULL,
  PRIMARY KEY (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_release` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) NOT NULL,
  `snapshot` longtext NOT NULL CHECK (json_valid(`snapshot`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `releases_by_partner` (`partner_id`,`id`),
  CONSTRAINT `clinic_web_release_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `clinic_web_site` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_site` (
  `partner_id` varchar(80) NOT NULL,
  `slug` varchar(63) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `custom_host` varchar(253) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `domain_token` char(48) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `domain_verified` tinyint(4) NOT NULL DEFAULT 0,
  `draft` longtext NOT NULL CHECK (json_valid(`draft`)),
  `published` bigint(20) unsigned DEFAULT NULL,
  `revision` bigint(20) unsigned NOT NULL DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`partner_id`),
  UNIQUE KEY `slug` (`slug`),
  UNIQUE KEY `custom_host` (`custom_host`),
  CONSTRAINT `clinic_web_site_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_site_control` (
  `partner_id` varchar(80) NOT NULL,
  `status` enum('paused','deleted') NOT NULL,
  PRIMARY KEY (`partner_id`),
  CONSTRAINT `clinic_web_site_control_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `clinic_web_site` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_web_storage` (
  `plan_id` varchar(80) NOT NULL,
  `max_mb` smallint(5) unsigned NOT NULL,
  PRIMARY KEY (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `clinic_workspace` (
  `user_id` varchar(191) NOT NULL,
  `revision` bigint(20) unsigned NOT NULL CHECK (`revision` > 0),
  `payload` longtext NOT NULL CHECK (json_valid(`payload`)),
  `updated_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `request_branches` longtext GENERATED ALWAYS AS (json_extract(`payload`,'$.branches')) STORED CHECK (json_valid(`request_branches`)),
  `branch_count` int(10) unsigned GENERATED ALWAYS AS (coalesce(json_length(`payload`,'$.branches'),0)) STORED,
  `client_count` int(10) unsigned GENERATED ALWAYS AS (coalesce(json_length(`payload`,'$.clients'),0)) STORED,
  `patient_count` int(10) unsigned GENERATED ALWAYS AS (coalesce(json_length(`payload`,'$.patients'),0)) STORED,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `CONSTRAINT_1` CHECK (json_type(`payload`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `finance_entry` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `branch_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `source_type` varchar(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `entry_date` date NOT NULL,
  `amount_cents` bigint(20) NOT NULL,
  `account_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `finance_source` (`partner_id`,`source_type`,`source_id`),
  KEY `finance_period` (`partner_id`,`branch_id`,`entry_date`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `finance_entry_ibfk_1` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`),
  CONSTRAINT `finance_entry_ibfk_2` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `identity_account` (
  `id` varchar(80) NOT NULL,
  `kind` enum('center','phone') NOT NULL,
  `identifier` varchar(254) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `verified_at` bigint(20) DEFAULT NULL,
  `phone_verified_at` bigint(20) DEFAULT NULL,
  `blocked` tinyint(4) NOT NULL DEFAULT 0 CHECK (`blocked` in (0,1)),
  `version` bigint(20) unsigned NOT NULL DEFAULT 0,
  `totp_seed` text DEFAULT NULL,
  `totp_step` bigint(20) NOT NULL DEFAULT -1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `identity_identifier` (`kind`,`identifier`),
  CONSTRAINT `CONSTRAINT_1` CHECK (`kind` = 'center' or `totp_seed` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `identity_activation` (
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `membership_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` bigint(20) NOT NULL,
  `used` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`token_hash`),
  KEY `membership_id` (`membership_id`),
  KEY `activation_expiry` (`expires`),
  CONSTRAINT `identity_activation_ibfk_1` FOREIGN KEY (`membership_id`) REFERENCES `identity_membership` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `identity_center` (
  `account_id` varchar(80) NOT NULL,
  `workspace_id` varchar(191) NOT NULL,
  `is_owner` tinyint(4) NOT NULL CHECK (`is_owner` in (0,1)),
  `owner_slot` tinyint(4) GENERATED ALWAYS AS (case when `is_owner` = 1 then 1 else NULL end) STORED,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `identity_single_owner` (`owner_slot`),
  CONSTRAINT `identity_center_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `identity_login_window` (
  `address_hash` binary(32) NOT NULL,
  `window_start` bigint(20) NOT NULL,
  `attempts` int(10) unsigned NOT NULL,
  PRIMARY KEY (`address_hash`),
  KEY `identity_login_window_cleanup` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
CREATE TABLE `identity_membership` (
  `id` varchar(80) NOT NULL,
  `account_id` varchar(80) NOT NULL,
  `partner_id` varchar(80) NOT NULL,
  `role` enum('dealer','branch','staff','customer') NOT NULL,
  `branch_id` varchar(80) NOT NULL DEFAULT '',
  `customer_id` varchar(80) NOT NULL DEFAULT '',
  `name` varchar(160) NOT NULL DEFAULT '',
  `modules` longtext NOT NULL CHECK (json_valid(`modules`)),
  `status` enum('pending','active','revoked') NOT NULL DEFAULT 'pending',
  `live_customer_id` varchar(80) GENERATED ALWAYS AS (case when `role` = 'customer' and `status` <> 'revoked' then `customer_id` else NULL end) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `identity_membership_scope` (`account_id`,`partner_id`,`role`,`branch_id`,`customer_id`),
  UNIQUE KEY `identity_customer_link` (`partner_id`,`branch_id`,`live_customer_id`),
  KEY `identity_membership_partner` (`partner_id`,`branch_id`,`status`),
  KEY `identity_partner_active_accounts` (`partner_id`,`status`,`account_id`),
  CONSTRAINT `identity_membership_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`),
  CONSTRAINT `identity_membership_ibfk_2` FOREIGN KEY (`partner_id`) REFERENCES `partner_account` (`id`),
  CONSTRAINT `CONSTRAINT_1` CHECK (json_type(`modules`) = 'OBJECT'),
  CONSTRAINT `CONSTRAINT_2` CHECK (`role` = 'dealer' and `branch_id` = '' and `customer_id` = '' or `role` in ('branch','staff') and `branch_id` <> '' and `customer_id` = '' or `role` = 'customer' and `branch_id` <> '' and `customer_id` <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `identity_session` (
  `token_hash` char(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_hash` char(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_id` varchar(80) NOT NULL,
  `account_version` bigint(20) unsigned NOT NULL,
  `membership_id` varchar(80) DEFAULT NULL,
  `created` bigint(20) NOT NULL,
  `touched` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  `reauth_at` bigint(20) NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `identity_session_account` (`account_id`,`expires`),
  KEY `membership_id` (`membership_id`),
  KEY `identity_session_expiry` (`expires`),
  CONSTRAINT `identity_session_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`),
  CONSTRAINT `identity_session_ibfk_2` FOREIGN KEY (`membership_id`) REFERENCES `identity_membership` (`id`),
  CONSTRAINT `CONSTRAINT_1` CHECK (`expires` > `created`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `native_deletion_request` (
  `account_id` varchar(80) NOT NULL,
  `requested_at` bigint(20) NOT NULL,
  PRIMARY KEY (`account_id`),
  CONSTRAINT `native_deletion_request_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `native_device` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `account_id` varchar(80) NOT NULL,
  `membership_id` varchar(80) NOT NULL,
  `device_hash` char(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_cipher` text NOT NULL,
  `platform` enum('android','ios','macos','windows') NOT NULL,
  `build` varchar(32) NOT NULL,
  `account_version` bigint(20) unsigned NOT NULL,
  `registered_at` bigint(20) NOT NULL,
  `seen_at` bigint(20) NOT NULL,
  `mute` longtext NOT NULL CHECK (json_valid(`mute`)),
  `tone` enum('default','silent') NOT NULL DEFAULT 'default',
  PRIMARY KEY (`id`),
  UNIQUE KEY `native_token` (`token_hash`),
  UNIQUE KEY `native_installation` (`device_hash`),
  KEY `native_scope` (`membership_id`,`seen_at`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `native_device_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `identity_account` (`id`) ON DELETE CASCADE,
  CONSTRAINT `native_device_ibfk_2` FOREIGN KEY (`membership_id`) REFERENCES `identity_membership` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `native_notice_read` (
  `membership_id` varchar(80) NOT NULL,
  `notice_id` bigint(20) unsigned NOT NULL,
  `read_at` bigint(20) NOT NULL,
  PRIMARY KEY (`membership_id`,`notice_id`),
  KEY `notice_id` (`notice_id`),
  CONSTRAINT `native_notice_read_ibfk_1` FOREIGN KEY (`membership_id`) REFERENCES `identity_membership` (`id`) ON DELETE CASCADE,
  CONSTRAINT `native_notice_read_ibfk_2` FOREIGN KEY (`notice_id`) REFERENCES `clinic_delivery_notice` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `native_push_delivery` (
  `notice_id` bigint(20) unsigned NOT NULL,
  `device_id` bigint(20) unsigned NOT NULL,
  `outcome` enum('retry','sent','rejected') NOT NULL,
  `attempts` tinyint(3) unsigned NOT NULL,
  `next_at` bigint(20) NOT NULL,
  PRIMARY KEY (`notice_id`,`device_id`),
  KEY `native_push_state` (`outcome`,`next_at`),
  KEY `device_id` (`device_id`),
  CONSTRAINT `native_push_delivery_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `native_device` (`id`) ON DELETE CASCADE,
  CONSTRAINT `native_push_delivery_ibfk_2` FOREIGN KEY (`notice_id`) REFERENCES `clinic_delivery_notice` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `native_push_policy` (
  `category` varchar(24) NOT NULL,
  `role` enum('dealer','branch','staff','customer') NOT NULL,
  `enabled` tinyint(4) NOT NULL,
  PRIMARY KEY (`category`,`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `partner_account` (
  `id` varchar(80) NOT NULL,
  `code` varchar(32) NOT NULL,
  `name` varchar(160) NOT NULL,
  `email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact` varchar(160) NOT NULL DEFAULT '',
  `phone` varchar(32) NOT NULL DEFAULT '',
  `city` varchar(100) NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `active` tinyint(4) NOT NULL CHECK (`active` in (0,1)),
  `created_at` varchar(32) NOT NULL,
  `updated_at` varchar(32) NOT NULL,
  `last_seen` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  UNIQUE KEY `email` (`email`),
  KEY `partner_directory_name` (`name`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE `vebot_local_job` (
  `turn_id` bigint(20) unsigned NOT NULL,
  `payload` mediumtext DEFAULT NULL,
  `sources` mediumtext NOT NULL,
  `lease` char(48) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `failed` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`turn_id`),
  UNIQUE KEY `local_lease` (`lease`),
  KEY `local_expiry` (`expires_at`),
  CONSTRAINT `local_turn` FOREIGN KEY (`turn_id`) REFERENCES `vebot_turn` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `vebot_policy` (
  `plan_id` varchar(32) NOT NULL,
  `rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`rules`)),
  PRIMARY KEY (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `vebot_turn` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `partner_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `membership_id` char(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `thread` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `day` date NOT NULL,
  `mode` varchar(16) NOT NULL,
  `prompt` text NOT NULL,
  `answer` mediumtext NOT NULL,
  `tokens` int(10) unsigned NOT NULL DEFAULT 0,
  `duration_ms` int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `history` (`partner_id`,`membership_id`,`thread`,`id`),
  KEY `usage_day` (`partner_id`,`membership_id`,`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `vetnet_appearance` (
  `scope_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `palette` varchar(16) NOT NULL,
  `locked` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`scope_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
SET FOREIGN_KEY_CHECKS=1;
