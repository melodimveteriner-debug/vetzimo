-- SMS ve WhatsApp kredi satışı kaldırıldı: mesajlar kliniğin kendi hattından gider, sınırlar paketten gelir
DROP TABLE IF EXISTS clinic_credit_grant;
DELETE FROM center_management WHERE kind IN ('credit_order','credit_package');
