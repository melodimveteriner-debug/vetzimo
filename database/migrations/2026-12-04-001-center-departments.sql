-- Merkez departmanları: '' = tam yetkili yönetici (sahip), 'support' = yalnız destek talepleri, 'dealer' = bayi departmanı
-- (havale onayları, abonelik geçişleri, bayi listesi). Her hesap kendi doğrulama uygulaması koduyla girer.
ALTER TABLE identity_center ADD COLUMN IF NOT EXISTS department varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT '';

-- Abonelik hatırlatmaları: aynı dönem ve aşama için ikinci kez gönderilmez.
CREATE TABLE IF NOT EXISTS subscription_reminder (
  partner_id varchar(80) COLLATE utf8mb4_bin NOT NULL,
  ends_on date NOT NULL,
  stage varchar(8) COLLATE ascii_bin NOT NULL,
  sent_at bigint NOT NULL,
  channels varchar(40) COLLATE ascii_bin NOT NULL DEFAULT '',
  PRIMARY KEY (partner_id,ends_on,stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
