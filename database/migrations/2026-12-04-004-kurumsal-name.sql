-- "Özel" paketin adı "Kurumsal" oldu (paket kodu ozel aynı kalır, mevcut abonelikler etkilenmez).
UPDATE clinic_package_settings SET settings=JSON_SET(settings,'$.name','Kurumsal') WHERE plan_id='ozel' AND JSON_UNQUOTE(JSON_EXTRACT(settings,'$.name'))='Özel';
UPDATE clinic_subscription SET plan_name='Kurumsal' WHERE plan_id='ozel' AND plan_name='Özel';
UPDATE saas_order SET plan_name='Kurumsal' WHERE plan_id='ozel' AND plan_name='Özel';
