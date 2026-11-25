# VetZimo Uygulamaları · Mağaza Yayın Rehberi

Bu rehber Android (Google Play), iPhone/iPad (App Store), Windows ve macOS uygulamalarının yayınlanması için **sizin yapmanız gereken** dış işlemleri ve hazır olan teknik parçaları anlatır. Mağaza onayı garanti edilemez; aşağıdaki maddeler ret riskini en aza indirmek için hazırlandı.

## 1. Mimari (kısa)

| Parça | Konum | Durum |
|---|---|---|
| Android + iOS uygulaması (Capacitor 8) | `apps/mobile` | Proje hazır; Android hata ayıklama ve yayın paketi bu ortamda derlendi |
| Windows / macOS / Linux uygulaması (Electron 45) | `apps/desktop` | Proje hazır; Windows kurulum paketi derlendi |
| Web / PWA | `public/` (`vetzimo-sw.js`, `native-bridge.js`) | Çalışıyor |
| Uygulama merkezi (sunucu) | `src/AppHub.php`, `src/AppPush.php` | Çalışıyor, otomatik testli |
| Uygulama Yönetimi (merkez paneli) | `/yonetim?tab=uygulamalar` | Çalışıyor |

Uygulamalar aynı merkezi VetZimo sistemine bağlanır: hesaplar, yetkiler, veriler ve modüller ortaktır; ayrı veri tabanı yoktur. Uygulama, işletim sistemi özelliklerini (push bildirimi, kilit ekranı, simge rozeti, bildirime dokununca ilgili sayfa, konum, kamera, mikrofon, Face ID / Touch ID / parmak izi, çevrimdışı ekranı, derin bağlantılar) yerel eklentilerle kullanır.

## 2. Sizin açmanız gereken hesaplar

1. **Google Play Console** geliştirici hesabı (tek seferlik ücret). Kurumsal hesap önerilir (D-U-N-S numarası gerekir).
2. **Apple Developer Program** üyeliği (yıllık ücret). Kurumsal üyelik için D-U-N-S numarası gerekir.
3. **Firebase projesi** (ücretsiz): Android push bildirimleri için.
4. **Windows kod imzalama sertifikası** (isteğe bağlı ama önerilir; yoksa SmartScreen uyarısı çıkar).
5. **Apple Developer ID** sertifikası ve noter onayı (macOS, Mac App Store dışı dağıtım için).

## 3. Push bildirimi kurulumu

### Android (Firebase Cloud Messaging)
1. Firebase konsolunda proje oluşturun, Android uygulaması ekleyin: paket adı `com.vetzimo.app`.
2. `google-services.json` dosyasını indirip `apps/mobile/android/app/` klasörüne koyun (depoya eklenmez).
3. Firebase › Proje ayarları › Hizmet hesapları › **Yeni özel anahtar oluştur** (JSON).
4. VetZimo Yönetim › Uygulamalar ve destek › Uygulama Yönetimi › **Push ayarları**: proje kimliğini ve JSON'u yapıştırın, kaydedin. Anahtar sunucuda şifreli saklanır.

### iOS (Apple Push Notification service)
1. Apple Developer › Certificates, IDs & Profiles › Keys › **+** › "Apple Push Notifications service (APNs)" seçili anahtar oluşturun, `.p8` dosyasını indirin.
2. Identifiers › `com.vetzimo.app` için **Push Notifications** ve **Associated Domains** yeteneklerini açın.
3. Uygulama Yönetimi › Push ayarları: Key ID, Team ID, Bundle ID (`com.vetzimo.app`) ve `.p8` içeriğini girin. TestFlight denemelerinde "Geliştirme (sandbox)" kutusunu işaretleyin.

### Web / PWA
Hesap gerekmez; VAPID anahtarı ilk kullanımda otomatik üretilir.

### Sunucu görevi
Her dakika çalışacak görev (cPanel › Cron Jobs):
```
* * * * * php /home/KULLANICI/public_html/bin/app-push.php
```

## 4. Android yayını

1. İmza anahtarı oluşturun (bir kez; anahtarı ve şifreyi güvenli saklayın, kaybederseniz güncelleme yayınlanamaz):
   ```
   keytool -genkeypair -v -keystore vetzimo-upload.jks -alias vetzimo -keyalg RSA -keysize 4096 -validity 10000
   ```
2. `apps/mobile/android/keystore.properties` dosyası (depoya eklenmez):
   ```
   storeFile=../vetzimo-upload.jks
   storePassword=...
   keyAlias=vetzimo
   keyPassword=...
   ```
3. Paketi üretin: `cd apps/mobile && npm install && npm run android:release` → `android/app/build/outputs/bundle/release/app-release.aab`.
4. Play Console'da **Play App Signing**'i açın; uygulama imzalama sayfasındaki **SHA-256** parmak izini Uygulama Yönetimi › Push ayarları › Android SHA-256 alanına girin (bildirim bağlantılarının uygulamada açılması için `/.well-known/assetlinks.json` bu değerle üretilir).
5. Sürüm yükseltirken `android/app/build.gradle` içinde `versionCode`'u artırın, ardından Uygulama Yönetimi › Sürümler'e yeni derleme numarasını girin (zorunlu güncelleme için "zorunlu en düşük derleme").

**Hedef API:** Proje hedef SDK 36 ile derlenir; Google Play'in güncel hedef API şartını karşılar.

## 5. iOS yayını (Mac ve Xcode gerekir)

1. `cd apps/mobile && npm install && npm run ios:open` (Xcode açılır; Swift Package Manager bağımlılıkları kendiliğinden iner).
2. Signing & Capabilities: ekibinizi seçin; **Push Notifications**, **Background Modes › Remote notifications** ve **Associated Domains** (`applinks:vetzimo.com`) zaten yetki dosyasında tanımlı.
3. Product › Archive › Distribute App › App Store Connect.
4. App Store Connect'te TestFlight ile deneyin, ardından incelemeye gönderin.
5. `/.well-known/apple-app-site-association` dosyası Team ID ve Bundle ID ile otomatik üretilir.

## 6. Windows ve macOS

- Windows: `cd apps/desktop && npm install && npm run dist:win` → `dist/VetZimo Setup 1.0.0.exe`. İmzalamak için sertifikanızı `CSC_LINK` / `CSC_KEY_PASSWORD` ortam değişkenleriyle verin ve `package.json` içindeki `signAndEditExecutable` değerini `true` yapın.
- macOS (Mac gerekir): `npm run dist:mac` → `.dmg` ve `.zip`. Developer ID ile imzalama ve noter onayı için `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` ortam değişkenlerini tanımlayın.
- Masaüstü uygulaması bildirimleri işletim sisteminin bildirim merkezine verir; okunmamış sayısı macOS'ta Dock rozetinde, Windows'ta görev çubuğu simgesinde ve tepside görünür.

## 7. Mağaza gizlilik beyanları

### Google Play › Veri güvenliği
| Veri türü | Toplanır mı | Paylaşılır mı | Amaç | İsteğe bağlı mı |
|---|---|---|---|---|
| Ad, telefon numarası, e-posta | Evet | Hayır | Hesap yönetimi, uygulama işlevi | Hayır (giriş için gerekli) |
| Hassas olmayan sağlık verisi (evcil hayvan kayıtları) | Evet | Hayır | Uygulama işlevi | Hayır |
| Yaklaşık ve kesin konum | Evet | Hayır | Uygulama işlevi (evde hizmet canlı rota, yalnız aktif ziyaret süresince) | Evet |
| Fotoğraflar ve videolar | Evet | Hayır | Uygulama işlevi (hasta fotoğrafı, belge) | Evet |
| Ses kayıtları | Hayır (cihazda işlenir) | Hayır | — | — |
| Uygulama etkinliği / hata günlükleri | Evet | Hayır | Analiz ve hata giderme | Hayır |
| Cihaz kimliği (bildirim anahtarı) | Evet | Hayır | Bildirimler | Evet |
- Veriler aktarım sırasında şifrelenir: **Evet** (TLS).
- Kullanıcı verilerin silinmesini isteyebilir: **Evet** — uygulama içinden ve `https://vetzimo.com/hesap-silme`.

### App Store › Uygulama Gizliliği
- Kimliğinizle ilişkili veriler: İletişim bilgileri (ad, telefon, e-posta), Sağlık ve fitness değil → **Diğer veriler (evcil hayvan kayıtları)**, Konum (kesin, uygulama işlevi), Kullanıcı içeriği (fotoğraflar), Tanılama (hata verileri), Tanımlayıcılar (cihaz kimliği/bildirim anahtarı).
- İzleme (tracking): **Hayır**. Reklam: **Hayır**. Üçüncü taraf analitiği: **Hayır**.

## 8. İzin gerekçeleri (inceleme ekibi için)

| İzin | Ne zaman istenir | Gerekçe |
|---|---|---|
| Bildirim | Uygulama içi açıklama penceresinden sonra; zorunlu değil | Randevu, aşı, tetkik sonucu, mesaj, evde hizmet ve güvenlik bildirimleri |
| Konum (kullanımdayken) | Personel "Yola çık ve konumumu paylaş"a dokununca | Hasta sahibine tahmini varış süresi; varışta durur. Arka plan konumu yoktur |
| Kamera | Fotoğraf/belge/QR düğmesine basınca | Hasta fotoğrafı, belge, barkod |
| Fotoğraflar | Dosya seçilince | Seçilen dosyayı hasta kaydına eklemek |
| Mikrofon | Bas Konuş düğmesi basılı tutulunca | Sesli komut ve muayene dikte |
| Face ID / biyometrik | Ayarlar'da biyometrik kilit açılınca | Uygulamayı kilitlemek |

İzin reddedilirse uygulama çalışmaya devam eder; yalnız ilgili özellik kullanılamaz ve Ayarlar'dan sonradan açılabilir.

## 9. İnceleme notları (Review Notes) — örnek metin

> VetZimo is a veterinary clinic management app. Clinics, staff and pet owners sign in with their phone number and password provided by their clinic. Demo account (clinic staff): phone **05XXXXXXXXX**, password **********. Demo account (pet owner): phone **05XXXXXXXXX**, password **********.
> Native features: push notifications with lock-screen privacy and badge counts, deep links to the related record, location only while a home-visit route is active (no background location), camera/photo upload, push-to-talk dictation, biometric lock, offline screen. Account deletion: Settings › My devices and delete account, or https://vetzimo.com/hesap-silme.

Demo hesapları için test veritabanındaki örnek klinik yerine **yayına özel boş bir demo bayi** açın ve şifreleri yalnız mağaza formuna yazın.

## 10. Mağaza görselleri ve metinleri

- Simge: 1024×1024 (iOS), 512×512 (Play) — `apps/mobile/www/icon.png` kaynağı; profesyonel yayın için vektör logodan yeniden üretilmesi önerilir.
- Ekran görüntüleri: telefon (6,7" ve 6,5" iPhone; Android 16:9 / 20:9), tablet (12,9" iPad, 10" Android). Önerilen sahneler: Genel bakış, hasta dosyası ve tetkik sonuçları, Bas Konuş ile muayene, bildirim merkezi, evde hizmet canlı rota, hasta sahibi portalı.
- Kısa açıklama (TR): "Veteriner kliniği yönetimi: randevu, hasta dosyası, tetkik, evde hizmet ve anında bildirimler."
- Uzun açıklama: satış sitesindeki özellik sayfalarından derlenebilir; tıbbi tavsiye vermediği, hekimin kararını desteklediği belirtilmelidir.
- Kategori: Tıp / İş. İçerik derecelendirmesi: 4+ / Herkes.

## 11. Gerçek cihaz test listesi (yayın öncesi)

Her madde Android (en az bir Samsung ve bir Pixel), iPhone ve iPad'de denenmelidir:
- [ ] Uygulama açıkken, arka plandayken ve kapalıyken bildirim gelir; ses çalar.
- [ ] Kilit ekranında bildirim görünür; hasta/ödeme ayrıntısı görünmez.
- [ ] Simgede okunmamış sayısı (1, 2, 3…) görünür; okuyunca azalır (desteklemeyen başlatıcılarda uygulama içi sayı doğru).
- [ ] Bildirime dokununca doğru hasta / randevu / mesaj sayfası açılır; farklı kurumdaysa kurum değişir.
- [ ] Bildirim izni kabul, red ve Ayarlar'dan sonradan açma.
- [ ] Konum izni kabul/red; "Yola çık" sonrası hasta sahibine tahmini süre ve yaklaşma bildirimi.
- [ ] Kamera ve dosya yükleme; mikrofon ile Bas Konuş.
- [ ] Biyometrik kilit açma/kapama; 5 dakika arka plandan dönünce kilit.
- [ ] Telefon ve tablette dikey/yatay ekran; klavye açıkken formlar.
- [ ] İnternet kesilince çevrimdışı uyarısı; bağlantı gelince bildirimler ve rozet güncellenir.
- [ ] Bayi, şube, personel ve hasta sahibi hesaplarında yalnız yetkili verinin göründüğü.
- [ ] Hesap silme talebi ve merkez panelinden tamamlanması.
- [ ] Sürüm yönetimi: zorunlu güncellemede uygulamanın güncelleme ekranına yönlendirmesi.

## İndirme klasörü ve "Uygulama indir" sayfası

- Tüm kurulum dosyaları `public/indir/` klasöründe toplanır; kaynakları `apps/` altında da kalır. Klasörü güncellemek için: `php bin/build-downloads.php` (dosyaları kopyalar, klinik ajanı zip'ini üretir, `manifest.json` içine boyut ve SHA-256 yazar).
- Satış sitesinde sayfa: `/platform/uygulama-indir` (kısa adres `/indir`). Her dosya için QR kod, cihaza göre öneri ve SHA-256 değeri gösterilir.
- Google Play, App Store ve Mac bağlantıları **Merkez › Uygulama Yönetimi › Sürümler** bölümünde yayımlanan sürümün adresinden otomatik alınır; yayımlanana kadar bekleme metni görünür.
- Büyük kurulum dosyaları depoya girmez (`.gitignore`); kurulum paketine dahil edilir.

## Windows kurucusu (Linux'ta da üretilebilir)

`npm run dist:win-kurulum:linux` (Windows'ta `npm run dist:win-kurulum`): electron-builder ile uygulama klasörünü hazırlar, `build/brand-exe.mjs` simge ve sürüm bilgisini yazar, `build/installer.nsi` NSIS ile `VetZimo-Kurulum-<sürüm>.exe` üretir. Kullanıcı başına kurulum (yönetici izni gerekmez), Başlat menüsü ve masaüstü kısayolu, `vetzimo://` bağlantıları ve Program Ekle/Kaldır kaydı içerir. Kod imzalama sertifikası alınınca `signtool` ile imzalanmalıdır; imzasız kurucuda Windows SmartScreen uyarısı görülebilir.

## Android yayın imzası

Dağıtım anahtarı depo dışında tutulur (`apps/mobile/android/keystore.properties` ve `.jks` git'e girmez). Uygulama Yönetimi › Push sağlayıcıları bölümündeki "Android SHA-256" alanına bu anahtarın SHA-256 parmak izi girilmelidir (App Links doğrulaması için). Anahtar kaybolursa aynı paket adıyla güncelleme yayımlanamaz; yedeğini güvenli yerde saklayın.
