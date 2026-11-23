# VeTNeT Merkez Yönetimi R5

## R4 kuruluysa

1. Dosya ve veritabanı yedeği alın.
2. ZIP'teki vetnet/src ve vetnet/public içeriklerini mevcut sunucuda aynı adlı klasörlere yükleyin. Daha önce kapatılmış install.php dosyasını tekrar yüklemeyin. Mevcut config.php dosyanızı kullanın. Özel .htaccess kurallarınız varsa koruyun.
3. public/index.php dosyasını en son yükleyin.
4. /yonetim adresinde Merkez paneli · R5 yazısını kontrol edin.

R4 veritabanı şeması yeterlidir. R3 veya daha eski PHP sürümünden yükseltiyorsanız önce MERKEZ-R4.md dosyasında açıklanan 013 SQL güncellemesini uygulayın. Sıfırdan kurulum için KURULUM.md dosyasına bakın.

## R5 değişiklikleri

- Duyuru ve reklam için JPEG/PNG/WebP görseli, üç yayın kutusu, bayi hedefleme, taslak/yayında durumu ve üst duyuru. Başlık ve metin boşken görselle yayın oluşturulabilir. Genel yayın aynı kutudaki bayi yayınına önceliklidir.
- Ödemede doğrulanan dekont tutarı ve kontrol onayı gerekir. Paket ve geçerli başlangıç/bitiş girilmişse ödeme onayı ile dönem açılışı aynı işlemde kaydedilir. Dönem çakışmasında onay kaydedilmez. Yeni dekont referanslarının tekrar kaydı engellenir.
- Ödeme onayı bankadan elle kontrol gerektirir. Sağlayıcı sorgusu, kredi siparişleri ve muhasebe fişi akışı eksiktir.
- Satış sitesi yönetiminde başlık ve arama açıklaması düzenlenebilir. Eski sayfa bölümü editörü henüz aktarılmadı.
- Klinik içe aktarma aynı bayinin VeTNeT JSON yedeğindeki eksik müşteri ve hastaları kapsar. Excel, tam geri yükleme ve tüm işletme kayıtlarının yedeği henüz aktarılmadı.
- ÖKC ekranı cihaz envanterini tutar. Eski Worker sürümündeki cihaz simülasyonu ve işlem akışları PHP'ye aktarılmadı. Canlı cihaz işlemleri için onaylı üretici bağlantısı gerekir.

PHP/JavaScript sözdizimi, derleme, paket bütünlüğü ve temel para doğrulama örnekleri kontrol edilmiştir. R5 canlı cPanel veya MySQL üzerinde uçtan uca doğrulanmadı.
