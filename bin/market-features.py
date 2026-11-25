#!/usr/bin/env python3
"""Satış sitesi: yeni özellik sayfalarını ve özellikler vitrinini üretir (statik market-pages dosyaları).
Çalıştırma: python3 bin/market-features.py  (public/market-pages altındaki sayfaları günceller; idempotent)."""
import hashlib, html, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'public', 'market-pages')
CSS = '<link rel="stylesheet" href="/market-showcase.css?v=3">'
key = lambda path: os.path.join(PAGES, hashlib.sha256(path.encode()).hexdigest() + '.html')
e = html.escape

ART = {
 'inbox': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Kanallardan gelen mesajlar tek gelen kutusunda toplanıyor">
  <circle cx="34" cy="38" r="14" class="ms-g"/><circle cx="34" cy="90" r="14" class="ms-c"/><circle cx="34" cy="142" r="14" class="ms-e"/><circle cx="74" cy="20" r="11" class="ms-b"/>
  <g><rect class="ms-flow ms-g" style="--dx:150px;--dy:40px" x="52" y="30" width="26" height="16" rx="8"/><rect class="ms-flow ms-c" style="--dx:150px;--dy:0px" x="52" y="82" width="26" height="16" rx="8"/>
  <rect class="ms-flow ms-e" style="--dx:150px;--dy:-40px" x="52" y="134" width="26" height="16" rx="8"/><rect class="ms-flow ms-b" style="--dx:130px;--dy:58px" x="88" y="14" width="22" height="14" rx="7"/></g>
  <rect x="196" y="28" width="104" height="124" rx="14" class="ms-soft"/><rect x="206" y="40" width="84" height="10" rx="5" class="ms-a"/>
  <g><rect class="ms-row ms-a" x="206" y="62" width="84" height="16" rx="6" opacity=".35"/><rect class="ms-row ms-a" x="206" y="86" width="84" height="16" rx="6" opacity=".35"/><rect class="ms-row ms-a" x="206" y="110" width="84" height="16" rx="6" opacity=".35"/></g>
 </svg>''',
 'phone': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Klinik telefonundan sırayla giden SMS ve WhatsApp mesajları">
  <rect x="58" y="24" width="70" height="132" rx="14" fill="#1f2a44"/><rect x="65" y="36" width="56" height="102" rx="6" class="ms-d"/><circle cx="93" cy="146" r="4" class="ms-d"/>
  <g transform="translate(93 86)"><circle class="ms-wave" r="46"/><circle class="ms-wave" r="46"/><circle class="ms-wave" r="46"/></g>
  <g><rect class="ms-send ms-a" x="170" y="40" width="110" height="26" rx="13"/><rect class="ms-send ms-g" x="170" y="78" width="96" height="26" rx="13"/><rect class="ms-send ms-a" x="170" y="116" width="120" height="26" rx="13"/></g>
  <path d="M74 52h38M74 64h28M74 76h34" class="ms-line" stroke-width="3"/>
 </svg>''',
 'sign': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Tablette KVKK onay formu imzalanıyor">
  <rect x="40" y="18" width="240" height="144" rx="16" class="ms-soft"/><rect x="58" y="34" width="120" height="10" rx="5" class="ms-a"/>
  <g><path class="ms-tick" d="M60 64l6 6 12-12"/><path class="ms-tick" d="M60 88l6 6 12-12"/><path class="ms-tick" d="M60 112l6 6 12-12"/></g>
  <path d="M90 66h110M90 90h90M90 114h120" class="ms-line" stroke-width="3" opacity=".35"/>
  <path class="ms-sign" d="M190 140c10-22 20-22 18-4s12-26 22-14 8 18 20 0 14 6 24-2"/><path d="M180 150h100" stroke="#9aa3b2" stroke-width="2"/>
 </svg>''',
 'edoc': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Satıştan e-Arşiv faturası otomatik düzenleniyor">
  <rect x="70" y="14" width="180" height="152" rx="12" class="ms-soft"/><rect x="88" y="30" width="80" height="12" rx="6" class="ms-a"/>
  <g><rect class="ms-fill ms-e" x="88" y="58" width="144" height="10" rx="5" opacity=".5"/><rect class="ms-fill ms-e" x="88" y="78" width="120" height="10" rx="5" opacity=".5"/>
  <rect class="ms-fill ms-e" x="88" y="98" width="136" height="10" rx="5" opacity=".5"/><rect class="ms-fill ms-a" x="168" y="122" width="64" height="14" rx="7"/></g>
  <g class="ms-stamp"><rect x="176" y="22" width="92" height="30" rx="6" fill="none" stroke="#1baf7a" stroke-width="3"/><text x="222" y="42" text-anchor="middle" font-size="12" font-weight="700" fill="#1baf7a">GIB2026…</text></g>
 </svg>''',
 'bridge': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Reçete ve aşı kaydı klinikten Bakanlık sistemine aktarılıyor">
  <rect x="26" y="60" width="86" height="80" rx="12" class="ms-soft"/><path d="M44 78h50M44 94h38M44 110h46" class="ms-line" stroke-width="4"/>
  <path d="M210 70l44-26 44 26z" class="ms-a"/><rect x="214" y="72" width="80" height="62" class="ms-soft"/><path d="M228 80v46M246 80v46M264 80v46M282 80v46" class="ms-line" stroke-width="5"/>
  <g><circle class="ms-move ms-g" style="--dx:96px" cx="120" cy="100" r="7"/><circle class="ms-move ms-g" style="--dx:96px;animation-delay:.9s" cx="120" cy="100" r="7"/><circle class="ms-move ms-g" style="--dx:96px;animation-delay:1.8s" cx="120" cy="100" r="7"/></g>
 </svg>''',
 'voice': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Sesle söylenen kilo ve ateş değerleri muayene formuna yazılıyor">
  <g class="ms-pulse"><circle cx="70" cy="90" r="34" class="ms-a"/><rect x="62" y="70" width="16" height="28" rx="8" class="ms-d"/><path d="M56 92a14 14 0 0 0 28 0M70 106v8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>
  <g transform="translate(120 70)"><rect class="ms-bar ms-b" x="0" y="0" width="7" height="40" rx="3"/><rect class="ms-bar ms-b" x="12" y="0" width="7" height="40" rx="3"/><rect class="ms-bar ms-b" x="24" y="0" width="7" height="40" rx="3"/><rect class="ms-bar ms-b" x="36" y="0" width="7" height="40" rx="3"/><rect class="ms-bar ms-b" x="48" y="0" width="7" height="40" rx="3"/></g>
  <rect x="190" y="30" width="110" height="120" rx="12" class="ms-soft"/>
  <text x="200" y="56" font-size="11" fill="#1f2a44">Kilo</text><text x="200" y="88" font-size="11" fill="#1f2a44">Ateş</text><text x="200" y="120" font-size="11" fill="#1f2a44">Semptom</text>
  <g><rect class="ms-type ms-a" x="246" y="46" width="44" height="14" rx="4" opacity=".7"/><rect class="ms-type ms-c" x="246" y="78" width="44" height="14" rx="4" opacity=".8"/><rect class="ms-type ms-g" x="246" y="110" width="44" height="14" rx="4" opacity=".8"/></g>
 </svg>''',
 'alerts': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Sağ üstte beliren klinik bildirimleri">
  <rect x="20" y="16" width="280" height="148" rx="14" class="ms-soft"/><rect x="20" y="16" width="280" height="26" rx="14" class="ms-a"/>
  <g><g class="ms-slide"><rect x="168" y="52" width="122" height="30" rx="8" fill="#fff" stroke="#dc2626" stroke-width="2"/><rect x="178" y="62" width="70" height="8" rx="4" fill="#dc2626"/></g>
  <g class="ms-slide"><rect x="168" y="90" width="122" height="30" rx="8" fill="#fff" stroke="#1baf7a" stroke-width="2"/><rect x="178" y="100" width="80" height="8" rx="4" fill="#1baf7a"/></g>
  <g class="ms-slide"><rect x="168" y="128" width="122" height="30" rx="8" fill="#fff" stroke="#2a78d6" stroke-width="2"/><rect x="178" y="138" width="60" height="8" rx="4" fill="#2a78d6"/></g></g>
  <path d="M40 66h100M40 86h80M40 106h96" class="ms-line" opacity=".25"/>
 </svg>''',
 'vebot': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="VeBot kiloya göre ilaç dozunu hesaplıyor">
  <g class="ms-float"><rect x="46" y="54" width="92" height="74" rx="22" class="ms-a"/><rect x="88" y="36" width="8" height="18" class="ms-a"/>
  <g class="ms-blink"><circle cx="74" cy="90" r="8" class="ms-d"/><circle cx="110" cy="90" r="8" class="ms-d"/></g><path d="M78 112h28" stroke="#fff" stroke-width="4" stroke-linecap="round"/></g>
  <rect x="164" y="34" width="134" height="112" rx="14" class="ms-soft"/><text x="176" y="58" font-size="11" fill="#1f2a44">4 kg kedi · meloksikam</text>
  <g><rect class="ms-row ms-b" x="176" y="70" width="110" height="12" rx="6"/><rect class="ms-row ms-g" x="176" y="92" width="86" height="12" rx="6"/><rect class="ms-row ms-c" x="176" y="114" width="98" height="12" rx="6"/></g>
 </svg>''',
 'devices': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Laboratuvar ve görüntüleme cihazlarından gelen sonuç hasta dosyasına ekleniyor">
  <rect x="22" y="44" width="92" height="96" rx="12" fill="#1f2a44"/><rect x="34" y="56" width="68" height="34" rx="6" class="ms-b"/><circle cx="46" cy="114" r="8" class="ms-g ms-pulse"/><rect x="62" y="108" width="40" height="12" rx="6" class="ms-d" opacity=".5"/>
  <path d="M42 80l10-10 10 8 12-14 14 10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <g><rect class="ms-move ms-c" style="--dx:96px" x="118" y="70" width="30" height="18" rx="6"/><rect class="ms-move ms-e" style="--dx:96px;animation-delay:.9s" x="118" y="96" width="30" height="18" rx="6"/><rect class="ms-move ms-g" style="--dx:96px;animation-delay:1.8s" x="118" y="83" width="30" height="18" rx="6"/></g>
  <rect x="214" y="26" width="90" height="128" rx="14" class="ms-soft"/><circle cx="240" cy="52" r="12" class="ms-a"/><rect x="258" y="46" width="36" height="10" rx="5" class="ms-a" opacity=".5"/>
  <g><path class="ms-tick" d="M226 86l6 6 12-12"/><path class="ms-tick" d="M226 112l6 6 12-12"/><path class="ms-tick" d="M226 138l6 6 12-12"/></g>
  <path d="M252 88h40M252 114h32M252 140h36" class="ms-line" stroke-width="3" opacity=".35"/>
 </svg>''',
 'route': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Evde hizmet aracı haritada ilerliyor, hasta sahibine varış süresi bildirimi gidiyor">
  <rect x="14" y="14" width="200" height="152" rx="14" class="ms-soft"/><path d="M14 70h200M90 14v152M14 124h200M160 14v152" stroke="#9aa3b2" stroke-width="1" opacity=".35"/>
  <path class="ms-route" d="M40 146C60 110 90 120 110 96s40-38 70-56"/><circle cx="40" cy="146" r="7" class="ms-a"/>
  <g class="ms-pulse"><path d="M180 22c-9 0-15 7-15 15 0 11 15 25 15 25s15-14 15-25c0-8-6-15-15-15z" class="ms-c"/><circle cx="180" cy="37" r="5" class="ms-d"/></g>
  <g class="ms-slide"><rect x="222" y="30" width="88" height="44" rx="10" fill="#fff" stroke="#1baf7a" stroke-width="2"/><text x="232" y="48" font-size="10" fill="#1f2a44">Yola çıktı</text><text x="232" y="64" font-size="12" font-weight="700" fill="#1baf7a">12 dk</text></g>
  <g class="ms-slide" style="animation-delay:1.2s"><rect x="222" y="86" width="88" height="40" rx="10" fill="#fff" stroke="#eb6834" stroke-width="2"/><text x="232" y="110" font-size="10" fill="#1f2a44">Yaklaşıyor</text></g>
  <g class="ms-blink"><text x="230" y="152" font-size="16" fill="#f5b301">★★★★★</text></g>
 </svg>''',
 'apps': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Telefon, tablet ve bilgisayarda VetZimo bildirimleri">
  <rect x="96" y="30" width="160" height="104" rx="10" fill="#1f2a44"/><rect x="104" y="38" width="144" height="86" rx="4" class="ms-d"/><path d="M80 140h192l-12 12H92z" fill="#1f2a44"/>
  <rect x="112" y="48" width="60" height="10" rx="5" class="ms-a"/><g><rect class="ms-row ms-b" x="112" y="68" width="124" height="10" rx="5" opacity=".5"/><rect class="ms-row ms-g" x="112" y="86" width="96" height="10" rx="5" opacity=".5"/><rect class="ms-row ms-e" x="112" y="104" width="110" height="10" rx="5" opacity=".5"/></g>
  <g class="ms-float"><rect x="24" y="62" width="58" height="98" rx="12" fill="#1f2a44"/><rect x="30" y="72" width="46" height="76" rx="5" class="ms-d"/><rect x="36" y="80" width="34" height="14" rx="4" class="ms-a"/></g>
  <g class="ms-float" style="animation-delay:.8s"><rect x="244" y="74" width="62" height="86" rx="10" fill="#1f2a44"/><rect x="250" y="82" width="50" height="70" rx="4" class="ms-d"/><rect x="256" y="90" width="38" height="10" rx="4" class="ms-b"/></g>
  <g class="ms-pulse"><circle cx="76" cy="66" r="10" fill="#dc2626"/><text x="76" y="70" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">3</text></g>
 </svg>''',
 'settings': '''<svg class="ms-art" viewBox="0 0 320 180" role="img" aria-label="Tüm ayarlar sekmeli tek ekranda">
  <rect x="26" y="20" width="268" height="140" rx="14" class="ms-soft"/>
  <g><rect class="ms-fill ms-a" x="40" y="34" width="52" height="16" rx="8"/><rect x="100" y="34" width="52" height="16" rx="8" class="ms-a" opacity=".2"/><rect x="160" y="34" width="52" height="16" rx="8" class="ms-a" opacity=".2"/><rect x="220" y="34" width="52" height="16" rx="8" class="ms-a" opacity=".2"/></g>
  <g><rect class="ms-row ms-b" x="40" y="68" width="150" height="12" rx="6" opacity=".45"/><rect class="ms-row ms-b" x="40" y="94" width="120" height="12" rx="6" opacity=".45"/><rect class="ms-row ms-b" x="40" y="120" width="140" height="12" rx="6" opacity=".45"/></g>
  <g><rect x="200" y="66" width="30" height="16" rx="8" class="ms-g"/><circle cx="222" cy="74" r="6" class="ms-d"/><rect x="200" y="92" width="30" height="16" rx="8" class="ms-g"/><circle cx="222" cy="100" r="6" class="ms-d"/></g>
  <g class="ms-spin" style="transform-origin:262px 120px"><circle cx="262" cy="120" r="16" fill="none" stroke="var(--brand-bg,#713fa9)" stroke-width="8" stroke-dasharray="6 5"/><circle cx="262" cy="120" r="7" class="ms-a"/></g>
 </svg>''',
}

FEATURES = [
 ('/platform/ozellikler/gelen-kutusu', 'inbox', 'İletişim', 'Çok kanallı gelen kutusu',
  'WhatsApp, Instagram, Facebook, Telegram, SMS, e-posta ve web formu mesajları tek ekranda. Kim yanıtladıysa adı ve imzasıyla görünür.',
  'Tüm mesajlar tek yerde', ['Her kanaldan gelen mesaj konuşma olarak düşer; hasta sahibi kartına bağlanır.', 'Yanıtlayan ekip üyesi konuşmayı üstlenir; başkasına atanmışsa devraldığı kayda geçer, mesajın sonuna adı eklenir.', 'Hızlı yanıtlar, notlar, etiketler ve okunmamış uyarıları sağ üstte bildirim olarak gelir.']),
 ('/platform/ozellikler/sms', 'phone', 'İletişim', 'Kendi hattınızdan SMS',
  'Hatırlatma, toplu mesaj ve yanıtlar kliniğinizin kendi telefon hattından gider. SMS paketi veya aracı firma gerekmez.',
  'Ücretli SMS paketine gerek yok', ['Klinik telefonuna kurulan VetZimo uygulaması mesajları kendi SIM kartınızdan gönderir; gelen SMS’ler gelen kutusuna düşer.', 'Başlangıç saati, gönderim süresi, günlük sınır ve mesaj arası saniye ayarıyla operatör engeline takılmadan sıralı gönderim.', 'Türkçe karakter sadeleştirme ile mesaj tek SMS’e sığar; aylık sınırı paketiniz belirler.']),
 ('/platform/ozellikler/whatsapp', 'phone', 'İletişim', 'Kendi numaranızdan WhatsApp',
  'Aşı ve randevu hatırlatmaları kliniğinizin kendi WhatsApp numarasından gider; gelen mesajlar gelen kutusunda toplanır.',
  'Meta onayı beklemeden', ['Klinik bilgisayarındaki ajan WhatsApp’ı bağlı cihaz olarak bir kez QR ile bağlar.', 'Mesajlar insan benzeri aralıklarla, belirlediğiniz saat penceresinde sırayla gönderilir.', 'İsterseniz SMS ve WhatsApp aynı anda gönderilir; yalnız izin veren hasta sahiplerine iletilir.']),
 ('/platform/ozellikler/kvkk-onay-formu', 'sign', 'Uyum', 'KVKK onay formu ve tablette imza',
  'Yeni hasta sahibine tek kullanımlık kısa bağlantı gider ya da formu klinikte tablette imzalar; izinler kartına kendiliğinden işlenir.',
  'İzinler kayıt altında', ['KVKK aydınlatma metni, gizlilik ve kullanım şartları ile SMS, WhatsApp, e-posta ve kampanya izinleri tek formda.', 'Hoş geldin SMS’ine kısa onay bağlantısı otomatik eklenir; silinemez.', 'İmzalı belge, imza görüntüsü, IP ve zaman damgasıyla saklanır; gönderimler yalnız izin verenlere yapılır.']),
 ('/platform/ozellikler/e-donusum', 'edoc', 'İşletme', 'e-Fatura, e-Arşiv ve e-SMM',
  'Geçmiş satışlardan tek tıkla e-Arşiv, e-Fatura ve serbest meslek makbuzu. API sözleşmesi gerekmez; kendi GİB, Uyumsoft veya Ödeal hesabınız kullanılır.',
  'API’siz e-belge', ['Ajan, ekranı bir kez öğrendikten sonra kliniğin kendi portal oturumunda belgeyi doldurur ve numarasını getirir.', 'KDV, iskonto ve stopaj satış toplamıyla kuruşu kuruşuna aynı hesaplanır.', 'Bağlantı koparsa işlem tekrar denenmez; çift fatura yerine “kontrol gerekli” uyarısı düşer.']),
 ('/platform/ozellikler/bakanlik-koprusu', 'bridge', 'Uyum', 'Bakanlık köprüsü',
  'e-Reçete ve aşı kayıtlarını Bakanlık sistemine kendi e-Devlet oturumunuzla, kayıtları yeniden yazmadan gönderin.',
  'Çift girişe son', ['İlaç ve aşılar Bakanlık listesindeki karşılıklarıyla bir kez eşleştirilir, sonra hatırlanır.', 'Mikroçip, parti numarası ve sahip bilgisi eksikse göndermeden önce uyarır.', 'Gönderim kuyruğu, belge numaraları ve sorunlu işler tek ekranda.']),
 ('/platform/ozellikler/sesli-komut', 'voice', 'Klinik', 'Bas Konuş · sesli komut ve dikte',
  '“Pamuk için yeni muayene aç, kilo 4, ateş 41,3, kusma öksürük” deyin; form açılır ve değerler doğru alanlara yazılır.',
  'Elleriniz serbest', ['Sesle sayfa açın, hasta ve hasta sahibini bulun; aynı adlı hastalar listelenir, seçtiğinizin dosyası açılır.', 'Kilo, ateş, nabız, solunum, semptom, bulgu, tanı, plan ve kontrol tarihi ilgili alanlara yazılır; “ıı, şey” gibi dolgu sözcükleri eklenmez.', 'Hızlı mod anlıktır; cihaz içi mod internetsiz çalışır. Ücretsiz ve sınırsız.']),
 ('/platform/ozellikler/akilli-bildirimler', 'alerts', 'Klinik', 'Akıllı bildirimler',
  'Yeni mesajlar, KVKK onayları, sorunlu e-belgeler ve telefon hattı uyarıları sağ üstte düşer; işi biten bildirim listeden kalkar.',
  'Kalabalık değil, öncelik', ['Önemli uyarılar kapatılana kadar kalır, diğerleri birkaç saniye sonra kaybolur.', 'Her ekip üyesi yalnız yetkili olduğu bildirimleri görür; “Tamamlandı” dediği kendi listesinden kalkar.', 'Okunan mesaj ve çözülen işler kendiliğinden düşer.']),
 ('/platform/ozellikler/vebot-asistan', 'vebot', 'Yapay zekâ', 'VeBot hekim asistanı',
  'İlaç dozu, aşı takvimi, normal değerler, zehirlenmeler ve ayırıcı tanı sorularını yanıtlar; hasta adını söyleyince kilo ve türü kayıttan alır.',
  'Ücretsiz ve internetsiz bilgi', ['60’tan fazla ilaçta köpek ve kedi doz aralıkları, türe özgü uyarılar ve ürün başına mL/tablet hesabı.', 'Çikolata ve ksilitol zehirlenme hesabı, sıvı ve enerji ihtiyacı, gebelik tarihi, KPR özeti.', 'Ciro, stok, randevu ve hasta özeti gibi klinik verisi soruları; veriler cihazdan çıkmaz.']),
 ('/platform/ozellikler/cihaz-entegrasyonu', 'devices', 'Klinik', 'Cihaz entegrasyonu',
  'Hemogram, biyokimya, kan gazı, idrar, röntgen, ultrason, MR ve BT sonuçları cihazdan doğrudan gelir; doğru hasta ve sahibiyle eşleşip muayeneye eklenir.',
  'Sonuç kendiliğinden dosyada', ['HL7, ASTM, CSV/XML ve DICOM desteklenir; klinik ajanı klasör, ağ (TCP), seri port veya DICOM C-STORE ile cihazı dinler.', 'Mikroçip, protokol numarası veya hasta ve sahip adıyla otomatik eşleşme; emin olunamayan sonuç tek tıkla doğru hastaya atanır.', 'Değerler tablo olarak muayeneye işlenir, görüntüler DICOM görüntüleyicide açılır, hekime “Tetkik sonucu hazır” bildirimi düşer.']),
 ('/platform/ozellikler/evde-hizmet-canli-rota', 'route', 'Evde hizmet', 'Canlı rota ve Google yorumu',
  'Personel yola çıkınca sıradaki hasta sahibine klinik adı, personel adı ve tahmini varış süresi gider; yaklaşınca yeniden haber verilir.',
  'Hasta sahibi kapıda beklemez', ['Yola çıktı, yaklaşıyor ve tamamlandı bildirimleri uygulama, SMS veya WhatsApp ile kliniğin kendi hattından gider.', 'Hasta sahibi canlı takip sayfasında personelin konumunu ve kalan süreyi görür; ziyaret bitince konum paylaşımı kendiliğinden kapanır.', 'Ziyaret sonrası isteğe bağlı Google yorum bağlantısı gönderilir; her bayi kendi Google işletme bağlantısını ekler.']),
 ('/platform/ozellikler/mobil-uygulamalar', 'apps', 'Uygulamalar', 'Android, iOS ve masaüstü uygulamalar',
  'VetZimo telefon, tablet, Windows, macOS ve Linux’ta uygulama olarak çalışır; randevu, sonuç, mesaj ve ödeme bildirimleri kilit ekranına gelir.',
  'Klinik cebinizde', ['Bayi, şube, personel ve hasta sahibi tek girişle kendi alanına düşer; bildirime dokununca ilgili kayıt açılır.', 'Rol bazlı akıllı bildirimler: herkes yalnız yetkili olduğu kaydı görür, sessiz saatler ve kategori tercihleri kişiye özeldir.', 'Bildirim merkezi, okundu/okunmadı, uygulama simgesinde rozet, parmak izi veya yüz tanıma ile kilit ve çevrimdışı uyarısı.']),
 ('/platform/ozellikler/ayarlar-merkezi', 'settings', 'Klinik', 'Tek yerden ayarlar',
  'Klinik, ekip, bildirim, cihaz, tema, iletişim ve entegrasyon ayarları aranabilir sekmelerle tek ekranda toplanır.',
  'Dağınıklığa son', ['Yedi sekme ve arama kutusu: aradığınız ayarı adını yazarak bulursunuz.', 'Bildirim tercihleri, bağlı cihazlar, tema, Bas Konuş ve Google yorum bağlantısı aynı yerden yönetilir.', 'Her ekip üyesi yalnız yetkili olduğu ayarları görür; değişiklikler kayıt altına alınır.']),
]

def template():
    with open(key('/platform/ozellikler/sms'), encoding='utf-8') as f: return f.read()

def detail(base, path, art, eyebrow, title, lead, h2, bullets):
    head, rest = base.split('<main', 1)
    main_end = rest.index('</main>')
    tail = rest[main_end + 7:]
    main_open = '<main' + rest[:rest.index('>') + 1]
    why = rest[rest.index('<h2 class="sub-title"'):rest.index('<section class="callout"')]
    head = re.sub(r'<title>[^<]*</title>', f'<title>{e(title)} · VetZimo</title>', head, count=1)
    head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{e(lead)}">', head, count=1)
    if 'market-showcase.css' not in head: head = head.replace('</head>', CSS + '</head>', 1)
    items = ''.join(f'<li>{e(b)}</li>' for b in bullets)
    body = (f'{main_open}<header class="intro"><div class="lp-mesh" aria-hidden="true"><i></i><i></i><i></i></div><span class="eyebrow">{e(eyebrow)}</span><h1>{e(title)}</h1><p>{e(lead)}</p></header>'
            f'<section class="feature-detail" data-edit-area="Özellik örneği"><div><span class="eyebrow">YENİ</span><h2>{e(h2)}</h2><ul class="ms-points">{items}</ul></div>'
            f'<figure class="feature-illustration"><figcaption>Hareketli örnek</figcaption>{ART[art]}</figure></section>{why}'
            f'<section class="callout" data-edit-area="Sayfa sonu çağrısı"><div><span class="eyebrow">{e(eyebrow)}</span><h2>Kendi kliniğinizde deneyin</h2></div><a href="/platform/demo" class="button primary">Demo talep edin</a></section></main>')
    return head + body + tail

def showcase():
    cards = ''.join(f'<a class="ms-card" href="{p}"><span class="ms-badge">YENİ · {e(eb)}</span>{ART[a]}<h3>{e(t)}</h3><p>{e(l)}</p></a>' for p, a, eb, t, l, *_ in FEATURES)
    return f'<section class="ms-section" data-ms-showcase><h2 class="sub-title">Yeni özellikler</h2><div class="ms-grid">{cards}</div></section>'

# ───────────────────────── Uygulama indir sayfası ─────────────────────────
DL_PATH = '/platform/uygulama-indir'
DL_ASSETS = '<link rel="stylesheet" href="/market-downloads.css?v=2"><script src="/market-downloads.js?v=1" type="module"></script>'
NAV_LINK = '<a href="/platform/uygulama-indir" class="" data-dl-nav>Uygulama indir</a>'
FOOT_LINK = '<a href="/platform/uygulama-indir" data-dl-nav>Uygulama indir</a>'

def manifest():
    try:
        import json
        with open(os.path.join(ROOT, 'public', 'indir', 'manifest.json'), encoding='utf-8') as f: return json.load(f).get('files', {})
    except (OSError, ValueError): return {}

def mb(n): return f'{n / 1048576:.1f} MB'.replace('.', ',') if n >= 1048576 else f'{max(1, round(n / 1024))} KB'

def dl_button(files, key, label, cls='button primary'):
    f = files.get(key)
    if not f: return ''
    meta = ' · '.join(x for x in [('v' + f['version']) if f.get('version') else '', mb(f['size'])] if x)
    return (f'<a class="{cls} dl-file" href="{e(f["url"])}" download data-dl-file="{e(key)}"><span>{e(label)}</span>'
            f'<small data-dl-meta>{e(meta)}</small></a>')

def dl_sum(files, keys):
    rows = ''.join(f'<li><span>{e(files[k]["file"])}</span><code>{e(files[k]["sha256"])}</code></li>' for k in keys if k in files)
    return f'<details class="dl-sum"><summary>SHA-256 doğrulama</summary><ul>{rows}</ul></details>' if rows else ''

def dl_card(key, icon, title, text, body, qr, files, sums=()):
    return (f'<article class="dl-card" data-dl-card="{key}"><span class="dl-rec" hidden>Bu cihaz için önerilen</span>'
            f'<div class="dl-top"><span class="dl-icon" aria-hidden="true">{icon}</span><div><h3>{e(title)}</h3><p>{e(text)}</p></div></div>'
            f'<div class="dl-body"><div class="dl-actions">{body}</div>'
            f'<figure class="dl-qr"><div data-dl-qr="{e(qr)}"></div><figcaption>Telefonla okutun</figcaption></figure></div>{dl_sum(files, sums)}</article>')

def downloads_main(main_open):
    f = manifest()
    store = lambda plat, label: f'<a class="button outline dl-store" data-dl-store="{plat}" href="#" hidden>{e(label)}</a>'
    cards = [
        dl_card('android', '🤖', 'Android telefon ve tablet', 'Android 7 ve üzeri. Bildirimler, konum ve kamera izinleri ilk kullanımda açıklamasıyla sorulur.',
                store('android', 'Google Play’den yükle') + dl_button(f, 'android', 'APK dosyasını indir') +
                '<p class="dl-note">APK’yı açarken telefon “bilinmeyen kaynak” izni isteyebilir; yalnız bu sayfadan indirdiğiniz dosyaya izin verin.</p>',
                f.get('android', {}).get('url', DL_PATH), f, ['android']),
        dl_card('ios', '📱', 'iPhone ve iPad', 'iOS 15 ve üzeri. App Store sürümü yayımlandığında bu düğme kendiliğinden açılır.',
                store('ios', 'App Store’dan yükle') +
                '<p class="dl-wait" data-dl-wait="ios">App Store onayı sürerken Safari’de web uygulamasını açıp Paylaş › Ana Ekrana Ekle ile uygulama gibi kullanabilirsiniz.</p><a class="button outline" data-dl-wait="ios" href="/app">Web uygulamasını aç</a>',
                '/app', f),
        dl_card('windows', '🪟', 'Windows bilgisayar', 'Windows 10 ve 11 (64 bit). Yönetici izni gerekmez; masaüstü ve Başlat menüsü kısayolu oluşturur.',
                dl_button(f, 'windows', 'Kurulum dosyasını indir (.exe)') + dl_button(f, 'windows-zip', 'Taşınabilir sürüm (.zip)', 'button outline'),
                f.get('windows', {}).get('url', DL_PATH), f, ['windows', 'windows-zip']),
        dl_card('macos', '💻', 'Mac bilgisayar', 'macOS 11 ve üzeri, Apple Silicon ve Intel. Mac sürümü yayımlandığında bu düğme kendiliğinden açılır.',
                store('macos', 'Mac için indir') + dl_button(f, 'macos', 'Mac kurulum dosyası (.dmg)') +
                '<p class="dl-wait" data-dl-wait="macos">Şimdilik web uygulamasını Safari veya Chrome’da açıp Dock’a ekleyerek kullanabilirsiniz.</p><a class="button outline" data-dl-wait="macos" href="/app">Web uygulamasını aç</a>',
                f.get('macos', {}).get('url', '/app'), f, ['macos']),
        dl_card('linux', '🐧', 'Linux bilgisayar', 'Ubuntu, Debian, Pardus ve diğer 64 bit dağıtımlar.',
                dl_button(f, 'linux-deb', 'Debian / Ubuntu / Pardus (.deb)') + dl_button(f, 'linux', 'Tüm dağıtımlar (AppImage)', 'button outline'),
                f.get('linux-deb', {}).get('url', DL_PATH), f, ['linux-deb', 'linux']),
        dl_card('web', '🌐', 'Web uygulaması', 'Kurulum gerektirmez; her tarayıcıda çalışır, ana ekrana eklenince uygulama gibi açılır ve bildirim alır.',
                '<a class="button primary" href="/app">Tarayıcıda aç</a>', '/app', f),
    ]
    tools = [
        dl_card('agent', '🖥', 'Klinik ajanı', 'Klinik bilgisayarına bir kez kurulur: laboratuvar ve görüntüleme cihazları, Bakanlık köprüsü, e-Fatura/e-Arşiv ve WhatsApp bağlantısı. Panelde verilen kodla eşleşir.',
                dl_button(f, 'agent', 'Klinik ajanını indir (.zip)'), f.get('agent', {}).get('url', DL_PATH), f, ['agent']),
        dl_card('phone', '📱', 'Telefon ajanı (SMS hattı)', 'SMS’lerin kliniğin kendi SIM kartından gitmesi için klinik telefonuna Termux ile kurulur. Kurulum komutu Ayarlar › Telefon Bağlantısı’ndadır.',
                dl_button(f, 'phone', 'Kurulum betiğini indir', 'button outline'), f.get('phone', {}).get('url', DL_PATH), f, ['phone']),
    ]
    return (f'{main_open}<header class="intro"><div class="lp-mesh" aria-hidden="true"><i></i><i></i><i></i></div><span class="eyebrow">Uygulamalar</span>'
            '<h1>VetZimo uygulamasını indirin</h1><p>Telefon, tablet ve bilgisayarınıza kurun; bildirimler kilit ekranına gelsin. Tüm indirmeler tek sayfada, her biri için QR kodla.</p></header>'
            '<section class="dl-hero" data-edit-area="Hızlı indirme"><div><span class="eyebrow">Tek QR</span><h2>Telefonunuzla okutun, doğru uygulama açılsın</h2>'
            '<p>Kamerayla okuttuğunuzda bu sayfa telefonunuzda açılır ve cihazınıza uygun indirme en üstte gösterilir.</p>'
            '<ul class="ms-points"><li>Bayi, şube, personel ve hasta sahibi aynı uygulamaya kendi hesabıyla girer.</li><li>Uygulamalar ücretsizdir; kullanım klinik paketinize dahildir.</li><li>Dosyalar VetZimo sunucusundan iner; SHA-256 değeriyle doğrulayabilirsiniz.</li></ul></div>'
            '<figure class="dl-qr big"><div data-dl-qr="/platform/uygulama-indir"></div><figcaption>vetzimo.com/indir</figcaption></figure></section>'
            f'<h2 class="sub-title">Cihazınızı seçin</h2><section class="dl-grid" data-edit-area="Uygulamalar">{"".join(cards)}</section>'
            f'<h2 class="sub-title">Klinik araçları</h2><section class="dl-grid tools" data-edit-area="Klinik araçları">{"".join(tools)}</section>'
            '<section class="callout" data-edit-area="Sayfa sonu çağrısı"><div><span class="eyebrow">Hesabınız yok mu?</span><h2>Ücretsiz demo ile başlayın</h2></div><a href="/platform/deneme" class="button primary">Ücretsiz Demo</a></section></main>')

def downloads_page(base):
    head, rest = base.split('<main', 1)
    tail = rest[rest.index('</main>') + 7:]
    main_open = '<main' + rest[:rest.index('>') + 1]
    head = re.sub(r'<title>[^<]*</title>', '<title>Uygulama indir · VetZimo</title>', head, count=1)
    head = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="VetZimo Android, iPhone, iPad, Windows, macOS ve Linux uygulamalarını QR kodla indirin.">', head, count=1)
    if 'market-downloads.css' not in head: head = head.replace('</head>', DL_ASSETS + '</head>', 1)
    return head + downloads_main(main_open) + tail

def dl_band():
    return ('<section class="ms-section dl-band wrap" data-dl-band><div><span class="eyebrow">YENİ · Uygulamalar</span><h2>Telefonunuza, tabletinize ve bilgisayarınıza kurun</h2>'
            '<p>Android, iPhone, iPad, Windows, macOS ve Linux. Randevu, sonuç ve mesaj bildirimleri kilit ekranına gelir.</p>'
            '<div class="dl-chips"><span>🤖 Android</span><span>📱 iOS</span><span>🪟 Windows</span><span>💻 macOS</span><span>🐧 Linux</span></div>'
            '<a class="button primary" href="/platform/uygulama-indir">Uygulamayı indir</a></div>'
            '<figure class="dl-qr"><div data-dl-qr="/platform/uygulama-indir"></div><figcaption>Telefonla okutun</figcaption></figure></section>')

def site_links():
    """Tüm satış sayfalarına menü ve alt menü bağlantısı; showcase css sürümü."""
    for name in os.listdir(PAGES):
        p = os.path.join(PAGES, name); t = open(p, encoding='utf-8').read(); o = t
        t = t.replace('market-showcase.css?v=1"', 'market-showcase.css?v=3"')
        if 'id="main-nav"' in t and 'data-dl-nav' not in t:
            t = re.sub(r'(<nav id="main-nav"[^>]*>.*?)(</nav>)', lambda m: m.group(1) + NAV_LINK + m.group(2), t, count=1, flags=re.S)
            t = re.sub(r'(<nav aria-label="Alt menü">.*?)(</nav>)', lambda m: m.group(1) + FOOT_LINK + m.group(2), t, count=1, flags=re.S)
        if t != o: open(p, 'w', encoding='utf-8').write(t)

def main():
    base = template()
    for path, art, eyebrow, title, lead, h2, bullets in FEATURES:
        with open(key(path), 'w', encoding='utf-8') as f: f.write(detail(base, path, art, eyebrow, title, lead, h2, bullets))
    # Özellikler sayfası: vitrin + eski kart metinleri
    fp = key('/platform/ozellikler')
    s = open(fp, encoding='utf-8').read()
    s = re.sub(r'<section class="ms-section" data-ms-showcase>.*?</section>', '', s, flags=re.S)
    s = s.replace('</header><div class="cards">', '</header>' + showcase() + '<h2 class="sub-title">Tüm modüller</h2><div class="cards">', 1)
    if 'market-showcase.css' not in s: s = s.replace('</head>', CSS + '</head>', 1)
    for path, art, eyebrow, title, lead, *_ in FEATURES:
        s = re.sub(r'(<a class="card" href="' + re.escape(path) + r'"[^>]*>)<span class="eyebrow">[^<]*</span><h3>[^<]*</h3><p>[^<]*</p>',
                   lambda m: m.group(1) + f'<span class="eyebrow">{e(eyebrow)}</span><h3>{e(title)}</h3><p>{e(lead)}</p>', s)
    open(fp, 'w', encoding='utf-8').write(s)
    # Ana sayfa vitrini
    hp = key('/platform')
    if os.path.exists(hp):
        h = open(hp, encoding='utf-8').read()
        h = re.sub(r'<section class="ms-section" data-ms-showcase>.*?</section>', '', h, flags=re.S)
        if 'market-showcase.css' not in h: h = h.replace('</head>', CSS + '</head>', 1)
        marker = '<section class="lp-block" data-edit-area="Cihazlar ve temalar">'
        if marker in h: h = h.replace(marker, showcase().replace('<section class="ms-section"', '<section class="ms-section ms-home wrap"') + marker, 1)
        h = re.sub(r'<section class="ms-section dl-band wrap" data-dl-band>.*?</section>', '', h, flags=re.S)
        if marker in h: h = h.replace(marker, dl_band() + marker, 1)
        if 'market-downloads.css' not in h: h = h.replace('</head>', DL_ASSETS + '</head>', 1)
        open(hp, 'w', encoding='utf-8').write(h)
    with open(key(DL_PATH), 'w', encoding='utf-8') as f: f.write(downloads_page(base))
    site_links()
    # Tüm sayfalardaki eski kart metinleri (entegrasyonlar vb.) ve kaldırılan temaya bağlı statik varsayılan
    for name in os.listdir(PAGES):
        p = os.path.join(PAGES, name); t = open(p, encoding='utf-8').read(); o = t
        for path, art, eyebrow, title, lead, *_ in FEATURES:
            t = re.sub(r'(<a class="card" href="' + re.escape(path) + r'"[^>]*>)<span class="eyebrow">[^<]*</span><h3>[^<]*</h3><p>[^<]*</p>',
                       lambda m: m.group(1) + f'<span class="eyebrow">{e(eyebrow)}</span><h3>{e(title)}</h3><p>{e(lead)}</p>', t)
        if t != o: open(p, 'w', encoding='utf-8').write(t)
        if 'data-theme="classic"' in t: open(p, 'w', encoding='utf-8').write(t.replace('data-theme="classic"', 'data-theme="prizma"'))
    print('Yeni/güncel sayfa:', len(FEATURES))

main()
