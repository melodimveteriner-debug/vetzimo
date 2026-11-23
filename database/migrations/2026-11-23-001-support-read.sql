-- Klinik kullanıcılarının destek yanıtlarını okuyup okumadığını izler (okunmamış yanıt bildirimi).
CREATE TABLE IF NOT EXISTS clinic_support_read (
  membership_id varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticket_id char(32) NOT NULL,
  last_reply_id bigint(20) unsigned NOT NULL,
  PRIMARY KEY (membership_id, ticket_id),
  KEY clinic_support_read_ticket (ticket_id),
  CONSTRAINT clinic_support_read_ticket_fk FOREIGN KEY (ticket_id) REFERENCES clinic_support (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Merkez yanıtlarını bilete göre hızlı bulmak için
CREATE INDEX IF NOT EXISTS clinic_support_reply_side ON clinic_support_reply (ticket_id, side, id)
