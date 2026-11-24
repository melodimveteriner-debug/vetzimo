CREATE TABLE IF NOT EXISTS site_legal_doc (
  slug varchar(40) NOT NULL PRIMARY KEY,
  title varchar(160) NOT NULL,
  summary varchar(400) NOT NULL DEFAULT '',
  body mediumtext NOT NULL,
  version int unsigned NOT NULL DEFAULT 1,
  effective_on date NOT NULL,
  updated_at datetime NOT NULL,
  updated_by varchar(160) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
CREATE TABLE IF NOT EXISTS site_legal_revision (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  slug varchar(40) NOT NULL,
  version int unsigned NOT NULL,
  title varchar(160) NOT NULL,
  summary varchar(400) NOT NULL DEFAULT '',
  body mediumtext NOT NULL,
  effective_on date NOT NULL,
  note varchar(300) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  created_by varchar(160) NOT NULL DEFAULT '',
  UNIQUE KEY slug_version (slug,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
CREATE TABLE IF NOT EXISTS site_legal_company (
  id tinyint unsigned NOT NULL PRIMARY KEY,
  data text NOT NULL,
  updated_at datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci
