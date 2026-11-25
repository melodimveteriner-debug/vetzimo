-- Evde hizmet canlı rota (yalnız aktif ziyaret süresince konum) ve bayinin Google yorum bağlantısı
CREATE TABLE IF NOT EXISTS clinic_visit_track (
  visit_id char(32) NOT NULL,
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  staff_account varchar(80) COLLATE utf8mb4_bin NOT NULL,
  staff_name varchar(80) NOT NULL DEFAULT '',
  lat decimal(9,6) DEFAULT NULL,
  lng decimal(9,6) DEFAULT NULL,
  accuracy int NOT NULL DEFAULT 0,
  speed float DEFAULT NULL,
  distance_m int DEFAULT NULL,
  eta_s int DEFAULT NULL,
  started_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  public_hash char(64) NOT NULL,
  active tinyint NOT NULL DEFAULT 1,
  depart_notified tinyint NOT NULL DEFAULT 0,
  approach_notified tinyint NOT NULL DEFAULT 0,
  review_sent tinyint NOT NULL DEFAULT 0,
  PRIMARY KEY (visit_id),
  KEY visit_track_public (public_hash),
  KEY visit_track_partner (partner_id,active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_review_link (
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  url varchar(500) NOT NULL DEFAULT '',
  message varchar(300) NOT NULL DEFAULT '',
  auto tinyint NOT NULL DEFAULT 1,
  PRIMARY KEY (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
