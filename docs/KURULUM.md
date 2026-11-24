# VeTNeT PHP/MySQL aktarımı — test kurulumu

Bu paket tam ticari VeTNeT sürümü değildir. PHP/MySQL'e aktarılmış, kapsamı aşağıda belirtilen klinik çekirdeğini ve tarayıcıdan ilk kurulum ekranını içerir. Çalışan sitenizin üzerine yüklemeyin; ayrı bir alt alan adı ve yeni boş veritabanı kullanın. Önce DURUM.md dosyasını okuyun.

## Gereksinimler

- PHP 8.2 veya üzeri; PDO MySQL, Sodium ve Argon2id desteği. Test edilen PHP: 8.4.
- MySQL 8.0.16 veya üzeri ya da MariaDB 10.6 veya üzeri hedeflenir. Gerçek veritabanı testleri MariaDB 11.8 üzerinde yapıldı; Oracle MySQL ve gerçek cPanel sunucusu ayrıca doğrulanmadı.
- Apache 2.4, mod_rewrite, .htaccess izinleri, HTTPS.
- Alan adının kökünde kurulum. `/altklasor/` URL kurulumu desteklenmez.
- Sunucuda Node.js, Composer veya terminal gerekmez; tarayıcı varlıkları hazırdır.

## cPanel üzerinden kurulum

1. cPanel'de yeni boş bir MySQL veritabanı ve yalnızca bu veritabanına erişen kullanıcı oluşturun. Kullanıcıya bu veritabanı için tablo oluşturma ve okuma/yazma izinlerini verin. Var olan VeTNeT/veri tabanını seçmeyin.
2. ZIP içindeki `vetnet` klasörünü FTP veya cPanel Dosya Yöneticisiyle hesabınıza yükleyin. Örnek: `/home/CPANEL_HESABI/vetnet`.
3. Yeni test alt alan adının belge kökünü `/home/CPANEL_HESABI/vetnet/public` yapın. **Belge kökü `vetnet` değil, `vetnet/public` olmalıdır.** Kaynaklar, SQL ve yapılandırma public dışında kalır. Sunucunuz belge kökü değişimine izin vermiyorsa sağlayıcınızdan bu alt alan adı için ayarlamasını isteyin.
4. SSL sertifikasını etkinleştirin.
5. `vetnet/config.example.php` dosyasının kopyasını aynı yerde `config.php` adıyla oluşturun. `origin` alanına `https://test.alanadiniz.com` biçiminde gerçek adresi, sonunda `/` olmadan yazın. DSN içindeki veritabanı adını, username ve password alanlarını cPanel bilgileriyle doldurun. Dosyayı public içine koymayın.
6. Parola yöneticinizle birbirinden farklı iki rastgele anahtar üretin (en az 32 karakter). Birini `rateSecret`, diğerini `installationToken` alanına yazın. Anahtarları ve DB parolasını sohbetle paylaşmayın. `assets` satırını değiştirmeyin. config.php dosyasını PHP kullanıcısının okuyabileceği en dar izinle saklayın (uygunsa 0600).
7. `https://test.alanadiniz.com/install.php` adresini açın. Kurulum anahtarını ve ilk klinik/bayi hesabının telefonunu, e-postasını, klinik adını ve en az 12 karakterli şifresini girin. SQL dosyalarını önceden içe aktarmayın; kurucu kendisi uygular.
8. Başarılı kurulumdan sonra `config.php` içindeki `installationToken` değerini boşaltın. `public/install.php` dosyasını kaldırın. Kurucu boş olmayan veritabanında zaten yeniden çalışmaz.
9. `/app` adresinden oluşturduğunuz telefon ve şifreyle giriş yapın.
10. Deneme müşteri, hasta, randevu, muayene ve aşı kaydı oluşturun. Sayfayı yenileyip kayıtların kaldığını kontrol edin. Şifre değiştirme sonrası tekrar giriş yapın.

## Kurulum hataları

- “Veritabanı boş değil”: mevcut veriler korunur; hiçbir tablo silinmez. Var olan veritabanınızı boşaltmayın. Yeni bir test veritabanı seçin.
- Yarım kalmış SQL kurulumu: MySQL DDL işlemleri otomatik commit yapar. Kurucu tabloları silmez veya tekrar deneyerek üzerine yazmaz. Hata nedeni giderildikten sonra yeni bir boş test veritabanında yeniden kurun.
- HTTPS hatası: sunucu PHP'ye HTTPS durumunu doğru aktarmalıdır. Bu kontrolü kaldırmayın; proxy ayarını sağlayıcınız düzeltsin.
- 404 giriş/API: belge kökü, .htaccess dosyasının yüklenmiş olması ve mod_rewrite kontrol edilmeli.
- Genel sunucu hatası: cPanel PHP hata günlüğüne bakın. Şifreleri veya tüm yapılandırma dosyasını paylaşmayın.
- “Henüz desteklenmiyor”: bu PHP aktarımında tamamlanmamış modüldür; kurulum hatası değildir. DURUM.md bölümüne bakın.

## Yedekleme ve geri dönüş

cPanel'in yedekleme aracı veya phpMyAdmin dışa aktarımıyla veritabanını; FTP ile tüm vetnet klasörünü yedekleyin. Yapılandırma sırlarını ayrı ve korumalı saklayın. Geri dönüşü yeni test veritabanına SQL içe aktararak ve ayrı bir kopyadaki config.php bağlantısını değiştirerek deneyin. Dolu veritabanında install.php çalıştırmayın. Bu pakette mevcut Worker/D1 canlı verilerini MySQL'e kayıpsız taşıyan tamamlanmış araç yoktur. Eski hesap parolalarının biçimi PHP password_verify ile doğrudan uyumlu değildir; mevcut hesapların geçişi ayrıca tasarlanmalıdır.

## Güncelleme

Bu teslimat yeni test kurulumu içindir; mevcut PHP kurulumu için otomatik yükseltici değildir. SQL dosyalarını dolu veritabanına yeniden çalıştırmayın. Canlı veri taşınmadan ve geri yükleme testi yapılmadan üretime geçmeyin.

## Bu geliştirmede eklenen merkez ve ekip kurulumu

Merkez girişi `/yonetim` adresindedir. PHP Sodium eklentisi gereklidir. `config.php` içindeki `encryptionKey` alanına rastgele üretilmiş 32 baytın Base64 karşılığını girin; bu anahtar değiştirilirse kayıtlı yönetici 2FA sırrı çözülemez. Anahtarı veritabanından ayrı ve güvenli yedekleyin. Kurulum formundaki ayrı merkez e-postası/şifresini doldurun; gösterilen kurulum sırrını doğrulama uygulamanıza zaman tabanlı, 6 haneli, 30 saniyelik hesap olarak ekleyin. Üretilen kodu girerek kurulumu tamamlayın. Kurulum kodu tek kullanımlıktır; yönetici girişinde bir sonraki kodu bekleyin.

Merkez panelinde bayi arama, bayi açma, şube/üye listelerini görme, bayi kapatma ve tekrar etkinleştirme vardır. Yeni bayiye verilen aktivasyon bağlantısı 15 dakika geçerlidir. Bağlantıyı yalnızca kimliği doğrulanan bayi yetkilisine iletin. İşlem üzerinden beş dakika geçtiğinde yeni doğrulama koduyla tekrar merkez girişi gerekir. Merkez yöneticisi kurtarma ve yardımcı yönetici yetkilendirmesi henüz aktarılmamıştır.

Bayi panelinde hesaplar bölümünde şube/personel/hasta sahibi üyeliği oluşturulabilir. SMS bağlantısı ertelendiğinden yüz yüze doğrulama yöntemini seçin ve kimliği gerçekten doğrulayın. Mevcut hesap telefonuna yeni üyelik açıldığında aktivasyonda o hesabın mevcut şifresi gerekir; yöneticinin bu şifreyi bilmesi gerekmez. İzin değişikliği ve üyelik kapatma aktif oturumları sonlandırır. Şube üst sınırı 2, ekip hesabı üst sınırı 4'tür; merkezden bu sınırları özelleştirme henüz yoktur.

## Geliştirici testleri

Kaynak depoda `node scripts/build.mjs --cpanel-assets` ve `VETNET_TEST_RUNTIME=/tam/php-mariadb/usr bash cpanel/tests/run-integration.sh` ile testler çalıştırıldı. Betik bağımsız geçici MariaDB başlatır; 43328/43329 portlarının boş olması gerekir. PHP 8.4, MariaDB araçları, Node.js ve Python 3 test makinesinde gereklidir. Bunlar FTP kurulumu için gerekmemektedir. Test yönlendiricisi HTTPS sonlandırmasını taklit eder; canlı HTTPS kontrolünü kaldıran bir kod public klasörüne eklenmez.

Önceki PHP test kurulumu güncelleniyorsa, mevcut veritabanının yedeğini aldıktan sonra phpMyAdmin üzerinden `database/008-print-templates.sql` dosyasını uygulayın. Yeni kurulum bu tabloyu otomatik oluşturur.

Önceki PHP test veritabanına destek modülünü eklemek için yedek aldıktan sonra `database/009-support.sql` dosyasını da uygulayın. Yeni kurulum bu adımı otomatik yürütür.

Satış sitesi `/platform`, paketler `/platform/paketler`, demo başvurusu `/platform/demo` adresindedir. Merkez yöneticisi `/yonetim` ekranında **CRM · Başvurular** bölümünden görüşme durumunu kaydeder. **Bayiler → bayi → Abonelik dönemleri** yolundan paket ve tarih aralığı atanır. Bayi kendi dönemini `/#abonelik` ekranında görür. Paket adları ve teklif bilgileri kaynak projedeki `cpanel/sales-plans.json` dosyasından hazırlanır. Katalog değişikliğinde satış HTML dosyaları yeniden derlenmelidir.

Mevcut test kurulumuna bu modülleri eklerken veritabanı yedeğini alın ve eksikse `database/010-commerce.sql` dosyasını phpMyAdmin üzerinden uygulayın. Yeni kurulumda tablo otomatik oluşturulur.

### Şube e-SMM portalı

Mevcut kurulumda veritabanı yedeği aldıktan sonra `database/011-esmm-portal.sql` dosyasını uygulayın. Yeni kurulum tabloyu oluşturur. Bayi panelinde **Ayarlar → Şube e-SMM ayarları** üzerinden GİB veya İşNet portalını seçin. Satış ekranındaki kısayol, kullanıcının kendi hesabıyla giriş yapacağı sağlayıcı portalını açar. Belge sağlayıcı portalında düzenlenir. Bu değişikliğin HTTP testleri dosyaya eklendi. PHP/MariaDB çalışma ortamı bu turda bulunamadığından test sonucu bekliyor.

### Tema ve kurulum kontrolü

`config.php` içindeki `encryptionKey`, Base64 kodlanmış 32 rastgele bayt olmalıdır. Kurulum ekranı anahtarı tablo oluşturmadan önce kontrol eder. Yeni kurulum tema tablosunu otomatik oluşturur. Mevcut PHP test kurulumunda yedek aldıktan sonra `database/012-appearance.sql` dosyasını uygulayın. Yönetici **Tema** ekranından ortak paleti belirler. Klinik hesaplarının kişisel tema tercihleri hesap bazında saklanır. Ortak tema kilidi etkin olduğunda klinik ve satış sitesi ortak paleti kullanır.
