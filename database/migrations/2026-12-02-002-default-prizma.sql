-- Sitenin genel teması Prizma · Işıltı olur (kişisel tema seçimleri korunur)
INSERT INTO vetnet_appearance(scope_key,palette,locked) VALUES ('global','prizma',0) ON DUPLICATE KEY UPDATE palette='prizma';
