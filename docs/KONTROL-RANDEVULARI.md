# Kontrol randevuları ve otomatik hatırlatma

Muayenede **Kontrol tarihi** ile **Kontrol saati** birlikte doldurulur. Açık
kontrol randevusunu aynı muayeneden güncelleyin. Muayene iptal edilirse veya
kontrol tarihi ve saati temizlenirse açık kontrol randevusu iptal edilir.
Muayeneye bağlı önceki tamamlanmış randevular geçmişte kalır. Randevu yazma
yetkisi gereklidir. Hasta sahibi yetkisinde **Randevular** açıksa hasta sahibinin
**Randevularım** bölümüne düşer.

## Mevcut cPanel kurulumuna yükleme

ZIP içindeki dizinleri VeTNeT kurulum diziniyle birleştirin. Var olan
`config.php` dosyasını koruyun. phpMyAdmin'de VeTNeT veritabanını seçin ve
`database/019-appointment-reminders.sql` dosyasını içe aktarın.

## SMS ve WhatsApp ayarları

Web kökünün dışındaki `config.php` dosyasında, ana yapılandırma dizisine aşağıdaki
alanı ekleyin. Bayi kimliği, `partner_account` tablosundaki ilgili bayinin
`id` değeridir. İstemediğiniz kanalı o bayinin ayarından çıkarın.

```php
'appointmentReminderConnections' => [
    'BAYI_KIMLIGI' => [
        'sms' => [
            'account' => 'NETGSM_ABONE_NUMARASI',
            'password' => 'NETGSM_API_SIFRESI',
            'sender' => 'ONAYLI_BASLIK',
        ],
        'whatsapp' => [
            'version' => 'META_API_SURUMU',
            'phoneId' => 'PHONE_NUMBER_ID',
            'token' => 'META_ERISIM_BELIRTECI',
            'template' => 'randevu_hatirlatma',
            'language' => 'tr',
        ],
    ],
],
```

WhatsApp için Meta'da üç konumsal gövde alanıyla bir onaylı Utility şablonu
kullanın. Örnek gövde `{{1}} için randevunuz {{2}}. Kliniğiniz: {{3}}.`
Alanlar sırasıyla hasta adı (hasta yoksa müşteri adı), İstanbul yerel tarih ve
saati, şube adıdır.

Bayi panelinde **Diğer → Genel Ayarlar → Otomatik hatırlatmalar** altında
**Randevu** ile kullanacağınız kanalları açın ve kaydedin. Hasta sahibinin
müşteri kartında ilgili kanal için gönderim izni **Var** olmalıdır.

cPanel **Cron İşleri** ekranında 5 dakikada bir çalışacak görev ekleyin.
Önceki dizin düzeniniz için örnek komut aşağıdadır. PHP CLI yolunu hosting
hesabınızın PHP sürümüne göre seçin. CLI'da PDO MySQL ve cURL gereklidir.

```text
/usr/local/bin/php /home/melodim/veterinerhekimlik.com/public_html/bin/appointment-reminders.php
```

Görev gelecek 24 saatin randevularını tarar. Aynı bayi, şube, randevu, saat ve
kanal için ikinci kez gönderim yapmaz. Kabul durumu sağlayıcıya aktarımı ifade
eder. Belirsiz sonuçlarda çift gönderimi önlemek için otomatik tekrar yapılmaz.
Sonuçlar `clinic_appointment_reminder` tablosunda ve cPanel cron çıktısında
izlenebilir.
