// VetZimo · VeBot klinik bilgi eki (çevrimdışı, ücretsiz).
// 1) Sohbete yazılan hemogram / biyokimya / kan gazı değerlerini kedi-köpek aralıklarıyla yorumlar (lab-interpret motoru).
// 2) Laboratuvar anormalliklerinin nedenleri ve önerilen tetkikler (trombositopeni, hiperkalemi, metabolik asidoz…).
// 3) Panel referans listeleri ve adım adım kan gazı yorumu. 4) Ek ayırıcı tanılar. 5) Beşeri ve ek veteriner ilaç dozları.
// Kaynaklar: Plumb's Veterinary Drug Handbook (genel aralıklar), BSAVA Small Animal Formulary, MSD Veterinary Manual,
// Ettinger Textbook of Veterinary Internal Medicine. Kesin tanı, doz ve tedavi kararı hekimindir; ürün prospektüsü önceliklidir.
import {interpretLabs, codeFor, LAB_REF, LAB_LABEL} from "./lab-interpret.js?v=20261125-r3";
import {CASES} from "./vet-cases.js?v=2";
import {symptomAnswer, extractSymptoms} from "./vet-symptoms.js?v=3";

const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9.,/%\s-]/g, " ").replace(/\s+/g, " ").trim();
const fmt = (v, d = 2) => Number.isFinite(v) ? new Intl.NumberFormat("tr-TR", {maximumFractionDigits: d}).format(v) : "—";
const range = (a, b, d = 2) => a === b ? fmt(a, d) : fmt(a, d) + "–" + fmt(b, d);
const SP_TR = {dog: "Köpek", cat: "Kedi"};
const speciesOf = t => /\b(kedi\w*|cat|feline)\b/.test(t) ? "cat" : /\b(kope[kg]\w*|dog|canine)\b/.test(t) ? "dog" : "";
const weightOf = t => { const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilogram)\b/); return m ? Number(m[1].replace(",", ".")) : NaN; };
const NOTE = "Karar desteğidir; kesin tanı ve tedavi kararı hekime aittir. Cihazınızın referans aralığı önceliklidir.";
const ASK = /\b(neden\w*|sebep\w*|olasi\w*|ayirici\w*|ayirt\w*|ddx|ne olabilir|ne demek|nedir|anlami\w*|yorum\w*|degerlendir\w*|tani\w*|yaklasim\w*|tedavi\w*)\b/;

// ───────────── 1) Yazılan laboratuvar değerleri ─────────────
const UNIT = {WBC: "×10⁹/L", RBC: "×10¹²/L", HGB: "g/dL", HCT: "%", MCV: "fL", MCH: "pg", MCHC: "g/dL", PLT: "×10⁹/L", NEU: "×10⁹/L", LYM: "×10⁹/L", MON: "×10⁹/L", EOS: "×10⁹/L", BAS: "×10⁹/L", RETIC: "×10⁹/L",
  GLU: "mg/dL", BUN: "mg/dL", CRE: "mg/dL", SDMA: "µg/dL", ALT: "U/L", AST: "U/L", ALP: "U/L", GGT: "U/L", TBIL: "mg/dL", TP: "g/dL", ALB: "g/dL", GLOB: "g/dL", "A/G": "", CHOL: "mg/dL", TG: "mg/dL",
  AMY: "U/L", LIP: "U/L", CK: "U/L", Ca: "mg/dL", P: "mg/dL", Mg: "mg/dL", Na: "mmol/L", K: "mmol/L", Cl: "mmol/L", FRU: "µmol/L", NH3: "µmol/L", CRP: "mg/L", T4: "µg/dL",
  pH: "", pCO2: "mmHg", pO2: "mmHg", HCO3: "mmol/L", TCO2: "mmol/L", BE: "mmol/L", LAC: "mmol/L", iCa: "mmol/L", AG: "mmol/L", sO2: "%"};
const PANELS = [
  ["Hemogram", /\b(hemogram|tam kan|cbc|kan sayimi)\b/, ["WBC", "RBC", "HGB", "HCT", "MCV", "MCH", "MCHC", "PLT", "NEU", "LYM", "MON", "EOS", "BAS", "RETIC"]],
  ["Biyokimya", /\b(biyokimya|biokimya|kan kimyasi|chemistry)\b/, ["GLU", "BUN", "CRE", "SDMA", "ALT", "AST", "ALP", "GGT", "TBIL", "TP", "ALB", "GLOB", "A/G", "CHOL", "TG", "AMY", "LIP", "CK", "Ca", "P", "Mg", "Na", "K", "Cl", "FRU", "NH3", "T4"]],
  ["Kan gazı", /\b(kan gazi|kangazi|blood gas|asit baz|asit-baz)\b/, ["pH", "pCO2", "pO2", "HCO3", "TCO2", "BE", "LAC", "iCa", "AG", "sO2", "Na", "K", "Cl"]],
];
const PAIR = /([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9./%#+-]{0,14})(?:\s*[:=]\s*|\s+)([<>]?[-+]?\d+(?:[.,]\d+)?)(?![\d.,]*\s*(?:kg|mg|ml|gr|gram|tablet|yas|ay)\b)/g;

function labValues(text, t, context) {
  const seen = new Map();
  for (const m of String(text).matchAll(PAIR)) {
    const code = codeFor("", m[1]);
    if (!code || seen.has(code)) continue;
    if (/^(kg|mg|ml|gr|gun|yas|ay)$/i.test(m[1])) continue;
    seen.set(code, m[2].replace(",", "."));
  }
  if (!seen.size) return null;
  const asked = ASK.test(t) || /\b(normal mi|yuksek mi|dusuk mu|kedi\w*|kope[kg]\w*)\b/.test(t);
  if (seen.size < 2 && !asked) return null;
  // Tek değer + ilaç sorusu (ör. "glukoz 450 köpek insülin dozu") ilaç tarafına bırakılır.
  if (seen.size < 2 && /\b(doz|dozu|mg\/kg)\b/.test(t)) return null;
  let species = speciesOf(t) || context.species || "";
  const guessed = species !== "cat" && species !== "dog";
  if (guessed) species = "dog";
  const lines = [...seen].map(([c, v]) => c + ": " + v).join("\n");
  const res = interpretLabs({panels: [{result: lines}], species: species === "cat" ? "Kedi" : "Köpek"});
  if (!res.rows.length) return null;
  const normal = res.rows.filter(r => r.status === "normal").map(r => r.name);
  const items = [
    ...res.critical.map(x => ["⚠ " + x, "Kritik"]),
    ...res.abnormal.map(r => [`${r.name}: ${r.raw} ${r.unit || UNIT[r.code] || ""}`.trim(), `${r.status === "high" ? "↑ Yüksek" : "↓ Düşük"} · ${r.degree}`]),
    ...(normal.length ? [["Normal aralıkta: " + normal.join(", "), ""]] : []),
    ...res.findings.slice(0, 8).map(f => [f.title + (f.parts.length ? ": " + f.parts.join(" ") : ""), "Değerlendirme"]),
    ...res.differentials.slice(0, 8).map(x => [x, "Olası neden"]),
    ...res.tests.slice(0, 6).map(x => [x, "Önerilen tetkik"]),
    ...res.approach.slice(0, 5).map(x => [x, "Yaklaşım"]),
  ];
  // Tek değerde motor bulgu üretmediyse anormallik bilgi kartı eklenir.
  if (!res.findings.length && res.abnormal.length) for (const r of res.abnormal.slice(0, 3)) {
    const card = causeCard(r.code, r.status);
    if (card) items.push(...card.causes.slice(0, 8).map(c => [c, "Olası neden"]), ...card.tests.slice(0, 4).map(c => [c, "Önerilen tetkik"]));
  }
  return {text: (context.name ? context.name + " · " : "") + "Laboratuvar yorumu · " + SP_TR[species], urgent: res.critical.length > 0,
    stats: [["Okunan değer", String(res.rows.length)], ["Aralık dışı", String(res.abnormal.length)]], items,
    note: (guessed ? "Tür yazılmadığı için köpek aralıkları kullanıldı; kedi için “kedi” ekleyin. " : "") + NOTE};
}

// ───────────── 2) Laboratuvar anormallikleri: nedenler ─────────────
// [tetikleyici, başlık, kod, yön, nedenler, tetkikler]
const CAUSES = [
  [/\b(trombositopeni|trombosit (dusuk|dusuklugu|az)|plt (dusuk|dusuklugu))/, "Trombositopeni", "PLT", "low",
    ["Psödotrombositopeni: pıhtılaşmış örnek, trombosit kümelenmesi (özellikle kedi) — yayma ile doğrulayın", "İmmün aracılı trombositopeni (ITP; çoğunlukla <30 ×10⁹/L)", "Vektörle bulaşan enfeksiyonlar: Ehrlichia, Anaplasma, Babesia, Leishmania", "Yaygın damar içi pıhtılaşma (DIC), sepsis", "Kemik iliği baskılanması: FeLV/FIV, ilaç (kemoterapi, östrojen, kloramfenikol), myeloftizi", "Kanama ile tüketim (genelde hafif-orta düşüş)", "Cavalier King Charles, Greyhound'da ırka özgü düşük/büyük trombositler"],
    ["Yayma (kümelenme, makrotrombosit)", "Vektör hastalıkları için SNAP 4Dx / PCR", "PT, aPTT, fibrinojen, D-dimer", "FeLV/FIV (kedi)", "Gerekirse kemik iliği aspirasyonu"]],
  [/\b(trombositoz|trombosit (yuksek|yuksekligi|fazla))/, "Trombositoz", "PLT", "high",
    ["Reaktif: inflamasyon, demir eksikliği anemisi, travma sonrası", "Splenektomi sonrası", "Glukokortikoid / hiperadrenokortisizm", "Neoplazi (paraneoplastik)", "Seyrek: esansiyel trombositemi"],
    ["Demir parametreleri", "İnflamasyon belirteçleri (CRP)", "Karın ultrasonu"]],
  [/\b(lokositoz|lokosit (yuksek|yuksekligi)|wbc (yuksek|yuksekligi))/, "Lökositoz", "WBC", "high",
    ["Fizyolojik (adrenalin): genç kedi, heyecan — lenfositoz ile birlikte", "Stres / steroid lökogramı: nötrofili + lenfopeni + eozinopeni (± monositoz)", "İnflamasyon/enfeksiyon: sola kayma (bant nötrofil) eşlik edebilir — piyometra, apse, pnömoni, peritonit", "İmmün aracılı hastalıklar (IMHA, poliartrit)", "Doku nekrozu, neoplazi", "Lösemi (çok yüksek değerler, atipik hücreler)"],
    ["Yayma ile lökosit formülü ve sola kayma", "CRP", "Görüntüleme (toraks röntgeni, karın USG)", "İdrar analizi ve kültür"]],
  [/\b(lokopeni|lokosit (dusuk|dusuklugu)|wbc (dusuk|dusuklugu))/, "Lökopeni", "WBC", "low",
    ["Viral: parvovirüs (köpek), panlökopeni (kedi), FeLV/FIV", "Aşırı tüketim: perakut sepsis, endotoksemi", "Kemik iliği baskılanması: kemoterapi, ilaçlar (kloramfenikol, azatioprin, metimazol)", "Ehrlichiozis (kronik)", "İmmün aracılı nötropeni"],
    ["Parvo/panlökopeni antijen testi", "FeLV/FIV", "Yayma", "Gerekirse kemik iliği"]],
  [/\b(notrofili|notrofil (yuksek|yuksekligi))/, "Nötrofili", "NEU", "high",
    ["Stres/kortikosteroid (olgun nötrofiller)", "Bakteriyel enfeksiyon / inflamasyon (sola kayma ile)", "Doku nekrozu, immün aracılı hastalık", "Fizyolojik (adrenalin)", "Paraneoplastik"],
    ["Sola kayma ve toksik değişiklik için yayma", "CRP", "Odak arama: görüntüleme, idrar"]],
  [/\b(notropeni|notrofil (dusuk|dusuklugu))/, "Nötropeni", "NEU", "low",
    ["Aşırı doku tüketimi: sepsis, peritonit, piyometra", "Parvo / panlökopeni", "Kemik iliği hastalığı, FeLV/FIV", "İlaç kaynaklı", "İmmün aracılı"],
    ["Yayma (sola kayma, toksik değişiklik)", "Viral testler", "Kemik iliği"]],
  [/\b(lenfopeni|lenfosit (dusuk|dusuklugu))/, "Lenfopeni", "LYM", "low",
    ["Stres/endojen veya ekzojen kortikosteroid (en sık)", "Akut viral enfeksiyon", "Şilotoraks / lenfanjiektazi (lenf kaybı)", "İmmünsüpresif tedavi"],
    ["Kortizol öyküsü", "Albümin ve kolesterol (lenfanjiektazi)", "Toraks görüntüleme"]],
  [/\b(lenfositoz|lenfosit (yuksek|yuksekligi))/, "Lenfositoz", "LYM", "high",
    ["Fizyolojik (adrenalin; genç kedide çok sık)", "Kronik antijenik uyarı (Ehrlichia vb.)", "Hipoadrenokortisizm (Addison) — stres altında normal/yüksek lenfosit uyarıcıdır", "Kronik lenfositik lösemi / lenfoma", "Aşılama sonrası (geçici)"],
    ["Yayma (atipik lenfosit)", "Kortizol / ACTH stimülasyon testi", "Vektör testleri", "Akım sitometri / PARR"]],
  [/\b(eozinofili|eozinofil (yuksek|yuksekligi))/, "Eozinofili", "EOS", "high",
    ["Parazitler (iç/dış, kalp kurdu)", "Alerjik hastalıklar (atopi, besin alerjisi, eozinofilik granülom kompleksi, kedi astımı)", "Eozinofilik bronkopnömopati, eozinofilik enterit", "Hipoadrenokortisizm", "Mast hücre tümörü, lenfoma (paraneoplastik)", "Hipereozinofilik sendrom (Rottweiler, kedi)"],
    ["Dışkı flotasyonu ve Baermann", "Kalp kurdu antijen testi", "Toraks röntgeni / BAL", "ACTH stimülasyonu"]],
  [/\b(monositoz|monosit (yuksek|yuksekligi))/, "Monositoz", "MON", "high",
    ["Stres / kortikosteroid (köpek)", "Kronik inflamasyon, granülomatöz hastalık", "Nekroz, immün aracılı hemoliz", "Monositik lösemi (seyrek)"], ["Yayma", "Görüntüleme"]],
  [/\b(anemi\w*|hct (dusuk|dusuklugu)|hematokrit (dusuk|dusuklugu)|pcv (dusuk|dusuklugu))/, "Anemi", "HCT", "low",
    ["Önce rejeneratif mi? Retikülosit: köpek >110, kedi >60 ×10⁹/L (agregat) rejeneratif", "Rejeneratif — kan kaybı: travma, GİS kanaması (melena), parazit (pire, kancalı kurt), rodentisit, koagülopati", "Rejeneratif — hemoliz: IMHA (sferosit, aglütinasyon), Babesia, Mycoplasma haemofelis, Heinz cisimciği (soğan, parasetamol), hipofosfatemi, zinc", "Non-rejeneratif: kronik hastalık/inflamasyon anemisi, kronik böbrek hastalığı (EPO eksikliği), demir eksikliği (mikrositer, hipokromik)", "Non-rejeneratif: FeLV/FIV, kemik iliği hastalığı, ehrlichiozis, endokrin (hipotiroidi, Addison)", "Akut kanamada ilk 3–5 gün retikülosit yanıtı görülmeyebilir (pre-rejeneratif)"],
    ["Retikülosit sayımı", "Yayma (sferosit, şistosit, Heinz, parazit)", "Lam aglütinasyonu / Coombs", "Total protein (kan kaybında birlikte düşer)", "PCR: Babesia, Mycoplasma; FeLV/FIV", "Demir profili, dışkıda gizli kan", "Gerekirse kemik iliği"]],
  [/\b(polisitemi|eritrositoz|hct (yuksek|yuksekligi)|hematokrit (yuksek|yuksekligi))/, "Eritrositoz (polisitemi)", "HCT", "high",
    ["Göreceli: dehidrasyon (TP de yüksek), splenik kontraksiyon (heyecan)", "Hemorajik gastroenterit (AHDS; HCT yüksek, TP normal/düşük)", "Sekonder: kronik hipoksi (sağdan sola şantlı kalp hastalığı, akciğer hastalığı), EPO salgılayan tümör (böbrek)", "Primer: polisitemia vera (dışlama tanısı)", "Irk: Greyhound ve tazılarda fizyolojik yüksek HCT"],
    ["Total protein ve hidrasyon", "Kan gazı / SpO2", "Ekokardiyografi", "Böbrek USG, EPO düzeyi"]],
  [/\b(mikrositoz|mcv (dusuk|dusuklugu))/, "Mikrositoz", "MCV", "low",
    ["Demir eksikliği (kronik kan kaybı: GİS, parazit)", "Portosistemik şant", "Irk: Akita, Shiba, Jindo (normal)", "Anemi of inflammation (hafif)"], ["Demir profili", "Safra asitleri / amonyak", "Dışkıda gizli kan"]],
  [/\b(makrositoz|mcv (yuksek|yuksekligi))/, "Makrositoz", "MCV", "high",
    ["Rejeneratif anemi (retikülositler)", "FeLV (kedi, rejenerasyon olmadan)", "Örnek bekletme / EDTA artefaktı, aglütinasyon", "Irk: Poodle makrositozu"], ["Retikülosit", "FeLV", "Yayma"]],
  [/\b(hiperglisemi|glukoz (yuksek|yuksekligi)|seker (yuksek|yuksekligi)|kan sekeri yuksek)/, "Hiperglisemi", "GLU", "high",
    ["Stres hiperglisemisi (kedide 300–400 mg/dL'ye çıkabilir)", "Diabetes mellitus (glukozüri ve kalıcı yükseklik)", "Diyabetik ketoasidoz (keton, metabolik asidoz)", "Hiperadrenokortisizm, akromegali (kedi), diöstrus/progesteron (köpek)", "İlaçlar: glukokortikoid, dekstrozlu sıvı, medetomidin/deksmedetomidin", "Pankreatit, yemek sonrası örnek"],
    ["Fruktozamin (kalıcı hiperglisemi)", "İdrar analizi: glukoz, keton, kültür", "Kan gazı (DKA)", "Lipaz / Spec cPL-fPL"]],
  [/\b(hipoglisemi|glukoz (dusuk|dusuklugu)|seker (dusuk|dusuklugu)|kan sekeri dusuk)/, "Hipoglisemi", "GLU", "low",
    ["Örnek artefaktı: serum ayrılmadan bekletme (in vitro glikoliz), lökositoz/polisitemi", "İnsülin aşırı dozu", "İnsülinoma (köpek; insülin/glukoz oranı)", "Sepsis, babesiozis", "Karaciğer yetmezliği, portosistemik şant", "Hipoadrenokortisizm", "Ksilitol zehirlenmesi (köpek)", "Yavru ve oyuncak ırklarda açlık hipoglisemisi, av köpeği hipoglisemisi", "Büyük tümörler (paraneoplastik), glikojen depo hastalıkları"],
    ["Örneği hemen ayırıp yeniden ölçüm", "Eşzamanlı insülin (glukoz <60 iken)", "Safra asitleri", "ACTH stimülasyonu", "Kan kültürü, karın USG"]],
  [/\b(azotemi|ure (yuksek|yuksekligi)|bun (yuksek|yuksekligi)|kreatinin (yuksek|yuksekligi)|crea (yuksek|yuksekligi)|bobrek degerleri yuksek)/, "Azotemi (BUN/kreatinin yüksekliği)", "CRE", "high",
    ["Prerenal: dehidrasyon, hipovolemi, kalp yetmezliği, Addison — idrar dansitesi konsantre (köpek >1.030, kedi >1.035)", "Renal: akut böbrek hasarı (toksin: etilen glikol, zambak, NSAİİ, üzüm; leptospiroz; pyelonefrit) veya kronik böbrek hastalığı — idrar izostenürik (1.008–1.012)", "Postrenal: üretral tıkanıklık (erkek kedi), mesane rüptürü, bilateral üreter tıkanıklığı", "Yalnız BUN yüksek: GİS kanaması, yüksek proteinli diyet, katabolizma", "Kas kütlesi yüksek köpeklerde (Greyhound) kreatinin fizyolojik yüksek"],
    ["İdrar dansitesi (sıvı tedavisinden ÖNCE)", "İdrar analizi, UPC, kültür", "SDMA", "Kan basıncı", "Böbrek USG ve röntgen (taş)", "Potasyum ve fosfor", "Leptospiroz testi (köpek)"]],
  [/\b(sdma (yuksek|yuksekligi))/, "SDMA yüksekliği", "SDMA", "high",
    ["Erken böbrek fonksiyon kaybı (GFR %25–40 azaldığında yükselir; kreatininden önce)", "Prerenal nedenler", "Akut böbrek hasarı", "Hipertiroid kedide kas kaybıyla kreatinin düşük kalırken SDMA böbrek fonksiyonunu daha iyi yansıtır"],
    ["İdrar dansitesi, UPC", "Kan basıncı", "IRIS evrelemesi için tekrar ölçüm (stabil hastada)"]],
  [/\b(alt (yuksek|yuksekligi|artisi)|karaciger enzim\w* (yuksek|yuksekligi)|hepatoselluler)/, "ALT yüksekliği", "ALT", "high",
    ["Hepatoselüler hasar: hepatit (kronik hepatit, bakır birikimi — Bedlington, Labrador, Dobermann)", "Toksinler/ilaçlar: ksilitol, NSAİİ (karprofen), parasetamol, fenobarbital, azatioprin, mantar, aflatoksin", "Hipoksi / şok, ağır anemi", "Enfeksiyonlar: leptospiroz, adenovirüs, toksoplazma, FIP", "Sekonder (reaktif) hepatopati: pankreatit, GİS hastalığı, sepsis, endokrin hastalıklar", "Neoplazi: lenfoma, hepatoselüler karsinom, metastaz", "Kedide hepatik lipidoz ve kolanjit (ALT ile birlikte bilirubin)", "Kas hasarı (AST ve CK ile birlikte, ALT hafif artar)"],
    ["Safra asitleri (karaciğer fonksiyonu)", "Karın USG", "Albümin, glukoz, kolesterol, BUN, bilirubin (fonksiyon)", "Pıhtılaşma profili (biyopsi öncesi)", "Leptospiroz testi", "Karaciğer biyopsisi + bakır ölçümü (kalıcı yükseklikte)"]],
  [/\b(alp (yuksek|yuksekligi|artisi)|alkalen fosfataz)/, "ALP yüksekliği", "ALP", "high",
    ["Köpekte steroid izoenzimi: ekzojen glukokortikoid, hiperadrenokortisizm (en sık), stres", "Kolestaz: safra kesesi mukoseli, kolanjiohepatit, pankreatit, safra yolu tıkanıklığı", "İlaç: fenobarbital", "Kemik: büyüyen yavru, osteosarkom, osteomiyelit", "Nodüler hiperplazi (yaşlı köpek)", "Kedide ALP yarı ömrü kısa — küçük artış bile anlamlı: hepatik lipidoz, hipertiroidi, kolanjit, diyabet"],
    ["GGT (kolestazda birlikte artar)", "Karın USG (safra kesesi, adrenal)", "ACTH stimülasyonu / düşük doz deksametazon testi", "T4 (kedi)", "Bilirubin"]],
  [/\b(ggt (yuksek|yuksekligi))/, "GGT yüksekliği", "GGT", "high",
    ["Kolestaz (safra yolu hastalığı, mukosel, pankreatit)", "Glukokortikoid indüksiyonu (köpek)", "Kedide kolanjit ve safra yolu hastalığı (hepatik lipidozda GGT genelde normaldir — ayırımda önemli)"], ["Karın USG", "Bilirubin, ALP", "Safra asitleri"]],
  [/\b(hiperbilirubinemi|bilirubin (yuksek|yuksekligi)|ikter\w*|sarilik)/, "Hiperbilirubinemi / ikter", "TBIL", "high",
    ["Prehepatik: hemoliz — HCT düşük (IMHA, Babesia, Mycoplasma, Heinz cisimciği)", "Hepatik: hepatit, kedi hepatik lipidozu, kolanjit, leptospiroz, sepsis, lenfoma, siroz", "Posthepatik: safra yolu tıkanıklığı (pankreatit, mukosel, tümör, taş), safra kesesi rüptürü (safra peritoniti)"],
    ["HCT ve yayma (hemoliz var mı?)", "ALT, ALP, GGT", "Karın USG", "Coombs / aglütinasyon", "Leptospiroz testi", "Abdominosentez (sıvı varsa bilirubin)"]],
  [/\b(hipoalbuminemi|albumin (dusuk|dusuklugu))/, "Hipoalbuminemi", "ALB", "low",
    ["Protein kaybettiren enteropati (globulin de düşük: panhipoproteinemi)", "Protein kaybettiren nefropati (globulin normal; UPC yüksek)", "Karaciğer yetmezliği (sentez azalması; BUN, glukoz, kolesterol de düşük)", "Kan kaybı, eksüdatif deri lezyonları, yanık", "Negatif akut faz proteini: inflamasyon, sepsis", "Malnütrisyon"],
    ["Globulin (birlikte mi düşük?)", "İdrar UPC", "Safra asitleri", "Kobalamin/folat, dışkı muayenesi, GİS biyopsisi", "Karın USG"]],
  [/\b(hiperglobulinemi|globulin (yuksek|yuksekligi))/, "Hiperglobulinemi", "GLOB", "high",
    ["Kronik inflamasyon/enfeksiyon (poliklonal): ehrlichiozis, leishmaniozis, FIP (kedi; A/G <0,4)", "Kronik deri/diş hastalığı", "Monoklonal gammopati: multipl miyelom, lenfoma, Ehrlichia (bazen)", "Dehidrasyon (albümin de yüksek)"],
    ["Protein elektroforezi", "Vektör testleri (Ehrlichia, Leishmania)", "Kedide A/G oranı ve FIP değerlendirmesi", "İdrarda Bence-Jones"]],
  [/\b(hiperproteinemi|total protein (yuksek|yuksekligi))/, "Hiperproteinemi", "TP", "high",
    ["Dehidrasyon (albümin ve globulin birlikte artar)", "Hiperglobulinemi (inflamasyon, FIP, ehrlichiozis, miyelom)"], ["Albümin/globulin ayrımı", "Hidrasyon değerlendirmesi"]],
  [/\b(hiperkalemi|potasyum (yuksek|yuksekligi))/, "Hiperkalemi", "K", "high",
    ["Üretral tıkanıklık (erkek kedi), mesane rüptürü — postrenal", "Hipoadrenokortisizm (Addison: Na/K <27)", "Akut böbrek hasarı / oligüri-anüri", "Psödohiperkalemi: hemoliz (Akita, Shiba), trombositoz, EDTA kontaminasyonu", "İlaç: ACE inhibitörü, spironolakton, potasyumlu sıvı, NSAİİ", "Ağır doku hasarı, tümör lizis, reperfüzyon", "Asidoz (hücre içinden çıkış)"],
    ["EKG (sivri T, P kaybı, bradikardi — ACİL)", "Na/K oranı, ACTH stimülasyonu", "Mesane palpasyonu, idrar çıkışı", "Kan gazı"]],
  [/\b(hipokalemi|potasyum (dusuk|dusuklugu))/, "Hipokalemi", "K", "low",
    ["Kronik böbrek hastalığı (kedi; servikal ventrofleksiyon, kas güçsüzlüğü)", "Kusma/ishal ile kayıp", "Diüretik (furosemid, tiyazid), postobstrüktif diürez", "İnsülin / dekstroz tedavisi, alkaloz (hücre içine kayma)", "Primer hiperaldosteronizm (kedi; hipertansiyon)", "Yetersiz alım, potasyumsuz sıvı tedavisi"],
    ["Kan gazı", "Kan basıncı", "Aldosteron (kedi)", "Kreatin kinaz (miyopati)"]],
  [/\b(hipernatremi|sodyum (yuksek|yuksekligi))/, "Hipernatremi", "Na", "high",
    ["Saf su kaybı: suya erişememe, hipodipsi, diabetes insipidus", "Hipotonik sıvı kaybı: kusma, ishal, ozmotik diürez", "Tuz zehirlenmesi (oyun hamuru, deniz suyu), hipertonik sıvı/sodyum bikarbonat", "Hiperaldosteronizm"],
    ["İdrar dansitesi", "Hidrasyon ve su tüketimi öyküsü", "Düzeltmeyi 0,5 mmol/L/saat'ten yavaş yapın (beyin ödemi riski)"]],
  [/\b(hiponatremi|sodyum (dusuk|dusuklugu))/, "Hiponatremi", "Na", "low",
    ["Hipoadrenokortisizm (Addison)", "GİS kayıpları ve hipotonik sıvı ile yerine koyma", "Kalp yetmezliği, karaciğer yetmezliği, nefrotik sendrom (hipervolemik)", "Üçüncü boşluk kaybı: şilotoraks, peritonit, uroabdomen", "Psikojenik polidipsi, uygunsuz ADH (SIADH)", "Psödohiponatremi: ağır lipemi, hiperproteinemi; hiperglisemi (düzeltilmiş Na hesaplayın)"],
    ["Na/K oranı, ACTH stimülasyonu", "Glukoz ve lipemi", "Karın/toraks USG (efüzyon)", "Düzeltmeyi 10–12 mmol/L/gün'ü aşmayacak şekilde yapın (osmotik demiyelinizasyon)"]],
  [/\b(hiperkalsemi|kalsiyum (yuksek|yuksekligi))/, "Hiperkalsemi", "Ca", "high",
    ["Malignite hiperkalsemisi (en sık köpekte): lenfoma, anal kese adenokarsinomu, multipl miyelom (PTHrP)", "Primer hiperparatiroidizm (Keeshond; PTH yüksek/normal üst)", "Hipoadrenokortisizm", "Kronik böbrek hastalığı (genelde iyonize Ca normal)", "D vitamini zehirlenmesi (kalsipotriol kremi, rodentisit kolekalsiferol)", "Granülomatöz hastalık (blastomikoz, şistozomiyaz)", "İdiyopatik hiperkalsemi (kedi; en sık neden)", "Genç büyüyen hayvanda hafif artış normal"],
    ["İyonize kalsiyum (MUTLAKA doğrulayın)", "PTH, PTHrP, 25-OH vitamin D", "Lenf nodu ve rektal muayene (anal kese)", "Toraks röntgeni, karın USG", "Fosfor (Ca×P > 70 doku mineralizasyonu riski)"]],
  [/\b(hipokalsemi|kalsiyum (dusuk|dusuklugu))/, "Hipokalsemi", "Ca", "low",
    ["Hipoalbuminemi (total Ca düşük, iyonize normal olabilir)", "Laktasyon tetanisi / eklampsi (küçük ırk anne köpek, doğum sonrası 1–4 hafta)", "Etilen glikol zehirlenmesi", "Akut pankreatit", "Primer hipoparatiroidizm, tiroidektomi sonrası (kedi)", "Kronik / akut böbrek hasarı, üretral tıkanıklık (fosfor yüksekliğiyle)", "Fosfat lavmanı (kedi, küçük köpek)", "Sitratlı kan transfüzyonu"],
    ["İyonize kalsiyum", "Albümin", "PTH", "Magnezyum", "Klinik bulgu (tremor, tetani) varsa kalsiyum glukonat %10, 0,5–1,5 mL/kg IV yavaş + EKG"]],
  [/\b(hiperfosfatemi|fosfor (yuksek|yuksekligi))/, "Hiperfosfatemi", "P", "high",
    ["Glomerüler filtrasyonun azalması: böbrek hastalığı, prerenal/postrenal azotemi", "Genç büyüyen hayvan (fizyolojik)", "Hemoliz (in vitro)", "D vitamini zehirlenmesi", "Fosfat lavmanı, tümör lizis, doku hasarı", "Hipoparatiroidizm, hipertiroidi (kedi)"],
    ["BUN, kreatinin, SDMA", "Ca × P çarpımı", "IRIS'e göre fosfor hedefi ve fosfat bağlayıcı"]],
  [/\b(hipofosfatemi|fosfor (dusuk|dusuklugu))/, "Hipofosfatemi", "P", "low",
    ["Diyabetik ketoasidoz tedavisi (insülin sonrası hücre içine kayma)", "Yeniden besleme sendromu (kedi hepatik lipidozu)", "Primer hiperparatiroidizm, malignite hiperkalsemisi", "Fosfat bağlayıcı aşırı kullanımı"],
    ["Ciddi düşüklükte (<1–1,5 mg/dL) hemoliz riski — HCT takibi", "Potasyum fosfat ile yerine koyma"]],
  [/\b(hiperkolesterolemi|kolesterol (yuksek|yuksekligi))/, "Hiperkolesterolemi", "CHOL", "high",
    ["Yemek sonrası örnek", "Hipotiroidizm (köpek)", "Hiperadrenokortisizm, diabetes mellitus", "Nefrotik sendrom (protein kaybettiren nefropati)", "Kolestaz, pankreatit", "Primer hiperlipidemi (Minyatür Schnauzer, Shetland çoban köpeği)"],
    ["12 saat açlık sonrası tekrar", "T4/fT4 ve TSH", "UPC", "Lipaz"]],
  [/\b(hipertrigliseridemi|trigliserit (yuksek|yuksekligi)|lipemi)/, "Hipertrigliseridemi / lipemi", "TG", "high",
    ["Yemek sonrası (en sık)", "Primer hiperlipidemi (Minyatür Schnauzer)", "Diabetes mellitus, hipotiroidizm, hiperadrenokortisizm", "Pankreatit (hem neden hem sonuç)", "Kolestaz, nefrotik sendrom"], ["Açlık örneği", "Lipaz / Spec cPL", "T4, kortizol testleri"]],
  [/\b(lipaz (yuksek|yuksekligi)|pankreatit)/, "Lipaz yüksekliği / pankreatit", "LIP", "high",
    ["Akut veya kronik pankreatit", "Azalmış böbrek atılımı (azotemi — lipaz 2–3 kata kadar artabilir)", "Glukokortikoid (köpekte lipaz aktivitesini artırır)", "GİS hastalığı, karın operasyonu sonrası", "Pankreas neoplazisi"],
    ["Spec cPL / fPL (pankreasa özgü)", "Karın USG (hipoekoik pankreas, hiperekoik çevre yağ)", "Kalsiyum, bilirubin, glukoz", "Ağrı yönetimi, antiemetik, erken enteral beslenme"]],
  [/\b(ck (yuksek|yuksekligi)|kreatin kinaz (yuksek|yuksekligi))/, "Kreatin kinaz (CK) yüksekliği", "CK", "high",
    ["Kas travması, IM enjeksiyon, zor venöz kan alımı, nöbet", "Miyozit (immün aracılı, toksoplazma, neospora)", "Kedide anoreksi (katabolik kas kaybı)", "Hipotiroidizm, hipokalemik miyopati", "Aortik tromboemboli (kedi; çok yüksek)", "Egzersiz, hipertermi"], ["AST ve potasyum", "Kas biyopsisi (kalıcıysa)", "Toxoplasma/Neospora serolojisi"]],
  [/\b(laktat (yuksek|yuksekligi)|hiperlaktatemi|laktik asidoz)/, "Hiperlaktatemi", "LAC", "high",
    ["Tip A (doku hipoksisi): şok, hipovolemi, ağır anemi, sepsis, mide dilatasyon-volvulus (GDV), tromboemboli, nöbet", "Tip B: diyabetik ketoasidoz, karaciğer yetmezliği, neoplazi, ilaç/toksin (etilen glikol, ksilitol), timsah ağzı aşırı egzersiz", "Örnek alım hatası: uzun turnike, kan alırken mücadele"],
    ["Seri laktat ölçümü (tedaviye yanıt; klirens)", "Perfüzyon değerlendirmesi (kan basıncı, kapiller dolum)", "GDV'de >6 mmol/L ve sıvıyla düşmüyorsa mide nekrozu riski artar"]],
  [/\b(metabolik asidoz)/, "Metabolik asidoz", "HCO3", "low",
    ["Anyon açığı YÜKSEK: laktik asidoz (şok), diyabetik ketoasidoz, üremik asidoz (böbrek yetmezliği), toksinler (etilen glikol, salisilat, metaldehit)", "Anyon açığı NORMAL (hiperkloremik): ishal ile bikarbonat kaybı, renal tübüler asidoz, hızlı %0,9 NaCl infüzyonu, dilüsyonel asidoz, Addison"],
    ["Anyon açığı = (Na + K) − (Cl + HCO3)", "Laktat, keton, kreatinin", "Etilen glikol testi (şüphede)", "Solunumsal kompanzasyon beklenen pCO2: köpek ≈ 0,7 × ΔHCO3 kadar düşüş"]],
  [/\b(metabolik alkaloz)/, "Metabolik alkaloz", "HCO3", "high",
    ["Mide içeriği kusması (HCl kaybı) — pilor tıkanıklığı, yabancı cisim (hipokloremik, hipokalemik)", "Loop/tiyazid diüretikler", "Hiperadrenokortisizm / hiperaldosteronizm", "Bikarbonat verilmesi"],
    ["Klor ve potasyum", "Karın görüntüleme (pilor/proksimal tıkanıklık)", "Tedavi: %0,9 NaCl + KCl (klora duyarlı alkaloz)"]],
  [/\b(solunumsal asidoz|respiratuvar asidoz|hiperkapni|pco2 (yuksek|yuksekligi))/, "Solunumsal asidoz (hiperkapni)", "pCO2", "high",
    ["Hipoventilasyon: anestezi, opioid/sedatif, beyin sapı lezyonu", "Üst solunum yolu tıkanıklığı (brakisefalik sendrom, larinks paralizisi)", "Plevral boşluk hastalığı (efüzyon, pnömotoraks), göğüs duvarı travması", "Nöromüsküler hastalık (botulizm, kene paralizisi, poliradikülonörit, miyastenia)", "Ağır akciğer hastalığı (geç dönem)"],
    ["pCO2 >60 mmHg ventilasyon desteği gerektirebilir", "Toraks röntgeni / POCUS", "Nörolojik muayene"]],
  [/\b(solunumsal alkaloz|respiratuvar alkaloz|hipokapni|pco2 (dusuk|dusuklugu))/, "Solunumsal alkaloz (hipokapni)", "pCO2", "low",
    ["Hiperventilasyon: ağrı, stres, anksiyete, hipertermi", "Hipoksemi (pulmoner hastalık, tromboemboli) ile solunum uyarımı", "Sepsis, karaciğer hastalığı, merkezi sinir sistemi hastalığı", "Mekanik ventilasyonda aşırı ventilasyon"], ["pO2 / SpO2", "Ağrı skoru", "Toraks görüntüleme"]],
  [/\b(hipoksemi|po2 (dusuk|dusuklugu)|oksijen (dusuk|dusuklugu)|spo2 (dusuk|dusuklugu))/, "Hipoksemi", "pO2", "low",
    ["Ventilasyon/perfüzyon uyumsuzluğu: pnömoni, pulmoner ödem, kontüzyon, ARDS", "Hipoventilasyon (pCO2 yüksek)", "Şant: sağdan sola kardiyak şant, atelektazi, ağır konsolidasyon", "Difüzyon bozukluğu (pulmoner fibrozis — West Highland Terrier)", "Düşük solunan O2 (yüksek rakım, anestezi cihaz hatası)", "Pulmoner tromboemboli"],
    ["A-a gradyanı ≈ (150 − pCO2/0,9) − pO2 (oda havası); >15–20 mmHg akciğer hastalığı lehine", "Oksijen desteği ile yanıt (şantta yanıt zayıf)", "Toraks röntgeni, POCUS, ekokardiyografi"]],
  [/\b(anyon acigi (yuksek|yuksekligi)|anion gap)/, "Anyon açığı yüksekliği", "AG", "high",
    ["Laktik asidoz", "Ketoasidoz (diyabetik)", "Üremik asidoz", "Etilen glikol, salisilat, metaldehit", "Ağır hiperfosfatemi"], ["Laktat, keton, kreatinin", "Ozmolal açık (etilen glikolde artar)"]],
  [/\b(hiperamonyemi|amonyak (yuksek|yuksekligi))/, "Hiperamonyemi", "NH3", "high",
    ["Portosistemik şant (konjenital: küçük ırk köpek, kedi)", "Akut / kronik karaciğer yetmezliği", "Üre döngüsü enzim eksikliği, arginin eksikliği (anoreksik kedi)", "Örnek bekletme (yanlış yükseklik — hemen buzda ölçün)"],
    ["Safra asitleri (aç/tok)", "Karın USG / BT anjiyografi", "Ürat kristalleri (idrar)", "Hepatik ensefalopati tedavisi: laktuloz, metronidazol/amoksisilin, protein ayarı"]],
  [/\b(hipertiroid\w*|t4 (yuksek|yuksekligi))/, "Hipertiroidi / T4 yüksekliği", "T4", "high",
    ["Kedide fonksiyonel tiroid adenomu (8 yaş üstü kedilerin en sık endokrin hastalığı)", "Köpekte tiroid karsinomu (nadir), ekzojen levotiroksin aşırı dozu", "Çiğ beslenen köpekte diyetle tiroid dokusu alımı"],
    ["Sınırda değerde fT4 (denge diyalizi) veya tekrar", "Böbrek değerleri (tedavi sonrası maskelenen KBH ortaya çıkabilir)", "Kan basıncı, ekokardiyografi", "Tedavi: tiamazol, iyot kısıtlı diyet, radyoaktif iyot, tiroidektomi"]],
  [/\b(hipotiroid\w*|t4 (dusuk|dusuklugu))/, "Hipotiroidi / T4 düşüklüğü", "T4", "low",
    ["Köpekte primer hipotiroidizm (lenfositik tiroidit, idiyopatik atrofi): kilo alma, letarji, simetrik alopesi, hiperkolesterolemi, non-rejeneratif anemi", "Hasta ötiroid sendromu (sistemik hastalık T4'ü düşürür — sık!)", "İlaçlar: glukokortikoid, fenobarbital, sülfonamid, NSAİİ, klomipramin", "Irk: Greyhound ve tazılarda fizyolojik düşük T4", "Kedide iatrojenik (tiroidektomi, radyoiyot, tiamazol aşırı)"],
    ["fT4 (denge diyalizi) + TSH birlikte", "Tiroglobulin otoantikoru", "Sistemik hastalık iyileşince tekrar test"]],
  [/\b(proteinuri\w*|upc (yuksek|yuksekligi)|idrarda protein)/, "Proteinüri", "", "",
    ["Prerenal: hemoglobinüri, miyoglobinüri, Bence-Jones protein", "Renal (glomerüler): glomerülonefrit, amiloidoz (Shar-Pei, Abyssinian), kronik böbrek hastalığı, hipertansiyon, leishmania/ehrlichia", "Postrenal: idrar yolu enfeksiyonu, ürolitiyazis, kanama, neoplazi (aktif sediment)"],
    ["UPC (köpek >0,5, kedi >0,4 anlamlı; inaktif sedimentte)", "İdrar kültürü", "Kan basıncı", "Vektör testleri", "Tedavi: ACE inhibitörü / telmisartan, omega-3, böbrek diyeti"]],
];
function causeCard(code, status) {
  const row = CAUSES.find(c => c[2] === code && c[3] === status);
  return row ? {title: row[1], causes: row[4], tests: row[5]} : null;
}
function causesAnswer(t, species) {
  const row = CAUSES.find(([re]) => re.test(t));
  if (!row) return null;
  const [, title, code, dir, causes, tests] = row;
  const ref = code && LAB_REF[species || "dog"]?.[code];
  const stats = [];
  if (code && LAB_REF.dog[code]) for (const s of species ? [species] : ["dog", "cat"]) { const r = LAB_REF[s][code]; if (r) stats.push([SP_TR[s] + " referansı · " + (LAB_LABEL[code] || code), range(r[0], r[1]) + " " + (UNIT[code] || "")]); }
  return {text: title + (species ? " · " + SP_TR[species] : ""), stats, items: [...causes.map(c => [c, "Olası neden"]), ...tests.map(c => [c, "Önerilen tetkik / yaklaşım"])],
    note: "Liste sıklık ve önem sırasına göredir; öykü, yaş, ırk ve diğer bulgularla birlikte değerlendirin. " + NOTE + (ref ? "" : "")};
}

// ───────────── 3) Referans listeleri ve kan gazı rehberi ─────────────
function panelAnswer(t, species) {
  if (!/\b(referans\w*|normal deger\w*|normal aralik\w*|aralik\w*|degerleri|tablo\w*)\b/.test(t)) return null;
  const panel = PANELS.find(([, re]) => re.test(t));
  if (!panel) {
    // Tek parametre: "kedi glukoz referans", "köpek kreatinin normal aralığı"
    const code = t.split(" ").map(w => codeFor("", w)).find(c => c && LAB_REF.dog[c]);
    if (!code) return null;
    const list = species ? [species] : ["dog", "cat"];
    return {text: (LAB_LABEL[code] || code) + " referans aralığı", stats: list.map(s => [SP_TR[s], range(LAB_REF[s][code][0], LAB_REF[s][code][1]) + " " + (UNIT[code] || "")]),
      note: "Genel yetişkin aralığıdır; cihazınızın aralığı önceliklidir. Yüksek/düşük nedenleri için ör. “" + (LAB_LABEL[code] || code) + " yüksekliği nedenleri” yazın."};
  }
  const list = species ? [species] : ["dog", "cat"];
  const items = panel[2].filter(c => LAB_REF.dog[c]).map(c => [LAB_LABEL[c] || c, list.map(s => (list.length > 1 ? SP_TR[s] + ": " : "") + range(LAB_REF[s][c][0], LAB_REF[s][c][1]) + " " + (UNIT[c] || "")).join(" · ")]);
  return {text: panel[0] + " referans aralıkları · " + list.map(s => SP_TR[s]).join(", "), items, note: "Genel yetişkin aralıklarıdır; yavru, ırk ve cihaza göre değişir. Cihazınızın raporundaki aralık önceliklidir. Değerleri yazarsanız (ör. “kedi HCT 22 WBC 24”) yorumlarım."};
}
function gasGuide(t) {
  if (!/\b(kan gazi|asit baz|asit-baz|blood gas)\b/.test(t) || !/\b(yorum\w*|nasil|adim\w*|degerlendir\w*|okun\w*|rehber)\b/.test(t)) return null;
  return {text: "Kan gazı yorumlama · adım adım", items: [
    ["1. pH", "<7,35 asidemi, >7,45 alkalemi (kedide alt sınır 7,30)"],
    ["2. Birincil bozukluk", "pH ile aynı yönde değişen parametre birincildir: HCO3 düşük + pH düşük → metabolik asidoz; pCO2 yüksek + pH düşük → solunumsal asidoz"],
    ["3. Kompanzasyon (köpek)", "Metabolik asidoz: pCO2, HCO3'teki her 1 mmol/L düşüşte ≈0,7 mmHg düşer · Metabolik alkaloz: her 1 mmol/L artışta ≈0,7 mmHg artar · Akut solunumsal asidoz: pCO2 her 1 mmHg artışta HCO3 ≈0,15 artar (kronik: 0,35)"],
    ["4. Karma bozukluk", "Beklenen kompanzasyondan sapma varsa ikinci bir bozukluk vardır; kompanzasyon pH'yı asla tam normale getirmez"],
    ["5. Anyon açığı", "(Na + K) − (Cl + HCO3); yüksekse laktat, keton, üremik asit veya toksin (etilen glikol) arayın"],
    ["6. Oksijenasyon", "Arteriyel pO2 <80 mmHg hipoksemi, <60 ağır; A-a gradyanı ≈ (150 − pCO2/0,9) − pO2; venöz örnekte pO2 yorumlanmaz"],
    ["7. Elektrolit ve laktat", "K, iCa, Cl, laktat birlikte; hiperkalemi + asidoz → üretral tıkanıklık/Addison; laktat >2,5 hipoperfüzyon"]],
    note: "Değerleri yazın (ör. “köpek pH 7.21 pCO2 38 HCO3 14 Na 145 K 4.2 Cl 118”), birincil bozukluğu ve olası nedenleri çıkarayım. " + NOTE};
}

// ───────────── 4) Ek ayırıcı tanılar ─────────────
const DIFF = [
  [/\b(kilo kayb\w*|zayifl\w*|kilo veriyor|weight loss)/, "Kilo kaybı", ["İştah normal/artmış: hipertiroidi (kedi), diabetes mellitus, ekzokrin pankreas yetmezliği, malabsorpsiyon (IBD, lenfoma), parazitler", "İştah azalmış: kronik böbrek hastalığı, karaciğer hastalığı, neoplazi, kalp yetmezliği (kaşeksi), ağız-diş hastalığı", "FIV/FeLV, FIP (genç kedi), kronik enfeksiyonlar", "Yetersiz/kalitesiz besleme, rekabet (çok hayvanlı ev)"], "Hemogram, biyokimya, T4 (kedi), idrar analizi, dışkı, TLI, kobalamin/folat, karın USG, toraks röntgeni"],
  [/\b(ates\w* (neden|sebep)\w*|hipertermi|yuksek ates|ateslen\w*|fever)/, "Ateş (hipertermi)", ["Enfeksiyon: bakteriyel (apse, piyometra, pnömoni, pyelonefrit, endokardit, diskospondilit), viral (FIP, FeLV), vektör (Ehrlichia, Anaplasma, Babesia, Leishmania)", "İmmün aracılı: poliartrit, IMHA, SLE, steroid yanıtlı menenjit-arterit", "Neoplazi (lenfoma, nekrotik tümör)", "Doku nekrozu, pankreatit", "İlaç reaksiyonu (sülfonamid, tetrasiklin)", "Ateş değil hipertermi: sıcak çarpması, nöbet, egzersiz, stres — ateş düşürücüye yanıt vermez", "Nedeni bulunamayan ateş (FUO)"], "Hemogram (sola kayma), biyokimya, idrar analizi + kültür, kan kültürü, vektör testleri, toraks/karın görüntüleme, ekokardiyografi, eklem sıvısı sitolojisi"],
  [/\b(hipersalivasyon|salya\w*|ptyalizm|agizdan kopuk)/, "Hipersalivasyon (ptyalizm)", ["Ağız boşluğu: diş hastalığı, stomatit (kedi gingivostomatiti, kalisivirüs), yabancı cisim, tümör, oral yanık (kostik)", "Bulantı: GİS hastalığı, böbrek/karaciğer yetmezliği, taşıt tutması", "Toksinler: organofosfat, piretroid/permetrin (kedi), bufo kurbağası, kostik maddeler, acı ilaç tadı (kedi)", "Nörolojik: kuduz (!), tetanoz, yüz siniri paralizisi, hepatik ensefalopati (kedi — portosistemik şant)", "Özofagus hastalığı (megaözofagus, özofajit)"], "Ağız muayenesi (sedasyon), biyokimya, safra asitleri (genç kedi), aşı durumu (kuduz!), toksin öyküsü"],
  [/\b(karin sisligi|karin buyumesi|asit\b|asites|abdominal distansiyon|karinda sivi|karin sis\w*)/, "Karın şişliği / asit", ["Sıvı: sağ kalp yetmezliği, hipoalbuminemi (PLE/PLN/karaciğer), portal hipertansiyon, peritonit (septik, safra, idrar — uroabdomen), hemoabdomen (splenik hemanjiyosarkom, rodentisit), FIP (kedi; yüksek proteinli sarı sıvı)", "Organ büyümesi: hepatomegali, splenomegali, gebelik, piyometra, mesane dolgunluğu", "Gaz: mide dilatasyon-volvulus (GDV — ACİL), ileus", "Kitle (neoplazi)", "Kas zayıflığı: hiperadrenokortisizm (pot belly)"], "Abdominosentez (sitoloji, total protein, PCV, kreatinin/K, bilirubin, laktat/glukoz), karın USG/röntgen, albümin, ekokardiyografi, FIP için Rivalta"],
  [/\b(hematuri|kanli idrar|idrarda kan|kirmizi idrar)/, "Hematüri", ["Alt üriner sistem: sistit (bakteriyel), ürolitiyazis, kedide idiyopatik sistit (FIC), polipoid sistit, travma", "Neoplazi: geçiş hücreli karsinom (köpek; trigon), prostat tümörü", "Prostat hastalığı (erkek köpek: BPH, prostatit, apse)", "Üst üriner: pyelonefrit, nefrolit, böbrek tümörü, idiyopatik renal hematüri", "Koagülopati (rodentisit), trombositopeni", "Ayırın: hemoglobinüri (hemoliz) ve miyoglobinüri — santrifüjde süpernatan kırmızı kalır; östrus kanaması"], "İdrar analizi (sistosentez) + sediment + kültür, üriner USG, röntgen (taş), hemogram ve pıhtılaşma, BRAF testi (TCC), prostat muayenesi"],
  [/\b(kanama bozuklu\w*|koagulopati|pihtilasma bozuklu\w*|kanamasi durmuyor|morarma|pteşi|petesi|ekimoz)/, "Kanama bozukluğu", ["Primer hemostaz (peteşi, mukozal kanama): trombositopeni (ITP, vektör, DIC), trombositopati (NSAİİ/aspirin, üremi), von Willebrand hastalığı (Dobermann)", "Sekonder hemostaz (hematom, boşluk kanaması): antikoagülan rodentisit (PT önce uzar), karaciğer yetmezliği, DIC, hemofili A/B (genç erkek), K vitamini malabsorpsiyonu", "Damar hastalığı: vaskülit"], "Trombosit sayımı + yayma, PT ve aPTT, BMBT (mukozal kanama zamanı), fibrinojen, D-dimer, vWF antijeni; rodentisitte K1 vitamini 2,5–5 mg/kg/gün PO 4–6 hafta"],
  [/\b(kollaps\w*|bayil\w*|senkop|bayilma|yere yigil\w*)/, "Kollaps / senkop", ["Kardiyak: bradiaritmi (AV blok, hasta sinüs sendromu), taşiaritmi (ARVC — Boxer, DCM — Dobermann), subaortik/pulmoner stenoz, perikardiyal efüzyon (tamponad), kalp yetmezliği", "Solunumsal: trakeal kollaps, larinks paralizisi, brakisefalik sendrom, pulmoner hipertansiyon", "Metabolik: hipoglisemi (insülinoma), Addison krizi, ağır anemi, hipokalemi, hipokalsemi", "Nörolojik/nöromüsküler: nöbet (ayırın!), miyastenia gravis, egzersize bağlı kollaps (Labrador — DNM1)", "Hipovolemi, iç kanama (hemoabdomen), vazovagal (öksürük/işeme ile)"], "EKG (Holter), ekokardiyografi, kan basıncı, glukoz, elektrolit, hemogram, toraks röntgeni, POCUS (efüzyon), ACTH stimülasyonu"],
  [/\b(hapsir\w*|burun akintisi|rinit|burun kanama\w*|epistaksis|nazal akinti)/, "Hapşırma / burun akıntısı / epistaksis", ["Kedi: üst solunum yolu enfeksiyonu (FHV-1, FCV, Chlamydia, Mycoplasma, Bordetella), kronik rinit, nazofaringeal polip, kriptokokkoz", "Köpek: yabancı cisim (çimen tohumu — tek taraflı, akut), nazal tümör (yaşlı, tek taraflı, kanlı), aspergilloz, lenfoplazmasitik rinit, diş kökü apsesi (oronazal fistül)", "Epistaksis: koagülopati/trombositopeni, hipertansiyon, ehrlichiozis, leishmaniozis, tümör, travma"], "Ağız ve diş muayenesi, kafa BT ve rinoskopi + biyopsi, sitoloji/kültür, FHV/FCV PCR, pıhtılaşma ve trombosit, kan basıncı, vektör testleri"],
  [/\b(goz akintisi|konjonktivit|gozde kizariklik|kirmizi goz|gozler kizar\w*)/, "Kırmızı göz / göz akıntısı", ["Konjonktivit (kedide FHV-1, Chlamydia; köpekte alerji, KCS)", "Keratokonjonktivitis sicca (kuru göz — Schirmer <10 mm/dk)", "Kornea ülseri (floresein boyası)", "Üveit (miyozis, düşük göz içi basıncı): FIP, FeLV/FIV, toksoplazma, lenfoma, vektör hastalıkları, travma", "Glokom (ACİL; yüksek göz içi basıncı, midriyazis)", "Entropiyon, distikiazis, yabancı cisim"], "Schirmer gözyaşı testi, floresein boyası, tonometri, fundus muayenesi; üveitte sistemik tarama"],
  [/\b(alopesi|tuy dokul\w*|kil dokul\w*|tuysuz\w*|kellik)/, "Alopesi (tüy dökülmesi)", ["Kaşıntılı: pire alerjisi, atopi, besin alerjisi, uyuz (Sarcoptes), Malassezia, piyoderma — kedide aşırı yalanma (psikojenik dışlama tanısıdır)", "Kaşıntısız, simetrik: hipotiroidizm, hiperadrenokortisizm, seks hormonu dermatozu, X alopesisi (Pomeranian), mevsimsel flank alopesi", "Odaksal: dermatofitoz (mantar — Wood lambası, kültür), demodikozis, enjeksiyon yeri reaksiyonu"], "Deri kazıntısı (derin: demodeks), trikogram, Wood lambası + DTM kültürü / PCR, sitoloji (bant), pire kontrolü denemesi, eliminasyon diyeti (8 hafta), T4/kortizol testleri"],
  [/\b(kabiz\w*|konstipasyon|disari cikam\w*|diski yapam\w*|obstipasyon)/, "Kabızlık / obstipasyon", ["Diyet: kemik yeme, lif azlığı, tüy yumağı (kedi)", "Dehidrasyon, hipokalemi (KBH kedide sık)", "Megakolon (kedi; idiyopatik)", "Pelvis kırığı sonrası kanal daralması", "Perineal herni, prostat büyümesi (köpek)", "Ağrı (ortopedik, anal kese), nörolojik (sakral/kauda ekuina)", "İlaç: opioid, antikolinerjik, sukralfat, demir"], "Rektal muayene, karın röntgeni, biyokimya (K, Ca), hidrasyon; tedavi: sıvı, lavman (kedide fosfatlı lavman KULLANMAYIN), laktuloz, lif, prokinetik (sisaprid)"],
  [/\b(agiz kokusu|halitozis|nefes kokusu)/, "Ağız kokusu (halitozis)", ["Periodontal hastalık (en sık)", "Kedide gingivostomatit, rezorptif diş lezyonları", "Oral tümör (melanom, skuamöz hücreli karsinom, fibrosarkom)", "Üremi (amonyak kokusu — böbrek yetmezliği)", "Diyabetik ketoasidoz (aseton kokusu)", "Megaözofagus / yabancı cisim, nekrotik doku"], "Ağız muayenesi ve diş röntgeni (anestezi altında), biyokimya (BUN, kreatinin, glukoz), idrarda keton"],
  [/\b(ataksi|dengesiz\w*|sendeleme|sarhos gibi|koordinasyon bozuklu\w*)/, "Ataksi", ["Propriyoseptif (spinal): disk hernisi, fibrokartilajinöz emboli, dejeneratif miyelopati (yaşlı köpek), Wobbler sendromu, spinal tümör, diskospondilit", "Vestibüler: otitis media/interna, idiyopatik geriatrik vestibüler sendrom, nazofaringeal polip (kedi), hipotiroidizm, metronidazol toksisitesi, tümör", "Serebellar: serebellar hipoplazi (kedi; panlökopeni), abiyotrofi, menenjit, tümör", "Sistemik: hipoglisemi, hipokalemi (kedi), anemi, toksin (ivermektin — MDR1, etilen glikol, metaldehit), hepatik ensefalopati"], "Nörolojik muayene ile lezyon lokalizasyonu, glukoz ve elektrolit, otoskopi, MR/BT, BOS analizi, ilaç öyküsü"],
  [/\b(bas egikligi|kafa egik\w*|nistagmus|vestibuler|bas yana)/, "Baş eğikliği / vestibüler sendrom", ["Periferik: otitis media/interna (en sık), idiyopatik vestibüler sendrom (yaşlı köpek, her yaştaki kedi), nazofaringeal polip, ototoksik ilaçlar (aminoglikozit, klorheksidin kulağa), hipotiroidizm, kulak tümörü", "Merkezi (bilinç değişikliği, propriyoseptif eksik, dikey nistagmus): menenjoensefalit (MUO), tümör, infarkt, metronidazol toksisitesi, tiamin eksikliği (kedi), FIP, toksoplazma"], "Otoskopi, bulla röntgeni/BT, MR, T4, ilaç öyküsü (metronidazol), BOS"],
  [/\b(felc\w*|parezi|parapleji|arka bacak\w* tutmuyor|yuruyemiyor|paraliz\w*)/, "Parezi / paralizi", ["Köpek: intervertebral disk hernisi (Dachshund, Fransız Bulldog — en sık; derin ağrı duyusunu test edin), fibrokartilajinöz emboli (akut, ağrısız, asimetrik), travma, dejeneratif miyelopati, spinal tümör, diskospondilit", "Kedi: aortik tromboemboli (ACİL; soğuk arka ayaklar, nabız yok, ağrılı — kalp hastalığı), travma, lenfoma (spinal), FIP", "Nöromüsküler: kene paralizisi, botulizm, poliradikülonörit (rakun/coonhound paralizisi), miyastenia gravis", "Metabolik: hipokalemik polimiyopati (kedi), hipoglisemi"], "Nörolojik muayene + derin ağrı testi, spinal röntgen/MR/BT, kedide femoral nabız + ekokardiyografi + laktat/glukoz farkı, CK ve K, asetilkolin reseptör antikoru"],
  [/\b(idrar kacirma|inkontinans|idrar damlatma|altina kacir\w*)/, "İdrar kaçırma (inkontinans)", ["Üretral sfinkter yetmezliği (kısırlaştırılmış dişi köpek — en sık)", "Ektopik üreter (genç dişi; doğuştan sürekli damlatma)", "Taşma tipi: üretral tıkanıklık veya detrüsör atonisi (spinal lezyon, disotonomi)", "Poliüri ile ilişkili (DM, KBH, Cushing) — sıkışma inkontinansı", "Sistit, ürolitler", "Nörolojik: sakral/kauda ekuina lezyonu"], "İdrar analizi + kültür, biyokimya, işeme sonrası rezidüel hacim, üriner USG, BT ürografi (ektopik üreter), nörolojik muayene; tedavi: fenilpropanolamin, estriol"],
  [/\b(vulva akinti\w*|vajinal akinti|piyometra|rahim iltihab\w*)/, "Vulvar akıntı", ["Piyometra (kısırlaştırılmamış dişi, östrustan 4–8 hafta sonra; kapalı piyometra ACİL)", "Normal östrus / doğum sonrası lohia", "Vajinit (yavru vajiniti, yabancı cisim, anatomik anomali)", "Gebelik kaybı, metrit", "Vajinal / uterus tümörü, ovaryan kalıntı sendromu (kısır dişide)"], "Karın USG, vajinal sitoloji, hemogram (lökositoz), biyokimya (azotemi), idrar analizi; piyometrada ovariohisterektomi + antibiyotik"],
  [/\b(kulak kasinti\w*|otit\w*|kulak akinti\w*|kulak kokusu|kulak enfeksiyon\w*)/, "Otitis externa / kulak sorunları", ["Primer neden: atopi ve besin alerjisi (en sık), kulak uyuzu (Otodectes — yavru kedi), yabancı cisim (çimen tohumu), endokrin hastalık, otoimmün", "Predispozan: sarkık kulak, dar kanal (Shar-Pei), kulak içi kıl, yüzme", "Sürdürücü: Malassezia, Staphylococcus pseudintermedius, Pseudomonas (kronik, ülseratif), otitis media, kanal hiperplazisi", "Kedi: nazofaringeal polip, seruminöz bez tümörü"], "Otoskopi (kulak zarı), kulak sitolojisi (bant/sürüntü — maya, kok, çomak), kültür-antibiyogram (çomak bakteri varsa), primer alerjinin araştırılması; zar perfore ise ototoksik damla kullanmayın"],
  [/\b(tremor\w*|titreme\w*|kas segirme\w*)/, "Tremor", ["Toksinler: permetrin (kedi), metaldehit, mikotoksin (küflü yiyecek), organofosfat, ivermektin, çikolata, amfetamin", "Metabolik: hipoglisemi, hipokalsemi (eklampsi), hepatik ensefalopati, üremi", "Steroid yanıtlı tremor sendromu (küçük beyaz köpekler — 'white shaker')", "Serebellar hastalık (amaçlı tremor)", "Ağrı, hipotermi, korku, yaşlılık tremoru"], "Glukoz, kalsiyum (iyonize), biyokimya, toksin öyküsü; permetrin/metaldehitte metokarbamol ve diazepam"],
  [/\b(regurjitasyon|kusmadan once|yemegi geri cikar\w*|megaozofagus)/, "Regürjitasyon", ["Megaözofagus: idiyopatik, miyastenia gravis (edinsel — en sık edinsel neden), hipoadrenokortisizm, hipotiroidi, polimiyozit, kurşun", "Özofagus yabancı cismi veya darlığı (anestezi sonrası reflü, doksisiklin tableti — kedi)", "Vasküler halka anomalisi (sütten kesilince başlayan yavru — PRAA)", "Hiatal herni (brakisefalik)", "Özofagit"], "Toraks röntgeni (aspirasyon pnömonisi?), kontrastlı özofagografi/floroskopi, asetilkolin reseptör antikoru, ACTH stimülasyonu, T4, CK, endoskopi"],
  [/\b(melena|siyah diski|katran gibi diski|hematokezi|diskida kan|kanli diski)/, "Dışkıda kan (melena / hematokezi)", ["Melena (sindirilmiş, siyah — üst GİS): gastroduodenal ülser (NSAİİ, glukokortikoid, mast hücre tümörü, karaciğer/böbrek hastalığı), tümör, koagülopati, yutulmuş kan (burun/akciğer kanaması)", "Hematokezi (taze kırmızı — kalın bağırsak): kolit (diyet, parazit — kamçılı kurt, Giardia, Clostridium), akut hemorajik ishal sendromu (AHDS — HCT yüksek), parvovirüs, polip/tümör (rektal), anal kese hastalığı", "Koagülopati / trombositopeni"], "Hemogram (HCT, TP, trombosit), BUN (melenada artar), pıhtılaşma profili, dışkı flotasyonu + Giardia, parvo testi, rektal muayene, karın USG, endoskopi/kolonoskopi"],
  [/\b(lenf\w* (buyuk|buyume\w*|sis\w*)|lenfadenopati|lenfadenomegali)/, "Lenfadenopati", ["Reaktif: lokal enfeksiyon/inflamasyon (deri, diş), sistemik antijenik uyarı", "Lenfadenit: bakteriyel, mantar, mikobakteri, toksoplazma", "Vektör hastalıkları: leishmaniozis, ehrlichiozis, babesiozis", "Neoplazi: lenfoma (genelleşmiş, ağrısız, simetrik büyüme — köpekte en sık), metastaz (mast hücre tümörü, melanom, karsinom)"], "İnce iğne aspirasyonu sitolojisi (ilk adım), gerekirse biyopsi + histopatoloji, PARR/akım sitometri, vektör testleri, toraks ve karın görüntüleme (evreleme)"],
  [/\b(polifaji|cok yiyor|asiri istah\w*|istah artis\w*)/, "Polifaji", ["Diabetes mellitus (kilo kaybı + PU/PD)", "Hipertiroidi (kedi; kilo kaybı)", "Hiperadrenokortisizm (köpek; pot belly, PU/PD)", "Ekzokrin pankreas yetmezliği, malabsorpsiyon (kilo kaybı, yağlı dışkı)", "İlaçlar: glukokortikoid, fenobarbital, mirtazapin", "İnsülinoma, akromegali (kedi), gebelik/laktasyon, davranışsal"], "Glukoz + fruktozamin, T4 (kedi), ACTH stimülasyonu / LDDST, TLI, kobalamin/folat, idrar analizi"],
  [/\b(sarkom|tumor\w*|kitle\w*|sis\w* (deri|derialti)|deride kitle)/, "Deri/deri altı kitle", ["Benign: lipom, histiyositom (genç köpek; kendiliğinden geriler), sebase adenom, kist", "Malign: mast hücre tümörü (köpekte en sık malign deri tümörü — 'büyük taklitçi'), yumuşak doku sarkomu, enjeksiyon bölgesi sarkomu (kedi), melanom, skuamöz hücreli karsinom (beyaz kulak/burun — kedi), lenfoma", "Apse, granülom, seroma, hematom"], "İnce iğne aspirasyonu sitolojisi (her kitleye!), mast hücre tümöründe aspirasyon öncesi antihistaminik düşünün, biyopsi + histopatoloji (derece ve cerrahi sınır), bölgesel lenf nodu aspirasyonu, evreleme (toraks röntgeni, karın USG)"],
  [/\b(kasinti\w* kedi|kedide kasinti|miliyer dermatit|eozinofilik granulom)/, "Kedide kaşıntı", ["Pire alerjisi dermatiti (en sık; miliyer dermatit, sırt-kuyruk kökü)", "Atopik-benzeri sendrom ve besin alerjisi (baş-boyun kaşıntısı, eozinofilik granülom kompleksi)", "Parazit: Otodectes, Notoedres, Cheyletiella, Demodex gatoi", "Dermatofitoz (Microsporum canis — zoonoz!)", "Psikojenik alopesi (dışlama tanısı)"], "Pire tarağı ve tüm hayvanlara pire tedavisi, deri kazıntısı, bant sitolojisi, Wood lambası + DTM kültürü, eliminasyon diyeti 8 hafta"],
  [/\b(sik idrar\w*|polakiuri|zor isiyor|idrar yaparken zorlan\w*|kumda cok vakit|kedi idrar yapamiyor)/, "Kedide alt üriner sistem hastalığı (FLUTD)", ["Feline idiyopatik sistit (FIC; stres ile ilişkili — genç-orta yaş, en sık)", "Ürolitiyazis: struvit, kalsiyum oksalat", "Üretral tıkaç (erkek kedi — ACİL: hiperkalemi, azotemi)", "Bakteriyel sistit (yaşlı, KBH'li, diyabetik kedide daha sık)", "Anatomik bozukluk, neoplazi (nadir)"], "Mesane palpasyonu (dolu ve sert ise tıkanıklık!), idrar analizi + sediment + kültür, röntgen (taş), USG, potasyum ve kreatinin; tıkanıklıkta EKG ve sondalama"],
  [/\b(siyanoz|morarma dil|dil mor)/, "Siyanoz", ["Ağır hipoksemi: pulmoner ödem, pnömoni, plevral efüzyon, pnömotoraks, üst solunum yolu tıkanıklığı", "Sağdan sola şant (Fallot tetralojisi, ters akımlı PDA — farklı siyanoz)", "Methemoglobinemi (kahverengi mukoza — parasetamol kedide!)", "Periferik: aortik tromboemboli (kedi; bölgesel), şok"], "ACİL oksijen ve stres azaltma; SpO2/kan gazı, POCUS, toraks röntgeni (stabil olunca), ekokardiyografi, methemoglobin için kan rengi testi"],
  [/\b(kalp ufurum\w*|ufurum|murmur)/, "Kalp üfürümü", ["Köpek küçük ırk, yaşlı: miksomatöz mitral kapak hastalığı (MMVD; Cavalier KCS)", "Köpek büyük ırk: dilate kardiyomiyopati (sessiz olabilir), subaortik stenoz (Boxer, Newfoundland)", "Yavru: PDA (sürekli üfürüm), pulmonik stenoz, VSD, masum (fizyolojik) üfürüm — 4–5 aya kadar kaybolur", "Kedi: hipertrofik kardiyomiyopati (HCM — dinamik), dinamik sağ ventrikül çıkış obstrüksiyonu", "Ekstrakardiyak: anemi, ateş, hipertiroidi (fizyolojik akım üfürümü)"], "Ekokardiyografi (kesin tanı), toraks röntgeni (VHS, ödem), NT-proBNP, kan basıncı, T4 (kedi), EKG; MMVD B2 evresinde pimobendan"],
];
function diffLoose(t) { // soru kalıbı olmadan da kısa belirti sorularında hazır listeyi kullan ("köpek topallıyor")
  if (t.split(" ").length > 12) return null;
  const row = DIFF.find(([re]) => re.test(t));
  return row ? {text: "Ayırıcı tanı · " + row[1], items: row[2].map(d => [d, ""]), stats: [["Önerilen tetkikler", row[3]]],
    note: "Liste sıklık ve önem sırasına göredir; öykü, yaş, ırk ve muayene bulgularıyla daraltın. Birden çok belirti yazarsanız (ör. “kedide kusma, ishal, iştahsızlık”) olası hastalıkları sıralarım. " + NOTE} : null;
}
function diffAnswer(t) {
  if (!ASK.test(t) && !/\b(nelerdir|ne yapmali|ne yapilir)\b/.test(t)) return null;
  const row = DIFF.find(([re]) => re.test(t));
  if (!row) return null;
  return {text: "Ayırıcı tanı · " + row[1], items: row[2].map(d => [d, ""]), stats: [["Önerilen tetkikler", row[3]]],
    note: "Liste sıklık ve önem sırasına göredir; öykü, yaş, ırk ve muayene bulgularıyla daraltın. " + NOTE};
}

// ───────────── 5) Beşeri ve ek veteriner ilaçları ─────────────
// [ad, eş anlamlılar, {dog: [min, max, birim?], cat: [...] | null}, yol·sıklık, uyarılar, ürünler [[etiket, mg, "tab"|"ml"]]]
const DRUGS = [
  ["Metamizol (dipiron)", ["metamizol", "dipiron", "novalgin", "analjin", "metamizole"], {dog: [25, 35], cat: [20, 25]}, "IV (yavaş)/IM/PO · köpek 8 saatte bir, kedi 12–24 saatte bir", ["Beşeri ilaç. Hızlı IV'de hipotansiyon; kedide salivasyon yapabilir.", "Uzun kullanımda kan tablosu (agranülositoz nadir)."], [["Novalgin 500 mg/mL enj.", 500, "ml"], ["Novalgin 500 mg tablet", 500, "tab"]]],
  ["Parasetamol", ["parasetamol", "asetaminofen", "paracetamol", "parol", "minoset"], {dog: [10, 15], cat: null}, "PO · köpek 8–12 saatte bir", ["KEDİDE HİÇBİR DOZDA KULLANMAYIN (methemoglobinemi, Heinz anemi, ölüm).", "Beşeri ilaç; köpekte karaciğer hastalığında kaçının."], [["Parol 500 mg tablet", 500, "tab"]]],
  ["Ketoprofen", ["ketoprofen", "profenid", "ketofen"], {dog: [1, 2], cat: [1, 2]}, "SC/IM/PO · 24 saatte bir, en fazla 5 gün (ilk doz 2 mg/kg, sonra 1 mg/kg)", ["NSAİİ: dehidrasyon, böbrek hastalığı, GİS ülseri ve kortikosteroidle birlikte kullanmayın."], [["Ketofen %1 enj. 10 mg/mL", 10, "ml"]]],
  ["Morfin", ["morfin", "morphine"], {dog: [0.25, 1], cat: [0.1, 0.2]}, "IM/SC · 4 saatte bir · IV yavaş (histamin salınımı)", ["Kusma yapabilir; kedide düşük doz kullanın (eksitasyon).", "Kontrollü ilaç."], [["Morfin 10 mg/mL", 10, "ml"]]],
  ["Fentanil", ["fentanil", "fentanyl"], {dog: [2, 5, "µg/kg"], cat: [1, 3, "µg/kg"]}, "IV bolus; CRI köpek 2–10, kedi 1–5 µg/kg/saat", ["Solunum depresyonu, bradikardi; kontrollü ilaç."], []],
  ["Naloksan", ["nalokson", "naloksan", "naloxone", "narcan"], {dog: [0.01, 0.04], cat: [0.01, 0.04]}, "IV/IM/SC · etki kısa, gerekirse tekrar", ["Opioid antagonisti; analjezi de ortadan kalkar — titre ederek verin."], [["Narcan 0,4 mg/mL", 0.4, "ml"]]],
  ["Flumazenil", ["flumazenil", "anexate"], {dog: [0.01, 0.01], cat: [0.01, 0.01]}, "IV · benzodiazepin antagonisti", ["Etki süresi kısa; sedasyon geri gelebilir."], [["Anexate 0,1 mg/mL", 0.1, "ml"]]],
  ["Asepromazin", ["asepromazin", "acepromazine", "kalmivet", "vetranquil"], {dog: [0.01, 0.05], cat: [0.01, 0.05]}, "IV/IM/SC · premedikasyon (toplam en fazla 3 mg)", ["Hipotansiyon; şok, hipovolemi ve dehidrasyonda kullanmayın.", "Boxer'da vazovagal kollaps, MDR1 mutasyonlu ırklarda (Collie) uzamış sedasyon — düşük doz."], [["Kalmivet 5 mg/mL", 5, "ml"]]],
  ["Lidokain", ["lidokain", "lidocaine", "aritmal", "jetokain"], {dog: [1, 2], cat: [0.25, 0.5]}, "IV yavaş bolus (ventriküler aritmi) · köpek CRI 25–80 µg/kg/dk", ["Kedi çok duyarlı (nöbet, kardiyak depresyon) — düşük doz, dikkatle.", "Lokal blokta toplam doz köpek ≤6 mg/kg, kedi ≤3 mg/kg."], [["Lidokain %2 (20 mg/mL)", 20, "ml"]]],
  ["Bupivakain", ["bupivakain", "bupivacaine", "marcaine", "buvasin"], {dog: [1, 2], cat: [1, 1]}, "Lokal / bölgesel blok (toplam en fazla: köpek 2 mg/kg, kedi 1 mg/kg)", ["ASLA IV vermeyin (kardiyotoksik)."], [["Marcaine %0,5 (5 mg/mL)", 5, "ml"]]],
  ["Metokarbamol", ["metokarbamol", "methocarbamol", "robaxin"], {dog: [44, 220], cat: [44, 220]}, "IV yavaş (etkiye göre; günde en fazla 330 mg/kg) · PO 15–20 mg/kg 8 saatte bir", ["Permetrin, metaldehit ve tremorojenik toksinlerde kas gevşetici."], []],
  ["Ampisilin", ["ampisilin", "ampicillin", "ampisid", "unasyn", "sulbaktam"], {dog: [20, 30], cat: [20, 30]}, "IV/IM · 6–8 saatte bir (ampisilin-sulbaktam 30 mg/kg 8 saatte bir)", ["Beşeri ilaç; oral emilimi zayıftır, parenteral tercih edin."], []],
  ["Sefazolin", ["sefazolin", "cefazolin", "sefazol", "cefamezin"], {dog: [22, 22], cat: [22, 22]}, "IV · 8 saatte bir · cerrahi profilakside indüksiyonda, işlem sürerse 90 dakikada bir", ["Beşeri ilaç; perioperatif profilaksinin standart seçimidir."], []],
  ["Seftriakson", ["seftriakson", "ceftriaxone", "rocephin", "iesef", "novosef"], {dog: [25, 50], cat: [25, 50]}, "IV/IM/SC · 12–24 saatte bir", ["Beşeri ilaç; kalsiyumlu sıvılarla aynı hattan vermeyin."], []],
  ["Gentamisin", ["gentamisin", "gentamicin", "genta"], {dog: [9, 14], cat: [5, 8]}, "IV/IM/SC · 24 saatte bir (tek doz)", ["NEFROTOKSİK ve ototoksik: dehidrasyon ve böbrek hastalığında kullanmayın; idrar sedimentinde silendir takibi.", "Tedaviyi kısa tutun (5–7 gün)."], [["Gentamisin 40 mg/mL", 40, "ml"]]],
  ["Amikasin", ["amikasin", "amikacin", "amikozit"], {dog: [15, 30], cat: [10, 14]}, "IV/IM/SC · 24 saatte bir", ["Nefrotoksik; gentamisinden daha az. Hidrasyonu sağlayın, böbrek takibi yapın."], [["Amikasin 250 mg/mL", 250, "ml"]]],
  ["Siprofloksasin", ["siprofloksasin", "ciprofloxacin", "cipro", "siproksin", "siprobel"], {dog: [20, 25], cat: null}, "PO · 24 saatte bir", ["Beşeri ilaç; kedide kullanmayın (emilim düşük, retina riski) — kedide marbofloksasin/pradofloksasin tercih edin.", "Büyüyen köpekte kıkırdak hasarı."], [["Cipro 500 mg tablet", 500, "tab"]]],
  ["Klaritromisin", ["klaritromisin", "clarithromycin", "klacid", "macrol"], {dog: [7.5, 12.5], cat: [7.5, 12.5]}, "PO · 12 saatte bir", ["Beşeri ilaç; mikobakteri ve Helicobacter kombinasyonlarında."], []],
  ["Kloramfenikol", ["kloramfenikol", "chloramphenicol"], {dog: [40, 50], cat: [12.5, 20]}, "PO · köpek 8 saatte bir, kedi 12 saatte bir (kedide 50 mg/kedi)", ["İnsanda aplastik anemi riski — eldivenle uygulayın.", "Kedide kemik iliği baskılanması; 14 günü aşmayın."], []],
  ["Rifampisin", ["rifampisin", "rifampin", "rifadin"], {dog: [5, 10], cat: [10, 15]}, "PO · 24 saatte bir (köpek 5 mg/kg 12 saatte bir)", ["Hepatotoksik; idrar ve gözyaşını kırmızı-turuncu boyar. Tek başına kullanmayın (direnç)."], []],
  ["Flukonazol", ["flukonazol", "fluconazole", "diflucan", "fungustatin", "triflucan"], {dog: [5, 10], cat: [5, 10]}, "PO · 12–24 saatte bir (kedide 50 mg/kedi 12–24 saatte bir)", ["Beşeri ilaç; kriptokokkoz, Malassezia, kandida. Böbrek yetmezliğinde dozu azaltın."], [["Diflucan 50 mg kapsül", 50, "tab"], ["Diflucan 150 mg kapsül", 150, "tab"]]],
  ["İtrakonazol", ["itrakonazol", "itraconazole", "sporanox", "itraxol", "itrafungol"], {dog: [5, 5], cat: [5, 5]}, "PO · 24 saatte bir, yemekle (kedide dermatofitozda hafta aşırı pulse tedavi)", ["Hepatotoksik olabilir; uzun kullanımda ALT takibi. Köpekte deri vaskülitine dikkat (>10 mg/kg)."], [["Sporanox 100 mg kapsül", 100, "tab"], ["Itrafungol 10 mg/mL", 10, "ml"]]],
  ["Terbinafin", ["terbinafin", "terbinafine", "lamisil", "terbisil"], {dog: [30, 30], cat: [30, 30]}, "PO · 24 saatte bir", ["Beşeri ilaç; dermatofitoz ve Malassezia. Kusma yapabilir."], [["Lamisil 250 mg tablet", 250, "tab"]]],
  ["Ketokonazol", ["ketokonazol", "ketoconazole", "nizoral"], {dog: [5, 10], cat: [5, 10]}, "PO · 12–24 saatte bir, yemekle", ["Kedide hepatotoksisite ve iştahsızlık daha sık — mümkünse itrakonazol tercih edin.", "Kortizol sentezini baskılar; birçok ilaçla etkileşir (siklosporin düzeyini artırır)."], [["Nizoral 200 mg tablet", 200, "tab"]]],
  ["Famsiklovir", ["famsiklovir", "famciclovir", "famvir", "famvirax"], {dog: null, cat: [40, 90]}, "PO · kedi 90 mg/kg 12 saatte bir (FHV-1 enfeksiyonu, 2–3 hafta)", ["Beşeri ilaç; kedide herpesvirüs keratokonjonktiviti ve rinitinde. Böbrek hastalığında doz azaltın."], [["Famvir 250 mg tablet", 250, "tab"], ["Famvir 500 mg tablet", 500, "tab"]]],
  ["Enalapril", ["enalapril", "enapril", "renitec", "konveril", "ednyt"], {dog: [0.5, 0.5], cat: [0.25, 0.5]}, "PO · 12–24 saatte bir", ["Beşeri ilaç; başlangıçtan 1–2 hafta sonra kreatinin ve potasyum.", "Dehidrasyonda ve azotemik krizde başlamayın."], [["Enapril 5 mg tablet", 5, "tab"], ["Enapril 10 mg tablet", 10, "tab"]]],
  ["Spironolakton", ["spironolakton", "spironolactone", "aldactone", "prilactone"], {dog: [1, 2], cat: [1, 2]}, "PO · 12–24 saatte bir", ["Hiperkalemi (ACE inhibitörüyle birlikte K takibi).", "Maine Coon kedilerinde yüz derisi ülseratif dermatiti bildirilmiştir."], [["Aldactone 25 mg tablet", 25, "tab"]]],
  ["Hidroklorotiyazid", ["hidroklorotiyazid", "hydrochlorothiazide", "esidrex"], {dog: [2, 4], cat: [1, 2]}, "PO · 12 saatte bir", ["Dirençli kalp yetmezliğinde furosemide ek; hipokalemi ve azotemi takibi.", "Kalsiyum oksalat ürolitlerinin önlenmesinde de kullanılır (köpek)."], []],
  ["Torasemid", ["torasemid", "torsemide", "upcard", "dilatrend"], {dog: [0.1, 0.3], cat: [0.1, 0.3]}, "PO · 24 saatte bir (furosemidin ~1/10 dozu)", ["Güçlü loop diüretik; elektrolit ve böbrek değerleri takibi."], [["UpCard 0,75 mg tablet", 0.75, "tab"], ["UpCard 3 mg tablet", 3, "tab"]]],
  ["Digoksin", ["digoksin", "digoxin", "lanoxin"], {dog: [0.003, 0.005], cat: [0.007, 0.007]}, "PO · köpek 12 saatte bir · kedi 48 saatte bir", ["DAR TERAPÖTİK ARALIK: serum düzeyi 0,8–1,2 ng/mL (doz sonrası 8 saat).", "Hipokalemi ve böbrek hastalığı toksisiteyi artırır (kusma, iştahsızlık, aritmi). Yağsız vücut ağırlığına göre hesaplayın."], [["Lanoxin 0,25 mg tablet", 0.25, "tab"]]],
  ["Diltiazem", ["diltiazem", "diltizem", "dilzem", "cardizem"], {dog: [0.5, 1.5], cat: [7.5, 7.5, "mg/kedi"]}, "PO · 8 saatte bir (atriyal fibrilasyonda hız kontrolü)", ["Bradikardi, hipotansiyon; beta-blokerle birlikte dikkat."], [["Diltizem 60 mg tablet", 60, "tab"]]],
  ["Atenolol", ["atenolol", "tenormin", "nortan"], {dog: [0.25, 1], cat: [6.25, 12.5, "mg/kedi"]}, "PO · 12–24 saatte bir", ["Kalp yetmezliği tablosunda başlamayın; ani kesmeyin.", "Kedide HCM (dinamik çıkış tıkanıklığı) ve hipertiroidide taşikardi kontrolü."], [["Tenormin 25 mg tablet", 25, "tab"], ["Tenormin 50 mg tablet", 50, "tab"]]],
  ["Sotalol", ["sotalol", "darob", "talozin"], {dog: [1, 2], cat: [10, 10, "mg/kedi"]}, "PO · 12 saatte bir", ["Ventriküler aritmide (Boxer ARVC); proaritmik olabilir — EKG/Holter takibi."], [["Darob 80 mg tablet", 80, "tab"]]],
  ["Sildenafil", ["sildenafil", "viagra", "revatio", "silden"], {dog: [1, 3], cat: [1, 1]}, "PO · 8–12 saatte bir", ["Beşeri ilaç; pulmoner hipertansiyonda. Nitratlarla birlikte kullanmayın (hipotansiyon)."], [["Revatio 20 mg tablet", 20, "tab"]]],
  ["Klopidogrel", ["klopidogrel", "clopidogrel", "plavix", "karum", "pingel"], {dog: [1, 2], cat: [18.75, 18.75, "mg/kedi"]}, "PO · 24 saatte bir (köpekte ilk gün yükleme 4–10 mg/kg)", ["Kedide kardiyomiyopatide tromboemboli önlemi (75 mg tabletin ¼'ü). Acı tadı nedeniyle jelatin kapsüle koyun."], [["Plavix 75 mg tablet", 75, "tab"]]],
  ["Aspirin (düşük doz)", ["aspirin", "aspirin dusuk doz", "asetilsalisilik", "coraspin", "ecopirin"], {dog: [0.5, 1], cat: [5, 5, "mg/kedi"]}, "PO · köpek 24 saatte bir · kedi 72 saatte bir (antitrombotik)", ["Antitrombotik doz; analjezik olarak kullanmayın. NSAİİ ve kortikosteroidle birlikte vermeyin.", "Kedide salisilat atılımı çok yavaştır — doz aralığına uyun."], [["Coraspin 100 mg tablet", 100, "tab"]]],
  ["Rivaroksaban", ["rivaroksaban", "rivaroxaban", "xarelto"], {dog: [1, 2], cat: [2.5, 2.5, "mg/kedi"]}, "PO · 24 saatte bir", ["Beşeri ilaç; kanama riski. IMHA ve kardiyomiyopatide tromboprofilaksi."], [["Xarelto 10 mg tablet", 10, "tab"]]],
  ["Enoksaparin", ["enoksaparin", "enoxaparin", "clexane", "enox"], {dog: [0.8, 0.8], cat: [1, 1]}, "SC · köpek 6 saatte bir, kedi 12 saatte bir", ["Düşük molekül ağırlıklı heparin; anti-Xa izlemi önerilir. Kanama riski."], [["Clexane 100 mg/mL", 100, "ml"]]],
  ["Heparin", ["heparin", "nevparin", "fraxiparin"], {dog: [100, 300, "IU/kg"], cat: [100, 300, "IU/kg"]}, "SC · 6–8 saatte bir (fraksiyone olmayan)", ["aPTT ile izleyin (normalin 1,5–2 katı hedef). Kanama riski."], []],
  ["Traneksamik asit", ["traneksamik", "tranexamic", "transamin", "tranex"], {dog: [10, 20], cat: [10, 20]}, "IV yavaş · 8 saatte bir · köpekte 50 mg/kg IV emetik olarak da kullanılır", ["Antifibrinolitik; tromboemboli riskinde dikkat. Hızlı IV kusma yapabilir."], [["Transamin 100 mg/mL", 100, "ml"]]],
  ["Desmopressin", ["desmopressin", "ddavp", "minirin"], {dog: [1, 1, "µg/kg"], cat: [1, 1, "µg/kg"]}, "SC/IV · von Willebrand'da cerrahi öncesi 30 dk · diabetes insipidusta 1–4 damla konjonktivaya 12–24 saatte bir", ["Hiponatremi riski; su alımını izleyin."], []],
  ["Mannitol", ["mannitol", "osmofundin"], {dog: [0.5, 1, "g/kg"], cat: [0.5, 1, "g/kg"]}, "IV · 15–20 dakikada (kafa içi basınç artışı, akut glokom)", ["Dehidrasyon ve kalp yetmezliğinde dikkat; kristalleşmişse ısıtıp filtreyle verin."], []],
  ["Hipertonik NaCl %7,5", ["hipertonik", "hipertonik salin", "hypertonic saline", "%7,5 nacl", "%3 nacl"], {dog: [3, 5, "mL/kg"], cat: [2, 4, "mL/kg"]}, "IV · 10–15 dakikada (şok, kafa içi basınç artışı)", ["Ardından kristaloid ile sıvı açığını kapatın; hipernatremide kullanmayın."], []],
  ["Dobutamin", ["dobutamin", "dobutamine", "dobuject"], {dog: [2, 15, "µg/kg/dk"], cat: [1, 5, "µg/kg/dk"]}, "IV CRI · etkiye göre titre", ["Kedide >5 µg/kg/dk nöbet yapabilir. EKG ve kan basıncı izlemi."], []],
  ["Teofilin", ["teofilin", "theophylline", "teokap", "theo-dur", "aminofilin"], {dog: [10, 10], cat: [15, 19]}, "PO · köpek 12 saatte bir, kedi 24 saatte bir (uzun etkili)", ["Bronkodilatör; taşikardi, ajitasyon. Florokinolonlar düzeyini artırır."], []],
  ["Terbutalin", ["terbutalin", "terbutaline", "bricanyl"], {dog: [0.01, 0.01], cat: [0.01, 0.01]}, "SC/IM/IV · kedi astım krizinde (4 saatte bir tekrar edilebilir)", ["Taşikardi; kardiyomiyopatide dikkat."], [["Bricanyl 0,5 mg/mL", 0.5, "ml"]]],
  ["Pantoprazol", ["pantoprazol", "pantoprazole", "pulcet", "protonix", "panto"], {dog: [1, 1], cat: [1, 1]}, "IV · 24 saatte bir (yavaş)", ["Beşeri ilaç; oral yol mümkün olunca omeprazole geçin."], [["Pulcet 40 mg flakon", 40, "ml"]]],
  ["Esomeprazol", ["esomeprazol", "esomeprazole", "nexium", "esomep"], {dog: [0.5, 1], cat: [0.5, 1]}, "IV/PO · 12–24 saatte bir", ["Beşeri ilaç; en etkili mide asidi baskılayıcılarından."], [["Nexium 20 mg tablet", 20, "tab"], ["Nexium 40 mg tablet", 40, "tab"]]],
  ["Misoprostol", ["misoprostol", "cytotec"], {dog: [2, 5, "µg/kg"], cat: null}, "PO · 8–12 saatte bir (NSAİİ ülserinin önlenmesi)", ["GEBE HAYVANDA KULLANMAYIN (abort); gebe kadınlar dokunmamalı.", "İshal yapabilir."], [["Cytotec 200 µg tablet", 0.2, "tab"]]],
  ["Loperamid", ["loperamid", "loperamide", "imodium", "lopermid"], {dog: [0.1, 0.2], cat: [0.04, 0.1]}, "PO · 8–12 saatte bir, kısa süreli", ["MDR1 mutasyonlu ırklarda (Collie, Shetland, Avustralya çoban köpeği) KULLANMAYIN — nörotoksisite.", "Enfeksiyöz ishal ve tıkanıklıkta kullanmayın; kedide dikkat (eksitasyon)."], [["Imodium 2 mg kapsül", 2, "tab"]]],
  ["Laktuloz", ["laktuloz", "lactulose", "duphalac", "laktulax"], {dog: [0.25, 0.5, "mL/kg"], cat: [0.5, 0.5, "mL/kg"]}, "PO · 8–12 saatte bir (yumuşak dışkı hedefi) · hepatik ensefalopatide de", ["Aşırı dozda ishal ve dehidrasyon; kediler tadını sevmeyebilir."], []],
  ["Sisaprid", ["sisaprid", "cisapride", "prepulsid"], {dog: [0.1, 0.5], cat: [2.5, 5, "mg/kedi"]}, "PO · 8–12 saatte bir, yemekten 15 dk önce", ["Prokinetik; megakolon ve gastroparezide. Azol antifungallerle birlikte aritmi riski."], []],
  ["Ursodeoksikolik asit", ["ursodeoksikolik", "ursodiol", "ursofalk", "udca", "ursactive"], {dog: [10, 15], cat: [10, 15]}, "PO · 24 saatte bir (bölünebilir), yemekle", ["Safra tıkanıklığında KULLANMAYIN. Kolestatik karaciğer hastalığı ve safra çamurunda."], [["Ursofalk 250 mg kapsül", 250, "tab"]]],
  ["S-adenozilmetiyonin (SAMe)", ["same", "s-adenozilmetiyonin", "adenozilmetiyonin", "denamarin", "transmetil"], {dog: [20, 20], cat: [20, 20]}, "PO · 24 saatte bir, aç karnına", ["Karaciğer koruyucu (glutatyon öncülü); parasetamol toksisitesinde destek."], []],
  ["Difenhidramin", ["difenhidramin", "diphenhydramine", "benadryl", "dramamine"], {dog: [2, 4], cat: [1, 2]}, "PO 8–12 saatte bir · IM/IV yavaş 1–2 mg/kg (alerjik reaksiyon, mast hücre tümörü manipülasyonu öncesi)", ["Sedasyon; glokom ve üriner retansiyonda dikkat."], []],
  ["Setirizin", ["setirizin", "cetirizine", "zyrtec", "allerset", "cetrin"], {dog: [0.5, 1], cat: [5, 5, "mg/kedi"]}, "PO · 24 saatte bir (köpekte 12 saatte bir de verilebilir)", ["Beşeri ilaç; atopide yardımcı, tek başına etkinliği sınırlıdır.", "Psödoefedrin içeren (Zyrtec-D) ürünleri KULLANMAYIN."], [["Zyrtec 10 mg tablet", 10, "tab"]]],
  ["Hidroksizin", ["hidroksizin", "hydroxyzine", "atarax"], {dog: [2, 2], cat: [5, 10, "mg/kedi"]}, "PO · 8–12 saatte bir", ["Sedasyon; nöbet eşiğini düşürebilir."], [["Atarax 25 mg tablet", 25, "tab"]]],
  ["Klorfeniramin", ["klorfeniramin", "chlorpheniramine", "avil"], {dog: [0.2, 0.5], cat: [1, 2, "mg/kedi"]}, "PO · 8–12 saatte bir (köpekte en fazla 1 mg/kg)", ["Sedasyon; kedide atopide yardımcı."], []],
  ["Siklosporin", ["siklosporin", "cyclosporine", "atopica", "sandimmun", "neoral", "cyclavance"], {dog: [5, 5], cat: [7, 7]}, "PO · 24 saatte bir, aç karnına (yanıta göre gün aşırı)", ["Kusma (ilk haftalar), dişeti hiperplazisi; kedide önce toksoplazma serolojisi.", "Ketokonazol düzeyini artırır."], [["Atopica 25 mg kapsül", 25, "tab"], ["Atopica 50 mg kapsül", 50, "tab"], ["Atopica 100 mg kapsül", 100, "tab"]]],
  ["Oklasitinib", ["oklasitinib", "oclacitinib", "apoquel"], {dog: [0.4, 0.6], cat: null}, "PO · 14 gün 12 saatte bir, sonra 24 saatte bir", ["12 aydan küçük köpekte ve ciddi enfeksiyonda kullanmayın. Kedide ruhsatsız."], [["Apoquel 3,6 mg tablet", 3.6, "tab"], ["Apoquel 5,4 mg tablet", 5.4, "tab"], ["Apoquel 16 mg tablet", 16, "tab"]]],
  ["Azatioprin", ["azatioprin", "azathioprine", "imuran", "azamun"], {dog: [1, 2], cat: null}, "PO · 2 mg/kg 24 saatte bir, remisyonda 1 mg/kg 48 saatte bir", ["KEDİDE KULLANMAYIN (ölümcül kemik iliği baskılanması).", "Kan tablosu ve ALT takibi (2 haftada bir başlangıçta)."], [["Imuran 50 mg tablet", 50, "tab"]]],
  ["Mikofenolat", ["mikofenolat", "mycophenolate", "cellcept", "myfortic"], {dog: [10, 10], cat: [10, 10]}, "PO · 12 saatte bir", ["İshal sık; immün aracılı hastalıklarda (IMHA, MUO) ikinci ajan."], [["CellCept 250 mg kapsül", 250, "tab"], ["CellCept 500 mg tablet", 500, "tab"]]],
  ["Metilprednizolon", ["metilprednizolon", "methylprednisolone", "prednol", "depo-medrol", "medrol"], {dog: [0.5, 1], cat: [0.5, 1]}, "PO/IV · 12–24 saatte bir (immünsüpresif 1–2 mg/kg)", ["Glukokortikoid: NSAİİ ile birlikte vermeyin; diyabet ve enfeksiyonda dikkat."], [["Prednol 4 mg tablet", 4, "tab"], ["Prednol 16 mg tablet", 16, "tab"]]],
  ["Levotiroksin", ["levotiroksin", "levothyroxine", "euthyrox", "levotiron", "tefor", "forthyron"], {dog: [0.02, 0.02], cat: [0.05, 0.1, "mg/kedi"]}, "PO · köpek 12 saatte bir (20 µg/kg), aç karnına", ["4–6 hafta sonra doz sonrası 4–6. saatte T4 ölçümü.", "Kalp hastalığında düşük dozla başlayın."], [["Euthyrox 50 µg", 0.05, "tab"], ["Euthyrox 100 µg", 0.1, "tab"], ["Forthyron 200 µg", 0.2, "tab"], ["Forthyron 400 µg", 0.4, "tab"]]],
  ["Tiamazol (metimazol)", ["tiamazol", "metimazol", "methimazole", "thiamazole", "thyromazol", "felimazole"], {dog: null, cat: [1.25, 2.5, "mg/kedi"]}, "PO · 12 saatte bir; 2–3 hafta sonra T4, böbrek ve kan tablosu", ["Yan etki: kusma, yüz kaşıntısı, trombositopeni, agranülositoz, hepatopati.", "Tedavi böbrek hastalığını maskeleyebilir — kreatinini izleyin."], [["Thyromazol 5 mg tablet", 5, "tab"], ["Felimazole 2,5 mg tablet", 2.5, "tab"]]],
  ["Trilostan", ["trilostan", "trilostane", "vetoryl"], {dog: [1, 2], cat: [1, 2]}, "PO · 12 saatte bir (düşük doz protokolü), yemekle", ["Hipoadrenokortizm krizi riski: halsizlik, kusma olursa kesin ve kortizol ölçün.", "10–14 gün sonra ACTH stimülasyonu veya doz öncesi kortizol."], [["Vetoryl 10 mg kapsül", 10, "tab"], ["Vetoryl 30 mg kapsül", 30, "tab"], ["Vetoryl 60 mg kapsül", 60, "tab"]]],
  ["Fludrokortizon", ["fludrokortizon", "fludrocortisone", "florinef", "astonin"], {dog: [0.01, 0.02], cat: [0.1, 0.1, "mg/kedi"]}, "PO · 24 saatte bir (Addison idamesi; DOCP mevcut değilse)", ["Na/K takibi ile titre edin; bazı hastalarda düşük doz prednizolon da gerekir."], [["Astonin H 0,1 mg tablet", 0.1, "tab"]]],
  ["Glipizid", ["glipizid", "glipizide", "minidiab", "glucotrol"], {dog: null, cat: [2.5, 5, "mg/kedi"]}, "PO · 12 saatte bir, yemekle", ["Kedide yalnız insülini reddeden sahiplerde; remisyon şansı insüline göre düşüktür. Hipoglisemi ve hepatotoksisite."], []],
  ["Fenilpropanolamin", ["fenilpropanolamin", "phenylpropanolamine", "propalin", "proin"], {dog: [1, 1.5], cat: [1, 1.5]}, "PO · 8–12 saatte bir", ["Üretral sfinkter yetmezliğinde; hipertansiyon, huzursuzluk. Kalp hastalığında dikkat."], [["Propalin 40 mg/mL şurup", 40, "ml"]]],
  ["Prazosin", ["prazosin", "minipress"], {dog: [0.07, 0.07], cat: [0.25, 0.5, "mg/kedi"]}, "PO · 8–12 saatte bir (köpek 1 mg/15 kg)", ["Üretral spazm (fonksiyonel tıkanıklık); hipotansiyon."], []],
  ["Tamsulosin", ["tamsulosin", "flomax", "uroflo"], {dog: [0.01, 0.02], cat: [0.004, 0.006]}, "PO · 12–24 saatte bir", ["Beşeri ilaç; üretral spazmda. Hipotansiyon."], [["Flomax 0,4 mg kapsül", 0.4, "tab"]]],
  ["Betanekol", ["betanekol", "bethanechol", "urecholine"], {dog: [5, 15, "mg/köpek"], cat: [1.25, 5, "mg/kedi"]}, "PO · 8 saatte bir", ["Detrüsör atonisinde; üretral tıkanıklık varken KULLANMAYIN. Salivasyon, kusma, ishal."], []],
  ["Potasyum sitrat", ["potasyum sitrat", "potassium citrate", "urocit"], {dog: [40, 75], cat: [40, 75]}, "PO · 12 saatte bir", ["Kalsiyum oksalat ürolitlerinin önlenmesi (idrar pH'sını yükseltir); hiperkalemi riski."], []],
  ["Amitriptilin", ["amitriptilin", "amitriptyline", "laroxyl", "triptilin"], {dog: [1, 2], cat: [2.5, 12.5, "mg/kedi"]}, "PO · köpek 12 saatte bir · kedi 24 saatte bir (akşam)", ["Antikolinerjik; kedide idiyopatik sistit ve davranış sorunlarında. MAO inhibitörü/amitrazla birlikte vermeyin."], [["Laroxyl 10 mg tablet", 10, "tab"], ["Laroxyl 25 mg tablet", 25, "tab"]]],
  ["Fluoksetin", ["fluoksetin", "fluoxetine", "prozac", "depreks", "reconcile"], {dog: [1, 2], cat: [0.5, 1]}, "PO · 24 saatte bir (etki 4–6 haftada)", ["Ayrılık anksiyetesi, kompulsif davranış. Tramadol, amitraz ve diğer serotonerjiklerle serotonin sendromu riski."], [["Prozac 20 mg kapsül", 20, "tab"]]],
  ["Klomipramin", ["klomipramin", "clomipramine", "anafranil", "clomicalm"], {dog: [2, 4], cat: [0.25, 0.5]}, "PO · köpek günlük doz 2'ye bölünerek · kedi 24 saatte bir", ["Antikolinerjik; nöbet eşiğini düşürebilir. T4'ü düşürebilir."], [["Anafranil 25 mg tablet", 25, "tab"]]],
  ["Alprazolam", ["alprazolam", "xanax", "zolam"], {dog: [0.02, 0.1], cat: [0.125, 0.25, "mg/kedi"]}, "PO · olaydan 1 saat önce, gerekirse 6–12 saatte bir", ["Kontrollü ilaç; paradoks eksitasyon. Kedide oral benzodiazepinlerle nadir akut karaciğer yetmezliği bildirilmiştir."], [["Xanax 0,25 mg tablet", 0.25, "tab"], ["Xanax 0,5 mg tablet", 0.5, "tab"]]],
  ["Pregabalin", ["pregabalin", "lyrica", "pregaba"], {dog: [2, 4], cat: [1, 2]}, "PO · 12 saatte bir (köpekte 2 mg/kg ile başlayın)", ["Nöropatik ağrı ve nöbette yardımcı; sedasyon, ataksi. Böbrek hastalığında doz azaltın."], [["Lyrica 75 mg kapsül", 75, "tab"]]],
  ["Amantadin", ["amantadin", "amantadine", "pk-merz", "symmetrel"], {dog: [3, 5], cat: [3, 3]}, "PO · 24 saatte bir (kronik ağrıda NSAİİ ile birlikte)", ["NMDA antagonisti; ajitasyon ve ishal yapabilir."], [["PK-Merz 100 mg tablet", 100, "tab"]]],
  ["Zonisamid", ["zonisamid", "zonisamide", "zonegran"], {dog: [5, 10], cat: [5, 10]}, "PO · köpek 12 saatte bir · kedi 24 saatte bir", ["Sülfonamid türevi: KCS, hepatopati, renal tübüler asidoz nadir.", "Fenobarbitalle birlikte doz artırılması gerekebilir."], [["Zonegran 100 mg kapsül", 100, "tab"]]],
  ["Potasyum bromür", ["potasyum bromur", "kbr", "bromur", "libromide"], {dog: [30, 40], cat: null}, "PO · günlük doz yemekle, tek ya da bölünmüş", ["KEDİDE KULLANMAYIN (eozinofilik bronşit/pnömonit).", "Kararlı düzeye 3–4 ayda ulaşır; pankreatit ve sedasyon yapabilir. Diyetteki tuz değişikliği düzeyi etkiler."], []],
  ["İmepitoin", ["imepitoin", "pexion"], {dog: [10, 30], cat: null}, "PO · 12 saatte bir", ["Köpekte idiyopatik epilepsi ve ses fobisinde; kedide ruhsatsız."], [["Pexion 100 mg tablet", 100, "tab"], ["Pexion 400 mg tablet", 400, "tab"]]],
  ["Darbepoetin", ["darbepoetin", "aranesp", "eritropoetin", "epoetin", "eprex"], {dog: [1, 1, "µg/kg"], cat: [1, 1, "µg/kg"]}, "SC · haftada bir, hedef HCT'ye ulaşınca 2–3 haftada bir", ["Böbrek kaynaklı anemide; demir desteği verin. Hipertansiyon ve (epoetinde) anti-EPO antikoru (saf eritroid aplazi) riski."], []],
  ["Vitamin B12 (siyanokobalamin)", ["b12", "siyanokobalamin", "cyanocobalamin", "kobalamin", "dodex"], {dog: [250, 1200, "µg/köpek"], cat: [250, 250, "µg/kedi"]}, "SC · haftada bir 6 hafta, sonra ayda bir (düşük kobalamin)", ["Kronik enteropati ve EPI'de kobalamin eksikliği; tedavi sonrası ölçüm."], []],
  ["Demir (demir sülfat)", ["demir sulfat", "ferrous", "ferro sanol", "demir ilaci", "demir takviyesi"], {dog: [100, 300, "mg/köpek"], cat: [50, 100, "mg/kedi"]}, "PO · 24 saatte bir (demir eksikliği anemisi)", ["Kabızlık, GİS irritasyonu; altta yatan kronik kanamayı tedavi edin."], []],
];
function drugAnswer(t, species) {
  if (/\b(zehir\w*|toksik|yedi|yemis|yuttu|yutmus|icti)\b/.test(t)) return null;
  const drug = DRUGS.find(([name, syn]) => [fold(name), ...syn].some(s => new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(t)));
  if (!drug) return null;
  const weight = weightOf(t);
  const [name, , dose, route, warnings, products] = drug;
  const list = species ? [species] : ["dog", "cat"];
  const stats = [], items = [];
  for (const s of list) {
    const d = dose[s];
    if (!d) { stats.push([SP_TR[s], s === "cat" ? "Kedide kullanılmaz / ruhsatsız" : "Köpekte kullanılmaz / endikasyon yok"]); continue; }
    const unit = d[2] || "mg/kg";
    stats.push([SP_TR[s] + " doz aralığı", range(d[0], d[1], 4) + " " + unit]);
    if (weight > 0 && /\/kg$/.test(unit) && !/dk|saat/.test(unit)) {
      const lo = d[0] * weight, hi = d[1] * weight, u = unit.replace("/kg", "");
      stats.push([SP_TR[s] + " · " + fmt(weight) + " kg toplam", range(lo, hi, 3) + " " + u]);
      if (u === "mg") for (const [label, c, kind] of products.slice(0, 4)) items.push([label, range(lo / c, hi / c, 2) + (kind === "ml" ? " mL" : " tablet")]);
    }
  }
  stats.push(["Yol · sıklık", route]);
  for (const w of warnings) items.push(["⚠ " + w, ""]);
  return {text: name + (weight > 0 ? " · " + fmt(weight) + " kg" : ""), stats, items,
    note: "Genel referans aralıklarıdır (Plumb's, BSAVA). Hastaya özel doz, böbrek/karaciğer durumu ve etkileşimleri hekim değerlendirir; prospektüs önceliklidir." + (weight > 0 ? "" : " Kilo yazarsanız (ör. “8 kg köpek metamizol”) toplam miktarı hesaplarım.")};
}

// ───────────── 6) Olgu kütüphanesi (kedi ve köpekte en sık 100+ hastalık) ─────────────
const CASE_INDEX = CASES.map(c => [c, [fold(c[0]).replace(/\s*\(.*?\)\s*/g, " ").trim(), ...c[1]].filter(s => s.length >= 3)]);
const reOf = s => new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
function caseAnswer(t, species, context) {
  // Doz ve zehirlenme soruları ilgili bölümlere; belirti odaklı ayırıcı tanı soruları ayırıcı tanı listesine gider.
  if (/\b(doz\w*|mg\/kg|zehir\w*)\b/.test(t)) return null;
  let best = null, len = 0;
  for (const [c, keys] of CASE_INDEX) for (const k of keys) if (k.length > len && reOf(k).test(t)) { best = c; len = k.length; }
  if (!best) return null;
  if (context.name && fold(context.name).split(" ").some(w => w.length >= 3 && reOf(w).test(fold(best[0]) + " " + best[1].join(" ")))) return null;
  const [name, , sp, who, signs, dx, tx, prog] = best;
  const label = sp === "both" ? "Kedi ve köpek" : SP_TR[sp];
  const focus = /\b(tedavi\w*|ilac\w*|ne verilir|yaklasim\w*)\b/.test(t) ? "tx" : /\b(tani\w*|test\w*|teshis\w*|nasil anlas\w*)\b/.test(t) ? "dx" : /\b(belirti\w*|bulgu\w*|semptom\w*)\b/.test(t) ? "signs" : "";
  const rows = [["signs", "Belirtiler", signs], ["dx", "Tanı", dx], ["tx", "Tedavi", tx], ["prog", "Prognoz / not", prog]];
  if (focus) rows.sort((a, b) => (b[0] === focus) - (a[0] === focus));
  return {text: name + " · " + label, stats: [["Kimlerde", who]], items: rows.map(([, l, v]) => [v, l]),
    note: (species && sp !== "both" && sp !== species ? "Not: bu olgu daha çok " + SP_TR[sp].toLowerCase() + "te görülür. " : "") + "Genel başvuru bilgisidir; doz için ilaç adını ve kiloyu yazın (ör. “4 kg kedi doksisiklin dozu”). " + NOTE};
}
const SYMPTOM_ASK = /\b(ayirici\w*|ddx|differansiyel|nedenleri|sebepleri|ne olabilir)\b/;

/** VeBot için: yazılan değer yorumu → anormallik nedenleri → referans listesi → kan gazı rehberi → ayırıcı tanı → ilaç. */
export function clinicalAnswer(text, context = {}) {
  const t = fold(text);
  if (!t) return null;
  const species = speciesOf(t) || (context.species === "cat" || context.species === "dog" ? context.species : "");
  const lab = labValues(text, t, context) || panelAnswer(t, species) || gasGuide(t);
  if (lab) return lab;
  // Birden çok belirti yazıldıysa (ör. "köpekte öksürük, ateş, burun akıntısı") olası hastalıklar belirti örtüşmesine göre sıralanır.
  // Tek belirtide hazır ayırıcı tanı listesi; hastalık adı geçiyorsa hastalık kartı önce gelir.
  const dose = /\b(doz\w*|mg\/kg|zehir\w*)\b/.test(t);
  const nSym = dose ? 0 : extractSymptoms(text).length;
  const multi = () => nSym >= 2 ? symptomAnswer(text, {species, min: 2}) : null;
  const single = () => nSym >= 1 ? (diffLoose(t) || symptomAnswer(text, {species, min: 1})) : null;
  if (SYMPTOM_ASK.test(t)) return multi() || causesAnswer(t, species) || diffAnswer(t) || single() || caseAnswer(t, species, context) || drugAnswer(t, species);
  return caseAnswer(t, species, context) || multi() || causesAnswer(t, species) || diffAnswer(t) || drugAnswer(t, species) || single();
}
export const CLINICAL_STATS = {drugs: DRUGS.length, causes: CAUSES.length, differentials: DIFF.length, cases: CASES.length};
