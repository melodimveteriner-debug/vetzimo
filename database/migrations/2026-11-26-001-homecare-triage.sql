-- Evden takip: hasta sahibi gözleminin ön değerlendirme seviyesi (routine, soon, urgent) ve nedenleri.
-- Klinik inceleme sırası acil gözlemleri önce gösterir.
ALTER TABLE clinic_homecare_checkin
  ADD COLUMN IF NOT EXISTS triage varchar(10) NOT NULL DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS triage_reasons varchar(255) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS clinic_queue_triage ON clinic_homecare_checkin (partner_id, branch_id, decision, triage)
