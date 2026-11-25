-- Aylık gönderim sınırı sayımı: klinik + ay aralığı indeksle okunur, mesaj geçmişi büyüdükçe yavaşlamaz
ALTER TABLE phone_outbox ADD KEY partner_month (partner_id,created_at,channel,status);
