-- Uygulama indirme sayacı: gün, uygulama, kaynak (web/qr/panel) ve indiren cihaz türüne göre toplam ve benzersiz sayılar.
-- Benzersizlik için IP saklanmaz, günlük gizli anahtarla üretilmiş özet tutulur ve iki gün sonra silinir.
CREATE TABLE IF NOT EXISTS app_download_stat (
  day date NOT NULL,
  app varchar(24) COLLATE ascii_bin NOT NULL,
  source varchar(8) COLLATE ascii_bin NOT NULL,
  client varchar(8) COLLATE ascii_bin NOT NULL,
  total int unsigned NOT NULL DEFAULT 0,
  uniq int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (day,app,source,client),
  KEY app_day (app,day)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;

CREATE TABLE IF NOT EXISTS app_download_seen (
  hash binary(32) NOT NULL,
  day date NOT NULL,
  PRIMARY KEY (hash),
  KEY day (day)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
