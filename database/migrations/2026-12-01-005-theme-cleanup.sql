-- Tema sadeleştirme: yalnız Orkide·Safir, Prizma ve Nebula kalır, kaldırılan temayı seçenler varsayılana döner
UPDATE vetnet_appearance SET palette='' WHERE palette NOT IN ('','orchid','prizma','nebula');
