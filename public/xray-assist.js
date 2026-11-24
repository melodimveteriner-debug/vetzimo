// Röntgen değerlendirme asistanı (ücretsiz, tamamen cihazda çalışır).
// - Otomatik görüntü kalitesi analizi (pozlama, kontrast, keskinlik) ve görüntü iyileştirme
// - Kalibreli ölçüm, VHS / VLAS kalp ölçümü, ince bağırsak / L5 oranı
// - Bölgeye göre sistematik değerlendirme ve kurallara dayalı ayırıcı tanı, acil uyarıları
// - Hazır rapor metni
// Görüntü hiçbir yere gönderilmez. Bu bir karar destek aracıdır; tanı ve sorumluluk hekime aittir.

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}

// ---------------- Görüntü analizi ----------------
export function analyse(pixels, width, height) {
  const n = width * height, hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = pixels[i]; hist[v]++; sum += v; }
  const pct = p => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  const mean = sum / n, p1 = pct(0.01), p50 = pct(0.5), p99 = pct(0.99);
  const clippedHigh = (hist[255] + hist[254]) / n, clippedLow = (hist[0] + hist[1]) / n;
  // Keskinlik: Laplace varyansı (orta bölge, kenar yakını hariç).
  let lsum = 0, lsq = 0, count = 0;
  for (let y = 2; y < height - 2; y += 2) for (let x = 2; x < width - 2; x += 2) {
    const i = y * width + x;
    const lap = 4 * pixels[i] - pixels[i - 1] - pixels[i + 1] - pixels[i - width] - pixels[i + width];
    lsum += lap; lsq += lap * lap; count++;
  }
  const lapVar = count ? lsq / count - (lsum / count) ** 2 : 0;
  // Kenar kuşağı (kolimasyon/arka plan) ortalaması ile merkez karşılaştırması: ters (negatif) görüntü ipucu.
  let edge = 0, edgeN = 0, center = 0, centerN = 0;
  for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
    const v = pixels[y * width + x], border = x < width * 0.06 || x > width * 0.94 || y < height * 0.06 || y > height * 0.94;
    if (border) { edge += v; edgeN++; } else if (x > width * 0.3 && x < width * 0.7 && y > height * 0.3 && y < height * 0.7) { center += v; centerN++; }
  }
  const findings = [];
  let score = 100;
  const add = (tone, text, cost) => { findings.push({tone, text}); score -= cost; };
  if (mean < 60 && p99 < 170) add("warn", "Görüntü koyu: az pozlanmış olabilir (kV/mAs artırılabilir). Ayrıntı kaybı ve yanlış 'artmış opasite' yorumu riski.", 25);
  else if (mean > 190 || clippedHigh > 0.12) add("warn", "Görüntü açık / yanmış alanlar var: aşırı pozlanmış olabilir. İnce dokular (akciğer damarları, yumuşak doku) kaybolabilir.", 25);
  if (p99 - p1 < 90) add("warn", "Kontrast düşük: dinamik aralık dar. 'Yerel kontrast' ya da pencere ayarı ile inceleyin.", 15);
  if (clippedLow > 0.25) add("info", "Görüntünün büyük bölümü siyah: kolimasyon geniş ya da hasta küçük. Bölgeyi kırparak inceleyin.", 5);
  const sharpness = lapVar / Math.max(1, mean);
  if (sharpness < 0.6) add("warn", "Görüntü flu olabilir (hareket ya da odak). Solunum sonu çekim veya tekrar çekim düşünün.", 20);
  if (edgeN && centerN && edge / edgeN > center / centerN + 60) add("info", "Kenarlar merkezden çok daha açık: görüntü ters (negatif) olabilir; 'Ters çevir' ile kontrol edin.", 5);
  if (!findings.length) findings.push({tone: "ok", text: "Pozlama, kontrast ve keskinlik kabul edilebilir görünüyor."});
  return {mean: Math.round(mean), p1, p50, p99, sharpness: Math.round(sharpness * 100) / 100, score: Math.max(0, score), findings};
}

// Basit yerel kontrast iyileştirme (bölgesel histogram eşitleme + harmanlama).
function localContrast(src, width, height, strength = 0.7) {
  const tiles = 8, tw = Math.ceil(width / tiles), th = Math.ceil(height / tiles), maps = [];
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    const hist = new Float32Array(256);
    let n = 0;
    for (let y = ty * th; y < Math.min(height, (ty + 1) * th); y++) for (let x = tx * tw; x < Math.min(width, (tx + 1) * tw); x++) { hist[src[y * width + x]]++; n++; }
    const clip = Math.max(1, n / 256 * 3);
    let excess = 0;
    for (let v = 0; v < 256; v++) if (hist[v] > clip) { excess += hist[v] - clip; hist[v] = clip; }
    const lut = new Uint8Array(256);
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v] + excess / 256; lut[v] = Math.min(255, Math.round(acc / Math.max(1, n) * 255)); }
    maps.push(lut);
  }
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(tiles - 1.001, Math.max(0, y / th - 0.5)), y0 = Math.floor(fy), wy = fy - y0, y1 = Math.min(tiles - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const fx = Math.min(tiles - 1.001, Math.max(0, x / tw - 0.5)), x0 = Math.floor(fx), wx = fx - x0, x1 = Math.min(tiles - 1, x0 + 1);
      const v = src[y * width + x];
      const a = maps[y0 * tiles + x0][v] * (1 - wx) + maps[y0 * tiles + x1][v] * wx, b = maps[y1 * tiles + x0][v] * (1 - wx) + maps[y1 * tiles + x1][v] * wx;
      out[y * width + x] = v * (1 - strength) + (a * (1 - wy) + b * wy) * strength;
    }
  }
  return out;
}

// ---------------- Bilgi tabanı ----------------
export const REGIONS = {
  thorax: {label: "Toraks", groups: [
    ["Teknik", [["inspFail", "Yetersiz inspirasyon"], ["rotated", "Rotasyon var"], ["oneView", "Tek yön çekim (en az iki yön önerilir)"]]],
    ["Kalp", [["cardiomegaly", "Kardiyomegali (genel büyüme)"], ["leftAtrium", "Sol atriyum büyümesi (kaudodorsal bel kaybı)"], ["rightHeart", "Sağ kalp büyümesi (ters D görünümü)"], ["globoid", "Globoid (yuvarlak) kalp silueti"], ["microcardia", "Küçük kalp (mikrokardi)"]]],
    ["Damarlar", [["venousCongestion", "Pulmoner venöz konjesyon (venler arterden geniş)"], ["arterialEnlargement", "Pulmoner arter genişlemesi / kıvrımlanma"]]],
    ["Akciğer", [["bronchial", "Bronşiyal patern (halka ve tren rayı)"], ["unstructuredInterstitial", "Yapısız interstisyel patern"], ["nodular", "Nodüler interstisyel patern / nodüller"], ["alveolarCranioventral", "Alveolar patern · kranioventral"], ["alveolarCaudodorsal", "Alveolar patern · perihiler / kaudodorsal"], ["alveolarLobar", "Alveolar patern · tek lob / fokal"]]],
    ["Plevra ve mediasten", [["effusion", "Plevral efüzyon (fissür çizgileri, yuvarlak lob kenarları)"], ["pneumothorax", "Pnömotoraks (kalp sternumdan ayrık)"], ["megaesophagus", "Megaözofagus"], ["mediastinalMass", "Kranial mediastinal kitle"], ["pneumomediastinum", "Pnömomediasten"]]],
    ["Diyafram ve göğüs duvarı", [["hernia", "Diyafram hernisi şüphesi (sınır kaybı, toraksta bağırsak)"], ["ribFracture", "Kot kırığı"]]],
  ]},
  abdomen: {label: "Abdomen", groups: [
    ["Genel", [["serosalLoss", "Serozal detay azalmış"], ["pneumoperitoneum", "Serbest gaz (pnömoperitoneum)"]]],
    ["Mide", [["gastricDilation", "Mide gaz distansiyonu"], ["gdv", "GDV bulguları (kompartmantasyon / pilor dorsokranialde)"], ["gastricForeign", "Midede radyoopak yabancı cisim"]]],
    ["İnce bağırsak", [["siDilation", "Segmental dilatasyon (SI/L5 > 1,6)"], ["twoPopulations", "İki farklı çapta bağırsak popülasyonu"], ["plication", "Plikasyon / gaz kabarcıkları (lineer yabancı cisim)"], ["siForeign", "İnce bağırsakta radyoopak yabancı cisim"]]],
    ["Kolon", [["constipation", "Konstipasyon"], ["megacolon", "Megakolon"]]],
    ["Organlar", [["hepatomegaly", "Hepatomegali"], ["microhepatia", "Mikrohepati"], ["splenomegaly", "Splenomegali / dalak kitlesi"], ["renalLarge", "Böbrek büyük"], ["renalSmall", "Böbrek küçük / düzensiz"], ["nephrolith", "Nefrolit / üreterolit"]]],
    ["Ürogenital", [["cystolith", "Mesanede radyoopak taş"], ["urethrolith", "Üretrada taş"], ["bladderDistended", "Mesane aşırı dolu"], ["uterus", "Tübüler uterus genişlemesi"], ["pregnancy", "Fetal iskelet (gebelik)"], ["prostatomegaly", "Prostatomegali"]]],
  ]},
  msk: {label: "Kas-iskelet", groups: [
    ["Kemik", [["fracture", "Kırık"], ["aggressive", "Agresif kemik lezyonu (periost reaksiyonu, kortikal yıkım)"], ["boneCyst", "Kistik / iyi sınırlı lizis"], ["panosteitis", "Medüller opasite artışı (genç büyük ırk)"]]],
    ["Eklem", [["luxation", "Çıkık"], ["djd", "Dejeneratif eklem hastalığı (osteofit)"], ["hipDysplasia", "Kalça displazisi şüphesi (subluksasyon, sığ asetabulum)"], ["jointEffusion", "Eklem efüzyonu"], ["ocd", "Subkondral defekt (OKD şüphesi)"]]],
    ["Omurga", [["discNarrowing", "Disk mesafesi daralması / mineralize disk"], ["spondylosis", "Spondiloz"], ["discospondylitis", "Diskospondilit (son plak erozyonu)"], ["vertebralFracture", "Vertebra kırığı / luksasyonu"]]],
  ]},
  dental: {label: "Diş ve kafa", groups: [
    ["Diş", [["periapical", "Periapikal lüsensi"], ["boneLoss", "Alveol kemik kaybı"], ["resorption", "Diş rezorpsiyonu"], ["retainedRoot", "Kalıntı kök"], ["unerupted", "Sürmemiş diş"]]],
    ["Kafa", [["nasalLysis", "Nazal turbinat yıkımı / opasite"], ["bullaDisease", "Timpanik bulla opasitesi / kalınlaşma"], ["mandibleFracture", "Mandibula kırığı"]]],
  ]},
};

const RULES = [
  // [koşul, ayırıcı tanılar, öneri, acil mi]
  [f => f.pneumothorax, "Pnömotoraks: travmatik veya spontan (bül rüptürü).", "Solunum güçlüğü varsa hemen torasentez; oksijen desteği.", true],
  [f => f.effusion, "Plevral efüzyon: konjestif kalp yetmezliği (özellikle kedi), piyotoraks, şilotoraks, neoplazi, FİP, hemotoraks.", "Torasentez (tanı + tedavi), sıvı analizi ve sitoloji; ekokardiyografi.", f => f.dyspnea],
  [f => (f.alveolarCaudodorsal || f.venousCongestion) && (f.vhsHigh || f.leftAtrium || f.vlasHigh), "Kardiyojenik pulmoner ödem (sol taraflı konjestif kalp yetmezliği) — kalp büyümesi ile birlikte perihiler/kaudodorsal alveolar patern.", "Oksijen, diüretik değerlendirmesi; stabil olunca ekokardiyografi, NT-proBNP.", true],
  [f => f.alveolarCaudodorsal && !f.vhsHigh && !f.leftAtrium, "Nonkardiyojenik pulmoner ödem: elektrik çarpması, nöbet sonrası, üst solunum yolu tıkanıklığı, ARDS.", "Öykü sorgulama; destek tedavisi ve takip grafisi.", false],
  [f => f.alveolarCranioventral, "Aspirasyon pnömonisi veya bakteriyel bronkopnömoni.", "Ateş/lökogram değerlendirmesi, mümkünse trakeal yıkama kültürü; megaözofagus ve kusma öyküsü araştırılmalı.", false],
  [f => f.alveolarLobar, "Tek lob tutulumu: lob torsiyonu, pulmoner kontüzyon, neoplazi, fokal pnömoni, yabancı cisim (ot kılçığı).", "Travma öyküsü; gerekirse BT ve bronkoskopi.", false],
  [f => f.bronchial, "Bronşiyal patern: kronik bronşit, felin astım/alerjik bronşit, bronkopnömoni, eozinofilik bronkopnömopati, akciğer parazitleri.", "Dışkı Baermann testi, BAL sitolojisi; kedide astım için tedavi denemesi.", false],
  [f => f.nodular, "Nodüler patern: metastatik neoplazi, primer akciğer tümörü, fungal granülom, parazitik nodül.", "Üç yönlü toraks grafisi (sağ + sol lateral + VD); primer tümör taraması, ince iğne aspirasyonu/BT.", false],
  [f => f.unstructuredInterstitial, "Yapısız interstisyel patern: yaşa bağlı değişim, erken ödem veya pnömoni, lenfoma, pulmoner fibrozis — yetersiz inspirasyonla da benzer görünür.", "İnspirasyon ve pozlamayı kontrol edin; klinik bulgularla birlikte değerlendirip takip grafisi.", false],
  [f => f.vhsHigh && f.species === "dog", "Kardiyomegali (köpek): miksomatöz mitral kapak hastalığı, dilate kardiyomiyopati, perikardiyal efüzyon, konjenital hastalıklar.", "Ekokardiyografi, kan basıncı; irk referansına göre değerlendirin.", false],
  [f => f.vhsHigh && f.species === "cat", "Kardiyomegali (kedi): hipertrofik ya da diğer kardiyomiyopatiler, hipertiroidizm, sistemik hipertansiyon.", "Ekokardiyografi, NT-proBNP, T4 ve kan basıncı.", false],
  [f => f.globoid, "Globoid kalp silueti: perikardiyal efüzyon, peritoneoperikardiyal diyafragmatik herni, dilate kardiyomiyopati.", "Acil ekokardiyografi; tamponad bulgusu varsa perikardiyosentez.", f => f.dyspnea],
  [f => f.rightHeart || f.arterialEnlargement, "Sağ kalp yüklenmesi: kalp kurdu (Dirofilaria), pulmoner hipertansiyon, pulmonik stenoz.", "Kalp kurdu antijen testi, ekokardiyografi.", false],
  [f => f.microcardia, "Mikrokardi: hipovolemi, dehidrasyon, şok, hipoadrenokortisizm.", "Perfüzyon değerlendirmesi, elektrolitler (Na/K), ACTH stimülasyon testi.", true],
  [f => f.megaesophagus, "Megaözofagus: idiyopatik, miyastenia gravis, hipoadrenokortisizm, hipotiroidizm, vasküler halka anomalisi (genç).", "Aspirasyon pnömonisini kontrol edin; AChR antikor, ACTH testi; dik pozisyonda besleme.", false],
  [f => f.mediastinalMass, "Kranial mediastinal kitle: lenfoma, timoma, ektopik tiroid.", "Sitoloji/ince iğne aspirasyonu, hiperkalsemi kontrolü, BT.", false],
  [f => f.hernia, "Diyafram hernisi (travmatik ya da konjenital PPDH).", "Kontrastlı çekim veya ultrason; stabilizasyon sonrası cerrahi.", f => f.dyspnea],
  [f => f.gdv, "Mide dilatasyonu-volvulusu (GDV).", "ACİL: stabilizasyon, mide dekompresyonu ve cerrahi (gastropeksi).", true],
  [f => f.pneumoperitoneum, "Pnömoperitoneum: gastrointestinal perforasyon (yakın zamanda cerrahi yoksa).", "ACİL cerrahi değerlendirme; abdominosentez ve sıvı analizi.", true],
  [f => f.twoPopulations || f.siDilation, "Mekanik ince bağırsak obstrüksiyonu (yabancı cisim, invajinasyon, neoplazi) — fonksiyonel ileus ayırıcı tanıda.", "Ultrason; seri grafi; obstrüksiyon doğrulanırsa cerrahi.", f => f.twoPopulations || f.siRatioHigh],
  [f => f.plication, "Lineer yabancı cisim (ip, misina) — dil altını kontrol edin.", "Cerrahi değerlendirme; perforasyon riski.", true],
  [f => f.gastricForeign || f.siForeign, "Radyoopak yabancı cisim.", "Lokalizasyon ve obstrüksiyon bulgularına göre endoskopi veya cerrahi.", f => f.siForeign],
  [f => f.serosalLoss && !f.pneumoperitoneum, "Serozal detay kaybı: peritoneal efüzyon (asit, kan, idrar, septik peritonit), karsinomatoz; zayıf ya da genç hayvanda normal olabilir.", "Ultrason ve abdominosentez.", false],
  [f => f.uterus, "Tübüler uterus genişlemesi: piyometra (kızgınlık sonrası), mukometra, erken gebelik.", "Ultrason; piyometra ise acil cerrahi değerlendirme.", true],
  [f => f.cystolith || f.urethrolith || f.nephrolith, "Ürolitiyazis (radyoopak: struvit, kalsiyum oksalat).", "İdrar analizi ve kültür; üretral obstrüksiyon varsa acil müdahale.", f => f.urethrolith],
  [f => f.bladderDistended, "Mesane distansiyonu: üretral obstrüksiyon (özellikle erkek kedi), nörojenik mesane.", "Sondalama yapılabiliyor mu kontrol edin; potasyum ölçün.", f => f.species === "cat"],
  [f => f.hepatomegaly, "Hepatomegali: steroid hepatopatisi/Cushing, lipidoz (kedi), sağ kalp yetmezliği, infiltratif neoplazi (lenfoma).", "Karaciğer enzimleri, ultrason.", false],
  [f => f.microhepatia, "Mikrohepati: portosistemik şant (genç), siroz.", "Safra asitleri, amonyak, ultrason.", false],
  [f => f.splenomegaly, "Splenomegali / dalak kitlesi: hemanjiyosarkom, hematom, nodüler hiperplazi, lenfoma, sedasyon etkisi.", "Ultrason; kitle varsa abdominal efüzyon ve toraks metastaz taraması.", false],
  [f => f.renalSmall, "Küçük/düzensiz böbrek: kronik böbrek hastalığı.", "Kreatinin, SDMA, idrar dansitesi, kan basıncı.", false],
  [f => f.renalLarge, "Böbrek büyümesi: hidronefroz, lenfoma, FİP, polikistik böbrek, akut böbrek hasarı.", "Ultrason, idrar analizi.", false],
  [f => f.megacolon || f.constipation, "Konstipasyon / megakolon: dehidrasyon, pelvis kanalı daralması, idiyopatik megakolon (kedi), yabancı madde.", "Rehidrasyon, lavman; pelvik kırık öyküsü araştırın.", false],
  [f => f.prostatomegaly, "Prostatomegali: benign hiperplazi, prostatit, apse, kist, neoplazi (kastre köpekte neoplazi öncelikli).", "Rektal palpasyon, ultrason, idrar kültürü.", false],
  [f => f.fracture, "Kırık.", "İki dik yön çekim; kırık sınıflaması ve ortopedik planlama; ağrı yönetimi.", false],
  [f => f.aggressive, "Agresif kemik lezyonu: primer kemik tümörü (osteosarkom), metastaz, bakteriyel/fungal osteomiyelit.", "Toraks metastaz taraması (üç yön), biyopsi.", false],
  [f => f.panosteitis, "Panosteit (genç büyük ırk köpek).", "Ağrı yönetimi; kendini sınırlayan hastalık.", false],
  [f => f.luxation, "Eklem çıkığı.", "Kapalı/açık redüksiyon planlaması; eşlik eden kırıkları dışlayın.", false],
  [f => f.hipDysplasia, "Kalça displazisi şüphesi.", "Standart pozisyonda (sedasyonla) VD kalça grafisi ve Norberg açısı ölçümü.", false],
  [f => f.djd || f.jointEffusion || f.ocd, "Eklem hastalığı: osteoartrit, OKD, çapraz bağ yırtığı (diz efüzyonu), immün aracılı poliartrit.", "Ortopedik muayene, gerekirse artrosentez.", false],
  [f => f.discNarrowing, "İntervertebral disk hastalığı şüphesi (radyografi tek başına kesin değildir).", "Nörolojik muayene; cerrahi düşünülüyorsa MR/BT.", f => f.neuro],
  [f => f.discospondylitis, "Diskospondilit.", "Kan ve idrar kültürü, Brucella canis testi.", false],
  [f => f.vertebralFracture, "Vertebra kırığı / luksasyonu.", "ACİL: hareketsizleştirme ve nörolojik değerlendirme, BT.", true],
  [f => f.spondylosis, "Spondiloz deformans — çoğunlukla klinik önemi düşüktür.", "Ağrı kaynağı olarak diğer nedenleri dışlayın.", false],
  [f => f.periapical || f.boneLoss || f.resorption || f.retainedRoot, "Diş hastalığı: periodontal hastalık, kök apsesi, diş rezorpsiyonu (kedi), kalıntı kök.", "Diş tedavi planı; etkilenen dişlerin çekimi/tedavisi.", false],
  [f => f.nasalLysis, "Nazal turbinat yıkımı: nazal neoplazi, aspergilloz, yabancı cisim.", "BT ve rinoskopi, biyopsi.", false],
  [f => f.bullaDisease, "Orta kulak hastalığı (otitis media) / nazofaringeal polip (kedi).", "Otoskopi, BT; gerekirse bulla osteotomisi.", false],
  [f => f.mandibleFracture, "Mandibula kırığı.", "Diş ve oklüzyon değerlendirmesi; fiksasyon planlaması.", false],
  [f => f.inspFail, "Yetersiz inspirasyon akciğer opasitesini artırır; interstisyel patern yanlış yorumlanabilir.", "Tepe inspirasyonda tekrar çekim önerilir.", false],
];

// VHS referansları (Buchanan 1995 ve sonraki ırk çalışmaları; yaklaşık üst sınırlar).
export const VHS_REF = {
  dog: {normal: [8.7, 10.7], label: "Köpek 8,7–10,7 v (ırka göre değişir: Boxer ≤ 11,6, Labrador ≤ 10,8, CKCS ≤ 10,6, Yorkshire ≤ 9,7, Pug ≤ 10,7)"},
  cat: {normal: [6.7, 8.1], label: "Kedi 6,7–8,1 v"},
};
export function vhsInterpret(value, species) {
  const ref = VHS_REF[species === "cat" ? "cat" : "dog"];
  if (value > ref.normal[1]) return {tone: "high", text: "Artmış (kardiyomegali lehine)"};
  if (value < ref.normal[0]) return {tone: "low", text: "Düşük (mikrokardi / hipovolemi değerlendirin)"};
  return {tone: "ok", text: "Referans aralığında"};
}

export function interpret(findings) {
  const out = [];
  for (const [when, diff, advice, urgent] of RULES) {
    if (!when(findings)) continue;
    out.push({diff, advice, urgent: typeof urgent === "function" ? !!urgent(findings) : urgent});
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

// ---------------- Arayüz ----------------
export function openXrayAssist({src, species = "", patient = "", pixelSpacing = 0, sourceColumns = 0, onReport, tr = s => s}) {
  const kind = /kedi|cat/i.test(species) ? "cat" : /köpek|dog/i.test(species) ? "dog" : "dog";
  const dialog = el("dialog", "", {className: "xr-dialog"});
  const state = {brightness: 0, contrast: 0, invert: false, enhance: false, sharpen: false, zoom: 1, panX: 0, panY: 0, tool: null, points: [], measures: [], vhs: {}, mmPerPx: 0, region: "thorax", checked: new Set(), dyspnea: false, neuro: false, notes: ""};
  const canvas = el("canvas", "", {className: "xr-canvas"});
  const ctx = canvas.getContext("2d");
  let base = null, gray = null, enhanced = null, W = 0, H = 0, quality = null;

  const head = el("header", "", {className: "xr-head"});
  const title = el("div");
  title.append(el("h2", tr("Röntgen değerlendirme asistanı")), el("p", [patient, tr(kind === "cat" ? "Kedi" : "Köpek")].filter(Boolean).join(" · ") + " — " + tr("Karar desteğidir; tanı ve sorumluluk hekime aittir."), {className: "xr-muted"}));
  const close = el("button", tr("Kapat"), {type: "button", className: "button"});
  close.addEventListener("click", () => dialog.close());
  head.append(title, close);

  const tools = el("div", "", {className: "xr-tools"});
  const range = (label, key, min, max) => {
    const l = el("label"); const i = el("input", "", {type: "range", min, max, value: state[key]});
    i.addEventListener("input", () => { state[key] = Number(i.value); draw(); });
    l.append(el("span", tr(label)), i); return l;
  };
  const toggle = (label, key) => {
    const b = el("button", tr(label), {type: "button", className: "button small"});
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => { state[key] = !state[key]; b.setAttribute("aria-pressed", String(state[key])); if (key === "enhance" && state.enhance && !enhanced) enhanced = localContrast(gray, W, H); render(); });
    return b;
  };
  const toolBtn = (label, key, hint) => {
    const b = el("button", tr(label), {type: "button", className: "button small"});
    b.dataset.tool = key;
    b.addEventListener("click", () => { state.tool = state.tool === key ? null : key; state.points = []; status.textContent = state.tool ? tr(hint) : ""; tools.querySelectorAll("[data-tool]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.tool === state.tool))); draw(); });
    return b;
  };
  const reset = el("button", tr("Sıfırla"), {type: "button", className: "button small ghost"});
  reset.addEventListener("click", () => { Object.assign(state, {brightness: 0, contrast: 0, zoom: 1, panX: 0, panY: 0}); tools.querySelectorAll("input[type=range]").forEach(i => { i.value = 0; }); render(); });
  tools.append(range("Parlaklık", "brightness", -100, 100), range("Kontrast", "contrast", -100, 100), toggle("Ters çevir", "invert"), toggle("Yerel kontrast", "enhance"), toggle("Keskinleştir", "sharpen"), reset,
    toolBtn("Kalibre et", "calibrate", "Uzunluğunu bildiğiniz bir nesnenin iki ucuna tıklayın (ör. kalibrasyon topu)."),
    toolBtn("Cetvel", "ruler", "Ölçmek istediğiniz iki noktaya tıklayın."),
    toolBtn("VHS", "vhs", "VHS: 1-2 uzun eksen (karina ventrali → apeks), 3-4 kısa eksen (en geniş, dik), 5-6 T4 kranial kenarından 4 omur kaudale (T8 kranial kenarı)."),
    toolBtn("VLAS", "vlas", "VLAS: 1-2 karina ventral sınırından sol atriyum kaudal sınırına (VHS'de omur ölçüsü alınmış olmalı)."),
    toolBtn("SI / L5", "si", "1-2 en geniş ince bağırsak çapı, 3-4 L5 vertebra gövdesinin en dar yüksekliği."));
  const status = el("p", "", {className: "xr-status", role: "status"});
  const stage = el("div", "", {className: "xr-stage"});
  stage.append(canvas);

  const side = el("aside", "", {className: "xr-side"});
  const qualityBox = el("section", "", {className: "xr-box"});
  const measureBox = el("section", "", {className: "xr-box"});
  const checkBox = el("section", "", {className: "xr-box"});
  const reportBox = el("section", "", {className: "xr-box"});
  side.append(qualityBox, measureBox, checkBox, reportBox);

  const body = el("div", "", {className: "xr-body"});
  const left = el("div", "", {className: "xr-left"});
  left.append(tools, status, stage);
  body.append(left, side);
  dialog.append(head, body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();

  // Görüntüyü yükle (en fazla 2000 piksel; ölçek kalibrasyona yansıtılır).
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    W = Math.round(img.naturalWidth * scale); H = Math.round(img.naturalHeight * scale);
    const off = document.createElement("canvas"); off.width = W; off.height = H;
    const o = off.getContext("2d", {willReadFrequently: true}); o.drawImage(img, 0, 0, W, H);
    const data = o.getImageData(0, 0, W, H).data;
    gray = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    if (pixelSpacing > 0) state.mmPerPx = pixelSpacing * (sourceColumns ? sourceColumns / W : 1 / scale);
    quality = analyse(gray, W, H);
    render(); drawSide();
  };
  img.onerror = () => { status.textContent = tr("Görüntü açılamadı."); };
  img.src = src;

  function render() {
    if (!gray) return;
    let px = state.enhance ? (enhanced ||= localContrast(gray, W, H)) : gray;
    if (state.sharpen) {
      const out = new Uint8ClampedArray(px.length);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        out[i] = 5 * px[i] - px[i - 1] - px[i + 1] - px[i - W] - px[i + W];
      }
      px = out;
    }
    const c = (state.contrast + 100) / 100, b = state.brightness * 1.5;
    const image = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      let v = (px[i] - 128) * c + 128 + b;
      if (state.invert) v = 255 - v;
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v; image.data[i * 4 + 3] = 255;
    }
    base = image;
    draw();
  }
  function fit() {
    const r = stage.getBoundingClientRect();
    const ratio = Math.min(r.width / W, Math.max(200, r.height) / H) || 1;
    canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
    return ratio;
  }
  let view = 1;
  function draw() {
    if (!base) return;
    view = fit();
    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; tmp.getContext("2d").putImageData(base, 0, 0);
    ctx.save();
    ctx.setTransform(view * state.zoom, 0, 0, view * state.zoom, state.panX, state.panY);
    ctx.drawImage(tmp, 0, 0);
    // Ölçüm çizgileri
    const line = (a, b, color, label) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5 / (view * state.zoom); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4 / (view * state.zoom), 0, 7); ctx.fillStyle = color; ctx.fill(); }
      if (label) { ctx.font = `${14 / (view * state.zoom)}px system-ui`; ctx.fillStyle = color; ctx.fillText(label, b.x + 8 / (view * state.zoom), b.y - 8 / (view * state.zoom)); }
    };
    for (const m of state.measures) line(m.a, m.b, m.color, m.label);
    for (let i = 0; i + 1 < state.points.length; i += 2) line(state.points[i], state.points[i + 1], "#f59e0b");
    if (state.points.length % 2) { const p = state.points.at(-1); ctx.beginPath(); ctx.arc(p.x, p.y, 4 / (view * state.zoom), 0, 7); ctx.fillStyle = "#f59e0b"; ctx.fill(); }
    ctx.restore();
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmt = (v, d = 1) => v.toLocaleString(document.documentElement.lang || "tr", {maximumFractionDigits: d, minimumFractionDigits: d});
  const len = px => state.mmPerPx ? fmt(px * state.mmPerPx) + " mm" : fmt(px, 0) + " px";

  canvas.addEventListener("click", e => {
    if (!state.tool || !base) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) * (canvas.width / r.width) - state.panX) / (view * state.zoom), y = ((e.clientY - r.top) * (canvas.height / r.height) - state.panY) / (view * state.zoom);
    state.points.push({x, y});
    const need = {calibrate: 2, ruler: 2, vhs: 6, vlas: 2, si: 4}[state.tool];
    if (state.points.length >= need) finish();
    draw();
  });
  // Yakınlaştırma (tekerlek) ve kaydırma (sürükleme)
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * (canvas.width / r.width), my = (e.clientY - r.top) * (canvas.height / r.height);
    const z = Math.min(8, Math.max(1, state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    state.panX = mx - (mx - state.panX) * (z / state.zoom); state.panY = my - (my - state.panY) * (z / state.zoom);
    if (z === 1) state.panX = state.panY = 0;
    state.zoom = z; draw();
  }, {passive: false});
  let drag = null;
  canvas.addEventListener("pointerdown", e => { if (!state.tool && state.zoom > 1) drag = {x: e.clientX - state.panX, y: e.clientY - state.panY}; });
  window.addEventListener("pointermove", e => { if (drag) { state.panX = e.clientX - drag.x; state.panY = e.clientY - drag.y; draw(); } });
  window.addEventListener("pointerup", () => { drag = null; });

  function finish() {
    const p = state.points;
    if (state.tool === "calibrate") {
      const pixels = dist(p[0], p[1]);
      const form = el("form", "", {className: "xr-cal"});
      const input = el("input", "", {inputMode: "decimal", placeholder: "25", required: true});
      const ok = el("button", tr("Uygula"), {type: "submit", className: "button small primary"});
      form.append(el("span", tr("Bu uzunluk kaç milimetre?")), input, ok);
      form.addEventListener("submit", e => {
        e.preventDefault();
        const mm = Number(input.value.replace(",", "."));
        if (!(mm > 0)) return input.focus();
        state.mmPerPx = mm / pixels;
        status.textContent = tr("Kalibrasyon tamam") + ": 1 px = " + fmt(state.mmPerPx, 3) + " mm";
        drawSide();
      });
      status.replaceChildren(form);
      setTimeout(() => input.focus());
    } else if (state.tool === "ruler") {
      state.measures.push({a: p[0], b: p[1], color: "#38bdf8", label: len(dist(p[0], p[1])), kind: "ruler", value: dist(p[0], p[1])});
    } else if (state.tool === "vhs") {
      const L = dist(p[0], p[1]), S = dist(p[2], p[3]), unit = dist(p[4], p[5]) / 4;
      state.vhs = {L: L / unit, S: S / unit, vhs: (L + S) / unit, unit};
      state.measures = state.measures.filter(m => m.kind !== "vhs");
      state.measures.push({a: p[0], b: p[1], color: "#ef4444", label: "L " + fmt(L / unit) + " v", kind: "vhs"}, {a: p[2], b: p[3], color: "#ef4444", label: "S " + fmt(S / unit) + " v", kind: "vhs"}, {a: p[4], b: p[5], color: "#a3e635", label: "T4→T8", kind: "vhs"});
    } else if (state.tool === "vlas") {
      if (!state.vhs.unit) status.textContent = tr("Önce VHS ölçümü yapın (omur ölçüsü gerekir).");
      else { state.vhs.vlas = dist(p[0], p[1]) / state.vhs.unit; state.measures.push({a: p[0], b: p[1], color: "#f472b6", label: "VLAS " + fmt(state.vhs.vlas) + " v", kind: "vhs"}); }
    } else if (state.tool === "si") {
      const ratio = dist(p[0], p[1]) / dist(p[2], p[3]);
      state.si = ratio;
      state.measures = state.measures.filter(m => m.kind !== "si");
      state.measures.push({a: p[0], b: p[1], color: "#c084fc", label: "SI", kind: "si"}, {a: p[2], b: p[3], color: "#c084fc", label: "L5 · " + fmt(ratio, 2), kind: "si"});
    }
    // Ölçüm bitince yönerge kalkar; kalibrasyon formu ve "önce VHS ölçün" uyarısı ekranda kalır.
    if (state.tool !== "calibrate" && !(state.tool === "vlas" && !state.vhs.unit)) status.textContent = "";
    state.points = []; state.tool = null;
    tools.querySelectorAll("[data-tool]").forEach(x => x.setAttribute("aria-pressed", "false"));
    drawSide();
  }

  function findings() {
    const f = Object.fromEntries([...state.checked].map(k => [k, true]));
    f.species = kind; f.dyspnea = state.dyspnea; f.neuro = state.neuro;
    if (state.vhs.vhs) { const v = vhsInterpret(state.vhs.vhs, kind); f.vhsHigh = v.tone === "high"; if (v.tone === "low") f.microcardia = true; }
    if (state.vhs.vlas && kind === "dog" && state.vhs.vlas >= 2.3) f.vlasHigh = true;
    if (state.si && kind === "dog" && state.si > 1.6) { f.siRatioHigh = true; f.siDilation = true; }
    return f;
  }

  function report() {
    const f = findings(), lines = [];
    lines.push(tr("RÖNTGEN DEĞERLENDİRMESİ") + " — " + tr(REGIONS[state.region].label) + (patient ? " · " + patient : ""));
    if (quality) lines.push(tr("Görüntü kalitesi") + ": " + quality.score + "/100. " + quality.findings.map(x => tr(x.text)).join(" "));
    const meas = [];
    if (state.vhs.vhs) meas.push("VHS " + fmt(state.vhs.vhs) + " v (L " + fmt(state.vhs.L) + " + S " + fmt(state.vhs.S) + ") — " + tr(vhsInterpret(state.vhs.vhs, kind).text) + "; " + tr("referans") + ": " + tr(VHS_REF[kind].label));
    if (state.vhs.vlas) meas.push("VLAS " + fmt(state.vhs.vlas) + " v" + (kind === "dog" ? (state.vhs.vlas >= 2.3 ? " — " + tr("artmış (≥ 2,3: sol atriyum büyümesi lehine)") : " — " + tr("normal (< 2,3)")) : ""));
    if (state.si) meas.push(tr("İnce bağırsak / L5 oranı") + " " + fmt(state.si, 2) + (kind === "dog" ? (state.si > 1.6 ? " — " + tr("artmış (> 1,6: obstrüksiyon lehine)") : " — " + tr("normal (≤ 1,6)")) : ""));
    for (const m of state.measures.filter(m => m.kind === "ruler")) meas.push(tr("Ölçüm") + ": " + m.label);
    if (meas.length) lines.push(tr("Ölçümler") + ": " + meas.join(" · "));
    const chosen = [];
    for (const [group, items] of REGIONS[state.region].groups) {
      const hits = items.filter(([k]) => state.checked.has(k)).map(([, l]) => tr(l));
      chosen.push(tr(group) + ": " + (hits.length ? hits.join("; ") : tr("belirgin anormallik işaretlenmedi")));
    }
    lines.push(tr("Bulgular") + ":\n- " + chosen.join("\n- "));
    const diffs = interpret(f);
    if (diffs.length) {
      lines.push(tr("Yorum ve ayırıcı tanılar") + ":\n" + diffs.map((d, i) => (i + 1) + ". " + (d.urgent ? "⚠ " + tr("ACİL") + " — " : "") + tr(d.diff) + " " + tr("Öneri") + ": " + tr(d.advice)).join("\n"));
    } else lines.push(tr("Yorum") + ": " + tr("İşaretlenen bulgulara göre belirgin patoloji lehine ipucu yok. Klinik bulgularla birlikte değerlendirin."));
    if (state.notes.trim()) lines.push(tr("Hekim notu") + ": " + state.notes.trim());
    lines.push(tr("Bu değerlendirme VetZimo karar destek asistanıyla hazırlanmıştır; kesin tanı ve sorumluluk muayene eden hekime aittir."));
    return {text: lines.join("\n"), urgent: diffs.some(d => d.urgent), diffs};
  }

  function drawSide() {
    // Kalite
    qualityBox.replaceChildren(el("h3", tr("Otomatik görüntü analizi")));
    if (quality) {
      const s = el("p", "", {className: "xr-score"}); s.dataset.tone = quality.score >= 75 ? "ok" : quality.score >= 50 ? "warn" : "bad";
      s.append(el("strong", String(quality.score)), el("span", "/100 " + tr("kalite")));
      const ul = el("ul");
      for (const x of quality.findings) { const li = el("li", tr(x.text)); li.dataset.tone = x.tone; ul.append(li); }
      qualityBox.append(s, ul);
    } else qualityBox.append(el("p", tr("Görüntü yükleniyor…"), {className: "xr-muted"}));
    // Ölçümler
    measureBox.replaceChildren(el("h3", tr("Ölçümler")));
    measureBox.append(el("p", state.mmPerPx ? tr("Kalibrasyon") + ": 1 px = " + fmt(state.mmPerPx, 3) + " mm" + (pixelSpacing ? " (DICOM)" : "") : tr("Kalibre edilmedi: uzunluklar piksel olarak verilir. VHS, VLAS ve SI/L5 oranları kalibrasyon gerektirmez."), {className: "xr-muted"}));
    const dl = el("dl", "", {className: "xr-dl"});
    const row = (k, v, tone) => { dl.append(el("dt", k)); const d = el("dd", v); if (tone) d.dataset.tone = tone; dl.append(d); };
    if (state.vhs.vhs) { const v = vhsInterpret(state.vhs.vhs, kind); row("VHS", fmt(state.vhs.vhs) + " v · " + tr(v.text), v.tone); }
    if (state.vhs.vlas) row("VLAS", fmt(state.vhs.vlas) + " v" + (kind === "dog" ? (state.vhs.vlas >= 2.3 ? " · " + tr("artmış") : " · " + tr("normal")) : ""), kind === "dog" && state.vhs.vlas >= 2.3 ? "high" : "ok");
    if (state.si) row(tr("SI / L5"), fmt(state.si, 2) + (kind === "dog" ? (state.si > 1.6 ? " · " + tr("artmış") : " · " + tr("normal")) : ""), kind === "dog" && state.si > 1.6 ? "high" : "ok");
    for (const m of state.measures.filter(m => m.kind === "ruler")) row(tr("Cetvel"), m.label);
    if (dl.children.length) measureBox.append(dl);
    measureBox.append(el("p", tr("Referans") + ": " + tr(VHS_REF[kind].label), {className: "xr-muted"}));
    // Sistematik değerlendirme
    checkBox.replaceChildren(el("h3", tr("Sistematik değerlendirme")));
    const regions = el("div", "", {className: "xr-regions"});
    for (const [k, r] of Object.entries(REGIONS)) {
      const b = el("button", tr(r.label), {type: "button"}); b.setAttribute("aria-pressed", String(state.region === k));
      b.addEventListener("click", () => { state.region = k; drawSide(); }); regions.append(b);
    }
    checkBox.append(regions);
    const flags = el("div", "", {className: "xr-flags"});
    for (const [key, label] of [["dyspnea", "Solunum güçlüğü var"], ["neuro", "Nörolojik defisit var"]]) {
      const l = el("label"); const c = el("input", "", {type: "checkbox", checked: state[key]});
      c.addEventListener("change", () => { state[key] = c.checked; drawReport(); }); l.append(c, el("span", tr(label))); flags.append(l);
    }
    checkBox.append(flags);
    for (const [group, items] of REGIONS[state.region].groups) {
      const fs = el("fieldset"); fs.append(el("legend", tr(group)));
      for (const [k, label] of items) {
        const l = el("label"); const c = el("input", "", {type: "checkbox", checked: state.checked.has(k)});
        c.addEventListener("change", () => { c.checked ? state.checked.add(k) : state.checked.delete(k); drawReport(); });
        l.append(c, el("span", tr(label))); fs.append(l);
      }
      checkBox.append(fs);
    }
    const notes = el("textarea", "", {rows: 3, placeholder: tr("Ek gözlem / hekim notu"), value: state.notes});
    notes.addEventListener("input", () => { state.notes = notes.value; drawReport(); });
    checkBox.append(notes);
    drawReport();
  }
  function drawReport() {
    const r = report();
    reportBox.replaceChildren(el("h3", tr("Yorum ve rapor")));
    if (r.urgent) reportBox.append(el("p", "⚠ " + tr("Acil durum bulgusu var — önce hastayı stabilize edin."), {className: "xr-urgent"}));
    const list = el("ol", "", {className: "xr-diffs"});
    for (const d of r.diffs) { const li = el("li"); if (d.urgent) li.dataset.urgent = "1"; li.append(el("strong", tr(d.diff)), el("span", tr("Öneri") + ": " + tr(d.advice))); list.append(li); }
    if (r.diffs.length) reportBox.append(list); else reportBox.append(el("p", tr("Bulgu işaretledikçe ayırıcı tanılar burada görünür."), {className: "xr-muted"}));
    const pre = el("textarea", "", {rows: 8, value: r.text, className: "xr-report"});
    const row = el("div", "", {className: "xr-row"});
    if (onReport) { const add = el("button", tr("Raporu kayda ekle"), {type: "button", className: "button primary"}); add.addEventListener("click", () => { onReport(pre.value); dialog.close(); }); row.append(add); }
    const copy = el("button", tr("Kopyala"), {type: "button", className: "button"});
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(pre.value); copy.textContent = tr("Kopyalandı"); } catch {} });
    row.append(copy);
    reportBox.append(pre, row);
  }
  new ResizeObserver(() => draw()).observe(stage);
  return {dialog, state, report};
}
