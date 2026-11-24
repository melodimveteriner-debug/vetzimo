-- Web sitesi iletişim mesajlarının klinik uygulamasında işlenmesi: kim, ne zaman işledi ve bağlanan müşteri kartı.
ALTER TABLE clinic_web_inbox
  ADD COLUMN IF NOT EXISTS handled_at bigint DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS handled_by varchar(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_id varchar(80) NOT NULL DEFAULT '';
