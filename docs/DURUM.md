# PHP aktarım durumu — 12 Kasım 2026, ikinci geliştirme

Tam platform dönüşümü henüz bitmedi. Aşağıdaki sonuçlar çalışan PHP/MariaDB testlerinden alınmıştır. Mevcut canlı Worker sitesi ve verileri değiştirilmedi.

## Bu geliştirmede eklenen ve test edilenler

- Satış sitesi ve paket sayfaları, demo/iletişim başvurusu, CRM görüşme durumu, elle paket ve dönem ataması ile bayi abonelik geçmişi. Fiyatlar teklif usulüdür. Dönem ataması ödeme kaydı oluşturmaz.

- PHP destek talepleri ve konuşma geçmişi. Klinik tarafında talep açma, yanıtlama ve kapatma HTTP testlerinden geçti. Merkez paneli destek listesi ve yanıtlama eklendi. Dosya ekleri ve bildirimler bu aktarımda kapalı.

- Klinik çıktı şablonları için hazır şablon listesi ve bayi bazında kaydetme, etkinleştirme ve silme uçları eklendi. Sistem şablonları silinemez.

- Şube, personel ve hasta sahibi telefon girişleri; aynı hesabın aktif üyeliklerini listeleme ve güvenli üyelik seçimi.
- Şube ve modül bazlı sunucu filtreleme; yasak alanlara yazmanın reddi; kısmi yetkili kayıt güncellemesinde gizli kalan kayıtların korunması.
- Hasta sahibinin sadece kendi hayvanlarına, izin verilen aşı/randevu alanlarına erişmesi; klinik özel notlarının dışarı verilmemesi.
- Yüz yüze kimlik doğrulaması sonrası 15 dakikalık, tek kullanımlık aktivasyon; mevcut telefon hesabı için mevcut şifre şartı; süre ve tekrar kullanım denetimi.
- Bayi tarafından üyelik oluşturma, modül izinleri değiştirme ve üyelik iptali; izin değişikliğinde oturum sonlandırma. Şube limiti 2, ekip hesabı limiti 4.
- Merkez yöneticisi kurulumu, ayrı e-posta/şifre ve zorunlu TOTP girişi, kod tekrarının reddi, şifrelenmiş TOTP sırrı.
- Merkezden bayi oluşturma, aktivasyon bağlantısı, bayi listeleme/arama, şube ve üye listeleri, bayiyi kapatınca oturum sonlandırma, tekrar etkinleştirme, yönetici işlem günlüğü.
- Ürün -> indirim/KDV içeren satış -> stok düşümü -> kısmi tahsilat -> ürün alışı -> stok artışı -> tedarikçi ödemesi -> gider kaydı HTTP üzerinden gerçek veritabanına işlendi ve geri okundu.
- Para hesapları sunucuda kuruş cinsinden tamsayıyla kontrol ediliyor. Değiştirilmiş toplam, fazla tahsilat, eksik stok dağılımı ve stok hareketi olmadan satış reddedildi.
- Mali hareketler ayrı finance_entry tablosuna aynı veritabanı işlemi içinde yazılıyor. Satış ilk tahsilatı, ek tahsilat, tedarikçi ödemesi, gider ve alış ayrı kaynak türleriyle tutuluyor; alış kayıtları nakit tahsilat değildir.
- Klinik kayıtlarında oluşturan/güncelleyen adları sunucu tarafından atanıyor.
- Mevcut kurulum, oturum, parola değiştirme, müşteri/hasta/randevu/muayene/aşı testleri geçmeye devam ediyor.

## Eklenen, ancak tüm kullanım senaryoları henüz doğrulanmayanlar

Kilo geçmişi, aşı kataloğu, tetkik, tedavi, reçete ve konaklama kayıtlarının temel PHP saklama/ilişki kontrolleri. Şube ve genel ayar değişiklikleri. Mevcut arayüzün bütün formları, mobil/tablet düzeni, grafik ve çıktı işlemleri tarayıcıdan uçtan uca denenmedi.

## Açık kalan işler

- Merkez panelinin tüm önceki bölümleri, yardımcı yöneticilerin ayrıntılı yetkileri, kişiye özel limitler, hesap kurtarma.
- Satış sitesi içeriğinin panelden düzenlenmesi, duyuru/reklam, otomatik ödeme ve ödeme sonrası otomatik abonelik işlemleri.
- Finansal iptal/iade/ters kayıt akışı. Bu sürümde kaydedilmiş mali hareketlerin üstüne yazmak veya silmek reddedilir; mevcut arayüzdeki mali düzenleme seçenekleri tamamlanmış değildir.
- Reçete ve aşıdan otomatik stok tüketimi gibi tüm klinik-finans birleşik senaryoları.
- Dosya yükleme/OCR/yapay zekâ, tüm dışa aktarma ve rapor ekranlarının doğrulanması.
- Uç nokta çağrıları arasında halen tamamlanmamış olanlar vardır; 501 cevabı verir. Görünür arayüz özelliği çalışıyor kabul edilmez.
- Eski D1 verilerinin ve parola biçimlerinin güvenli taşınması, sürüm yükseltme aracı.
- Gerçek cPanel/Apache, gerçek HTTPS, mobil/masaüstü tarayıcı, yük ve bağımsız güvenlik testleri; yedekten geri dönüş tatbikatı.

## Test ortamı ve sonuçları

PHP 8.4 / MariaDB 11.8. Geçici ve birbirinden ayrı veritabanları kullanıldı. Gerçek kullanıcı verisi kullanılmadı. PHP HTTP test yönlendiricisi TLS sonlandırmasını simüle etti; gerçek cPanel/TLS testi değildir.

- PHP dosyalarının sözdizimi denetimleri: geçti.
- core.php: oturum, bayi izolasyonu, revizyon, hız sınırlaması ve denetim kaydı testleri geçti.
- install.php: boş veritabanına kurulum, geçersiz girdiyi reddetme, yeniden kurulumu engelleme ve veri koruma geçti.
- roles.php: aktivasyon/süre/tekrar, hasta sahibi gizliliği, personel şube/modül izolasyonu, yetkisiz değişiklikleri reddetme, gizli kayıtları koruma ve oturum iptali geçti.
- finance.php: mevcut JS uygulama modelinin ürettiği satış/stok/tahsilat/alış/ödeme verileri PHP doğrulamasından geçti; değiştirilmiş veriler reddedildi.
- center.php: TOTP test vektörleri, sır şifreleme, kod tekrarının reddi, yönetici kurulumu/girişi, bayi açma/aktive etme, bayi hesabının merkeze erişememesi, kapatma ve denetim kayıtları geçti.
- http_checks.py: kurulum ve klinik işlemlerin HTTP gidiş/dönüş testleri, hasta sahibi davet/aktivasyon/giriş/portal testleri ve yetki reddi geçti.
- center-ops.js sözdizimi: geçti. PHP varlık derlemesi: geçti.

Bunlar tamamlanan sınırlı akışlara ait sonuçlardır; sistemin tamamının ticari kullanıma hazır olduğu veya tüm güvenlik gereksinimlerini karşıladığı anlamına gelmez.

## Ertelenen entegrasyonlar

Netgsm, WhatsApp Business, ÖKC, sanal POS, e-SMM/e-dönüşüm, SMTP ve HBS. Gerçek sağlayıcı sonucu olmadan mesaj gönderildi, ödeme alındı veya mali belge oluştu olarak işaretlenmez.

Tema ayarları için merkezde ortak palet ve kilit, klinikte hesap bazında tercih, satış sitesinde ortak paletin uygulanması eklendi. Kurucuda yönetici şifreleme anahtarı ön kontrolü eklendi. Bu güncellemede PHP sözdizimi ve paket derlemesi doğrulandı. Tema kayıtlarının MySQL ve tarayıcı doğrulaması bekliyor.
