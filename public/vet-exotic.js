// VetZimo · VeBot egzotik hayvan bilgi tabanı (tamamen tarayıcıda, API'siz, ücretsiz).
// Tavşan, gine domuzu (kobay), şinşilla, hamster/sıçan/fare, gelincik, muhabbet kuşu, papağan, kanarya, iguana ve diğer kertenkeleler,
// kaplumbağa ve yılan için: türe özgü hastalık kartları, belirtiden olası hastalıklar, kiloya/grama göre ilaç dozu, türde tehlikeli ilaçlar,
// normal yaşamsal değerler ve temel bakım uyarıları.
// Kaynaklar: Carpenter's Exotic Animal Formulary, BSAVA Manuals of Rabbit / Rodent & Ferret / Psittacine Birds / Reptiles, Quesenberry & Carpenter.
// Genel başvuru bilgisidir; kesin tanı ve tedavi kararı hekime aittir. Egzotiklerde ilaç kullanımı çoğunlukla prospektüs dışıdır.
import {extractSymptoms} from "./vet-symptoms.js?v=2";

const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9.,/%\s-]/g, " ").replace(/\s+/g, " ").trim();
const num = s => Number(String(s).replace(",", "."));
const fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString("tr-TR", {maximumFractionDigits: d}) : "—";

// Tür anahtarları ve tanıma kalıpları (sıra önemli: "cennet papağanı", "sultan papağanı" kuş; "kobay" gine domuzu)
export const EXOTIC = {
  rabbit: ["Tavşan", /\b(tavsan\w*|rabbit\w*|bunny)\b/],
  guineapig: ["Gine domuzu (kobay)", /\b(gine domuz\w*|kobay\w*|guinea\s*pig\w*|pig\b|pigler\w*)\b/],
  chinchilla: ["Şinşilla", /\b(sinsilla\w*|chinchilla\w*)\b/],
  rodent: ["Hamster · sıçan · fare (kemirgen)", /\b(hamster\w*|sican\w*|\brat\b|suruk fare\w*|evcil fare\w*|sus faresi|gerbil\w*|degu\w*)\b/],
  ferret: ["Gelincik (ferret)", /\b(gelincik\w*|ferret\w*|kokarca)\b/],
  bird: ["Kafes kuşu (muhabbet, papağan, kanarya)", /\b(muhabbet\w*|papagan\w*|sultan\w*|jako\w*|kakadu\w*|ara papag\w*|lovebird\w*|cennet papag\w*|kanarya\w*|ispinoz\w*|kus\b|kusu\b|kuslar\w*|kusum\w*|kusa\b|kusta\b|guvercin\w*|bird\w*|parrot\w*|budgie\w*|cockatiel\w*)\b/],
  lizard: ["Kertenkele (iguana, sakallı ejder, gekko)", /\b(iguana\w*|sakalli ejder\w*|bearded dragon|gekko\w*|gecko\w*|kertenkele\w*|bukalemun\w*|agama\w*|leopar gekko\w*)\b/],
  tortoise: ["Kaplumbağa", /\b(kaplumbaga\w*|tortoise\w*|turtle\w*|su kaplumbaga\w*|kara kaplumbaga\w*)\b/],
  snake: ["Yılan", /\b(yilan\w*|piton\w*|python\w*|boa\b|misir yilani|kral yilani|snake\w*)\b/],
};
export const exoticSpecies = t => Object.entries(EXOTIC).find(([, [, re]]) => re.test(t))?.[0] || "";
const SP = k => EXOTIC[k]?.[0] || k;
const REPTILE = ["lizard", "tortoise", "snake"];
const HINDGUT = ["rabbit", "guineapig", "chinchilla"];

// ───────────── Normal değerler ve temel bakım ─────────────
const BASICS = {
  rabbit: {vitals: [["Vücut ısısı", "38,5–40 °C"], ["Kalp hızı", "130–325 /dk"], ["Solunum", "30–60 /dk"], ["Ömür", "8–12 yıl"], ["Yetişkin ağırlık", "1–6 kg (ırka göre)"]],
    care: ["Diyetin %80'i sınırsız kuru ot (yonca değil çayır otu); günlük yeşillik; pelet az; meyve ödül kadar", "Dişler ömür boyu uzar: ot tüketimi diş aşınması ve bağırsak hareketi için şarttır", "12 saatten uzun dışkı yapmama veya yememe ACİLDİR (GİS stazı)", "Dişiler 4–6 ayda kısırlaştırılmalı (uterus adenokarsinomu riski çok yüksek)", "Miksomatozis ve RHDV1/RHDV2 aşıları önerilir"]},
  guineapig: {vitals: [["Vücut ısısı", "37,2–39,5 °C"], ["Kalp hızı", "230–380 /dk"], ["Solunum", "40–150 /dk"], ["Ömür", "5–8 yıl"], ["Yetişkin ağırlık", "0,7–1,2 kg"]],
    care: ["C vitaminini sentezleyemez: günde 10–30 mg/kg (gebe/hastada 50 mg/kg'a kadar) — taze biber, maydanoz veya C vitamini tableti", "Sınırsız kuru ot, kobay peleti (C vitaminli, taze), günlük yeşillik", "Dişiler ilk doğumu 6–7 aydan önce yapmalı (pubis simfizi kaynaşır → distosi)", "Oral penisilin, amoksisilin, ampisilin, klindamisin, linkomisin, eritromisin ölümcül disbiyoz yapar"]},
  chinchilla: {vitals: [["Vücut ısısı", "37–38 °C"], ["Kalp hızı", "100–150 /dk"], ["Solunum", "40–80 /dk"], ["Ömür", "10–20 yıl"], ["Yetişkin ağırlık", "400–800 g"]],
    care: ["Isıya çok duyarlıdır: ortam 25 °C'nin altında, nem düşük olmalı (sıcak çarpması sık)", "Haftada birkaç kez kum banyosu; suyla yıkanmaz", "Sınırsız ot, şinşilla peleti; kuru meyve ve kuruyemiş verilmez", "Dişler ömür boyu uzar (kök uzaması ve malokluzyon sık)"]},
  rodent: {vitals: [["Vücut ısısı", "Hamster 37–38 °C · sıçan 35,9–37,5 °C"], ["Kalp hızı", "Hamster 250–500 · sıçan 250–450 /dk"], ["Solunum", "Hamster 35–135 · sıçan 70–115 /dk"], ["Ömür", "Hamster 1,5–3 · sıçan 2–3,5 · fare 1,5–3 yıl"]],
    care: ["Hamsterlar yalnız yaşar; sıçan ve fareler sosyaldir", "Hamsterda oral penisilin grubu ve linkomisin ölümcül enterit yapabilir", "Sıçanda solunum yolu mikoplazmozu çok sık; tozlu talaş ve amonyak birikmesinden kaçının", "Dişi sıçanlarda meme tümörü sık (kısırlaştırma riski azaltır)"]},
  ferret: {vitals: [["Vücut ısısı", "37,8–40 °C"], ["Kalp hızı", "180–250 /dk"], ["Solunum", "33–36 /dk"], ["Ömür", "6–10 yıl"], ["Ağırlık", "Dişi 0,5–1 kg · erkek 1–2 kg"]],
    care: ["Zorunlu etoburdur: yüksek proteinli, düşük karbonhidratlı diyet (şeker ve meyve insülinoma riskini artırır)", "Köpek distemperine çok duyarlıdır (ölüm oranı ~%100) — distemper ve kuduz aşısı", "Kısırlaştırılmamış dişide östrus sürer ve ölümcül hiperöstrojenizm (kemik iliği baskılanması) gelişir", "3 yaş üstünde insülinoma ve adrenal hastalık sık"]},
  bird: {vitals: [["Vücut ısısı", "40–42 °C"], ["Kalp hızı", "Muhabbet 260–600 · papağan 120–780 /dk (strese göre)"], ["Solunum", "Muhabbet 60–75 · büyük papağan 15–45 /dk"], ["Ömür", "Muhabbet 8–15 · sultan 15–20 · Afrika grisi 40–60 · kanarya 10–15 yıl"], ["Ağırlık", "Muhabbet 30–40 g · sultan 80–100 g · Afrika grisi 400–550 g · kanarya 15–30 g"]],
    care: ["Kuşlar hastalığı saklar: kabarık oturma, kafes dibinde durma, dışkı değişikliği ACİL değerlendirilmelidir", "Yalnız tohum diyeti A vitamini ve kalsiyum eksikliği, obezite, karaciğer yağlanması yapar — pelet ağırlıklı, sebze destekli diyet", "Teflon (PTFE) tava dumanı, aerosol, sigara dumanı ve avokado kuşlar için ölümcül olabilir", "Çinko ve kurşun (kafes teli, oyuncak, perde ağırlığı) ağır metal zehirlenmesi yapar", "Psittakoz (Chlamydia psittaci) zoonozdur"]},
  lizard: {vitals: [["Tercih edilen sıcaklık", "İguana 29–35 °C · sakallı ejder sıcak bölge 38–42 °C · leopar gekko 28–32 °C"], ["UVB", "Gündüz canlıları (iguana, sakallı ejder) için UVB lambası zorunlu, 6–12 ayda bir değiştirilmeli"], ["Ömür", "İguana 15–20 · sakallı ejder 8–12 · leopar gekko 15–20 yıl"]],
    care: ["Sürüngen soğukkanlıdır: hastalıkların çoğu yanlış sıcaklık, UVB ve beslenmeden kaynaklanır (önce barınak koşullarını sorgulayın)", "İguana otçuldur (yapraklı yeşillik); sakallı ejder ve gekko böcekle beslenir — böcekler kalsiyumla tozlanmalı", "Metabolik kemik hastalığı en sık sorundur: UVB eksikliği, düşük Ca/P oranı", "İlaçlar sürüngen tercih ettiği sıcaklıkta tutulurken verilmelidir; enjeksiyonlar ön bacağa (renal portal sistem)"]},
  tortoise: {vitals: [["Tercih edilen sıcaklık", "Kara kaplumbağası gündüz 26–32 °C, bask noktası 35 °C"], ["UVB", "Zorunlu"], ["Ömür", "Kara kaplumbağası 50 yıl ve üzeri"]],
    care: ["İVERMEKTİN kaplumbağalarda ÖLÜMCÜLDÜR (ayrıca timsah ve bazı kertenkelelerde) — kullanmayın", "Kış uykusu yalnızca sağlıklı, kilosu yerinde hayvanlarda ve kontrollü sıcaklıkta yapılmalı", "Su kaplumbağasında A vitamini eksikliği göz kapağı şişliği yapar", "Kabuk yumuşaması metabolik kemik hastalığını gösterir"]},
  snake: {vitals: [["Tercih edilen sıcaklık", "Türüne göre 26–32 °C, sıcak ve serin bölge farkı olmalı"], ["Beslenme", "Türe ve yaşa göre 1–4 haftada bir; canlı av yaralanmalara yol açar (öldürülmüş/çözülmüş av önerilir)"], ["Ömür", "Mısır yılanı 15–20 · kral pitonu 20–30 yıl"]],
    care: ["Ağız açık soluma, ağızda köpük ve hırıltı solunum enfeksiyonunu düşündürür (çoğunlukla düşük ortam ısısı)", "Deri değiştirme sorunlarının çoğu düşük nemden kaynaklanır", "Boa ve pitonlarda nörolojik bulgu (yıldız bakışı, dönme) inklüzyon cisimcik hastalığını düşündürür"]},
};

// ───────────── İlaçlar ─────────────
// [ad, eş anlamlılar, {tür: [min, max, birim?]}, yol·sıklık, uyarılar, ürünler [[etiket, mg/mL, "ml"]]]
const DRUGS = [
  ["Enrofloksasin", ["enrofloksasin", "baytril", "enroxil"], {rabbit: [5, 10], guineapig: [5, 10], chinchilla: [5, 10], rodent: [10, 20], ferret: [5, 10], bird: [15, 30], lizard: [5, 10], tortoise: [5, 10], snake: [5, 10]},
    "Memeliler PO/SC 12–24 saatte bir · Kuş PO 12–24 saatte bir · Sürüngen PO/IM 24–48 saatte bir", ["Enjeksiyon dokuda nekroz yapabilir: seyreltin, mümkünse oral verin", "Genç büyüyen hayvanlarda kıkırdak hasarı riski"], [["Baytril %2,5 (25 mg/mL)", 25, "ml"], ["Baytril %5 (50 mg/mL)", 50, "ml"]]],
  ["Marbofloksasin", ["marbofloksasin", "marbocyl"], {rabbit: [2, 5], guineapig: [4, 4], ferret: [2, 5], bird: [2.5, 5], lizard: [2, 10], tortoise: [2, 10], snake: [2, 10]}, "PO/IM · 24 saatte bir (sürüngende 24–48 saatte bir)", [], [["Marbocyl %1 (10 mg/mL)", 10, "ml"]]],
  ["Trimetoprim-sülfonamid", ["trimetoprim", "sulfametoksazol", "bactrim", "tmp"], {rabbit: [30, 30], guineapig: [15, 30], chinchilla: [15, 30], rodent: [15, 30], ferret: [15, 30], bird: [30, 100], lizard: [30, 30], snake: [30, 30]}, "PO · 12 saatte bir (sürüngende 24–48 saatte bir)", ["Dehidrasyonda böbrek hasarı riski — sıvı desteği"], [["Bactrim süspansiyon (48 mg/mL toplam)", 48, "ml"]]],
  ["Doksisiklin", ["doksisiklin", "doxycycline"], {rodent: [5, 10], ferret: [5, 10], bird: [25, 50], rabbit: [2.5, 4]}, "PO · memelide 12 saatte bir · kuşta 24 saatte bir (psittakozda 45 gün)", ["Kuşta kusma yapabilir; kalsiyumlu yiyecek ve mineral blok emilimi azaltır"], []],
  ["Amoksisilin-klavulanik asit", ["amoksisilin", "amoksiklav", "synulox", "klavulanik"], {ferret: [12.5, 25], bird: [125, 125]}, "Gelincik PO 12 saatte bir · Kuş PO 12 saatte bir", ["TAVŞAN, GİNE DOMUZU, ŞİNŞİLLA VE HAMSTERDA AĞIZDAN VERMEYİN: ölümcül enterotoksemi/disbiyoz"], []],
  ["Seftazidim", ["seftazidim", "fortum"], {tortoise: [20, 20], snake: [20, 20], lizard: [20, 20], bird: [50, 100]}, "Sürüngen IM · 72 saatte bir · Kuş IM 4–8 saatte bir", ["Sürüngende ön bacağa uygulayın; sıvı desteği"], []],
  ["Metronidazol", ["metronidazol", "flagyl"], {rabbit: [20, 20], guineapig: [20, 25], chinchilla: [10, 20], rodent: [20, 20], ferret: [15, 20], bird: [20, 50], lizard: [20, 50], tortoise: [20, 50], snake: [20, 50]}, "PO · memelide 12 saatte bir · kuşta 12 saatte bir · sürüngende 24–48 saatte bir", ["Şinşillada karaciğer toksisitesi bildirilmiştir — dikkat", "Bazı yılan türlerinde (indigo, kral yılanı) daha düşük doz"], []],
  ["Meloksikam", ["meloksikam", "metacam", "loxicom"], {rabbit: [0.5, 1], guineapig: [0.2, 0.5], chinchilla: [0.2, 0.5], rodent: [1, 2], ferret: [0.2, 0.2], bird: [0.5, 1.6], lizard: [0.2, 0.5], tortoise: [0.1, 0.2], snake: [0.1, 0.3]}, "PO/SC · memelide 24 saatte bir · kuşta 12–24 saatte bir · sürüngende 24–48 saatte bir", ["Dehidrasyon ve böbrek hastalığında kullanmayın; sıvı desteği verin"], [["Metacam oral 0,5 mg/mL", 0.5, "ml"], ["Metacam oral 1,5 mg/mL", 1.5, "ml"], ["Metacam enj. 5 mg/mL", 5, "ml"]]],
  ["Buprenorfin", ["buprenorfin", "temgesic", "vetergesic"], {rabbit: [0.01, 0.05], guineapig: [0.05, 0.05], chinchilla: [0.05, 0.05], rodent: [0.05, 0.1], ferret: [0.01, 0.03], bird: [0.02, 0.05]}, "SC/IV/IM · 6–12 saatte bir", ["Tavşan ve kemirgende bağırsak hareketini azaltabilir — dışkıyı izleyin"], [["Vetergesic 0,3 mg/mL", 0.3, "ml"]]],
  ["Butorfanol", ["butorfanol", "torbugesic"], {bird: [1, 4], rabbit: [0.1, 0.5], ferret: [0.1, 0.5], lizard: [0.4, 2], tortoise: [0.4, 2]}, "IM/SC · kuşta 2–4 saatte bir · memelide 4 saatte bir", ["Kuşlarda tercih edilen opioid (kappa reseptör)"], [["Torbugesic 10 mg/mL", 10, "ml"]]],
  ["Metoklopramid", ["metoklopramid", "primperan"], {rabbit: [0.2, 1], guineapig: [0.2, 1], chinchilla: [0.2, 0.5], ferret: [0.2, 1]}, "SC/PO · 6–12 saatte bir", ["GİS tıkanıklığı varsa kullanmayın (tavşanda obstrüksiyon/staz ayrımı yapın)"], [["Primperan 5 mg/mL", 5, "ml"]]],
  ["Simetikon", ["simetikon", "simeticone", "gaz damlasi"], {rabbit: [65, 130, "mg/tavşan"], guineapig: [20, 20, "mg/hayvan"], chinchilla: [20, 20, "mg/hayvan"]}, "PO · 1–3 saatte bir (gaz birikiminde)", ["Destek tedavidir; ağrı kontrolü, sıvı ve beslenme desteğiyle birlikte"], []],
  ["Fenbendazol", ["fenbendazol", "panacur"], {rabbit: [20, 20], guineapig: [20, 50], rodent: [20, 50], lizard: [50, 100], tortoise: [50, 100], snake: [50, 100]}, "PO · tavşanda E. cuniculi için 20 mg/kg 24 saatte bir 28 gün · sürüngende tek doz, 14 günde tekrar", ["Kuşlarda (özellikle güvercin, bazı papağanlar) kemik iliği toksisitesi bildirilmiştir — kuşta önerilmez"], [["Panacur %2,5 süspansiyon (25 mg/mL)", 25, "ml"], ["Panacur %10 (100 mg/mL)", 100, "ml"]]],
  ["İvermektin", ["ivermektin", "ivomec"], {rabbit: [0.2, 0.4], guineapig: [0.2, 0.5], chinchilla: [0.2, 0.4], rodent: [0.2, 0.4], ferret: [0.2, 0.4], bird: [0.2, 0.2], lizard: [0.2, 0.2], snake: [0.2, 0.2]}, "SC/PO/topikal · 7–14 günde bir, 2–3 kez", ["KAPLUMBAĞADA ASLA KULLANMAYIN — ölümcül nörotoksisite", "Muhabbet kuşunda gaga-ayak uyuzunda (Knemidokoptes) topikal uygulanır"], [["Ivomec %1 (10 mg/mL)", 10, "ml"]]],
  ["Selamektin", ["selamektin", "stronghold", "revolution"], {rabbit: [6, 18], guineapig: [6, 15], ferret: [6, 18], rodent: [6, 15]}, "Topikal · 2–4 haftada bir", ["Fipronil (Frontline) TAVŞANDA KULLANILMAZ — ölüm bildirilmiştir"], []],
  ["İtrakonazol", ["itrakonazol", "sporanox", "itrafungol"], {bird: [5, 10], lizard: [5, 10], tortoise: [5, 10], snake: [5, 10]}, "PO · 24 saatte bir (aspergillozda haftalar–aylar)", ["AFRİKA GRİ PAPAĞANINDA toksisite: 2,5–5 mg/kg kullanın veya vorikonazol/terbinafin tercih edin"], [["Itrafungol 10 mg/mL", 10, "ml"]]],
  ["Nistatin", ["nistatin", "mycostatin"], {bird: [300000, 300000, "IU/kg"], rabbit: [100000, 100000, "IU/kg"]}, "PO · 8–12 saatte bir, 7–14 gün (kandidiyazis)", ["Ağızdan emilmez; ağız ve kursaktaki mantara doğrudan temas etmeli"], []],
  ["Kalsiyum glukonat", ["kalsiyum glukonat", "kalsiyum"], {bird: [50, 100], lizard: [100, 100], tortoise: [100, 100], snake: [100, 100], rabbit: [100, 100]}, "IM/SC (seyreltilmiş) · kuşta yumurta bağlamada ve hipokalsemide 6–12 saatte bir · sürüngende 6–8 saatte bir", ["Hızlı IV bradikardi yapar; seyrelterek ve yavaş verin"], [["%10 kalsiyum glukonat (100 mg/mL)", 100, "ml"]]],
  ["C vitamini (askorbik asit)", ["c vitamini", "askorbik asit", "vitamin c"], {guineapig: [10, 30], chinchilla: [10, 30]}, "PO · 24 saatte bir (iskorbüt tedavisinde 50–100 mg/kg/gün)", ["Suya katılan C vitamini ışık ve havayla hızla bozulur; doğrudan ağızdan verin"], []],
  ["Vitamin A", ["vitamin a", "a vitamini", "retinol"], {tortoise: [1000, 2000, "IU/kg"], bird: [1000, 2000, "IU/kg"], lizard: [1000, 2000, "IU/kg"]}, "IM · 7–10 günde bir, 2–4 doz", ["Aşırı dozda deri soyulması ve hipervitaminoz A — yalnızca eksiklik doğrulandığında, diyetle birlikte"], []],
  ["Prednizolon", ["prednizolon", "prednisolone", "prednol"], {ferret: [0.5, 2]}, "PO · 12 saatte bir (insülinoma, lenfoma)", ["Tavşan, kemirgen ve kuşlarda bağışıklık baskılanmasına çok duyarlıdır — kaçının veya çok dikkatli kullanın"], []],
  ["Diazoksit", ["diazoksit", "proglycem"], {ferret: [5, 10]}, "PO · 12 saatte bir (insülinoma; prednizolona ek)", [], []],
  ["Deslorelin implantı", ["deslorelin", "suprelorin"], {ferret: [4.7, 4.7, "mg/implant"], bird: [4.7, 4.7, "mg/implant"]}, "SC implant · 8–20 ay etkili (gelincikte adrenal hastalık, kuşta kronik yumurtlama)", [], []],
  ["Famotidin", ["famotidin", "famodin"], {ferret: [0.25, 0.5], rabbit: [0.5, 1]}, "PO/IV · 24 saatte bir (gelincikte Helicobacter gastriti)", [], []],
];
// Türde tehlikeli ilaçlar
const BANNED = {
  rabbit: [["Ağızdan amoksisilin, ampisilin, penisilin, klindamisin, linkomisin, eritromisin", "Ölümcül enterotoksemi (Clostridium spiroforme)"], ["Fipronil (Frontline)", "Nörotoksisite, ölüm"], ["Kortikosteroidler", "Bağışıklık baskılanması, GİS ülseri, gizli enfeksiyonların alevlenmesi"]],
  guineapig: [["Ağızdan penisilin grubu, klindamisin, linkomisin, eritromisin, tetrasiklin", "Ölümcül disbiyoz / enterotoksemi"], ["Streptomisin", "Toksik"]],
  chinchilla: [["Ağızdan penisilin grubu, klindamisin, linkomisin", "Ölümcül disbiyoz"], ["Metronidazol (yüksek doz)", "Karaciğer toksisitesi"]],
  rodent: [["Hamsterda ağızdan penisilin, ampisilin, linkomisin, klindamisin, eritromisin", "Ölümcül enterit"], ["Streptomisin (fare, gerbil)", "Toksik"]],
  ferret: [["Asetaminofen (parasetamol)", "Karaciğer toksisitesi"], ["Şeker ve karbonhidratlı ödüller", "İnsülinomayı tetikler"]],
  bird: [["Fenbendazol / albendazol", "Kemik iliği baskılanması"], ["İtrakonazol (Afrika grisinde yüksek doz)", "Toksisite"], ["Teflon (PTFE) dumanı, avokado, çikolata, kafein, alkol", "Ölümcül zehirlenme"], ["Aminoglikozitler (gentamisin)", "Böbrek toksisitesi"]],
  tortoise: [["İVERMEKTİN", "Ölümcül nörotoksisite"], ["Aminoglikozitler dehidrasyonda", "Böbrek hasarı"]],
  lizard: [["İvermektin (bazı türlerde, ör. bukalemun, gekko) — dikkat", "Nörotoksisite"], ["Aminoglikozitler dehidrasyonda", "Böbrek hasarı"]],
  snake: [["Aminoglikozitler dehidrasyonda", "Böbrek hasarı"], ["Metronidazol yüksek doz (indigo ve kral yılanı)", "Nörotoksisite"]],
};

// ───────────── Hastalıklar ─────────────
// [ad, eş anlamlılar, türler (dizi), kimlerde, belirtiler, tanı, tedavi, prognoz/not]
export const EXOTIC_CASES = [
  // Tavşan
  ["GİS stazı (gastrointestinal hipomotilite)", ["gis staz", "bagirsak durmasi", "ileus", "gastrointestinal staz", "hipomotilite"], ["rabbit", "guineapig", "chinchilla"], "Düşük lifli diyet, stres, ağrı, diş sorunu olan tavşan ve kobaylar", "İştahsızlık, dışkı azalması veya yokluğu, küçük kuru dışkı, karın şişliği, karın ağrısı (dişlerini gıcırdatma, kambur duruş), halsizlik", "Karın palpasyonu, abdominal röntgen (gaz/obstrüksiyon ayrımı), glukoz (>20 mmol/L obstrüksiyonu düşündürür), diş muayenesi", "Sıvı (SC/IV), ağrı kesici (meloksikam, buprenorfin), şırıngayla lifli besleme (critical care), prokinetik (metoklopramid — obstrüksiyon yoksa), simetikon, hareket, altta yatan neden (diş) tedavisi", "Erken tedaviyle iyi; obstrüksiyonda acil cerrahi, prognoz ciddi"],
  ["Diş malokluzyonu ve kök uzaması", ["dis malokluzyon", "dis uzamasi", "kesici dis uzama", "molar dis", "dis sorunu", "malokluzyon"], ["rabbit", "guineapig", "chinchilla", "rodent"], "Az ot tüketen, pelet/kuru yem ağırlıklı beslenen; kalıtsal (cüce ırklar)", "Salya, iştahsızlık veya seçici yeme, kilo kaybı, yanakta veya çenede şişlik (apse), göz akıntısı (nazolakrimal kanal), dışkı azalması", "Ağız muayenesi (otoskop/endoskop), kafatası röntgeni veya BT", "Anestezi altında diş törpüleme (kesici dişler makasla kesilmez), apsede cerrahi debridman, ağrı kesici, lifli diyete geçiş", "Kronik; düzenli kontrol gerekir"],
  ["Encephalitozoon cuniculi", ["encephalitozoon", "e cuniculi", "e. cuniculi", "ensefalitozoon"], ["rabbit"], "Her yaştaki tavşanlar (çoğu taşıyıcı)", "Baş eğikliği, dönme, nistagmus, denge kaybı, arka bacak zayıflığı, idrar kaçırma, katarakt veya fakoklastik üveit, böbrek yetmezliği", "Seroloji (IgG/IgM), klinik bulgular; otitis media'yı ayırmak için bulla röntgeni/BT", "Fenbendazol 20 mg/kg PO 24 saatte bir 28 gün, destek bakım, gerekirse meloksikam, düşmeyi önleyen yumuşak zemin", "Baş eğikliği kalıcı kalabilir ama hayvan uyum sağlar"],
  ["Pastöreloz (burun akıntısı / snuffles)", ["pastoreloz", "pasteurella", "snuffles", "tavsan nezlesi"], ["rabbit"], "Stresli, kalabalık ortamdaki tavşanlar", "Hapşırma, beyaz-sarı burun akıntısı, ön bacakların iç yüzünde kirlenme, göz akıntısı, apse, baş eğikliği (otitis), pnömoni", "Burun sürüntüsü kültür-antibiyogram, PCR, kafatası/toraks röntgeni", "Kültüre göre uzun süreli antibiyotik (enrofloksasin, marbofloksasin, TMP-S; parenteral penisilin G yalnız enjeksiyon), nebulizasyon, apse cerrahisi", "Kronikleşir; tam iyileşme zor, kontrol altında tutulur"],
  ["Myiasis (sinek kurtlanması)", ["myiasis", "kurtlanma", "sinek larvasi", "flystrike"], ["rabbit", "guineapig"], "Yaz aylarında, kirli arka bölge, ishal, obezite veya artriti olan (kendini temizleyemeyen) tavşanlar", "Kuyruk ve anüs çevresinde larvalar, kötü koku, yaralar, halsizlik, şok", "Görsel muayene", "ACİL: larvaları tek tek temizleme, tüy kırpma, yara bakımı, sıvı, ağrı kesici, antibiyotik, ivermektin; altta yatan nedeni (ishal, obezite) düzeltme", "Erken müdahaleyle kurtarılabilir; ağır olgularda ölüm riski yüksek"],
  ["Uterus adenokarsinomu", ["uterus adenokarsinom", "rahim kanseri tavsan", "uterus tumoru"], ["rabbit"], "Kısırlaştırılmamış dişi tavşanlar (4 yaş üstü %50–80)", "İdrarda kan (aslında uterus kanaması), vulva akıntısı, karında kitle, meme kistleri, kilo kaybı", "Ultrason, abdominal palpasyon, toraks röntgeni (akciğer metastazı)", "Ovariohisterektomi (metastaz yoksa küratif)", "Erken cerrahiyle iyi; korunmak için genç yaşta kısırlaştırma"],
  ["Miksomatozis", ["miksomatozis", "myxomatosis"], ["rabbit"], "Aşısız tavşanlar; sivrisinek ve pire ile bulaşır", "Göz kapaklarında, kulaklarda ve genital bölgede şişlik, göz akıntısı, ateş, iştahsızlık, solunum güçlüğü", "Klinik bulgular, PCR", "Spesifik tedavi yok; destek tedavi ve sekonder enfeksiyon kontrolü; çoğu olguda ötanazi değerlendirilir", "Aşısızlarda ölüm oranı çok yüksek; aşı ve vektör kontrolüyle korunma"],
  ["Tavşan hemorajik hastalığı (RHDV1/RHDV2)", ["rhd", "rhdv", "hemorajik hastalik", "viral hemorajik"], ["rabbit"], "Aşısız tavşanlar; RHDV2 yavruları da etkiler", "Ani ölüm, ateş, halsizlik, burundan kanama, solunum güçlüğü, nöbet, sarılık", "Nekropside karaciğer nekrozu, PCR", "Tedavisi yok; destek tedavi; diğer tavşanların aşılanması ve dezenfeksiyon", "Ölüm oranı yüksek; RHDV1 ve RHDV2 aşıları ile korunma"],
  ["Pododermatit (sore hocks)", ["pododermatit", "sore hock", "ayak tabani yarasi"], ["rabbit", "guineapig"], "Obez, ağır, tel zeminde veya ıslak altlıkta tutulan, rex ırkı tavşanlar ve kobaylar", "Arka ayak tabanında tüysüzlük, kızarıklık, yara, kabuk, topallık", "Muayene, derin olgularda röntgen (osteomiyelit)", "Yumuşak ve kuru zemin, kilo verme, yara bakımı ve bandaj, kültüre göre antibiyotik, ağrı kesici", "Hafif olgular iyi; kemik tutulumunda zor"],
  ["Coccidiosis (tavşan)", ["koksidiyoz tavsan", "eimeria", "hepatik koksidiyoz"], ["rabbit"], "Yavru ve genç tavşanlar, kalabalık ortam", "İshal, kilo kaybı, karın şişliği, gelişme geriliği; hepatik formda sarılık ve karın büyümesi", "Dışkı flotasyonu (ookist)", "Toltrazuril veya TMP-S, sıvı desteği, hijyen", "Genç hayvanlarda ölümcül olabilir"],
  ["Kulak uyuzu (Psoroptes cuniculi)", ["psoroptes", "tavsan kulak uyuzu", "kulak uyuzu tavsan"], ["rabbit"], "Her yaştaki tavşanlar", "Kulak içinde kalın kahverengi kabuklar, kaşıntı, baş sallama, kulak düşmesi, ikincil otit", "Kabuk örneğinin mikroskobik incelemesi", "İvermektin 0,4 mg/kg SC 14 günde bir 2–3 kez veya selamektin; kabukları zorla sökmeyin, ağrı kesici", "İyi"],
  ["Hiperkalsiüri ve mesane çamuru", ["hiperkalsiuri", "mesane camuru", "idrar camuru", "kalsiyum tasi"], ["rabbit", "guineapig"], "Yonca ve kalsiyumdan zengin diyetle beslenen, hareketsiz, obez tavşan ve kobaylar", "İdrar yaparken zorlanma, kalın beyaz-bej idrar, idrar kaçırma, idrar yanığı, idrarda kan", "Röntgen, ultrason, idrar tahlili", "Mesane yıkama (sedasyonla), sıvı, ağrı kesici; taşta sistotomi; düşük kalsiyumlu diyet (yonca kesilir), su tüketimini artırma", "Diyet düzeltilmezse tekrarlar"],
  // Gine domuzu
  ["Hipovitaminoz C (iskorbüt)", ["iskorbut", "c vitamini eksikligi", "hipovitaminoz c", "skorbut"], ["guineapig"], "C vitamini desteği almayan veya bayat pelet yiyen kobaylar", "İştahsızlık, eklem şişliği ve ağrı (yürümekte isteksizlik), dişeti kanaması, kötü tüy, ishal, kilo kaybı, enfeksiyonlara yatkınlık", "Diyet öyküsü, klinik bulgular, röntgende epifiz değişiklikleri", "C vitamini 50–100 mg/kg/gün PO (iyileşince 10–30 mg/kg/gün), ağrı kesici, destek besleme", "Erken tedaviyle günler içinde düzelme"],
  ["Trixacarus caviae uyuzu", ["trixacarus", "kobay uyuzu", "sarkoptik uyuz kobay"], ["guineapig"], "Her yaştaki kobaylar; stres ve C vitamini eksikliği tetikler", "Şiddetli kaşıntı (nöbet benzeri kaşınma atakları), tüy dökülmesi, kabuklanma, kilo kaybı", "Deri kazıntısı (bazen negatif — tedaviye yanıt tanı koydurur)", "İvermektin 0,4–0,5 mg/kg SC 7–10 günde bir 3 kez veya selamektin; tüm kobaylar tedavi edilmeli; C vitamini", "Tedaviyle iyi"],
  ["Kobayda pnömoni (Bordetella / Streptococcus)", ["kobay pnomonisi", "bordetella kobay", "kobay solunum"], ["guineapig"], "Tavşanla aynı ortamda tutulan (Bordetella taşıyıcısı), stresli kobaylar", "Burun ve göz akıntısı, hapşırma, solunum güçlüğü, iştahsızlık, kilo kaybı, ani ölüm", "Toraks röntgeni, burun/trakea kültürü", "Enrofloksasin veya TMP-S, nebulizasyon, C vitamini, destek besleme, oksijen", "Ağır olgularda kötü"],
  ["Ovaryum kistleri (kobay)", ["ovaryum kisti", "over kisti", "yumurtalik kisti"], ["guineapig"], "2 yaş üstü dişi kobaylar (çok sık)", "Her iki yanda simetrik tüy dökülmesi (yanlar), karın büyümesi, meme ucu büyümesi, iştahsızlık", "Ultrason", "Ovariohisterektomi (tercih), hormonal tedavi (hCG, deslorelin) geçici", "Cerrahiyle iyi"],
  ["Ürolitiyazis (kobay)", ["kobay idrar tasi", "kobay urolit"], ["guineapig"], "Orta-ileri yaş kobaylar, yüksek kalsiyumlu diyet", "İdrar yaparken ses çıkarma, zorlanma, idrarda kan, kambur duruş, iştahsızlık", "Röntgen (kalsiyum karbonat taşlar opaktır), ultrason", "Sistotomi veya üretrostomi, ağrı kesici, sıvı, diyet düzenlemesi", "Tekrarlayabilir"],
  // Şinşilla
  ["Sıcak çarpması (şinşilla)", ["sinsilla sicak carpmasi", "isi stresi"], ["chinchilla"], "Ortam 25 °C üstü ve nemli olan şinşillalar", "Hızlı solunum, kızarık kulaklar, halsizlik, yan yatma, nöbet", "Öykü, vücut ısısı", "ACİL: serin ortam, ıslak bezle kulak ve ayakları soğutma (buzlu su değil), sıvı, oksijen", "Erken müdahale hayati"],
  ["Kürk çiğneme / tüy kayması", ["kurk cigneme", "tuy kaymasi", "fur slip", "kurk yolma"], ["chinchilla"], "Stresli, yanlış tutulmuş veya sıkılan şinşillalar", "Sırt ve yanlarda düzensiz kısalmış tüyler, tutulduğunda tüy demetlerinin dökülmesi", "Öykü, dermatofitoz dışlaması (mantar kültürü)", "Stres kaynağını giderme, doğru tutma, zenginleştirme, uygun diyet", "Davranışsal; ortam düzeltilince iyileşir"],
  ["Giardiyaz (şinşilla)", ["sinsilla giardia", "giardia sinsilla"], ["chinchilla"], "Genç şinşillalar, kalabalık ortam", "Yumuşak-sulu dışkı, kilo kaybı, kötü tüy", "Dışkı direkt bakı, ELISA", "Metronidazol (dikkatli) veya fenbendazol, hijyen", "İyi; taşıyıcılık sık"],
  // Kemirgen
  ["Proliferatif ileit (hamster ıslak kuyruk)", ["islak kuyruk", "wet tail", "proliferatif ileit", "lawsonia"], ["rodent"], "Sütten yeni kesilmiş (3–8 haftalık) hamsterlar, stres", "Kuyruk çevresinde ıslaklık, sulu ishal, kötü koku, halsizlik, iştahsızlık, dehidrasyon, ani ölüm", "Klinik tanı, PCR", "Sıvı (SC), enrofloksasin veya TMP-S, sıcak ortam, destek besleme", "Ölüm oranı yüksek; erken tedavi önemli"],
  ["Solunum mikoplazmozu (sıçan)", ["mikoplazma sican", "mycoplasma pulmonis", "sican solunum", "sican nezlesi"], ["rodent"], "Sıçanların çoğu taşıyıcı; stres, amonyak, tozlu altlık tetikler", "Hapşırma, burun ve gözde kırmızı-kahve akıntı (porfirin), hırıltı, solunum güçlüğü, baş eğikliği (otitis), kilo kaybı", "Klinik bulgular, PCR, toraks röntgeni", "Enrofloksasin + doksisiklin (birlikte) 2–4 hafta veya daha uzun, nebulizasyon, ortam havalandırması", "Kronik; tam iyileşme nadir, kontrol edilir"],
  ["Meme tümörü (sıçan)", ["sican meme tumoru", "fibroadenom"], ["rodent"], "Kısırlaştırılmamış dişi sıçanlar (çoğu benign fibroadenom)", "Deri altında, koltuk altından kasığa kadar herhangi bir yerde hızla büyüyen kitle", "Muayene, ince iğne aspirasyonu", "Cerrahi çıkarma (erken), kısırlaştırma tekrarı azaltır; deslorelin implantı", "Benign olgularda iyi; yenileri gelişebilir"],
  // Gelincik
  ["İnsülinoma (gelincik)", ["insulinoma gelincik", "gelincik hipoglisemi"], ["ferret"], "3 yaş üstü gelincikler (çok sık)", "Halsizlik, ağızdan salya, ağzını patileme, arka bacak zayıflığı, dalgın bakış, nöbet, bayılma", "Açlık kan glukozu <3,9 mmol/L (70 mg/dL), insülin ölçümü", "Acil: ağızdan bal/glukoz, IV dekstroz; uzun dönem: prednizolon + diazoksit, protein ağırlıklı sık öğün, cerrahi nodül çıkarma", "Kronik; aylar-yıllarca kontrol edilebilir"],
  ["Adrenal hastalık (gelincik)", ["adrenal hastalik", "hiperadrenokortisizm gelincik", "adrenokortikal"], ["ferret"], "3 yaş üstü kısırlaştırılmış gelincikler", "Kuyruktan başlayan simetrik tüy dökülmesi, kaşıntı, dişide vulva şişmesi, erkekte prostat büyümesi ve idrar yapamama, kas kaybı", "Ultrason (adrenal büyüme), seks hormonu paneli", "Deslorelin implantı (tercih), adrenalektomi; erkekte idrar tıkanıklığı ACİL", "İmplantla iyi kontrol"],
  ["Gelincik distemperi", ["gelincik distemper", "ferret distemper"], ["ferret"], "Aşısız gelincikler (köpek distemper virüsü)", "Ateş, göz-burun akıntısı, çene altında ve kasıkta kabuklanma, ayak tabanında sertleşme, nöbet", "Klinik bulgular, PCR", "Tedavisi yok (ölüm oranı ~%100); destek tedavi; diğer gelinciklerin aşılanması", "Aşı ile korunma şart"],
  ["Hiperöstrojenizm (gelincik)", ["hiperostrojenizm", "ostrojen toksisitesi", "uzamis ostrus"], ["ferret"], "Kısırlaştırılmamış ve çiftleşmeyen dişi gelincikler", "Uzun süren vulva şişmesi, tüy dökülmesi, solukluk, kanama (peteşi), halsizlik", "Hemogram (pansitopeni), anamnez", "hCG veya GnRH ile östrusu sonlandırma, kan transfüzyonu, iyileşince kısırlaştırma", "Kemik iliği baskılanması ağırsa kötü"],
  ["Gelincikte yabancı cisim", ["gelincik yabanci cisim"], ["ferret"], "Genç gelincikler (lastik, sünger); yaşlılarda tüy yumağı", "Kusma (gelincikte nadir), salya, ağzını patileme, iştahsızlık, ishal veya dışkı azalması, kilo kaybı", "Palpasyon, röntgen, ultrason", "Cerrahi (enterotomi/gastrotomi), sıvı", "Erken cerrahiyle iyi"],
  ["Helicobacter mustelae gastriti", ["helicobacter gelincik", "gelincik gastrit", "gelincik ulser"], ["ferret"], "Stresli gelincikler", "Kusma, siyah dışkı, diş gıcırdatma, salya, kilo kaybı", "Klinik tanı, tedaviye yanıt", "Amoksisilin + metronidazol + famotidin (veya klaritromisin + omeprazol) 2–4 hafta", "İyi"],
  // Kuş
  ["Psittakoz (Chlamydia psittaci)", ["psittakoz", "chlamydia psittaci", "papagan hastaligi", "ornitoz"], ["bird"], "Yeni alınmış, stresli, kalabalık ortamdaki kuşlar; sultan ve muhabbet kuşu sık", "Kabarık oturma, iştahsızlık, yeşil sarı ishal (biliverdinüri), göz ve burun akıntısı, solunum güçlüğü, kilo kaybı", "PCR (koanal-kloakal sürüntü), seroloji, hemogram (lökositoz), karaciğer enzimleri", "Doksisiklin 25–50 mg/kg PO 24 saatte bir 45 gün, destek tedavi, izolasyon; sahipler bilgilendirilmeli (zoonoz)", "Erken tedaviyle iyi; insanlara bulaşır"],
  ["Aspergillozis", ["aspergilloz", "aspergillus", "kus mantar enfeksiyonu"], ["bird"], "Afrika grisi, Amazon papağanları; A vitamini eksikliği, kötü havalandırma, küflü yem", "Ses değişikliği veya kaybı, kuyruk sallayarak solunum, solunum güçlüğü, egzersiz intoleransı, kilo kaybı", "Hemogram (lökositoz, monositoz), röntgen/BT, endoskopi, seroloji", "İtrakonazol veya vorikonazol (aylarca), nebulize antifungal, endoskopik debridman, A vitamini ve ortam düzeltmesi", "Kronik olgularda temkinli"],
  ["Yumurta bağlama (distosi)", ["yumurta baglama", "yumurtlayamama", "egg binding", "yumurta tikanmasi"], ["bird", "lizard", "tortoise", "snake"], "Dişi muhabbet ve sultan papağanı, kanarya; kalsiyum eksikliği, obezite, kronik yumurtlama; sürüngenlerde uygun yuva yeri eksikliği", "Kafes dibinde kabarık oturma, ıkınma, kuyruk sallama, karın şişliği, bacak felci, solunum güçlüğü; sürüngende kazıp yumurtlayamama, iştahsızlık", "Palpasyon, röntgen, kalsiyum ölçümü", "Kalsiyum glukonat IM, sıcak ve nemli ortam, sıvı, yağlama; gerekirse oksitosin (kalsiyumdan sonra), yumurta aspirasyonu veya cerrahi", "Erken müdahaleyle iyi; tekrarlayanlarda deslorelin veya salpingohisterektomi"],
  ["Tüy yolma (davranışsal / tıbbi)", ["tuy yolma", "feather plucking", "tuylerini yoluyor"], ["bird"], "Afrika grisi, kakadu, Amazon; yalnızlık, can sıkıntısı, beslenme bozukluğu, deri hastalığı", "Göğüs, kanat altı ve bacaklarda tüysüz alanlar, kırık tüyler, kendini yaralama", "Tıbbi nedenlerin dışlanması: hemogram, biyokimya, deri/tüy sitolojisi, PBFD PCR, ağır metal", "Altta yatan tıbbi nedeni tedavi, çevresel zenginleştirme, sosyal etkileşim, pelet diyet, gerekirse yaka ve davranış ilacı", "Kronikleşebilir; erken müdahale önemli"],
  ["Gaga ve tüy hastalığı (PBFD)", ["pbfd", "gaga ve tuy hastaligi", "circovirus kus"], ["bird"], "Genç papağanlar (kakadu, Afrika grisi, muhabbet kuşu)", "Anormal, kıvrık veya kırık tüyler, tüy kaybı, gaga uzaması ve kırılması, bağışıklık baskılanması", "PCR (kan ve tüy)", "Tedavisi yok; destek tedavi, sekonder enfeksiyon kontrolü, izolasyon", "Genellikle ilerleyici ve ölümcül"],
  ["Gaga ve ayak uyuzu (Knemidokoptes)", ["knemidokoptes", "gaga uyuzu", "ayak uyuzu kus", "scaly face"], ["bird"], "Muhabbet kuşları (sık), kanaryalar (bacakta)", "Gaga, mum ve göz çevresinde süngerimsi beyaz kabuklar, gaga şekil bozukluğu, bacaklarda pullanma", "Kabuk kazıntısında akar", "İvermektin 0,2 mg/kg topikal veya PO, 2–3 hafta arayla tekrar; tüm kuşlar tedavi edilmeli", "Gaga şekil bozukluğu kalıcı olabilir"],
  ["Megabakteri (Macrorhabdus ornithogaster)", ["megabakteri", "macrorhabdus", "avian gastric yeast"], ["bird"], "Muhabbet kuşu, sultan papağanı, kanarya", "Kilo kaybına rağmen iştah, tohumu kırıp yutmadan bırakma, kusma, sindirilmemiş tohum içeren dışkı, kabarık oturma", "Dışkı direkt bakı ve Gram boyama", "Amfoterisin B PO 14–30 gün, destek besleme", "Ağır olgularda kötü; taşıyıcılık sık"],
  ["Kandidiyazis (kuş)", ["kandidiyaz kus", "candida kus", "kursak enfeksiyonu"], ["bird"], "Yavrular, antibiyotik kullanımı, A vitamini eksikliği", "Kursakta gecikmiş boşalma, kusma, ağızda beyaz plaklar, iştahsızlık", "Kursak yıkama sitolojisi", "Nistatin PO, dirençte flukonazol, A vitamini ve diyet düzeltmesi", "İyi"],
  ["Hipokalsemi sendromu (Afrika grisi)", ["hipokalsemi kus", "afrika grisi kalsiyum", "kalsiyum eksikligi kus"], ["bird"], "Tohum diyetiyle beslenen Afrika gri papağanları, sürekli yumurtlayan dişiler", "Dengesizlik, düşme, titreme, nöbet, yumurta bağlama, ince kabuklu yumurta", "İyonize kalsiyum ölçümü", "Kalsiyum glukonat IM, sonra oral kalsiyum ve D3, UVB ışığı, pelet diyet", "Diyet düzeltilirse iyi"],
  ["Teflon (PTFE) zehirlenmesi", ["teflon zehirlenmesi", "ptfe", "teflon"], ["bird"], "Mutfakta veya yakınında tutulan kuşlar; aşırı ısınan yapışmaz tava", "Ani solunum güçlüğü, ağız açık soluma, dengesizlik, kollaps, ani ölüm (dakikalar içinde)", "Öykü", "ACİL: temiz havaya çıkarma, oksijen, destek tedavi; çoğu olguda ölümcül", "Korunma: kuşları mutfaktan uzak tutun, yapışmaz tavayı aşırı ısıtmayın"],
  ["Ağır metal (çinko / kurşun) zehirlenmesi", ["agir metal", "cinko zehirlenmesi", "kursun zehirlenmesi kus"], ["bird"], "Kafes teli, galvanizli malzeme, eski boya, perde kurşunu kemiren papağanlar", "Halsizlik, kusma, kanlı veya yeşil ishal, idrarda kan, poliüri, nöbet, dengesizlik", "Kan çinko/kurşun düzeyi, röntgende metal yoğunluk", "Şelasyon (CaEDTA IM, DMSA PO), metal parçanın çıkarılması, sıvı ve destek", "Erken tedaviyle iyi"],
  ["Obezite ve lipom (muhabbet kuşu)", ["lipom kus", "obezite kus", "yagli karaciger kus", "hepatik lipidoz kus"], ["bird"], "Tohum ağırlıklı beslenen, hareketsiz muhabbet ve sultan papağanları", "Göğüs veya karında yumuşak sarı kitle, kilo artışı, solunum güçlüğü, gaga ve tırnak aşırı uzaması (karaciğer)", "Muayene, biyokimya (safra asitleri), röntgen", "Pelet-sebze diyetine kademeli geçiş, egzersiz, büyük lipomda cerrahi", "Diyetle düzelir"],
  // Kertenkele, kaplumbağa
  ["Metabolik kemik hastalığı", ["metabolik kemik", "mbd", "sekonder hiperparatiroidizm", "kabuk yumusamasi", "kemik yumusamasi"], ["lizard", "tortoise"], "UVB'siz ortamda tutulan, kalsiyum desteği almayan genç iguana, sakallı ejder ve kaplumbağalar", "Çene ve bacaklarda şişlik/yumuşama, kırıklar, titreme, kas seğirmesi, yürümede güçlük, kabuk yumuşaması veya şekil bozukluğu, iştahsızlık", "Röntgen (kemik yoğunluğu, kırık), kalsiyum ve fosfor ölçümü", "Kalsiyum glukonat (akut), oral kalsiyum, UVB lambası ve uygun sıcaklık, doğru diyet; kırıklara destek; D3 enjeksiyonu yalnızca dikkatle", "Erken düzeltilirse iyi; şekil bozuklukları kalıcı"],
  ["Deri değiştirememe (disekdisis)", ["disekdisis", "deri degistirememe", "kabuk degistirememe", "gomlek atamama"], ["lizard", "snake"], "Düşük nem, dehidrasyon, akar veya hastalık", "Parmak ve kuyruk ucunda kalmış eski deri (halka şeklinde daralma), gözde kalmış göz pulu (yılanda)", "Muayene", "Ilık su banyosu ve nem artırma, nazikçe soyma, göz pulunu zorla çıkarmama; altta yatan nedeni düzeltme", "Parmak/kuyruk ucunda dolaşım bozukluğu ve kayıp olabilir"],
  ["Stomatit (ağız çürüklüğü)", ["stomatit", "agiz curuklugu", "mouth rot", "infeksiyoz stomatit"], ["lizard", "snake"], "Düşük ortam ısısı, stres, ağız travması", "Ağızda kızarıklık, peteşi, peynirimsi irin, iştahsızlık, ağızdan salya/köpük", "Muayene, kültür, röntgen (kemik tutulumu)", "Ortam ısısını düzeltme, ağız temizliği (klorheksidin), kültüre göre sistemik antibiyotik (seftazidim, enrofloksasin)", "Erken iyi; osteomiyelitte zor"],
  ["Sürüngende solunum yolu enfeksiyonu", ["surungen solunum", "kaplumbaga solunum", "yilan solunum", "rti"], ["lizard", "tortoise", "snake"], "Düşük ortam ısısı, A vitamini eksikliği (kaplumbağa), stres", "Ağız açık soluma, hırıltı, burun ve ağızdan köpüklü akıntı, iştahsızlık, halsizlik, suda yan yüzme (su kaplumbağası)", "Toraks röntgeni (iki yönlü), trakea yıkama kültürü", "Ortam ısısını tercih edilen üst sınıra çıkarma, kültüre göre antibiyotik (seftazidim, enrofloksasin), nebulizasyon, sıvı ve besleme", "Erken tedaviyle iyi"],
  ["Hipovitaminoz A (kaplumbağa)", ["hipovitaminoz a", "a vitamini eksikligi", "goz kapagi sisligi kaplumbaga"], ["tortoise", "lizard"], "Etle veya marul ağırlıklı dengesiz beslenen su kaplumbağaları", "Göz kapaklarında şişlik ve gözü açamama, burun akıntısı, iştahsızlık, deri ve kabuk değişiklikleri, solunum enfeksiyonu", "Diyet öyküsü, klinik bulgular", "Diyet düzeltmesi (koyu yeşil yapraklılar, uygun pelet), vitamin A IM (dikkatli), göz damlası, sekonder enfeksiyon tedavisi", "Erken düzelir"],
  ["Kabuk çürüklüğü (septik kabuk hastalığı)", ["kabuk curuklugu", "shell rot", "septik kabuk"], ["tortoise"], "Kirli su, yetersiz kuruma ve ısınma imkânı olan su kaplumbağaları", "Kabukta yumuşak, kötü kokulu, renk değiştirmiş, çukurlaşmış alanlar, plakların kalkması", "Muayene, kültür", "Debridman, povidon iyot/klorheksidin, kuru tutma, sistemik antibiyotik, ortam hijyeni ve UVB", "Erken iyi; derin tutulumda uzun tedavi"],
  ["Kış uykusu sonrası iştahsızlık", ["kis uykusu sonrasi", "post hibernasyon", "hibernasyon"], ["tortoise"], "Uzun, soğuk veya hastayken kış uykusuna yatırılmış kara kaplumbağaları", "Uyandıktan sonra yememe, içmeme, halsizlik, gözlerde şişlik, kilo kaybı", "Kan biyokimyası (ürik asit, glukoz), kilo takibi", "Sıcak ortam ve UVB, ılık banyo (sıvı alımı), sıvı, gerekirse sonda ile besleme; altta yatan hastalığı araştırma", "Erken müdahaleyle iyi"],
  ["Yumurta tutulması (preovulatuar stazis)", ["preovulatuar stazis", "folikuler stazis", "yumurta tutulmasi kertenkele"], ["lizard"], "Yetişkin dişi iguana, sakallı ejder ve gekkolar", "İştahsızlık, karında şişlik, halsizlik, kilo kaybı", "Ultrason, röntgen", "Ovariektomi (stazis), uygun yumurtlama ortamı ve kalsiyum", "Cerrahiyle iyi"],
  ["Akar enfestasyonu (yılan)", ["yilan akari", "ophionyssus", "surungen akari"], ["snake", "lizard"], "Yeni alınmış veya kalabalık koleksiyondaki yılanlar", "Pullar arasında ve göz çevresinde hareketli siyah-kırmızı noktalar, su kabında boğulmuş akarlar, sık su banyosu, deri değiştirme sorunları", "Muayene", "Hayvan ve terraryumun birlikte tedavisi (ivermektin spreyi — kaplumbağada değil, fipronil spreyi seyreltik), terraryum dezenfeksiyonu, karantina", "İyi"],
  ["İnklüzyon cisimcik hastalığı (IBD)", ["inkluzyon cisimcik", "inclusion body", "arenavirus yilan"], ["snake"], "Boa ve pitonlar", "Yıldız bakışı (başını yukarı tutma), dönme, kendini çeviremem, kusma, stomatit, kilo kaybı", "Kan veya biyopside inklüzyon cisimcikleri, PCR", "Tedavisi yok; destek ve karantina", "İlerleyici ve ölümcül"],
  ["İç parazitler (sürüngen)", ["surungen parazit", "pinworm surungen", "koksidiya surungen"], ["lizard", "tortoise", "snake"], "Yeni alınmış veya yabani kökenli sürüngenler", "Kilo kaybı, iştahsızlık, ishal, kötü kokulu dışkı, büyüme geriliği", "Dışkı flotasyonu ve direkt bakı", "Fenbendazol (nematod), toltrazuril veya TMP-S (koksidiya), metronidazol (protozoa); terraryum hijyeni", "Tedaviyle iyi"],
];

// ───────────── Sorgu ─────────────
const reOf = s => new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
const weightOf = t => {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilogram)\b/) || t.match(/(\d+(?:[.,]\d+)?)\s*(gr|gram|g)\b/);
  if (!m) return NaN;
  const v = num(m[1]);
  return /^g/.test(m[2]) ? v / 1000 : v;
};
const NOTE = "Egzotik hayvanlarda ilaçların çoğu prospektüs dışıdır; dozlar Carpenter's Exotic Animal Formulary ve BSAVA kılavuzlarındaki genel aralıklardır. Küçük hayvanlarda ilacı seyreltip insülin şırıngasıyla ölçün; tür, sağlık durumu ve etkileşimleri hekim değerlendirir.";

function caseCard(c, t, sp) {
  const [name, , sps, who, signs, dx, tx, prog] = c;
  const focus = /\b(tedavi\w*|ilac\w*|ne verilir|yaklasim\w*)\b/.test(t) ? "tx" : /\b(tani\w*|test\w*|teshis\w*)\b/.test(t) ? "dx" : /\b(belirti\w*|bulgu\w*|semptom\w*)\b/.test(t) ? "signs" : "";
  const rows = [["signs", "Belirtiler", signs], ["dx", "Tanı", dx], ["tx", "Tedavi", tx], ["prog", "Prognoz / not", prog]];
  if (focus) rows.sort((a, b) => (b[0] === focus) - (a[0] === focus));
  return {text: name + " · " + sps.map(SP).join(", "), stats: [["Kimlerde", who]], items: rows.map(([, l, v]) => [v, l]),
    note: (sp && !sps.includes(sp) ? "Not: bu hastalık daha çok " + sps.map(SP).join(", ").toLocaleLowerCase("tr-TR") + " türlerinde görülür. " : "") + "Doz için ilaç adını, türü ve kiloyu/gramı yazın (ör. “1,5 kg tavşan meloksikam dozu”). " + NOTE};
}

function doseCard([name, , dose, route, warnings, products], sp, weight) {
  const d = dose[sp];
  const banned = (BANNED[sp] || []).find(([drug]) => fold(drug).includes(fold(name).split(" ")[0]));
  const stats = [], items = [];
  if (!d) {
    const known = Object.keys(dose).map(SP).join(", ");
    return {text: name + " · " + SP(sp), urgent: !!banned, stats: [["Bu tür için", banned ? "KULLANMAYIN — " + banned[1] : "Kayıtlı doz yok"]], items: [["Dozu kayıtlı türler: " + known, ""], ...warnings.map(w => ["⚠ " + w, ""])], note: NOTE};
  }
  const unit = d[2] || "mg/kg";
  stats.push([SP(sp) + " doz aralığı", (d[0] === d[1] ? fmt(d[0], 3) : fmt(d[0], 3) + "–" + fmt(d[1], 3)) + " " + unit]);
  if (weight > 0 && unit.endsWith("/kg")) {
    const lo = d[0] * weight, hi = d[1] * weight, u = unit.replace("/kg", "");
    stats.push([(weight < 1 ? fmt(weight * 1000, 0) + " g" : fmt(weight) + " kg") + " için toplam", (lo === hi ? fmt(lo, 3) : fmt(lo, 3) + "–" + fmt(hi, 3)) + " " + u]);
    if (u === "mg") for (const [label, c] of products) items.push([label, (lo === hi ? fmt(lo / c, 3) : fmt(lo / c, 3) + "–" + fmt(hi / c, 3)) + " mL"]);
  }
  stats.push(["Yol · sıklık", route]);
  for (const w of warnings) items.push(["⚠ " + w, ""]);
  if (banned) items.unshift(["⛔ " + banned[0] + ": " + banned[1], ""]);
  return {text: name + " · " + SP(sp) + (weight > 0 ? " · " + (weight < 1 ? fmt(weight * 1000, 0) + " g" : fmt(weight) + " kg") : ""), stats, items,
    note: NOTE + (weight > 0 ? "" : " Ağırlığı yazarsanız (ör. “35 g muhabbet kuşu” veya “1,2 kg tavşan”) toplam miktarı ve mL'yi hesaplarım.")};
}

function symptomCard(t, text, sp) {
  const asked = extractSymptoms(text);
  if (!asked.length) return null;
  const pool = EXOTIC_CASES.filter(c => c[2].includes(sp));
  const scored = pool.map(c => {
    const set = new Set(extractSymptoms(c[4] + " " + c[0]));
    const hit = asked.filter(s => set.has(s));
    return {c, hit, score: hit.length + (fold(c[4]).slice(0, 80) && hit.filter(s => extractSymptoms(c[4].slice(0, 90)).includes(s)).length * 0.5)};
  }).filter(x => x.hit.length).sort((a, b) => b.hit.length - a.hit.length || b.score - a.score).slice(0, 8);
  if (!scored.length) return null;
  return {text: "Bu belirtiler " + SP(sp).toLocaleLowerCase("tr-TR") + " türünde şu hastalıklarda görülebilir",
    stats: [["Değerlendirilen belirtiler", asked.join(", ")]],
    items: scored.map(x => [x.c[0], "Eşleşen: " + x.hit.join(", ").toLocaleLowerCase("tr-TR"), "ask:" + SP(sp).split(" ")[0] + " " + x.c[0] + " tedavisi"]),
    note: "Egzotiklerde hastalıkların çoğu barınma ve beslenme hatasından kaynaklanır; ortam ısısı, UVB, diyet ve hijyeni mutlaka sorgulayın. Bir hastalığa dokunursanız belirti, tanı ve tedavi kartını açarım. Karar desteğidir; kesin tanı hekime aittir."};
}

function basicsCard(sp) {
  const b = BASICS[sp];
  if (!b) return null;
  return {text: SP(sp) + " · normal değerler ve temel bakım", stats: b.vitals, items: [...b.care.map(c => [c, "Bakım"]), ...(BANNED[sp] || []).map(([d, why]) => ["⛔ " + d, why])],
    note: "Bu türdeki hastalıklar için belirti (ör. “tavşan yemiyor dışkı yok”), hastalık adı (ör. “E. cuniculi tedavisi”) veya ilaç ve ağırlık (ör. “1,2 kg tavşan enrofloksasin”) yazabilirsiniz."};
}

/** Egzotik hayvan sorusu ise yanıt; değilse null (köpek/kedi soruları diğer modüllere kalır). */
export function exoticAnswer(text) {
  const t = fold(text);
  if (!t) return null;
  const sp = exoticSpecies(t);
  // Hastalık adı (türe özgü adlar türsüz de tanınır: psittakoz, miksomatozis, iskorbüt…)
  let best = null, len = 0;
  for (const c of EXOTIC_CASES) {
    if (sp && !c[2].includes(sp)) continue;
    for (const k of [fold(c[0]).replace(/\s*\(.*?\)\s*/g, " ").trim(), ...c[1]]) if (k.length >= 5 && k.length > len && reOf(k).test(t)) { best = c; len = k.length; }
  }
  if (!sp && !best) return null;
  const weight = weightOf(t);
  // İlaç dozu / türde güvenlik
  const drug = DRUGS.find(d => [fold(d[0]), ...d[1]].some(s => reOf(s).test(t)));
  if (sp && drug) return doseCard(drug, sp, weight);
  if (sp && /\b(verilmez|verilir mi|kullanilir mi|tehlikeli ilac\w*|zararli ilac\w*|yasak ilac\w*|toksik ilac\w*|kullanilmamasi gereken)\b/.test(t)) {
    return {text: SP(sp) + " · kullanılmaması veya dikkat edilmesi gereken ilaçlar", items: (BANNED[sp] || []).map(([d, why]) => ["⛔ " + d, why]), note: NOTE};
  }
  if (best) return caseCard(best, t, sp);
  const sym = symptomCard(t, text, sp);
  if (sym) return sym;
  // Türe özgü hastalık listesi
  if (/\b(hastalik\w*|sik gorulen|neler olur)\b/.test(t)) {
    const list = EXOTIC_CASES.filter(c => c[2].includes(sp));
    return {text: SP(sp) + " · sık görülen hastalıklar", items: list.map(c => [c[0], c[4].split(",").slice(0, 3).join(","), "ask:" + SP(sp).split(" ")[0] + " " + c[0] + " tedavisi"]), note: "Bir hastalığa dokunun; belirti, tanı ve tedavi kartını açarım."};
  }
  if (/\b(normal|ates|nabiz|solunum|vital|yasamsal|bakim\w*|beslen\w*|omur|kac yil|nasil bakilir|degerler\w*)\b/.test(t) || t.split(" ").length <= 3) return basicsCard(sp);
  return basicsCard(sp);
}

export const EXOTIC_STATS = {species: Object.keys(EXOTIC).length, cases: EXOTIC_CASES.length, drugs: DRUGS.length, speciesNames: Object.values(EXOTIC).map(([n]) => n)};
