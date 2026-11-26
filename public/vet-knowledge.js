// VetZimo · hekim başvuru bilgisi (çevrimdışı, ücretsiz, sınırsız).
// İlaç dozları (köpek/kedi), aşı takvimi, normal yaşamsal değerler, referans aralıkları, zehirlenmeler, ayırıcı tanı,
// sıvı/enerji/gebelik hesapları. Kaynaklar: Plumb's Veterinary Drug Handbook (genel aralıklar), WSAVA 2024 aşı rehberi,
// AAHA 2013 sıvı rehberi, RECOVER KPR rehberi, MSD Veterinary Manual. Kesin karar hekimindir; ürün prospektüsü önceliklidir.

const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9.,/%\s-]/g, " ").replace(/\s+/g, " ").trim();
const num = s => Number(String(s).replace(",", "."));
const fmt = (v, d = 2) => Number.isFinite(v) ? new Intl.NumberFormat("tr-TR", {maximumFractionDigits: d}).format(v) : "—";
const range = (a, b, d = 2) => a === b ? fmt(a, d) : fmt(a, d) + "–" + fmt(b, d);
const NOTE = "Genel referans aralıklarıdır (Plumb's ve ürün prospektüsleri). Hastaya özel doz, böbrek/karaciğer durumu ve etkileşimleri hekim değerlendirir.";

// [ad, eşanlamlılar/ticari adlar, {dog:[min,max,birim], cat:[...]}, yol·sıklık, uyarılar, tipik yoğunluklar [etiket, mg/mL veya mg/tablet, 'ml'|'tab']]
const DRUGS = [
  ["Amoksisilin-klavulanik asit", ["amoksisilin klavulan", "amoksiklav", "synulox", "clavamox", "augmentin", "klavulanik"], {dog: [12.5, 25], cat: [12.5, 25]}, "PO · 12 saatte bir", ["Kusma ve ishal görülebilir; yemekle verin."], [["Synulox 50 mg tablet", 50, "tab"], ["Synulox 250 mg tablet", 250, "tab"], ["Enjeksiyon 175 mg/mL (SC, 8,75 mg/kg)", 175, "ml"]]],
  ["Amoksisilin", ["amoksisilin", "amoxicillin"], {dog: [10, 20], cat: [10, 20]}, "PO/SC · 12 saatte bir", [], [["Uzun etkili enj. 150 mg/mL (15 mg/kg, 48 saat)", 150, "ml"]]],
  ["Sefaleksin", ["sefaleksin", "cephalexin", "rilexine", "therios"], {dog: [22, 30], cat: [22, 30]}, "PO · 12 saatte bir (piyodermada 8–12 saatte bir)", ["Kusma yapabilir; yemekle verin."], []],
  ["Sefovesin", ["sefovesin", "convenia"], {dog: [8, 8], cat: [8, 8]}, "SC · tek doz, 14 gün etkili", ["Etkisi 2 hafta sürer; yan etki olursa geri çekilemez."], [["Convenia 80 mg/mL", 80, "ml"]]],
  ["Enrofloksasin", ["enrofloksasin", "baytril", "enroxil"], {dog: [5, 20], cat: [5, 5]}, "PO/SC · 24 saatte bir", ["KEDİDE 5 mg/kg/gün üstü retina dejenerasyonu ve körlük yapabilir.", "Büyüme çağındaki köpeklerde kıkırdak hasarı riski (özellikle büyük ırk yavrular)."], [["Baytril %5 enj. (50 mg/mL)", 50, "ml"], ["Baytril 50 mg tablet", 50, "tab"], ["Baytril 150 mg tablet", 150, "tab"]]],
  ["Marbofloksasin", ["marbofloksasin", "marbocyl", "marbox"], {dog: [2.75, 5.5], cat: [2.75, 5.5]}, "PO/SC/IV · 24 saatte bir", ["Genç büyüyen hayvanlarda dikkatli kullanın."], [["Marbocyl %1 enj. (10 mg/mL)", 10, "ml"], ["Marbocyl 20 mg tablet", 20, "tab"]]],
  ["Doksisiklin", ["doksisiklin", "doxycycline", "ronaxan", "vibramisin"], {dog: [5, 10], cat: [5, 10]}, "PO · 5 mg/kg 12 saatte bir ya da 10 mg/kg 24 saatte bir", ["KEDİDE tabletten sonra mutlaka 5–6 mL su verin veya yiyecekle verin (özofagus darlığı)."], [["Ronaxan 20 mg tablet", 20, "tab"], ["Ronaxan 100 mg tablet", 100, "tab"]]],
  ["Metronidazol", ["metronidazol", "flagyl", "nidazol"], {dog: [10, 15], cat: [10, 15]}, "PO · 12 saatte bir", ["Yüksek dozda (>30 mg/kg/gün uzun süre) nörotoksisite: ataksi, nistagmus.", "Acı tadı salya yapabilir."], [["250 mg tablet", 250, "tab"], ["500 mg tablet", 500, "tab"]]],
  ["Klindamisin", ["klindamisin", "antirobe", "clindamycin"], {dog: [5.5, 11], cat: [5.5, 11]}, "PO · 12 saatte bir (toksoplazmozda 12,5 mg/kg 12 saatte bir)", ["Kedide kapsülden sonra su verin."], [["Antirobe 75 mg kapsül", 75, "tab"], ["Antirobe 150 mg kapsül", 150, "tab"]]],
  ["Trimetoprim-sülfonamid", ["trimetoprim", "sulfametoksazol", "bactrim", "septra", "tmp smx"], {dog: [15, 30], cat: [15, 30]}, "PO · 12 saatte bir", ["Doberman'da hipersensitivite; kuru göz (KCS), poliartrit riski. Uzun kullanımda Schirmer testi."], []],
  ["Azitromisin", ["azitromisin", "zitromax"], {dog: [5, 10], cat: [5, 10]}, "PO · 24 saatte bir", [], []],
  ["Meloksikam", ["meloksikam", "metacam", "loxicom", "meloxidyl"], {dog: [0.1, 0.2], cat: [0.05, 0.1]}, "Köpek: ilk gün 0,2 mg/kg, sonra 0,1 mg/kg 24 saatte bir · Kedi: ilk gün 0,1 mg/kg, sonra 0,05 mg/kg", ["Dehidrasyon, böbrek hastalığı, kusma/ishal, kortikosteroid ile birlikte kullanmayın.", "Kedide uzun süreli kullanımda böbrek değerlerini izleyin."], [["Metacam köpek oral 1,5 mg/mL", 1.5, "ml"], ["Metacam kedi oral 0,5 mg/mL", 0.5, "ml"], ["Metacam enj. 5 mg/mL", 5, "ml"], ["Metacam kedi enj. 2 mg/mL", 2, "ml"]]],
  ["Karprofen", ["karprofen", "carprofen", "rimadyl", "norocarp"], {dog: [2.2, 4.4], cat: null}, "Köpek: 4,4 mg/kg 24 saatte bir ya da 2,2 mg/kg 12 saatte bir", ["KEDİDE KULLANMAYIN.", "Labradorlarda idiosenkratik karaciğer toksisitesi bildirilmiştir; uzun kullanımda karaciğer enzimleri."], [["Rimadyl 20 mg tablet", 20, "tab"], ["Rimadyl 50 mg tablet", 50, "tab"], ["Rimadyl 100 mg tablet", 100, "tab"], ["Rimadyl enj. 50 mg/mL", 50, "ml"]]],
  ["Robenakoksib", ["robenakoksib", "onsior"], {dog: [1, 2], cat: [1, 2.4]}, "PO · 24 saatte bir (kedide en fazla 6 gün; enj. 2 mg/kg SC)", ["NSAİİ: dehidrasyon ve böbrek hastalığında kullanmayın."], [["Onsior kedi 6 mg tablet", 6, "tab"], ["Onsior enj. 20 mg/mL", 20, "ml"]]],
  ["Maropitant", ["maropitant", "cerenia", "prevomax"], {dog: [1, 2], cat: [1, 1]}, "SC/IV 1 mg/kg 24 saatte bir · Köpek PO 2 mg/kg (kusma), 8 mg/kg (taşıt tutması)", ["SC enjeksiyon acı verebilir; buzdolabı soğukluğunda yapmak ağrıyı azaltır.", "3 aydan küçük yavrularda dikkat."], [["Cerenia enj. 10 mg/mL", 10, "ml"], ["Cerenia 16 mg tablet", 16, "tab"], ["Cerenia 24 mg tablet", 24, "tab"]]],
  ["Metoklopramid", ["metoklopramid", "primperan", "metpamid"], {dog: [0.2, 0.5], cat: [0.2, 0.5]}, "SC/IM/PO · 8 saatte bir · CRI 1–2 mg/kg/gün", ["GİS tıkanıklığı veya perforasyon şüphesinde kullanmayın."], [["Primperan enj. 5 mg/mL", 5, "ml"]]],
  ["Ondansetron", ["ondansetron", "zofran"], {dog: [0.5, 1], cat: [0.1, 1]}, "IV/PO · 8–12 saatte bir", [], [["Enj. 2 mg/mL", 2, "ml"]]],
  ["Omeprazol", ["omeprazol", "losec"], {dog: [1, 1], cat: [1, 1]}, "PO · 12 saatte bir (aç karnına)", [], []],
  ["Famotidin", ["famotidin", "famodin"], {dog: [0.5, 1], cat: [0.5, 1]}, "PO/IV · 12 saatte bir", ["Böbrek yetmezliğinde dozu azaltın."], []],
  ["Sukralfat", ["sukralfat", "antepsin"], {dog: [0.5, 1, "g/hayvan"], cat: [0.25, 0.25, "g/hayvan"]}, "PO · 8 saatte bir · diğer ilaçlardan 2 saat ayrı", ["Doz kilo başına değil, hayvan başınadır."], []],
  ["Furosemid", ["furosemid", "lasix", "dimazon"], {dog: [1, 4], cat: [1, 2]}, "IV/IM/SC/PO · akut kalp yetmezliğinde 2–4 mg/kg (köpek), 1–2 mg/kg (kedi)", ["Hipokalemi ve dehidrasyon; elektrolitleri izleyin."], [["Dimazon enj. 50 mg/mL", 50, "ml"], ["Lasix 40 mg tablet", 40, "tab"]]],
  ["Pimobendan", ["pimobendan", "vetmedin", "cardisure"], {dog: [0.2, 0.3], cat: [0.2, 0.3]}, "PO · 12 saatte bir, yemekten 1 saat önce", ["Hipertrofik obstrüktif kardiyomiyopatide dikkat."], [["Vetmedin 1,25 mg", 1.25, "tab"], ["Vetmedin 2,5 mg", 2.5, "tab"], ["Vetmedin 5 mg", 5, "tab"]]],
  ["Benazepril", ["benazepril", "fortekor", "benefortin"], {dog: [0.25, 0.5], cat: [0.5, 1]}, "PO · 24 saatte bir", ["Böbrek değerleri ve potasyumu izleyin."], [["Fortekor 5 mg", 5, "tab"], ["Fortekor 20 mg", 20, "tab"]]],
  ["Amlodipin", ["amlodipin", "amodip", "norvasc"], {dog: [0.1, 0.5], cat: [0.125, 0.25]}, "PO · 24 saatte bir · kedide genelde 0,625–1,25 mg/kedi", ["Tansiyonu ölçerek titre edin."], [["Amodip 1,25 mg", 1.25, "tab"]]],
  ["Prednizolon", ["prednizolon", "prednisolone", "prednol", "deltacortril"], {dog: [0.5, 2], cat: [1, 4]}, "PO · anti-inflamatuar 0,5–1 mg/kg/gün · immünsüpresif köpek 2 mg/kg/gün, kedi 2–4 mg/kg/gün", ["NSAİİ ile birlikte vermeyin. Uzun kullanımda yavaşça azaltarak kesin.", "Diyabet, enfeksiyon ve kornea ülserinde dikkat."], [["5 mg tablet", 5, "tab"], ["20 mg tablet", 20, "tab"]]],
  ["Deksametazon", ["deksametazon", "dexamethasone", "dekort", "dexazone"], {dog: [0.1, 0.2], cat: [0.1, 0.2]}, "IV/IM/SC · anti-inflamatuar; anafilakside 0,1–0,5 mg/kg", ["Prednizolondan ~7 kat güçlüdür. NSAİİ ile birlikte vermeyin."], [["Dekort enj. 8 mg/2 mL (4 mg/mL)", 4, "ml"], ["Enj. 2 mg/mL", 2, "ml"]]],
  ["Diazepam", ["diazepam", "diazem", "valium"], {dog: [0.5, 1], cat: [0.5, 1]}, "IV (status epileptikusta) · rektal 1–2 mg/kg", ["Kedide oral uzun kullanım idiosenkratik karaciğer nekrozu yapabilir."], [["Diazem enj. 5 mg/mL", 5, "ml"]]],
  ["Midazolam", ["midazolam", "dormicum", "zolamid"], {dog: [0.2, 0.5], cat: [0.2, 0.5]}, "IV/IM/intranazal · nöbette", [], [["Enj. 5 mg/mL", 5, "ml"], ["Enj. 1 mg/mL", 1, "ml"]]],
  ["Levetirasetam", ["levetirasetam", "keppra"], {dog: [20, 20], cat: [20, 20]}, "PO · 8 saatte bir · IV yükleme 30–60 mg/kg", [], [["Keppra 250 mg", 250, "tab"], ["Keppra 500 mg", 500, "tab"], ["Enj. 100 mg/mL", 100, "ml"]]],
  ["Fenobarbital", ["fenobarbital", "luminal", "phenobarbital"], {dog: [2, 3], cat: [1.5, 2.5]}, "PO · 12 saatte bir; kan düzeyini 2 hafta sonra ölçün", ["Karaciğer enzimlerini ve kan düzeyini izleyin."], [["Luminal 100 mg", 100, "tab"]]],
  ["Butorfanol", ["butorfanol", "torbugesic", "butomidor", "dolorex"], {dog: [0.2, 0.4], cat: [0.2, 0.4]}, "IV/IM/SC · 1–2 saat analjezi", ["Kısa etkilidir; şiddetli ağrıda yetersiz kalabilir."], [["Enj. 10 mg/mL", 10, "ml"]]],
  ["Buprenorfin", ["buprenorfin", "vetergesic", "bupaq", "temgesic"], {dog: [0.01, 0.02], cat: [0.01, 0.03]}, "IV/IM · kedide yanak içi (OTM) · 6–8 saatte bir", [], [["Enj. 0,3 mg/mL", 0.3, "ml"]]],
  ["Metadon", ["metadon", "comfortan", "methadone"], {dog: [0.2, 0.5], cat: [0.1, 0.3]}, "IV/IM · 4 saatte bir", ["Solunum depresyonu ve bradikardi izleyin."], [["Comfortan 10 mg/mL", 10, "ml"]]],
  ["Tramadol", ["tramadol", "contramal"], {dog: [2, 5], cat: [1, 2]}, "PO · köpekte 8–12, kedide 12 saatte bir", ["Kedide acı tat; serotonin sendromu riski (SSRI, trazodon ile)."], [["50 mg kapsül", 50, "tab"]]],
  ["Gabapentin", ["gabapentin", "neurontin"], {dog: [5, 10], cat: [5, 10]}, "PO · 8–12 saatte bir · kedide ziyaret öncesi 50–100 mg/kedi", ["Ksilitol içeren insan solüsyonlarını köpekte kullanmayın."], [["100 mg kapsül", 100, "tab"], ["300 mg kapsül", 300, "tab"]]],
  ["Propofol", ["propofol", "propoven", "diprivan"], {dog: [4, 6], cat: [6, 8]}, "IV · indüksiyon, etkiye göre yavaşça (premedikasyonla daha az)", ["Apne yapabilir; entübasyon ve oksijen hazır olsun."], [["Propoven 10 mg/mL", 10, "ml"]]],
  ["Ketamin", ["ketamin", "ketalar", "ketasol", "alfamine"], {dog: [5, 10], cat: [5, 10]}, "IM (kombinasyonla) · IV indüksiyon 2–5 mg/kg benzodiazepinle", ["Tek başına kas rijiditesi yapar; mutlaka sedatif ile kombine edin."], [["Ketasol 100 mg/mL", 100, "ml"]]],
  ["Deksmedetomidin", ["deksmedetomidin", "dexdomitor", "dexmedetomidine"], {dog: [0.001, 0.01], cat: [0.005, 0.015]}, "IM/IV · µg/kg: köpek 1–10, kedi 5–15 (etkiye göre)", ["Kalp hastalığında kullanmayın. Antidotu atipamezol."], [["Dexdomitor 0,5 mg/mL", 0.5, "ml"]]],
  ["Atipamezol", ["atipamezol", "antisedan", "revertor"], {dog: [0.025, 0.1], cat: [0.0125, 0.05]}, "IM · deksmedetomidin hacmine eşit hacim (5 mg/mL ürün)", [], [["Antisedan 5 mg/mL", 5, "ml"]]],
  ["Atropin", ["atropin", "atropine"], {dog: [0.02, 0.04], cat: [0.02, 0.04]}, "IV/IM/SC · bradikardide · organofosfat zehirlenmesinde 0,2–0,5 mg/kg", [], [["Atropin 1 mg/mL", 1, "ml"], ["Atropin 0,5 mg/mL", 0.5, "ml"]]],
  ["Adrenalin (epinefrin)", ["adrenalin", "epinefrin", "epinephrine", "adrenaline"], {dog: [0.01, 0.01], cat: [0.01, 0.01]}, "KPR: düşük doz 0,01 mg/kg IV/IO, her 3–5 dk (RECOVER) · anafilakside 0,01 mg/kg IM", ["Uzamış KPR'de yüksek doz (0,1 mg/kg) düşünülebilir."], [["Adrenalin 1 mg/mL (1:1000)", 1, "ml"]]],
  ["Kalsiyum glukonat %10", ["kalsiyum glukonat", "calcium gluconate"], {dog: [50, 150], cat: [50, 150]}, "IV · 0,5–1,5 mL/kg (%10) 10–20 dakikada yavaşça, EKG izlemiyle", ["Bradikardi görülürse infüzyonu durdurun."], [["%10 kalsiyum glukonat (100 mg/mL)", 100, "ml"]]],
  ["Dekstroz %50", ["dekstroz", "glukoz", "dextrose", "sekerli serum"], {dog: [250, 500], cat: [250, 500]}, "IV · hipoglisemide 0,5–1 mL/kg %50, 1:2–1:4 sulandırarak", ["Seyreltmeden periferik damardan vermeyin (flebit)."], [["%50 dekstroz (500 mg/mL)", 500, "ml"]]],
  ["Aktif kömür", ["aktif komur", "aktif karbon", "charcoal"], {dog: [1000, 4000], cat: [1000, 4000]}, "PO · 1–4 g/kg; enterohepatik dolaşımlı toksinlerde 4–8 saatte bir 0,5–1 g/kg", ["Kostik madde, hidrokarbon ve ksilitolde etkisizdir. Hipernatremiyi izleyin."], []],
  ["Apomorfin", ["apomorfin", "apomorphine", "kusturma"], {dog: [0.03, 0.04], cat: null}, "Köpek: IV 0,03 mg/kg ya da IM 0,04 mg/kg (kusturmak için)", ["Kedide etkisiz/önerilmez; kedide deksmedetomidin 7–10 µg/kg IM kullanılır.", "Kostik madde, bilinç bozukluğu veya nöbette kusturmayın."], []],
  ["N-asetilsistein", ["asetilsistein", "nac", "acetylcysteine", "parasetamol antidot"], {dog: [70, 140], cat: [70, 140]}, "IV/PO · yükleme 140 mg/kg, sonra 70 mg/kg 6 saatte bir (7 doz)", ["Parasetamol zehirlenmesinin antidotudur."], [["%20 (200 mg/mL)", 200, "ml"]]],
  ["Vitamin K1", ["vitamin k", "fitomenadion", "konakion", "phytonadione"], {dog: [2.5, 5], cat: [2.5, 5]}, "PO · 24 saatte bir (bölünmüş), antikoagülan rodentisitte 3–4 hafta", ["IV vermeyin (anafilaksi). Bittikten 48–72 saat sonra PT ölçün."], [["Konakion 10 mg/mL", 10, "ml"]]],
  ["Fenbendazol", ["fenbendazol", "panacur"], {dog: [50, 50], cat: [50, 50]}, "PO · 24 saatte bir, 3 gün (Giardia'da 5 gün)", [], [["Panacur %10 süspansiyon (100 mg/mL)", 100, "ml"], ["Panacur 250 mg tablet", 250, "tab"]]],
  ["Prazikuantel", ["prazikuantel", "droncit", "praziquantel"], {dog: [5, 5], cat: [5, 5]}, "PO/SC · tek doz", [], [["50 mg tablet", 50, "tab"]]],
  ["Pirantel", ["pirantel", "pyrantel"], {dog: [5, 10], cat: [20, 20]}, "PO · tek doz, 2–3 hafta sonra tekrar", [], []],
  ["Selamektin", ["selamektin", "stronghold", "revolution"], {dog: [6, 12], cat: [6, 12]}, "Spot-on · ayda bir", [], []],
  ["Afoxolaner", ["afoxolaner", "nexgard"], {dog: [2.5, 6.9], cat: null}, "PO · ayda bir", ["Nöbet öyküsü olan köpeklerde dikkat (izoksazolin)."], []],
  ["Fluralaner", ["fluralaner", "bravecto"], {dog: [25, 56], cat: [40, 94]}, "PO (köpek) 12 haftada bir · kedi spot-on 12 haftada bir", ["Nöbet öyküsünde dikkat (izoksazolin)."], []],
  ["Sarolaner", ["sarolaner", "simparica"], {dog: [2, 4], cat: null}, "PO · ayda bir", ["Nöbet öyküsünde dikkat (izoksazolin)."], []],
  ["Ivermektin", ["ivermektin", "ivomec"], {dog: [0.006, 0.006], cat: [0.024, 0.024]}, "PO · kalp kurdu koruması ayda bir (demodekozda çok daha yüksek dozlar, MDR1 testi şart)", ["Collie, Shetland, Avustralya çoban köpeği ve melezlerinde (MDR1/ABCB1 mutasyonu) ciddi nörotoksisite."], []],
  ["Milbemisin oksim + prazikuantel", ["milbemax", "milbemisin"], {dog: [0.5, 0.5], cat: [2, 2]}, "PO · milbemisin 0,5 mg/kg (köpek), 2 mg/kg (kedi) + prazikuantel 5 mg/kg", [], []],
  ["Mirtazapin", ["mirtazapin", "mirataz", "remeron"], {dog: [0.5, 1], cat: [0.4, 0.4]}, "Kedi: 1,88 mg/kedi PO 24–48 saatte bir ya da transdermal · Köpek: 24 saatte bir", ["Böbrek/karaciğer yetmezliğinde aralığı uzatın."], []],
  ["Trazodon", ["trazodon", "desyrel"], {dog: [3, 7], cat: [50, 100, "mg/kedi"]}, "PO · köpekte 8–24 saatte bir · kedide ziyaretten 1–2 saat önce 50–100 mg/kedi", ["Tramadol/SSRI ile serotonin sendromu riski."], []],
  ["İnsülin (glargin / lente)", ["insulin", "glargin", "caninsulin", "lantus", "prozinc"], {dog: [0.25, 0.5, "IU/kg"], cat: [1, 1, "IU/kedi"]}, "SC · 12 saatte bir, yemekle · kedide başlangıç 1 IU/kedi (glukoz <360 mg/dL ise)", ["Hipoglisemi belirtilerini sahibine anlatın; doz değişikliğini glukoz eğrisine göre yapın."], []],
];

const SPECIES = [["cat", /\b(kedi\w*|cat|feline|yavru kedi)\b/], ["dog", /\b(kope[kg]\w*|dog|canine|kopegi|yavru kopek)\b/], ["rabbit", /\b(tavsan\w*|rabbit)\b/], ["ferret", /\b(gelincik|ferret)\b/], ["bird", /\b(kus|muhabbet|papagan|bird)\w*\b/]];
const SPECIES_TR = {dog: "Köpek", cat: "Kedi", rabbit: "Tavşan", ferret: "Gelincik", bird: "Kuş"};
const speciesOf = t => SPECIES.find(([, re]) => re.test(t))?.[0] || "";
const weightOf = t => { const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilogram)\b/) || t.match(/(\d+(?:[.,]\d+)?)\s*(gr|gram)\b/); if (!m) return NaN; const v = num(m[1]); return /^g/.test(m[2]) ? v / 1000 : v; };
const concOf = t => { const m = t.match(/(\d+(?:[.,]\d+)?)\s*mg\s*\/\s*ml\b/); if (m) return {v: num(m[1]), kind: "ml"}; const tb = t.match(/(\d+(?:[.,]\d+)?)\s*mg\w*\s*(tablet|tb|kapsul)\b/); return tb ? {v: num(tb[1]), kind: "tab"} : null; };

const VITALS = {
  dog: [["Vücut sıcaklığı", "37,5–39,2 °C"], ["Nabız", "70–160/dk (küçük ırk 180'e, yavru 220'ye kadar)"], ["Solunum", "10–30/dk"], ["Kapiller dolum", "< 2 sn"], ["Sistolik tansiyon", "110–160 mmHg (>160 hipertansiyon riski)"]],
  cat: [["Vücut sıcaklığı", "38,1–39,2 °C"], ["Nabız", "140–220/dk"], ["Solunum", "20–30/dk (dinlenirken)"], ["Kapiller dolum", "< 2 sn"], ["Sistolik tansiyon", "120–160 mmHg"]],
  rabbit: [["Vücut sıcaklığı", "38,5–40,0 °C"], ["Nabız", "130–325/dk"], ["Solunum", "30–60/dk"], ["Not", "Tavşanda 12 saatten uzun dışkılamama/iştahsızlık acildir (GİS stazı)."]],
  ferret: [["Vücut sıcaklığı", "37,8–40,0 °C"], ["Nabız", "180–250/dk"], ["Solunum", "33–36/dk"]],
  bird: [["Vücut sıcaklığı", "40–42 °C"], ["Not", "Türe göre çok değişir; kuşlarda kilo takibi (gram) en değerli izlem parametresidir."]],
};

const VACCINES = {
  dog: {title: "Köpek aşı takvimi (WSAVA 2024 · Türkiye uygulaması)", rows: [
    ["6–8 hafta", "Karma (CDV, CAV-2, CPV-2 ± parainfluenza) 1. doz · iç parazit"],
    ["10–12 hafta", "Karma 2. doz · Leptospiroz 1. doz (risk varsa)"],
    ["12 hafta (3 ay)", "Kuduz (yasal zorunlu) · mikroçip"],
    ["14–16 hafta", "Karma 3. doz (son doz 16 haftadan sonra olmalı) · Leptospiroz 2. doz"],
    ["26–52 hafta", "Karma rapel (aşı yanıtsızlığını kapatmak için)"],
    ["Yıllık", "Kuduz (Türkiye'de yıllık zorunlu) · Leptospiroz · Kennel cough (Bordetella) riskli ortamda"],
    ["3 yılda bir", "Çekirdek karma aşılar (CDV, CAV, CPV) erişkinde"],
    ["İç/dış parazit", "Yavruda 12 haftaya kadar 2 haftada bir, 6 aya kadar ayda bir; erişkinde iç parazit 3 ayda bir, dış parazit ürüne göre aylık/3 aylık"]]},
  cat: {title: "Kedi aşı takvimi (WSAVA 2024 · Türkiye uygulaması)", rows: [
    ["6–8 hafta", "Karma (FPV, FHV-1, FCV) 1. doz · iç parazit"],
    ["9–12 hafta", "Karma 2. doz · FeLV 1. doz (dışarı çıkan / riskli yavrular, önce test)"],
    ["12 hafta (3 ay)", "Kuduz (yasal zorunlu) · FeLV 2. doz (3–4 hafta sonra)"],
    ["14–16 hafta", "Karma 3. doz (son doz 16 haftadan sonra)"],
    ["26 hafta", "Karma rapel"],
    ["Yıllık", "Kuduz (yasal) · FHV/FCV yüksek riskte yıllık · FeLV riskte"],
    ["3 yılda bir", "FPV ve düşük riskte FHV/FCV erişkinde"],
    ["Not", "Enjeksiyon bölgesi sarkomu nedeniyle aşıları kuyruk veya bacağın alt kısmına yapın ve bölgeyi kaydedin."]]},
  rabbit: {title: "Tavşan aşıları", rows: [["5–7 hafta", "Miksomatozis + RHD-1/RHD-2 (kombine aşı)"], ["Yıllık", "Miksomatozis ve RHD rapel"]]},
};

const LABS = { // köpek, kedi (yaygın laboratuvar aralıkları; cihazınızın aralığı önceliklidir)
  alt: ["ALT", "10–125 U/L", "12–130 U/L"], ast: ["AST", "0–50 U/L", "0–48 U/L"], alp: ["ALP", "23–212 U/L", "14–111 U/L"], ggt: ["GGT", "0–11 U/L", "0–4 U/L"],
  kreatinin: ["Kreatinin", "0,5–1,8 mg/dL", "0,8–2,4 mg/dL"], bun: ["BUN", "7–27 mg/dL", "16–36 mg/dL"], ure: ["Üre", "15–58 mg/dL", "34–77 mg/dL"], sdma: ["SDMA", "0–14 µg/dL", "0–14 µg/dL"],
  glukoz: ["Glukoz", "74–143 mg/dL", "71–159 mg/dL"], protein: ["Total protein", "5,2–8,2 g/dL", "5,7–8,9 g/dL"], albumin: ["Albümin", "2,3–4,0 g/dL", "2,2–4,0 g/dL"],
  bilirubin: ["Total bilirubin", "0–0,9 mg/dL", "0–0,9 mg/dL"], kolesterol: ["Kolesterol", "110–320 mg/dL", "65–225 mg/dL"], fosfor: ["Fosfor", "2,5–6,8 mg/dL", "3,1–7,5 mg/dL"],
  kalsiyum: ["Kalsiyum", "7,9–12,0 mg/dL", "7,8–11,3 mg/dL"], potasyum: ["Potasyum", "3,5–5,8 mmol/L", "3,5–5,8 mmol/L"], sodyum: ["Sodyum", "144–160 mmol/L", "150–165 mmol/L"],
  hematokrit: ["Hematokrit (HCT)", "%37–55", "%30–45"], hct: ["Hematokrit (HCT)", "%37–55", "%30–45"], wbc: ["Lökosit (WBC)", "5,5–16,9 ×10⁹/L", "5,5–19,5 ×10⁹/L"],
  lokosit: ["Lökosit (WBC)", "5,5–16,9 ×10⁹/L", "5,5–19,5 ×10⁹/L"], trombosit: ["Trombosit (PLT)", "148–484 ×10⁹/L", "151–600 ×10⁹/L"], plt: ["Trombosit (PLT)", "148–484 ×10⁹/L", "151–600 ×10⁹/L"],
  lipaz: ["Lipaz (DGGR)", "< 120 U/L (yaklaşık)", "< 26 U/L (yaklaşık)"], t4: ["Total T4", "1,0–4,0 µg/dL", "0,8–4,7 µg/dL"],
};

const TOXINS = [
  ["Çikolata (teobromin)", /\b(cikolata|kakao|teobromin)/, "20 mg/kg hafif belirti, 40–50 mg/kg kardiyak, ≥60 mg/kg nöbet. Kusturma (2 saat içinde), aktif kömür tekrarlı, sıvı, EKG.", "chocolate"],
  ["Ksilitol", /\b(ksilitol|xylitol|sekersiz sakiz)/, "Köpekte ≥0,075–0,1 g/kg hipoglisemi, >0,5 g/kg karaciğer yetmezliği. Kan şekerini 12 saat izleyin, dekstroz, karaciğer koruyucu. Aktif kömür etkisiz.", "xylitol"],
  ["Üzüm / kuru üzüm", /\b(uzum|kuru uzum|grape|raisin)/, "Güvenli doz yok; akut böbrek hasarı. Kusturma, aktif kömür, 48–72 saat IV sıvı ve böbrek değerleri.", ""],
  ["Soğan / sarımsak", /\b(sogan|sarimsak|onion|garlic|pirasa)/, "Heinz cisimcikli hemolitik anemi; köpekte vücut ağırlığının ≥%0,5'i soğan, kedi daha duyarlı. Belirtiler 1–5 gün gecikebilir; HCT takibi.", ""],
  ["Zambak (kedi)", /\b(zambak|lily|lilium)/, "Kedide polen dahil tüm kısımları akut böbrek yetmezliği yapar. Acil: kusturma, aktif kömür, 48 saat IV sıvı, kreatinin takibi.", ""],
  ["Parasetamol", /\b(parasetamol|asetaminofen|paracetamol|parol|tylenol)/, "Kedide HİÇBİR doz güvenli değil (methemoglobinemi). Köpekte >100 mg/kg karaciğer hasarı. Antidot N-asetilsistein; oksijen, vitamin C.", ""],
  ["İbuprofen / NSAİİ", /\b(ibuprofen|naproksen|diklofenak|aspirin|nurofen|majezik)/, "Köpekte ibuprofen ≥25 mg/kg GİS ülser, ≥175 mg/kg böbrek, ≥400 mg/kg nörolojik. Kedi iki kat duyarlı. Kusturma, aktif kömür, gastroprotektan, IV sıvı.", ""],
  ["Permetrin (kedi)", /\b(permetrin|pyrethroid|piretroid|kopek pire damlasi)/, "Köpek ürünü kediye uygulanınca tremor ve nöbet. Bulaşık deterjanıyla yıkama, metokarbamol veya intralipid, ısı kontrolü.", ""],
  ["Antikoagülan fare zehiri", /\b(fare zehiri|rodentisit|bromadiolon|brodifakum|kumarin|varfarin)/, "Kanama 3–5 gün sonra başlar. Erken ise kusturma + aktif kömür; vitamin K1 2,5–5 mg/kg/gün PO 3–4 hafta, sonra PT.", ""],
  ["Etilen glikol (antifriz)", /\b(antifriz|etilen glikol|ethylene glycol)/, "İlk 3 saat (kedi) / 8 saat (köpek) içinde fomepizol veya etanol. Sonrasında akut böbrek yetmezliği; prognoz kötü.", ""],
  ["Metaldehit (salyangoz zehiri)", /\b(metaldehit|salyangoz zehiri|metaldehyde)/, "Tremor, hipertermi, nöbet. Diazepam/metokarbamol, soğutma, IV sıvı.", ""],
  ["Organofosfat / karbamat", /\b(organofosfat|karbamat|bocek ilaci|tarim ilaci)/, "SLUDGE belirtileri, miyozis, bradikardi. Atropin 0,2–0,5 mg/kg (¼ IV, kalanı IM/SC), pralidoksim (organofosfatta).", ""],
  ["Makadamya cevizi", /\b(makadamya|macadamia)/, "Köpekte güçsüzlük, arka bacak felci, hipertermi; genelde 48 saatte geçer, destek tedavi.", ""],
  ["Avokado (kuş)", /\b(avokado|avocado)/, "Kuşlarda persin kardiyotoksisite; köpek/kedide GİS bozukluğu.", ""],
];

const DIFFERENTIALS = [
  [/\b(kusma|kusuyor|vomit)/, "Kusma", ["Diyet hatası / yabancı madde yeme", "Gastroenterit (viral: parvovirüs, panlökopeni)", "Yabancı cisim / obstrüksiyon", "Pankreatit", "Böbrek yetmezliği (üremi)", "Karaciğer hastalığı", "Hipoadrenokortisizm (Addison)", "Diyabetik ketoasidoz", "Piyometra (kısırlaştırılmamış dişi)", "Zehirlenme / ilaç"], "Hemogram, biyokimya (BUN, kreatinin, ALT, ALP, glukoz, lipaz), elektrolit, parvovirüs testi, abdominal röntgen/ultrason."],
  [/\b(ishal|diyare|diarrh)/, "İshal", ["Diyet değişikliği / diyet intoleransı", "Parazitler (Giardia, koksidia, nematod)", "Viral enterit (parvo, korona, panlökopeni)", "Bakteriyel (Salmonella, Clostridium, Campylobacter)", "Kronik enteropati (IBD)", "Ekzokrin pankreas yetmezliği", "Hipoadrenokortisizm", "Neoplazi (lenfoma)"], "Dışkı flotasyonu, Giardia antijen, parvo testi, hemogram/biyokimya; kronikse kobalamin/folat, TLI."],
  [/\b(pupd|pu pd|poliuri|polidipsi|cok su ic|cok idrar)/, "Poliüri / polidipsi", ["Kronik böbrek hastalığı", "Diabetes mellitus", "Hiperadrenokortisizm (Cushing)", "Piyometra", "Hiperkalsemi", "Karaciğer yetmezliği", "Hipertiroidi (kedi)", "Diabetes insipidus", "İlaç (steroid, diüretik)"], "İdrar dansitesi ve tahlili, glukoz, biyokimya, kalsiyum, kedi için T4, idrar kültürü."],
  [/\b(oksuruk|oksur|cough)/, "Öksürük", ["Kennel cough (infeksiyöz trakeobronşit)", "Trakeal kollaps (küçük ırk)", "Kalp yetmezliği (köpek)", "Kronik bronşit", "Felin astım", "Pnömoni", "Kalp kurdu", "Akciğer metastazı / tümör", "Akciğer kurtları"], "Toraks röntgeni, oskültasyon, ekokardiyografi, kalp kurdu testi, gerekiyorsa BAL."],
  [/\b(nobet|kasilma|havale|seizure|konvulz)/, "Nöbet", ["İdiyopatik epilepsi (köpek 1–5 yaş)", "Hipoglisemi", "Zehirlenme (metaldehit, organofosfat, permetrin)", "Hepatik ensefalopati", "Beyin tümörü (>6 yaş)", "Ensefalit / menenjit", "Hipokalsemi (eklampsi)", "Kafa travması"], "Glukoz, kalsiyum, biyokimya (safra asitleri), hemogram; gerekirse MR ve BOS analizi. 5 dakikadan uzun nöbet status epileptikustur."],
  [/\b(topall|aksama|lameness)/, "Topallık", ["Travma / yumuşak doku", "Kranial çapraz bağ kopması", "Patella luksasyonu", "Kalça/dirsek displazisi", "Osteoartrit", "Kırık", "Osteosarkom (büyük ırk, yaşlı)", "Panosteit (genç büyük ırk)", "Poliartrit / Lyme"], "Ortopedik muayene (çekmece testi), röntgen, gerekirse eklem sıvısı analizi."],
  [/\b(kasinti|kasin|pruritus|itch)/, "Kaşıntı", ["Pire alerjisi dermatiti", "Atopik dermatit", "Besin alerjisi", "Uyuz (Sarcoptes, Notoedres)", "Malassezia / bakteriyel piyoderma", "Otodektes (kulak uyuzu)", "Demodikoz (sekonder)"], "Pire kontrolü, deri kazıntısı, sitoloji, trikogram, 8 haftalık eliminasyon diyeti."],
  [/\b(nefes darlig|dispne|zor nefes|dyspnea|solunum gucl)/, "Dispne (ACİL)", ["Kalp yetmezliği (pulmoner ödem)", "Plevral efüzyon", "Pnömotoraks", "Üst solunum yolu tıkanıklığı (brakisefal, larinks felci)", "Felin astım", "Pnömoni", "Travma / diyafram fıtığı", "Anemi"], "Önce oksijen ve stresi azaltma; POCUS (TFAST), gerekirse torakosentez; stabilize olunca röntgen."],
  [/\b(anemi|solgun|soluk mukoza|anemia)/, "Anemi", ["Kan kaybı (travma, GİS, parazit, rodentisit)", "İmmün aracılı hemolitik anemi", "Kan parazitleri (Babesia, Mycoplasma haemofelis, Ehrlichia)", "Kronik böbrek hastalığı", "FeLV / FIV (kedi)", "Soğan/çinko zehirlenmesi", "Kemik iliği hastalığı"], "Hemogram + retikülosit (rejeneratif mi?), yayma, Coombs, kan parazit testleri, koagülasyon, FeLV/FIV."],
  [/\b(sarilik|ikter|jaundice)/, "Sarılık", ["Prehepatik: hemoliz (IMHA, Babesia)", "Hepatik: hepatit, hepatik lipidoz (kedi), kolanjit, leptospiroz", "Posthepatik: safra yolu tıkanıklığı, pankreatit, safra kesesi mukoseli"], "Hemogram (HCT), biyokimya, abdominal ultrason, leptospiroz testi."],
  [/\b(idrar yapam|idrar tikan|anuri|stranguri|idrar zorlan)/, "İdrar yapamama (ACİL)", ["Üretral tıkanıklık (erkek kedi: FLUTD, tıkaç, taş)", "Ürolitiyazis", "Sistit", "Prostat hastalığı (köpek)", "Mesane tümörü", "Nörolojik mesane"], "Mesane palpasyonu; erkek kedide tıkanıklık acildir: potasyum ve EKG, sonda; idrar tahlili, röntgen/ultrason."],
  [/\b(istahsiz|anoreksi|yemek yemiyor|mama yemiyor)/, "İştahsızlık", ["Ağız/diş hastalığı", "Sistemik hastalık (böbrek, karaciğer)", "Ağrı", "GİS hastalığı", "Ateşli hastalık / enfeksiyon", "Neoplazi", "Kedide hepatik lipidoz riski (3 günden uzun)"], "Ağız muayenesi, hemogram, biyokimya, abdominal görüntüleme."],
];

const GESTATION = {dog: [63, "58–68 gün"], cat: [65, "63–67 gün"], rabbit: [31, "29–35 gün"], ferret: [42, "41–43 gün"]};

/** Sorudan klinik başvuru yanıtı üretir; konu klinik bilgi değilse null döner. context: {species, weight, name} (seçili hasta) */
export function vetAnswer(text, context = {}) {
  const t = fold(text);
  if (!t) return null;
  const species = speciesOf(t) || context.species || "";
  const weight = weightOf(t) || (Number(context.weight) > 0 ? Number(context.weight) : NaN);
  const who = context.name ? context.name + " · " : "";

  // İlaç dozu
  // En uzun eşleşen ad kazanır ("milbemisin oksim + prazikuantel" › "prazikuantel").
  const hit = (name, syn) => Math.max(0, ...[fold(name), ...syn].filter(s => new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(t)).map(s => s.length));
  const drug = DRUGS.map(d => [hit(d[0], d[1]), d]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0])[0]?.[1];
  if (drug && (/\b(doz\w*|mg|ne kadar|kac|verilir|verelim|hesapla|ml|tablet|kullanim\w*|nasil|endikasyon\w*|uygula\w*)\b/.test(t) || weight > 0 || t.split(" ").length <= 3)) return doseAnswer(drug, species, weight, concOf(t), who);

  // Zehirlenme
  const toxin = TOXINS.find(([, re]) => re.test(t));
  if (toxin && (/\b(zehir\w*|toksik\w*|toksisite|yedi|yemis|yuttu|yutmus|icti|zararli|tehlikeli|doz|maruz\w*|bulas\w*|temas\w*)\b/.test(t) || t.split(" ").length <= 4 || species)) return toxinAnswer(toxin, t, species, weight, who);

  // Aşı takvimi
  if (/\b(asi takvimi|asi programi|asilari|asilar|hangi asi|asi ne zaman|kuduz asisi|karma asi|vaccin|rapel)\b/.test(t)) {
    const list = species && VACCINES[species] ? [species] : ["dog", "cat"];
    return {text: list.map(s => VACCINES[s].title).join(" · "), items: list.flatMap(s => VACCINES[s].rows.map(([k, v]) => [(list.length > 1 ? SPECIES_TR[s] + " · " : "") + k, v])), note: "Aşılama aralıkları hayvanın riskine, yaşam tarzına ve kullanılan ürüne göre hekimce ayarlanır."};
  }

  // Normal yaşamsal değerler
  if (/\b(normal|referans|kac olmali|ne olmali|vital|yasamsal)\b/.test(t) && /\b(ates|isi|sicaklik|nabiz|solunum|kalp|vital|yasamsal|degerler|tansiyon)\b/.test(t) && !/\b(alt|ast|alp|kreatinin|bun|ure|glukoz|hct|wbc|trombosit)\b/.test(t)) {
    const list = species && VITALS[species] ? [species] : ["dog", "cat"];
    return {text: "Normal yaşamsal değerler · " + list.map(s => SPECIES_TR[s]).join(", "), stats: list.length === 1 ? VITALS[list[0]] : null, items: list.length > 1 ? list.flatMap(s => VITALS[s].map(([k, v]) => [SPECIES_TR[s] + " · " + k, v])) : null, note: "Stres ve klinik ortamı nabız ve solunumu yükseltebilir."};
  }

  // Laboratuvar referansı
  const labKeys = Object.keys(LABS).filter(k => new RegExp("\\b" + k + "\\b").test(t));
  if (labKeys.length && /\b(referans|normal|aralik|deger|kac olmali|yuksek|dusuk)\b/.test(t)) {
    const uniq = [...new Map(labKeys.map(k => [LABS[k][0], LABS[k]])).values()];
    return {text: "Referans aralıkları" + (species ? " · " + SPECIES_TR[species] : ""), items: uniq.map(([n, d, c]) => [n, species === "cat" ? "Kedi: " + c : species === "dog" ? "Köpek: " + d : "Köpek: " + d + " · Kedi: " + c]), note: "Yaygın laboratuvar aralıklarıdır; cihazınızın raporundaki referans aralığı önceliklidir. Sonucu yorumlamak için tetkik kaydındaki «Yorumla» özelliğini kullanın."};
  }

  // Ayırıcı tanı
  const diff = DIFFERENTIALS.find(([re]) => re.test(t));
  if (diff && /\b(ayirici\w*|ayirt\w*|neden\w*|sebep\w*|olasi\w*|tani\w*|ddx|differansiyel|nelerdir|ne olabilir)\b/.test(t)) {
    return {text: "Ayırıcı tanı · " + diff[1], items: diff[2].map(d => [d, ""]), stats: [["Önerilen tetkikler", diff[3]]], note: "Liste sıklık ve önem sırasına göredir; öykü, yaş, ırk ve muayene bulgularıyla daraltın."};
  }

  // Sıvı tedavisi
  if (/\b(sivi tedavi|sivi ihtiyac|idame sivi|infuzyon hizi|serum hizi|dehidrasyon)\b/.test(t) && weight > 0) {
    const sp = species === "cat" ? "cat" : "dog";
    const dehy = num((t.match(/%\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*%/) || [])[1] || (t.match(/(\d+(?:[.,]\d+)?)\s*%/) || [])[1] || 0);
    const maintenance = (sp === "cat" ? 80 : 132) * Math.pow(weight, 0.75), deficit = weight * dehy * 10;
    return {text: who + "Sıvı tedavisi · " + SPECIES_TR[sp] + " " + fmt(weight) + " kg", stats: [["İdame (AAHA 2013)", fmt(maintenance, 0) + " mL/gün · " + fmt(maintenance / 24, 1) + " mL/sa"], ...(dehy ? [["Dehidrasyon açığı (%" + fmt(dehy, 1) + ")", fmt(deficit, 0) + " mL"], ["24 saatte kapatılırsa toplam hız", fmt(maintenance / 24 + deficit / 24, 1) + " mL/sa"]] : [])], note: "Şok tedavisi ayrıdır (köpek 15–20 mL/kg, kedi 5–10 mL/kg bolus, yeniden değerlendirerek). Kalp hastalarında hızı azaltın.", links: [["Hesaplayıcılar", "#hesaplayicilar"]]};
  }

  // Enerji ihtiyacı
  if (/\b(rer|mer|kalori|enerji ihtiyac|kcal|mama miktar)\b/.test(t) && weight > 0) {
    const rer = 70 * Math.pow(weight, 0.75);
    const factors = species === "cat" ? [["Kısır yetişkin", 1.2], ["Kısır olmayan", 1.4], ["Kilo verme", 0.8], ["Yavru", 2.5]] : [["Kısır yetişkin", 1.6], ["Kısır olmayan", 1.8], ["Kilo verme", 1.0], ["4 aydan küçük yavru", 3.0]];
    return {text: who + "Enerji ihtiyacı · " + fmt(weight) + " kg", stats: [["RER (70 × kg^0,75)", fmt(rer, 0) + " kcal/gün"], ...factors.map(([k, f]) => [k + " (×" + fmt(f, 1) + ")", fmt(rer * f, 0) + " kcal/gün"])], note: "Hastanede yatan hastada başlangıç RER'dir; 3–4 günde hedefe çıkılır."};
  }

  // Gebelik
  if (/\b(gebelik|hamilelik|dogum ne zaman|dogum tarihi|kizginlik|gebe)\b/.test(t)) {
    const list = species && GESTATION[species] ? [species] : ["dog", "cat"];
    const date = t.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
    const items = list.map(s => [SPECIES_TR[s] + " gebelik süresi", GESTATION[s][1]]);
    if (date) {
      const d = new Date(Number(date[3]), Number(date[2]) - 1, Number(date[1]));
      for (const s of list) { const due = new Date(d); due.setDate(due.getDate() + GESTATION[s][0]); items.push([SPECIES_TR[s] + " · tahmini doğum", due.toLocaleDateString("tr-TR")]); }
    }
    items.push(["Ultrasonla gebelik tespiti", "Köpekte 25. günden, kedide 15–20. günden itibaren"], ["Röntgenle yavru sayımı", "45. günden sonra (iskelet mineralizasyonu)"]);
    if (!species || species === "dog") items.push(["Köpek kızgınlık", "Yılda 1–2 kez, 2–3 hafta sürer; çiftleşme için en uygun dönem proöstrus başlangıcından 9–14. gün (progesteron ölçümüyle)"]);
    if (!species || species === "cat") items.push(["Kedi", "Uyarılmış ovulasyon; mevsimsel poliöstrus"]);
    return {text: "Üreme bilgisi", items: items.map(([a, b]) => [a, b])};
  }

  // KPR
  if (/\b(kpr|cpr|kardiyak arrest|kalp durmasi|resusitasyon|canlandirma)\b/.test(t)) {
    return {text: "KPR (RECOVER 2024 özet)", items: [["Göğüs basısı", "100–120/dk, göğsün 1/3–1/2'si kadar, 2 dakikalık döngüler, kesintisiz"], ["Ventilasyon", "Entübe: 10 nefes/dk; entübe değil: 30 basıya 2 nefes"], ["Adrenalin", "0,01 mg/kg IV/IO, her 3–5 dakikada (her ikinci döngü)"], ["Atropin", "0,04 mg/kg IV (vagal tonus/bradikardi şüphesinde)"], ["Defibrilasyon", "VF/nabızsız VT'de: harici 4–6 J/kg (monofazik), 2–4 J/kg (bifazik)"], ["İzlem", "EtCO2 > 18 mmHg etkili basının göstergesidir"]].map(([a, b]) => [a, b]), note: "Ekipte rolleri önceden belirleyin; 2 dakikada bir bası yapan kişiyi değiştirin."};
  }
  return null;
}

function doseAnswer([name, , dose, route, warnings, products], species, weight, conc, who) {
  const list = species === "cat" || species === "dog" ? [species] : ["dog", "cat"];
  const stats = [], items = [];
  for (const s of list) {
    const d = dose[s];
    if (!d) { stats.push([SPECIES_TR[s], s === "cat" ? "Kedide kullanılmaz" : "Köpekte kullanılmaz"]); continue; }
    const unit = d[2] || "mg/kg";
    stats.push([SPECIES_TR[s] + " doz aralığı", range(d[0], d[1], 4) + " " + unit]);
    if (weight > 0 && unit === "mg/kg") {
      const lo = d[0] * weight, hi = d[1] * weight;
      stats.push([SPECIES_TR[s] + " · " + fmt(weight) + " kg toplam", range(lo, hi, 3) + " mg"]);
      if (conc?.v > 0) stats.push([conc.kind === "ml" ? "Çekilecek hacim (" + fmt(conc.v) + " mg/mL)" : "Tablet (" + fmt(conc.v) + " mg)", range(lo / conc.v, hi / conc.v, 2) + (conc.kind === "ml" ? " mL" : " tablet")]);
      else for (const [label, c, kind] of products.slice(0, 4)) {
        if (kind === "ml" && /kedi/i.test(label) && s === "dog" || kind === "ml" && /köpek/i.test(label) && s === "cat") continue;
        items.push([label, range(lo / c, hi / c, 2) + (kind === "ml" ? " mL" : " tablet")]);
      }
    }
  }
  stats.push(["Yol · sıklık", route]);
  for (const w of warnings) items.push(["⚠ " + w, ""]);
  return {text: who + name + (weight > 0 ? " · " + fmt(weight) + " kg" : ""), stats, items, note: NOTE + (weight > 0 ? "" : " Kilo yazarsanız (ör. “4 kg kedi meloksikam dozu”) toplam miktarı hesaplarım.")};
}

function toxinAnswer([name, , info, calc], t, species, weight, who) {
  const stats = [["Önemli", info]];
  const grams = (t.match(/(\d+(?:[.,]\d+)?)\s*(g|gr|gram)\b/) || [])[1];
  if (calc === "chocolate" && weight > 0 && grams) {
    const type = /beyaz/.test(t) ? 0.01 : /bitter|siyah|yarı tatli|yari tatli|%70|bittersweet/.test(t) ? 5.5 : /kakao|toz/.test(t) ? 28 : 2.0;
    const g = num(grams), mgkg = type * g / weight;
    const level = mgkg >= 60 ? "Nöbet riski (≥ 60 mg/kg) · acil" : mgkg >= 40 ? "Kardiyak risk (40–50 mg/kg)" : mgkg >= 20 ? "Hafif belirtiler beklenir (≥ 20 mg/kg)" : "Belirti eşiğinin altında (< 20 mg/kg)";
    stats.unshift(["Teobromin", fmt(mgkg, 1) + " mg/kg"], ["Değerlendirme", level]);
  }
  if (calc === "xylitol" && weight > 0 && grams) {
    const gkg = num(grams) / weight;
    stats.unshift(["Ksilitol", fmt(gkg, 3) + " g/kg"], ["Değerlendirme", gkg > 0.5 ? "Karaciğer yetmezliği riski · acil" : gkg >= 0.075 ? "Hipoglisemi riski · acil" : "Eşiğin altında; izlem"]);
  }
  return {text: who + "Zehirlenme · " + name, stats, urgent: true, note: "Kusturma kararı alınan maddeye ve süreye göre verilir; kostik madde, hidrokarbon, bilinç bozukluğu veya nöbette kusturmayın.", links: [["Hesaplayıcılar", "#hesaplayicilar"]]};
}

/** Konu listesi (yardım ekranı için) */
export const KNOWLEDGE_EXAMPLES = ["“4 kg kedi meloksikam dozu”", "“10 kg köpek amoksisilin klavulanik 50 mg tablet”", "“Kedi aşı takvimi”", "“Köpek normal nabız ve ateş”", "“Kedi ALT referans”", "“Kusma ayırıcı tanı”", "“5 kg kedi %8 dehidrasyon sıvı tedavisi”", "“20 kg köpek 100 g bitter çikolata yedi”", "“Zambak kedi zehirlenmesi”", "“Kedi gebelik süresi 1.11.2026”", "“KPR adrenalin dozu”"];
export const KNOWLEDGE_STATS = {drugs: DRUGS.length, toxins: TOXINS.length, vaccines: Object.keys(VACCINES).length};
