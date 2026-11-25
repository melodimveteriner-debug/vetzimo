-- Uygulama bildirimleri: hasta sahibine giden hazır mesaj şablonu (Sayın {sahip}, {hasta} ... {klinik} · {telefon})
ALTER TABLE app_template ADD COLUMN IF NOT EXISTS message VARCHAR(400) NOT NULL DEFAULT '' AFTER body;
