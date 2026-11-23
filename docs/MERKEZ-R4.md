# VeTNeT Merkez Yönetimi R4

## Mevcut kurulumun güncellenmesi

1. cPanel üzerinden veritabanı ve dosya yedeği alın. VeTNeT'in kullandığı veritabanını seçin.
2. phpMyAdmin'de yalnızca `vetnet/database/013-center-management.sql` dosyasını çalıştırın. Bu adım mevcut satırları değiştirmez.
3. ZIP'teki `vetnet/src` dosyalarını ve `vetnet/public` dosyalarını, sunucuda bu klasörlerin mevcut olduğu VeTNeT dizinine yükleyin. Kök dizini ikinci bir `vetnet` veya `public` klasörüyle iç içe geçirmeyin. Mevcut `config.php` dosyasını kullanın. Daha önce devre dışı bıraktığınız `install.php` dosyasını tekrar yüklemeyin.
4. Özel Apache kurallarınız varsa yeni `.htaccess` dosyasındaki HTML şablonu korumasını mevcut kurallarınıza ekleyin. `public/index.php` dosyasını en son yükleyin.
5. `/yonetim` adresinde sol menüde **Merkez paneli · R4** yazısını kontrol edin. Hassas işlemler için Güvenlik ekranında yönetici şifreniz ve doğrulama uygulamasının yeni kodu kullanılır.

## Yeni kurulum

[KURULUM.md](KURULUM.md) adımlarını uygulayın. Kurucu 013 şemasını boş veritabanına kendisi ekler. Belge kökü `vetnet/public` olmalıdır.

## R4 kapsamı

- Ödeme Onayları dekont referansı ve elle onay/ret tutar. Banka sorgusu, muhasebe fişi veya abonelik aktivasyonu yoktur.
- Satış Sitesi Yönetimi var olan `/platform` sayfalarının başlığını ve arama açıklamasını düzenler.
- Duyuru ve metin/bağlantı reklamı tüm bayilere veya tek bayiye yayınlanabilir. Klinik Genel Bakış ekranında görünür.
- Son Değişiklikler merkez yöneticisinin yayın notlarını saklar.
- Yedekleme seçilen bayinin çalışma alanını JSON olarak verir. Sistem genelindeki veritabanı, oturumlar ve yapılandırma bu dosyanın dışındadır.
- Klinik Verisi İçe Aktar aynı bayinin VeTNeT JSON yedeğinden eksik müşteri ve hasta kayıtlarını önizler ve ekler. Diğer kayıt türleri, Excel ve tam geri yükleme bu akışın dışında kalır.
- ÖKC cihaz envanteri bayi, şube, marka, model ve seri numarası tutar. Gerçek cihaz iletişimi, fiş kesme ve mali işlem için sağlayıcı bağlantısı gerekir.

R4 için PHP ve JavaScript sözdizimi, derleme ve ZIP içeriği kontrol edilmiştir. Yeni işlemler canlı cPanel veya MySQL üzerinde uçtan uca doğrulanmamıştır.
