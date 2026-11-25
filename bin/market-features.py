#!/usr/bin/env python3
"""Satış sitesi: yeni özellik sayfalarını ve özellikler vitrinini üretir (statik market-pages dosyaları).
Çalıştırma: python3 bin/market-features.py  (public/market-pages altındaki sayfaları günceller; idempotent)."""
import hashlib, html, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'public', 'market-pages')
CSS = '<link rel="stylesheet" href="/market-showcase.css?v=1">'
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
        open(hp, 'w', encoding='utf-8').write(h)
    # Tüm sayfalardaki eski kart metinleri (entegrasyonlar vb.) ve kaldırılan temaya bağlı statik varsayılan
    for name in os.listdir(PAGES):
        p = os.path.join(PAGES, name); t = open(p, encoding='utf-8').read(); o = t
        for path, art, eyebrow, title, lead, *_ in FEATURES:
            t = re.sub(r'(<a class="card" href="' + re.escape(path) + r'"[^>]*>)<span class="eyebrow">[^<]*</span><h3>[^<]*</h3><p>[^<]*</p>',
                       lambda m: m.group(1) + f'<span class="eyebrow">{e(eyebrow)}</span><h3>{e(title)}</h3><p>{e(lead)}</p>', t)
        if t != o: open(p, 'w', encoding='utf-8').write(t)
        if 'data-theme="classic"' in t: open(p, 'w', encoding='utf-8').write(t.replace('data-theme="classic"', 'data-theme="orchid"'))
    print('Yeni/güncel sayfa:', len(FEATURES))

main()
