// Laboratuvar karar desteği: hemogram, biyokimya ve kan gazı sonuçlarını birlikte yorumlar.
// Tamamen cihazda çalışır. Kesin tanı koymaz; olası nedenleri, ek tetkikleri ve genel yaklaşımı hekime önerir.
// Metinler Türkçe anahtarlardır; ui-copy.js seçili dile çevirir.

// ---- Parametre adları ----
const ALIAS = {
  WBC:"WBC", LÖKOSIT:"WBC", LOKOSIT:"WBC", RBC:"RBC", ERITROSIT:"RBC", HGB:"HGB", HB:"HGB", HEMOGLOBIN:"HGB", HCT:"HCT", PCV:"HCT", HEMATOKRIT:"HCT",
  PLT:"PLT", TROMBOSIT:"PLT", MCV:"MCV", MCH:"MCH", MCHC:"MCHC", "RDW-CV":"RDW", RDW:"RDW", MPV:"MPV", RETIC:"RETIC", RET:"RETIC", RETIKULOSIT:"RETIC",
  "NEU#":"NEU", NEU:"NEU", GRAN:"NEU", "GRA#":"NEU", NÖTROFIL:"NEU", NOTROFIL:"NEU", "LYM#":"LYM", LYM:"LYM", LYMPH:"LYM", LENFOSIT:"LYM",
  "MON#":"MON", MON:"MON", MONO:"MON", MONOSIT:"MON", "EOS#":"EOS", EOS:"EOS", EOZINOFIL:"EOS", "BAS#":"BAS", BAS:"BAS",
  "NEU%":"NEU%", "LYM%":"LYM%", "MON%":"MON%", "EOS%":"EOS%", "BAS%":"BAS%",
  GLU:"GLU", GLUKOZ:"GLU", GLUCOSE:"GLU", BUN:"BUN", UREA:"UREA", ÜRE:"UREA", URE:"UREA", CRE:"CRE", CREA:"CRE", KREATININ:"CRE", CREATININE:"CRE",
  SDMA:"SDMA", ALT:"ALT", GPT:"ALT", AST:"AST", GOT:"AST", ALP:"ALP", ALKP:"ALP", GGT:"GGT", TBIL:"TBIL", "T.BIL":"TBIL", BILIRUBIN:"TBIL", DBIL:"DBIL",
  TP:"TP", "T.PROTEIN":"TP", "TOTAL PROTEIN":"TP", PROTEIN:"TP", ALB:"ALB", ALBÜMIN:"ALB", ALBUMIN:"ALB", GLOB:"GLOB", GLOBULIN:"GLOB", "A/G":"A/G", "ALB/GLOB":"A/G",
  CHOL:"CHOL", KOLESTEROL:"CHOL", TG:"TG", TRIG:"TG", TRIGLISERIT:"TG", AMY:"AMY", AMYL:"AMY", AMILAZ:"AMY", LIP:"LIP", LIPA:"LIP", LIPAZ:"LIP",
  CK:"CK", CPK:"CK", LDH:"LDH", CA:"Ca", KALSIYUM:"Ca", P:"P", PHOS:"P", IP:"P", FOSFOR:"P", MG:"Mg", NA:"Na", SODYUM:"Na", K:"K", POTASYUM:"K", CL:"Cl", KLOR:"Cl",
  FRU:"FRU", FRUKTOZAMIN:"FRU", NH3:"NH3", AMONYAK:"NH3", CRP:"CRP", "BUN/CRE":"BUN/CRE", T4:"T4", TT4:"T4",
  PH:"pH", PCO2:"pCO2", PO2:"pO2", HCO3:"HCO3", "HCO3-":"HCO3", "CHCO3":"HCO3", TCO2:"TCO2", BE:"BE", "BE(B)":"BE", "BE(ECF)":"BE", BEECF:"BE", BEB:"BE",
  LAC:"LAC", LACT:"LAC", LAKTAT:"LAC", LACTATE:"LAC", ICA:"iCa", "CA++":"iCa", "ICA++":"iCa", AG:"AG", "ANION GAP":"AG", SO2:"sO2", "SO2%":"sO2",
};
const fill = (template, ...values) => template.replace(/\{(\d)\}/g, (_, i) => String(values[i] ?? ""));
const fold = text => String(text ?? "").toLocaleUpperCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/İ/g, "I").replace(/\s+/g, " ").trim();
export function codeFor(code, name) {
  for (const candidate of [code, name]) {
    const key = fold(candidate);
    if (!key) continue;
    if (ALIAS[key]) return ALIAS[key];
    const short = key.replace(/\s*[(\[].*$/, "").replace(/[^A-Z0-9#%/+.-]/g, "");
    if (ALIAS[short]) return ALIAS[short];
  }
  return "";
}

// ---- Genel referans aralıkları (rapor referansı yoksa kullanılır; standart birimler) ----
const REF = {
  dog: {WBC:[6,17], RBC:[5.5,8.5], HGB:[12,18], HCT:[37,55], MCV:[60,77], MCH:[19.5,24.5], MCHC:[32,36], PLT:[200,500], NEU:[3,11.5], LYM:[1,4.8], MON:[0.15,1.35], EOS:[0.1,1.25], BAS:[0,0.1], RETIC:[0,110],
    GLU:[70,143], BUN:[7,27], CRE:[0.5,1.8], SDMA:[0,14], ALT:[10,125], AST:[0,50], ALP:[23,212], GGT:[0,11], TBIL:[0,0.9], TP:[5.2,8.2], ALB:[2.3,4.0], GLOB:[2.5,4.5], "A/G":[0.6,1.3],
    CHOL:[110,320], TG:[20,150], AMY:[500,1500], LIP:[200,1800], CK:[10,200], Ca:[7.9,12.0], P:[2.5,6.8], Mg:[1.8,2.4], Na:[144,160], K:[3.5,5.8], Cl:[109,122], FRU:[170,338], NH3:[0,98], CRP:[0,10], T4:[1.0,4.0],
    pH:[7.35,7.45], pCO2:[33,45], pO2:[80,105], HCO3:[18,24], TCO2:[17,25], BE:[-4,4], LAC:[0.5,2.5], iCa:[1.18,1.40], AG:[12,24], sO2:[95,100]},
  cat: {WBC:[5.5,19.5], RBC:[5,10], HGB:[8,15], HCT:[30,45], MCV:[39,55], MCH:[12.5,17.5], MCHC:[30,36], PLT:[300,800], NEU:[2.5,12.5], LYM:[1.5,7], MON:[0,0.85], EOS:[0,1.5], BAS:[0,0.1], RETIC:[0,60],
    GLU:[70,150], BUN:[16,36], CRE:[0.8,2.4], SDMA:[0,14], ALT:[12,130], AST:[0,48], ALP:[14,111], GGT:[0,4], TBIL:[0,0.9], TP:[5.7,8.9], ALB:[2.2,4.0], GLOB:[2.8,5.1], "A/G":[0.45,1.2],
    CHOL:[65,225], TG:[10,100], AMY:[500,1500], LIP:[100,1400], CK:[0,314], Ca:[7.8,11.3], P:[3.1,7.5], Mg:[1.8,2.6], Na:[150,165], K:[3.5,5.8], Cl:[112,129], FRU:[190,365], NH3:[0,95], T4:[0.8,4.7],
    pH:[7.30,7.45], pCO2:[28,40], pO2:[80,105], HCO3:[17,24], TCO2:[16,25], BE:[-5,3], LAC:[0.5,2.5], iCa:[1.10,1.40], AG:[13,27], sO2:[95,100]},
};
const LABEL = {WBC:"Lökosit (WBC)", RBC:"Eritrosit (RBC)", HGB:"Hemoglobin", HCT:"Hematokrit (HCT)", PLT:"Trombosit (PLT)", NEU:"Nötrofil", LYM:"Lenfosit", MON:"Monosit", EOS:"Eozinofil",
  GLU:"Glukoz", BUN:"BUN", UREA:"Üre", CRE:"Kreatinin", ALT:"ALT", ALP:"ALP", GGT:"GGT", TBIL:"Total bilirubin", TP:"Total protein", ALB:"Albümin", GLOB:"Globulin", Ca:"Kalsiyum", P:"Fosfor",
  Na:"Sodyum", K:"Potasyum", Cl:"Klor", pH:"pH", pCO2:"pCO2", HCO3:"HCO3", BE:"Baz açığı (BE)", LAC:"Laktat", iCa:"İyonize kalsiyum", AG:"Anyon açığı", CHOL:"Kolesterol", LIP:"Lipaz", AMY:"Amilaz", CK:"CK"};

// ---- Sayı ve birim ----
const num = raw => { const m = String(raw ?? "").replace(/\s/g, "").match(/[-+]?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(",", ".")) : NaN; };
function convert(code, value, unit) {
  if (!Number.isFinite(value)) return value;
  const u = String(unit || "").toLowerCase();
  switch (code) {
    case "CRE": return /µmol|umol|μmol/.test(u) || (!u && value > 25) ? value / 88.4 : value;
    case "GLU": return /mmol/.test(u) || (!u && value < 35) ? value * 18.016 : value;
    case "BUN": return /mmol/.test(u) ? value * 2.8 : value;
    case "Ca": return /mmol/.test(u) || (!u && value < 4) ? value * 4.008 : value;
    case "P": return /mmol/.test(u) || (!u && value < 1.8) ? value * 3.097 : value;
    case "Mg": return /mmol/.test(u) ? value * 2.43 : value;
    case "TBIL": case "DBIL": return /µmol|umol|μmol/.test(u) ? value / 17.1 : value;
    case "TP": case "ALB": case "GLOB": return /g\/l/.test(u) && !/g\/dl/.test(u) || (!u && value > 20) ? value / 10 : value;
    case "HGB": return /g\/l/.test(u) && !/g\/dl/.test(u) || (!u && value > 30) ? value / 10 : value;
    case "HCT": return value <= 1 ? value * 100 : value;
    case "CHOL": return /mmol/.test(u) ? value * 38.67 : value;
    case "TG": return /mmol/.test(u) ? value * 88.57 : value;
    case "LAC": return /mg/.test(u) ? value / 9.01 : value;
    case "pCO2": case "pO2": return /kpa/.test(u) ? value * 7.50062 : value;
    case "iCa": return /mg/.test(u) ? value / 4.008 : value;
    case "T4": return /nmol/.test(u) ? value / 12.87 : value;
    default: return value;
  }
}

// "Ad | Sonuç | Birim | Alt | Üst | İşaret | Kod | ?" tablosu
export function parseLabTable(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const cells = line.split("|").map(cell => cell.trim());
    if (cells.length < 2 || !cells[0]) continue;
    const [name, raw, unit = "", min = "", max = "", mark = "", code = ""] = cells;
    let canonical = codeFor(code, name);
    if (!canonical) continue;
    if (unit === "%" && ["NEU", "LYM", "MON", "EOS", "BAS"].includes(canonical)) canonical += "%";
    rows.push({code:canonical, name, raw, unit, min, max, mark: mark.toUpperCase()});
  }
  return rows;
}

// Serbest metindeki "HCT: 32 % (37-55)" satırları için yedek okuyucu
function parseFree(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*([\p{L}][\p{L}\p{N}./%#()+-]{0,20}?)\s*[:=\t ]\s*([<>]?[-+]?\d+(?:[.,]\d+)?)(.*)$/u);
    if (!m) continue;
    const code = codeFor("", m[1]);
    if (!code) continue;
    const range = [...m[3].matchAll(/([-+]?\d+(?:[.,]\d+)?)\s*[-–—]\s*([-+]?\d+(?:[.,]\d+)?)/g)].at(-1);
    const unit = (range ? m[3].slice(0, range.index) : m[3]).replace(/[()\[\]]/g, " ").trim().split(/\s+/)[0] || "";
    rows.push({code, name:m[1], raw:m[2], unit, min:range?.[1] || "", max:range?.[2] || "", mark:""});
  }
  return rows;
}

const speciesKey = species => /k[oö]pek|dog/i.test(species || "") ? "dog" : /kedi|cat/i.test(species || "") ? "cat" : "";

function normalizeRows(rawRows, species) {
  const key = speciesKey(species);
  const out = new Map();
  for (const row of rawRows) {
    let value = num(row.raw);
    if (!Number.isFinite(value)) continue;
    let code = row.code;
    let unit = row.unit;
    if (code === "UREA") { // Üre → BUN
      value = /mmol/i.test(unit) ? value * 2.8 : value / 2.14;
      code = "BUN"; unit = "mg/dL";
    }
    if (code.endsWith("%")) continue; // yüzde lökosit formülü mutlak sayıların yerine geçmez
    const v = convert(code, value, unit);
    let min = convert(code, num(row.min), row.unit), max = convert(code, num(row.max), row.unit);
    if (row.code === "UREA") { min = NaN; max = NaN; }
    let source = "rapor";
    if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) {
      const ref = REF[key]?.[code];
      if (ref) { [min, max] = ref; source = "genel"; } else { min = max = NaN; source = ""; }
    }
    let status = "unknown";
    if (Number.isFinite(min)) status = v < min ? "low" : v > max ? "high" : "normal";
    else if (row.mark === "H") status = "high";
    else if (row.mark === "L") status = "low";
    const width = Number.isFinite(min) ? Math.max(max - min, Math.abs(max) * 0.1, 1e-9) : NaN;
    const distance = status === "high" ? (v - max) / width : status === "low" ? (min - v) / width : 0;
    const degree = status === "normal" || status === "unknown" ? "" : distance >= 1 ? "Belirgin" : distance >= 0.25 ? "Orta" : "Hafif";
    out.set(code, {code, name:row.name || LABEL[code] || code, raw:row.raw, unit:row.unit, v, min, max, source, status, degree, distance});
  }
  return out;
}

// ---- Yorum ----
export function interpretLabs({panels = [], species = "", sex = "", ageMonths = NaN, history = []} = {}) {
  const key = speciesKey(species);
  const raw = [];
  for (const panel of panels) raw.push(...(panel.values ? parseLabTable(panel.values) : []), ...(!panel.values && panel.result ? parseFree(panel.result) : []));
  const L = normalizeRows(raw, species);
  const get = code => L.get(code);
  const val = code => get(code)?.v;
  const hi = code => get(code)?.status === "high";
  const lo = code => get(code)?.status === "low";
  const has = code => Number.isFinite(val(code));
  const young = Number.isFinite(ageMonths) && ageMonths < 12;
  const old = Number.isFinite(ageMonths) && ageMonths >= 96;
  const male = /erkek|male/i.test(sex || "");

  const critical = [], findings = [], dd = new Map(), tests = new Map(), approach = new Map(), notes = [];
  const rank = {critical:3, warn:2, info:1};
  const bump = (map, item, score) => map.set(item, Math.max(map.get(item) || 0, score));
  const add = (title, detail, {d = [], t = [], a = [], level = "warn", combined = false} = {}) => {
    const parts = (Array.isArray(detail) ? detail : [detail]).filter(Boolean);
    findings.push({title, detail:parts.join(" "), parts, level, combined});
    const score = (rank[level] || 1) + (combined ? 3 : 0);
    d.forEach(item => bump(dd, item, score)); t.forEach(item => bump(tests, item, score)); a.forEach(item => bump(approach, item, score));
  };
  const ordered = map => [...map.entries()].sort((x, y) => y[1] - x[1]).map(([item]) => item);
  const crit = text => critical.push(text);
  const f1 = (n, digits = 1) => Number.isFinite(n) ? String(Math.round(n * 10 ** digits) / 10 ** digits) : "—";

  // Kritik değerler
  if (has("K") && val("K") >= 7) crit("Potasyum ≥ 7 mmol/L: yaşamı tehdit eden hiperkalemi. EKG çekin, kalbi koruyucu acil tedaviyi ve nedeni (tıkanıklık, Addison, böbrek hasarı) hemen değerlendirin.");
  if (has("K") && val("K") < 2.5) crit("Potasyum < 2,5 mmol/L: ciddi hipokalemi; kas güçsüzlüğü ve solunum kaslarının etkilenmesi riski.");
  if (has("Na") && (val("Na") < 125 || val("Na") > 170)) crit("Sodyum kritik düzeyde. Düzeltme yavaş yapılmalı; hızlı düzeltme nörolojik hasara yol açabilir.");
  if (has("GLU") && val("GLU") < 60) crit("Glukoz < 60 mg/dL: hipoglisemi. Klinik bulgu varsa hemen dekstroz desteği ve yeniden ölçüm; örnek bekletme artefaktını dışlayın.");
  if (has("GLU") && val("GLU") > (key === "cat" ? 450 : 400)) crit("Glukoz çok yüksek: diyabetik ketoasidoz / hiperosmolar durum açısından keton ve kan gazı bakın.");
  if (has("pH") && (val("pH") < 7.1 || val("pH") > 7.6)) crit("pH kritik düzeyde: ağır asit-baz bozukluğu.");
  if (has("HCT") && val("HCT") < (key === "cat" ? 12 : 15)) crit("Hematokrit çok düşük: transfüzyon gereksinimini değerlendirin.");
  if (has("PLT") && val("PLT") < 30) crit("Trombosit < 30 ×10³/µL: kendiliğinden kanama riski. Kediyse önce kümeleşmeyi yaymada kontrol edin.");
  if (has("NEU") && val("NEU") < 1) crit("Nötrofil < 1 ×10³/µL: ağır nötropeni, sepsis riski.");
  if (has("LAC") && val("LAC") > 4) crit("Laktat > 4 mmol/L: belirgin doku hipoperfüzyonu.");
  if (has("iCa") && val("iCa") < 0.8) crit("İyonize kalsiyum çok düşük: tetani ve nöbet riski.");
  if (has("CRE") && val("CRE") > 5) crit("Kreatinin > 5 mg/dL: ağır azotemi.");

  // ---- Hemogram ----
  if (lo("HCT") || lo("HGB") || lo("RBC")) {
    const hct = val("HCT");
    const sev = !Number.isFinite(hct) ? "" : key === "cat" ? (hct < 10 ? "çok ağır" : hct < 15 ? "ağır" : hct < 20 ? "orta" : "hafif") : (hct < 13 ? "çok ağır" : hct < 20 ? "ağır" : hct < 30 ? "orta" : "hafif");
    let type = "Normositer", d = [], t = ["Retikülosit sayımı", "Periferik yayma (eritrosit morfolojisi, kan parazitleri)"];
    if (lo("MCV")) { type = "Mikrositer"; d = ["Kronik kan kaybına bağlı demir eksikliği (GİS kanaması, pire/parazit yükü)", key === "dog" ? "Portosistemik şant" : "Demir eksikliği"]; t.push("Serum demir / ferritin", "Dışkı muayenesi (gizli kan, parazit)"); }
    else if (hi("MCV")) { type = "Makrositer"; d = ["Rejeneratif anemi (retikülositoz)", key === "cat" ? "FeLV ilişkili diseritropoez" : "Irka bağlı makrositoz (Poodle)"]; }
    else d = ["Kronik hastalık / inflamasyon anemisi", "Kronik böbrek hastalığı", "Kemik iliği baskılanması", key === "cat" ? "FeLV / FIV" : "Ehrlichiosis"];
    if (hi("RDW")) notes.push("RDW yüksekliği eritrosit boyut çeşitliliğini gösterir; rejenerasyon lehine olabilir.");
    add(fill("{0} anemi ({1})", type, sev || "derece belirsiz"), [fill("HCT {0} %.", f1(hct)), "Anemi rejeneratif mi değil mi, retikülosit sayımıyla ayrılmalıdır."], {d, t, a:["Hidrasyon durumunu değerlendirerek HCT ve total proteini birlikte yorumlayın", "Ağır ve semptomatik anemide kan grubu tayini / çapraz karşılaştırma ve transfüzyon planlayın"]});
    if (lo("TP") || lo("ALB")) add("Anemi + düşük protein", "Kan kaybı (dış kanama, GİS kanaması, ağır parazit) lehine.", {combined:true, d:["Kan kaybı"], t:["Dışkıda gizli kan", "Koagülasyon profili (PT/aPTT)"]});
    if (hi("TBIL")) add("Anemi + hiperbilirubinemi", "Hemoliz olasılığı yüksek.", {combined:true, d:["İmmün aracılı hemolitik anemi (IMHA)", key === "cat" ? "Mycoplasma haemofelis" : "Babesiosis", "Çinko / soğan-sarımsak toksisitesi"], t:["Salin aglütinasyon testi", "Coombs testi", "Kan paraziti PCR / yayma"], a:["IMHA düşünülüyorsa enfeksiyöz nedenler dışlandıktan sonra immünsüpresif tedavi ve tromboprofilaksi değerlendirilir"]});
    if (lo("PLT")) add("Anemi + trombositopeni", "İki seri birlikte etkilenmiş.", {combined:true, d:["Kene kaynaklı enfeksiyonlar (Ehrlichia, Anaplasma, Babesia)", "DIC", "Evans sendromu (IMHA + IMTP)", "Kemik iliği hastalığı"], t:["Hızlı kene paneli (4Dx) / PCR", "Koagülasyon profili, D-dimer"]});
    if (lo("WBC") && lo("PLT")) add("Pansitopeni", "Üç hücre serisi de düşük: kemik iliği yetmezliği düşünülmeli.", {combined:true, level:"critical", d:["Kronik ehrlichiosis", key === "cat" ? "FeLV / panlökopeni" : "Parvovirus", "İlaç / östrojen toksisitesi", "Miyelodisplazi / lösemi"], t:["Kemik iliği aspirasyonu", "Enfeksiyöz hastalık serolojisi"]});
  }
  if (hi("HCT")) {
    if (hi("TP") || hi("ALB")) add("Hemokonsantrasyon", "HCT ve protein birlikte yüksek: dehidrasyon lehine.", {d:["Dehidrasyon (kusma, ishal, yetersiz su alımı)"], a:["Dehidrasyon yüzdesine göre sıvı tedavisi planlayın ve kilo/idrar çıkışını izleyin"]});
    else if (!has("TP") && !has("ALB")) add("Hematokrit yüksekliği", "Total protein ölçülmediği için dehidrasyon ile polisitemi ayrılamıyor; önce hidrasyon durumunu ve total proteini değerlendirin.", {d:["Dehidrasyon (kusma, ishal, yetersiz su alımı)", "Dalak kontraksiyonu (heyecan)", "Hipoksiye bağlı ikincil polisitemi (kalp/akciğer hastalığı)"], t:["Total protein / albümin"]});
    else add("Polisitemi", "Protein normalken HCT yüksek: heyecan/dalak kasılması ya da mutlak polisitemi.", {d:["Dalak kontraksiyonu (heyecan)", "Hipoksiye bağlı ikincil polisitemi (kalp/akciğer hastalığı)", "Böbrek tümörü (EPO artışı)", "Polisitemia vera"], t:["Tekrar ölçüm (sakin koşulda)", "Arteriyel kan gazı / SpO2", "Abdominal ultrason"]});
  }
  const stress = hi("NEU") && lo("LYM");
  if (stress) add("Stres lökogramı", "Nötrofili + lenfopeni (eozinopeni/monositoz eşlik edebilir): endojen veya ekzojen kortikosteroid etkisi.", {level:"info", d:["Akut stres / ağrı / sistemik hastalık", "Kortikosteroid kullanımı", "Hiperadrenokortisizm (klinik bulgu varsa)"]});
  else if (hi("NEU")) add("Nötrofili", [fill("Nötrofil {0} ×10³/µL: inflamasyon lehine.", f1(val("NEU"))), val("NEU") > 50 ? "Belirgin yükseklik (lökomoid reaksiyon) ciddi inflamatuvar odak veya lösemi açısından değerlendirilmelidir." : ""],
    {d:["Bakteriyel enfeksiyon / apse", key === "dog" && !male ? "Piyometra (kısırlaştırılmamış dişi)" : "Doku nekrozu", "İmmün aracılı hastalık", "Neoplazi"], t:["Yaymada sola kayma (çomak nötrofil) ve toksik değişiklik", "CRP / SAA", "Görüntüleme ile odak araştırması"]});
  if (lo("NEU") || (lo("WBC") && !has("NEU"))) add("Nötropeni / lökopeni", "Artmış tüketim veya kemik iliği yapımında azalma.", {level: val("NEU") < 1 ? "critical" : "warn",
    d:[young && key === "dog" ? "Parvovirus enteriti" : key === "cat" ? "Feline panlökopeni" : "Viral enfeksiyon", "Sepsis / endotoksemi", "Kemik iliği baskılanması (kemoterapi, ilaç)", "Ehrlichiosis", key === "cat" ? "FeLV / FIV" : "Ağır inflamasyon"],
    t:[key === "cat" ? "Panlökopeni antijen testi, FeLV/FIV testi" : "Parvovirus antijen testi", "Vücut ısısı takibi ve yayma"], a:["Ateş veya klinik bozulma varsa geniş spektrumlu antibiyotik ve destek tedavisi değerlendirilir", "İzolasyon ve bariyer hemşireliği uygulayın"]});
  if (hi("LYM")) add("Lenfositoz", key === "cat" ? "Kedilerde heyecan (adrenalin) yanıtı sık görülür; kalıcıysa ileri inceleme gerekir." : "Genç hayvanlarda fizyolojik olabilir; kalıcı ve belirginse ileri inceleme gerekir.",
    {level:"info", d:["Fizyolojik (heyecan / genç yaş)", "Kronik ehrlichiosis", "Lenfoma / kronik lenfositik lösemi"], t:["Tekrar hemogram ve yayma", "Kalıcıysa flow sitometri / PARR"]});
  if (hi("EOS")) add("Eozinofili", "Parazit, alerji veya eozinofilik hastalık lehine.", {d:["İç/dış parazit", "Alerjik dermatit / pire alerjisi", key === "cat" ? "Felin astım / eozinofilik granülom kompleksi" : "Eozinofilik bronkopnömopati", "Mast hücre tümörü", "Hipoadrenokortisizm (Addison)"], t:["Dışkı flotasyonu", "Deri ve tüy muayenesi"], a:["Düzenli iç ve dış parazit uygulamasını gözden geçirin"]});
  if (hi("MON") && !stress) add("Monositoz", "Kronik inflamasyon, nekroz veya stres yanıtı.", {level:"info", d:["Kronik inflamasyon / granülomatöz hastalık", "Doku nekrozu", "İmmün aracılı hastalık"]});
  if (lo("PLT") && !(lo("HCT") || lo("HGB"))) {
    const v = val("PLT");
    add("Trombositopeni", [fill("PLT {0} ×10³/µL.", f1(v, 0)), key === "cat" ? "Kedilerde trombosit kümeleşmesi yalancı düşüklüğün sık nedenidir." : ""], {
      d:[key === "cat" ? "Yalancı trombositopeni (kümeleşme)" : "Kene kaynaklı enfeksiyonlar (Ehrlichia, Anaplasma, Babesia)", "İmmün aracılı trombositopeni (IMTP)", "DIC / tüketim", "Kemik iliği hastalığı"],
      t:["Yaymada trombosit tahmini ve kümeleşme kontrolü", "Kene paneli (4Dx) / PCR", "Koagülasyon profili"], a:v < 50 ? ["Travmadan, kas içi enjeksiyondan ve trombosit fonksiyonunu bozan ilaçlardan (NSAİİ) kaçının"] : []});
  }
  if (hi("PLT")) add("Trombositoz", "Çoğunlukla reaktiftir.", {level:"info", d:["Reaktif (inflamasyon, demir eksikliği, kanama sonrası)", "Kortikosteroid etkisi", "Dalak kontraksiyonu"]});

  // ---- Böbrek ----
  const bun = val("BUN"), cre = val("CRE");
  if (hi("CRE") || hi("BUN") || hi("SDMA")) {
    const ratio = Number.isFinite(bun) && Number.isFinite(cre) && cre > 0 ? bun / cre : NaN;
    if (hi("CRE") || hi("SDMA")) {
      const stage = Number.isFinite(cre) ? (key === "cat" ? (cre > 5 ? 4 : cre >= 2.9 ? 3 : cre >= 1.6 ? 2 : 1) : (cre > 5 ? 4 : cre >= 2.9 ? 3 : cre >= 1.4 ? 2 : 1)) : 0;
      add("Azotemi", [Number.isFinite(ratio) ? fill("Kreatinin {0} mg/dL, BUN/Kreatinin oranı {1}.", f1(cre, 2), f1(ratio, 0)) : fill("Kreatinin {0} mg/dL.", f1(cre, 2)), "Prerenal, renal ve postrenal nedenler idrar dansitesi ile ayrılmalıdır.", stage ? fill("Hasta stabil ve hidrateyse kreatinin değeri IRIS evre {0} ile uyumludur (evreleme için tekrarlanan ölçüm gerekir).", stage) : ""], {
        level: cre > 5 ? "critical" : "warn",
        d:["Prerenal azotemi (dehidrasyon, hipovolemi)", "Kronik böbrek hastalığı", key === "cat" ? "Akut böbrek hasarı (toksin, leptospirosis, iskemi, zambak zehirlenmesi)" : "Akut böbrek hasarı (toksin, leptospirosis, iskemi)", male && key === "cat" ? "Üretral tıkanıklık (FLUTD, ürolit, tıkaç)" : "Postrenal tıkanıklık / üroabdomen"],
        t:["Tam idrar tahlili ve idrar dansitesi (sıvıdan önce)", "İdrar protein/kreatinin oranı (UPC)", "Kan basıncı ölçümü", "SDMA", "Abdominal ultrason (böbrek ve idrar yolları)"],
        a:["Dehidrasyonu sıvı tedavisiyle düzeltin, idrar çıkışını ve kiloyu izleyin; 24–72 saat sonra böbrek değerlerini tekrarlayın", "Nefrotoksik ilaçlardan (NSAİİ, aminoglikozid) kaçının", "Kronik böbrek hastalığında böbrek diyeti; fosfor yüksekse fosfor bağlayıcı değerlendirin"]});
      if (Number.isFinite(ratio) && ratio > 30 && !hi("P")) notes.push("BUN/Kreatinin oranının yüksek olması prerenal azotemi, GİS kanaması veya yüksek protein alımı lehine olabilir.");
    } else if (hi("BUN")) add("İzole BUN yüksekliği", "Kreatinin normalken BUN yüksek.", {d:["GİS kanaması", "Yüksek proteinli beslenme / yemek sonrası örnek", "Erken prerenal azotemi", "Katabolizma / kortikosteroid"], t:["Dışkıda gizli kan", "Açlık örneğiyle tekrar"]});
  }
  if (lo("BUN")) add("Düşük BUN", "", {level:"info", d:["Karaciğer yetmezliği / portosistemik şant", "Düşük proteinli beslenme", "Poliüri-polidipsi"], t:["Safra asitleri", "Amonyak"]});
  if (hi("P")) add("Hiperfosfatemi", young ? "Genç hayvanlarda büyümeye bağlı fizyolojik olabilir." : "Glomerüler filtrasyonda azalma ile en sık görülür.", {level: young ? "info" : "warn", d:young ? ["Büyüme (fizyolojik)"] : ["Böbrek fonksiyon kaybı", "Hemoliz artefaktı", "D vitamini toksisitesi", "Hipoparatiroidizm"]});
  if (has("Ca") && has("P") && val("Ca") * val("P") > 70) notes.push(fill("Ca × P çarpımı {0}: 70’in üzerinde yumuşak doku mineralizasyonu riski artar.", f1(val("Ca") * val("P"), 0)));

  // ---- Elektrolitler ----
  if (has("Na") && has("K") && val("K") > 0) {
    const ratio = val("Na") / val("K");
    if (ratio < 27) add("Düşük Na:K oranı", fill("Na:K = {0}.", f1(ratio, 1)), {level: ratio < 23 ? "critical" : "warn",
      d:[key === "dog" ? "Hipoadrenokortisizm (Addison)" : male ? "Üretral tıkanıklık (FLUTD, ürolit, tıkaç)" : "Üroabdomen", "Akut böbrek hasarı (oligüri)", "Ağır GİS hastalığı (kamçılı kurt, salmonella)", "Plevral/peritoneal efüzyon"],
      t:[key === "dog" ? "Bazal kortizol (≥ 2 µg/dL Addison’u büyük ölçüde dışlar) / ACTH stimülasyon testi" : "Mesane palpasyonu ve idrar çıkışı kontrolü", "EKG"],
      a:["Hipovolemi ve hiperkalemi varsa sıvı tedavisine başlayın ve EKG ile izleyin"]});
  }
  if (hi("K")) add("Hiperkalemi", "", {level: val("K") >= 7 ? "critical" : "warn", d:[male && key === "cat" ? "Üretral tıkanıklık (FLUTD, ürolit, tıkaç)" : "İdrar yolu tıkanıklığı / üroabdomen", key === "dog" ? "Hipoadrenokortisizm (Addison)" : "Akut böbrek hasarı (oligüri)", "İlaçlar (ACE inhibitörü, spironolakton)", "Artefakt (hemoliz, trombositoz, EDTA kontaminasyonu)"], t:["EKG (bradikardi, sivri T dalgası)", "Örnek tekrar (hemolizsiz)"]});
  if (lo("K")) add("Hipokalemi", "", {level: val("K") < 2.5 ? "critical" : "warn", d:["İştahsızlık, kusma, ishal", key === "cat" ? "Kronik böbrek hastalığı" : "Diüretik kullanımı", "İnsülin tedavisi / DKA", key === "cat" ? "Primer hiperaldosteronizm" : "Alkaloz"], a:["Potasyum desteği verilecekse infüzyon hızı güvenlik sınırına uyun ve tekrar ölçün"]});
  if (hi("Na")) add("Hipernatremi", "Serbest su kaybı veya tuz fazlalığı.", {d:["Su alımında yetersizlik / dehidrasyon", "Diabetes insipidus", "Tuz zehirlenmesi", "Hiperaldosteronizm"], a:["Sodyumu yavaş düşürün; hızlı düzeltme beyin ödemine yol açabilir"]});
  if (lo("Na")) add("Hiponatremi", "", {d:["GİS kayıpları", key === "dog" ? "Hipoadrenokortisizm (Addison)" : "Böbrek kayıpları", "Kalp yetmezliği / üçüncü boşluk", "Diüretik kullanımı"], a:["Sodyumu yavaş yükseltin; hızlı düzeltme nörolojik hasara (demiyelinizasyon) yol açabilir"]});
  if (has("Cl") && has("Na") && Number.isFinite(REF[key]?.Na?.[0])) {
    const mid = (REF[key].Na[0] + REF[key].Na[1]) / 2, corrected = val("Cl") * mid / val("Na");
    if (corrected < REF[key].Cl[0]) add("Düzeltilmiş hipokloremi", fill("Düzeltilmiş Cl {0} mmol/L.", f1(corrected, 0)), {d:["Mide içeriği kusması (pilor tıkanıklığı, yabancı cisim)", "Diüretik kullanımı"], t:["Abdominal görüntüleme (yabancı cisim)"]});
    else if (corrected > REF[key].Cl[1]) add("Düzeltilmiş hiperkloremi", fill("Düzeltilmiş Cl {0} mmol/L.", f1(corrected, 0)), {level:"info", d:["İnce bağırsak kaynaklı bikarbonat kaybı (ishal)", "Renal tübüler asidoz", "Yüksek klorlu sıvı tedavisi"]});
  }
  if (hi("Ca")) {
    const corrected = key === "dog" && has("ALB") ? val("Ca") - val("ALB") + 3.5 : NaN;
    add("Hiperkalsemi", Number.isFinite(corrected) ? fill("Albümine göre düzeltilmiş Ca ≈ {0} mg/dL (yalnız tahmin; iyonize Ca daha güvenilirdir).", f1(corrected)) : "İyonize kalsiyumla doğrulayın.", {
      d:["Malignite hiperkalsemisi (lenfoma, anal kese adenokarsinomu)", "Primer hiperparatiroidizm", key === "dog" ? "Hipoadrenokortisizm (Addison)" : "İdiyopatik hiperkalsemi", "D vitamini zehirlenmesi (kolekalsiferollü rodentisit)", "Kronik böbrek hastalığı"],
      t:["İyonize kalsiyum", "PTH ve PTHrP", "Lenf nodu palpasyonu ve rektal muayene", "Göğüs röntgeni ve abdominal ultrason"], a:["Belirgin hiperkalsemide sıvı tedavisi (serum fizyolojik) ve böbrek fonksiyon takibi"]});
  }
  if (lo("Ca") || lo("iCa")) add("Hipokalsemi", lo("ALB") && !has("iCa") ? "Düşük albümin toplam kalsiyumu yalancı düşürebilir; iyonize kalsiyumla doğrulayın." : "", {
    d:["Hipoalbüminemi (yalancı)", !male ? "Eklampsi (laktasyon)" : "Hipoparatiroidizm", "Akut böbrek hasarı / etilen glikol", "Akut pankreatit"], t:["İyonize kalsiyum"], a:["Tremor veya nöbet varsa EKG eşliğinde yavaş intravenöz kalsiyum desteği değerlendirilir"]});

  // ---- Karaciğer ----
  const altX = has("ALT") && get("ALT").max ? val("ALT") / get("ALT").max : NaN;
  if (hi("ALT")) add("Hepatoselüler hasar (ALT yüksekliği)", Number.isFinite(altX) ? [fill("ALT üst sınırın yaklaşık {0} katı.", f1(altX)), altX >= 5 ? "Belirgin hepatoselüler hasar." : ""] : "", {
    d:["Akut / kronik hepatit (bakır birikimi dahil)", "Toksinler (ksilitol, NSAİİ, mantar, aflatoksin)", "Hipoksi / hipoperfüzyon", "Pankreatit veya endokrin hastalığa ikincil", key === "cat" ? "Hipertiroidizm" : "Leptospirosis"],
    t:["Safra asitleri (açlık/tokluk)", "Abdominal ultrason", "Koagülasyon profili", key === "cat" && old ? "Total T4" : "Leptospira testi"]});
  if (hi("ALP")) {
    if (young) notes.push("Genç hayvanlarda kemik büyümesine bağlı ALP yüksekliği fizyolojiktir.");
    else if (key === "cat") add("ALP yüksekliği (kedi)", "Kedilerde ALP yarı ömrü kısadır; hafif yükseklik bile anlamlıdır.", {d:["Hepatik lipidozis (özellikle iştahsızlık sonrası)", "Kolanjit / kolanjiyohepatit", "Hipertiroidizm", "Diabetes mellitus"], t:[old ? "Total T4" : "Abdominal ultrason", "Abdominal ultrason", "Fruktozamin"], a:["İştahsız kedide beslenme desteğini geciktirmeyin (gerekirse besleme tüpü)"]});
    else add("ALP yüksekliği (köpek)", "Köpeklerde ALP steroid etkisiyle de artar.", {d:["Kortikosteroid etkisi (endojen Cushing / ilaç)", "Kolestaz", "Fenobarbital", "Nodüler hiperplazi (yaşlı köpek)", "Kemik kaynaklı (osteosarkom)"], t:["Abdominal ultrason", "Klinik bulgu varsa ACTH stimülasyon / düşük doz deksametazon testi"]});
  }
  if (hi("GGT")) add("GGT yüksekliği", "Kolestaz lehine.", {d:["Safra yolu hastalığı / kolestaz", key === "cat" ? "Kolanjit (GGT ALP’den belirgin yüksekse)" : "Steroid indüksiyonu", "Pankreatit"], t:["Abdominal ultrason"]});
  if (hi("TBIL") && !(lo("HCT") || lo("HGB"))) add("Hiperbilirubinemi", "Hematokrit normalken bilirubin yüksek: hepatik veya posthepatik neden lehine.", {d:["Karaciğer hastalığı", "Safra yolu tıkanıklığı (pankreatit, kolelit, mukosel)", key === "cat" ? "Hepatik lipidozis / kolanjit" : "Leptospirosis", "Sepsis"], t:["Abdominal ultrason", "Safra asitleri"]});
  if (hi("CK")) add("CK yüksekliği", "Kas hasarı lehine.", {level: val("CK") > 5 * (get("CK").max || 200) ? "warn" : "info", d:["Kas travması, kas içi enjeksiyon, uzun süre yatma", "Nöbet sonrası", key === "cat" ? "Aortik tromboemboli (arka bacak felci varsa)" : "Miyozit", "Hipotiroidizme bağlı miyopati"]});

  // ---- Protein ----
  if (lo("ALB")) {
    const both = lo("GLOB");
    add(both ? "Panhipoproteinemi" : "Hipoalbüminemi", both ? "Albümin ve globulin birlikte düşük: protein kaybı lehine." : "Globulin normal/yüksekken albümin düşük.", {level: val("ALB") < 1.5 ? "critical" : "warn",
      d:both ? ["Kan kaybı", "Protein kaybettiren enteropati (PLE)", "Eksüdatif deri kayıpları (yanık)"] : ["Protein kaybettiren nefropati (PLN)", "Karaciğer yetmezliği", "İnflamasyon (negatif akut faz)", "Yetersiz beslenme"],
      t:both ? ["Dışkı muayenesi", "Kobalamin / folat / TLI", "Abdominal ultrason"] : ["İdrar protein/kreatinin oranı (UPC)", "Safra asitleri"], a:val("ALB") < 1.5 ? ["Albümin < 1,5 g/dL ödem ve efüzyon riski taşır; kolloid veya plazma desteği değerlendirilir"] : []});
  }
  if (hi("GLOB")) {
    const ag = has("ALB") ? val("ALB") / val("GLOB") : val("A/G");
    add("Hiperglobulinemi", Number.isFinite(ag) ? [fill("A/G oranı {0}.", f1(ag, 2)), key === "cat" ? (ag < 0.4 ? "Kedide A/G < 0,4 klinik tablo uygunsa FIP lehine destekleyici bulgudur." : ag > 0.8 ? "A/G > 0,8 FIP olasılığını azaltır." : "") : ""] : "", {
      d:["Kronik antijenik uyarı / enfeksiyon", key === "cat" ? "Feline enfeksiyöz peritonit (FIP)" : "Leishmaniasis / ehrlichiosis", "Diş ve diş eti hastalığı", "Multipl miyelom / lenfoma (monoklonal)"],
      t:["Serum protein elektroforezi", key === "cat" ? "Efüzyon varsa Rivalta testi ve sıvı analizi" : "Leishmania ve Ehrlichia serolojisi"]});
  }
  if (hi("TP") && hi("ALB") && !hi("HCT")) notes.push("Total protein ve albümin birlikte yüksek: dehidrasyon lehine.");

  // ---- Glukoz ve lipitler ----
  if (hi("GLU") && val("GLU") <= (key === "cat" ? 450 : 400)) add("Hiperglisemi", key === "cat" ? "Kedilerde stres hiperglisemisi 250–300 mg/dL’ye ulaşabilir." : val("GLU") > 180 ? "Böbrek eşiği aşılmış; glukozüri beklenir." : "", {
    d:key === "cat" && val("GLU") < 300 ? ["Stres hiperglisemisi", "Diabetes mellitus"] : ["Diabetes mellitus", "Hiperadrenokortisizm / kortikosteroid", "Pankreatit", key === "cat" ? "Akromegali" : "Diöstrus"],
    t:["Fruktozamin", "İdrarda glukoz ve keton", "Kan gazı (asidoz var mı?)"]});
  if (lo("GLU") && val("GLU") >= 60) add("Hipoglisemi", "", {d:["Örneğin geç ayrıştırılması (artefakt)", young ? "Juvenil / oyuncak ırk hipoglisemisi" : "İnsülinoma", "Sepsis", key === "dog" ? "Hipoadrenokortisizm (Addison)" : "Karaciğer yetmezliği", "Ksilitol / insülin aşırı dozu"], t:["Hızlı ayrıştırılmış örnekle tekrar", "Eşzamanlı insülin ölçümü (tekrarlıyorsa)"]});
  if (hi("CHOL")) add("Hiperkolesterolemi", "", {level:"info", d:[key === "dog" ? "Hipotiroidizm" : "Diabetes mellitus", "Hiperadrenokortisizm", "Nefrotik sendrom", "Yemek sonrası örnek", "Pankreatit"], t:[key === "dog" ? "Total T4, serbest T4, TSH" : "Fruktozamin", "Açlık örneğiyle tekrar"]});
  if (lo("CHOL")) add("Hipokolesterolemi", "", {level:"info", d:["Karaciğer yetmezliği / portosistemik şant", "Protein kaybettiren enteropati", "Hipoadrenokortisizm (Addison)", "Malabsorpsiyon"], t:["Safra asitleri"]});
  if (hi("LIP") || hi("AMY")) add("Lipaz / amilaz yüksekliği", "Pankreatit için özgül değildir; böbrek fonksiyon kaybında da artar.", {d:["Akut pankreatit", "Azalmış glomerüler filtrasyon", "Kortikosteroid etkisi"], t:[key === "cat" ? "Spesifik feline pankreatik lipaz (fPL)" : "Spesifik kanin pankreatik lipaz (cPL)", "Abdominal ultrason"], a:["Pankreatit düşünülüyorsa ağrı kontrolü, antiemetik, sıvı tedavisi ve erken enteral beslenme"]});

  // ---- Kan gazı ve asit-baz ----
  let acidBase = null;
  if (has("pH") && (has("HCO3") || has("pCO2"))) {
    const ref = REF[key] || REF.dog;
    const rH = get("HCO3") && Number.isFinite(get("HCO3").min) ? (get("HCO3").min + get("HCO3").max) / 2 : (ref.HCO3[0] + ref.HCO3[1]) / 2;
    const rC = get("pCO2") && Number.isFinite(get("pCO2").min) ? (get("pCO2").min + get("pCO2").max) / 2 : (ref.pCO2[0] + ref.pCO2[1]) / 2;
    const pH = val("pH"), hco3 = val("HCO3"), pco2 = val("pCO2");
    let primary = "", compensation = "", mixed = "";
    const acid = pH < (get("pH").min || 7.35), base = pH > (get("pH").max || 7.45);
    const metAcid = Number.isFinite(hco3) && hco3 < rH - 2, metAlk = Number.isFinite(hco3) && hco3 > rH + 2;
    const respAcid = Number.isFinite(pco2) && pco2 > rC + 3, respAlk = Number.isFinite(pco2) && pco2 < rC - 3;
    const check = (expected, measured, above, below) => {
      if (!Number.isFinite(expected) || !Number.isFinite(measured)) return "";
      if (measured > expected + 3) return above;
      if (measured < expected - 3) return below;
      return "Beklenen kompanzasyonla uyumlu.";
    };
    if (acid && metAcid) { primary = "Metabolik asidoz"; const exp = rC - 0.7 * (rH - hco3); compensation = fill("Beklenen pCO2 ≈ {0} mmHg.", f1(exp, 0)); mixed = check(exp, pco2, "Eşlik eden solunumsal asidoz (yetersiz solunum kompanzasyonu).", "Eşlik eden solunumsal alkaloz."); }
    else if (acid && respAcid) { primary = "Solunumsal asidoz"; const acute = rH + 0.15 * (pco2 - rC), chronic = rH + 0.35 * (pco2 - rC); compensation = fill("Beklenen HCO3: akut ≈ {0}, kronik ≈ {1} mmol/L.", f1(acute, 0), f1(chronic, 0)); mixed = Number.isFinite(hco3) && hco3 < acute - 2 ? "Eşlik eden metabolik asidoz." : Number.isFinite(hco3) && hco3 > chronic + 2 ? "Eşlik eden metabolik alkaloz." : ""; }
    else if (base && metAlk) { primary = "Metabolik alkaloz"; const exp = rC + 0.7 * (hco3 - rH); compensation = fill("Beklenen pCO2 ≈ {0} mmHg.", f1(exp, 0)); mixed = check(exp, pco2, "Eşlik eden solunumsal asidoz.", "Eşlik eden solunumsal alkaloz."); }
    else if (base && respAlk) { primary = "Solunumsal alkaloz"; const acute = rH - 0.25 * (rC - pco2), chronic = rH - 0.55 * (rC - pco2); compensation = fill("Beklenen HCO3: akut ≈ {0}, kronik ≈ {1} mmol/L.", f1(acute, 0), f1(chronic, 0)); mixed = Number.isFinite(hco3) && hco3 < chronic - 2 ? "Eşlik eden metabolik asidoz." : Number.isFinite(hco3) && hco3 > acute + 2 ? "Eşlik eden metabolik alkaloz." : ""; }
    else if (!acid && !base && ((metAcid && respAlk) || (metAlk && respAcid))) { primary = "pH normal, karışık bozukluk olası"; mixed = metAcid ? "Metabolik asidoz + solunumsal alkaloz" : "Metabolik alkaloz + solunumsal asidoz"; }
    else if (!acid && !base && (metAcid || metAlk || respAcid || respAlk)) primary = "pH normal; kompanse veya karışık bozukluk";
    else if (acid || base) primary = acid ? "Asidemi (birincil neden belirsiz)" : "Alkalemi (birincil neden belirsiz)";
    else primary = "Asit-baz dengesi normal sınırlarda";
    let ag = val("AG");
    if (!Number.isFinite(ag) && has("Na") && has("Cl") && Number.isFinite(hco3)) ag = val("Na") + (has("K") ? val("K") : 0) - val("Cl") - hco3;
    const agRef = ref.AG;
    const agHigh = Number.isFinite(ag) && ag > agRef[1];
    acidBase = {primary, compensation, mixed, ag: Number.isFinite(ag) ? f1(ag, 0) : "", agHigh};
    const d = [], t = [], a = [];
    if (primary === "Metabolik asidoz" || /metabolik asidoz/i.test(mixed)) {
      if (agHigh) { d.push("Laktik asidoz (hipoperfüzyon, sepsis)", "Diyabetik ketoasidoz", "Üremik asidoz", "Etilen glikol / salisilat zehirlenmesi"); t.push("Laktat", "İdrar / kan ketonu"); }
      else if (Number.isFinite(ag)) d.push("Bikarbonat kaybı (ishal)", "Renal tübüler asidoz", "Dilüsyonel / yüksek klorlu sıvı");
      a.push("Altta yatan nedeni tedavi edin; perfüzyonu sıvı tedavisiyle düzeltin. Bikarbonat yalnızca ağır ve dirençli asidozda dikkatle düşünülür");
    }
    if (primary === "Metabolik alkaloz") { d.push("Mide içeriği kusması / pilor tıkanıklığı", "Diüretik kullanımı", "Hipokloremi, hipokalemi"); a.push("Klorlu sıvı (serum fizyolojik) ve potasyum desteği ile düzeltme"); }
    if (primary === "Solunumsal asidoz" || /solunumsal asidoz/i.test(mixed)) { d.push("Hipoventilasyon (anestezi, nöromüsküler hastalık, üst solunum yolu tıkanıklığı)", "Plevral boşluk hastalığı", "Ağır akciğer hastalığı"); a.push("Hava yolunu ve ventilasyonu değerlendirin; gerekirse oksijen ve ventilasyon desteği"); }
    if (primary === "Solunumsal alkaloz" || /solunumsal alkaloz/i.test(mixed)) { d.push("Hiperventilasyon (ağrı, stres, hipertermi)", "Hipoksemi", "Sepsis / SSS hastalığı"); }
    add(fill("Asit-baz: {0}", primary), [compensation, mixed, Number.isFinite(ag) ? fill(agHigh ? "Anyon açığı {0} mmol/L (yüksek)." : "Anyon açığı {0} mmol/L.", f1(ag, 0)) : ""], {level: acid || base ? "warn" : "info", d, t, a});
    if (has("pO2") && val("pO2") < 80) notes.push("pO2 düşük: örnek arteriyel ise hipoksemi vardır; venöz örnekte pO2 oksijenlenmeyi yansıtmaz.");
  }
  if (hi("LAC")) add("Hiperlaktatemi", fill("Laktat {0} mmol/L.", f1(val("LAC"))), {level: val("LAC") > 4 ? "critical" : "warn", d:["Hipoperfüzyon / şok", "Sepsis", "Mide dilatasyonu-volvulus (köpek)", "Nöbet / aşırı kas aktivitesi"], t:["Kan basıncı ve perfüzyon parametreleri", "Tedaviden sonra seri laktat ölçümü"], a:["Perfüzyonu düzeltin; laktatın 2–6 saat içinde düşmesi iyi yanıt göstergesidir"]});

  // ---- Paneller arası birleşik değerlendirme ----
  if (male && key === "cat" && hi("K") && (hi("CRE") || hi("BUN"))) add("Olası üretral tıkanıklık", "Erkek kedide hiperkalemi + azotemi birlikteliği acil üretral tıkanıklık için tipiktir.", {combined:true, level:"critical", d:["Üretral tıkanıklık (FLUTD, ürolit, tıkaç)"], t:["Mesane palpasyonu, abdominal ultrason / röntgen"], a:["Acil sondalama, hiperkalemi yönetimi ve sıvı tedavisi"]});
  if (key === "dog" && has("Na") && has("K") && val("Na") / val("K") < 27 && !lo("LYM") && (hi("BUN") || hi("CRE") || lo("GLU") || hi("Ca"))) add("Hipoadrenokortisizm (Addison) şüphesi", "Düşük Na:K, hasta bir köpekte stres lökogramının olmaması ve azotemi/hipoglisemi/hiperkalsemi birlikteliği Addison lehinedir.", {combined:true, level:"critical", t:["Bazal kortizol, ACTH stimülasyon testi"], a:["Addison krizinde agresif sıvı tedavisi ve glukokortikoid desteği hekim kararıyla başlanır"]});
  if (has("GLU") && val("GLU") > (key === "cat" ? 300 : 250) && (val("pH") < 7.35 || (has("HCO3") && val("HCO3") < 15)) && acidBase?.agHigh !== false) add("Diyabetik ketoasidoz şüphesi", "Hiperglisemi ile metabolik asidoz birlikte.", {combined:true, level:"critical", t:["Kan / idrar ketonu (β-hidroksibütirat)"], a:["DKA protokolü: sıvı, potasyum/fosfor takibi ve kısa etkili insülin hekim kararıyla"]});
  if (stress && hi("ALP") && key === "dog" && (hi("CHOL") || hi("GLU"))) add("Hiperadrenokortisizm (Cushing) düşünülebilir", "Stres lökogramı + ALP yüksekliği + hiperkolesterolemi/hiperglisemi. Yalnızca poliüri-polidipsi, polifaji, karın genişlemesi gibi klinik bulgular varsa test önerilir.", {combined:true, level:"info", t:["İdrar dansitesi, UPC", "Düşük doz deksametazon supresyon testi"]});
  if (lo("ALB") && lo("CHOL") && (lo("BUN") || lo("GLU"))) add("Karaciğer yetmezliği / şant şüphesi", "Düşük albümin, kolesterol ve BUN/glukoz birlikteliği karaciğerin sentez fonksiyonunda azalmayı düşündürür.", {combined:true, t:["Açlık ve tokluk safra asitleri", "Amonyak", "Abdominal ultrason / BT anjiyografi"]});
  if (hi("GLOB") && (lo("HCT") || lo("PLT")) && key === "dog") add("Vektörel enfeksiyon şüphesi", "Hiperglobulinemi ile anemi/trombositopeni birlikteliği Türkiye’de leishmaniasis ve ehrlichiosis açısından anlamlıdır.", {combined:true, t:["Leishmania serolojisi / PCR", "Ehrlichia serolojisi (4Dx)", "UPC (böbrek tutulumu)"]});
  if ((hi("CRE") || hi("BUN")) && acidBase?.agHigh) notes.push("Azotemi ile yüksek anyon açıklı asidoz birlikteliği üremik asidoz lehinedir.");

  // ---- Önceki sonuçlarla karşılaştırma ----
  const trends = [];
  const previous = history.map(item => ({date:item.date, rows:normalizeRows([...(item.values ? parseLabTable(item.values) : parseFree(item.result))], species)})).filter(item => item.rows.size).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const row of L.values()) {
    const before = previous.find(item => item.rows.has(row.code));
    if (!before) continue;
    const old = before.rows.get(row.code).v;
    if (!Number.isFinite(old) || old === 0) continue;
    const change = (row.v - old) / Math.abs(old) * 100;
    if (Math.abs(change) < 10 && row.status === "normal") continue;
    trends.push({code:row.code, name:row.name, before:old, now:row.v, date:before.date, change, status:row.status});
  }
  trends.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const creT = trends.find(item => item.code === "CRE");
  if (creT && creT.now - creT.before >= 0.3) notes.push(fill("Kreatinin önceki ölçüme göre {0} mg/dL arttı; ≥ 0,3 mg/dL artış akut böbrek hasarı açısından anlamlıdır.", f1(creT.now - creT.before, 2)));

  if (!key) notes.push("Bu tür için genel referans aralığı yok; yalnızca raporda yazan referanslar kullanıldı.");
  if ([...L.values()].some(row => row.source === "genel")) notes.push("Raporda referansı olmayan değerler için genel kedi/köpek referansları kullanıldı; cihazınızın referansları farklı olabilir.");

  const abnormal = [...L.values()].filter(row => row.status === "high" || row.status === "low").sort((a, b) => b.distance - a.distance);
  findings.sort((x, y) => Number(y.combined) - Number(x.combined) || (rank[y.level] || 0) - (rank[x.level] || 0));
  return {species:key, rows:[...L.values()], abnormal, critical, findings, differentials:ordered(dd), tests:ordered(tests), approach:ordered(approach), acidBase, trends:trends.slice(0, 12), notes};
}

// Düz metin özeti ("Sonuç ve değerlendirme" alanına eklenir)
export function summaryText(result) {
  const tr = text => { try { return globalThis.vetzimoTranslate?.(text) ?? text; } catch { return text; } };
  const list = (title, items) => items.length ? ["", tr(title), ...items.map(item => "• " + tr(item))] : [];
  const lines = [tr("Karar desteği · kesin tanı ve tedavi kararı hekime aittir")];
  lines.push(...list("Kritik değerler", result.critical));
  if (result.abnormal.length) lines.push("", tr("Referans dışı değerler"), ...result.abnormal.map(row => `• ${row.name}: ${row.raw} ${row.unit} ${tr(row.status === "high" ? "↑ Yüksek" : "↓ Düşük")} (${tr(row.degree)})`.replace(/\s+/g, " ")));
  if (result.findings.length) lines.push("", tr("Değerlendirme"), ...result.findings.map(item => "• " + tr(item.title) + (item.parts.length ? ": " + item.parts.map(tr).join(" ") : "")));
  lines.push(...list("Olası nedenler (ayırıcı tanı)", result.differentials), ...list("Önerilen ek tetkikler", result.tests), ...list("Genel yaklaşım ve tedavi önerileri", result.approach));
  return lines.join("\n");
}

// ---- Arayüz ----
export function renderLabInsight(container, {values = "", result = "", date = "", patient = null, history = [], onAppend = null} = {}) {
  const ageMonths = patient?.birth ? Math.floor((Date.now() - new Date(patient.birth + "T12:00:00Z")) / (30.44 * 864e5)) : NaN;
  const sameWindow = history.filter(item => date && item.date && Math.abs(new Date(item.date) - new Date(date)) <= 3 * 864e5);
  const older = history.filter(item => !sameWindow.includes(item));
  const res = interpretLabs({panels:[{values, result}, ...sameWindow], species:patient?.species, sex:patient?.sex, ageMonths, history:older});
  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); for (const child of children) if (child != null && child !== false) node.append(child); return node; };
  container.replaceChildren();
  container.hidden = !res.rows.length;
  if (!res.rows.length) return res;
  const fmt = n => new Intl.NumberFormat(document.documentElement.lang || "tr", {maximumFractionDigits:2}).format(n);
  const list = (title, items, cls = "") => items.length ? el("section", {className:"lab-insight-block " + cls}, el("h4", {textContent:title}), el("ul", {}, ...items.map(item => el("li", {textContent:item})))) : null;
  const header = el("header", {className:"lab-insight-head"},
    el("div", {}, el("h3", {textContent:"Klinik yorum"}), el("small", {textContent:"Karar desteği · kesin tanı ve tedavi kararı hekime aittir"})),
    el("span", {className:"lab-insight-chip", textContent:[patient?.species || "Tür seçilmedi", sameWindow.length ? fill("+{0} panel birlikte", sameWindow.length) : ""].filter(Boolean).join(" · ")}));
  container.append(header);
  if (res.critical.length) container.append(el("section", {className:"lab-insight-critical", role:"alert"}, el("h4", {textContent:"Kritik değerler"}), el("ul", {}, ...res.critical.map(item => el("li", {textContent:item})))));
  if (res.abnormal.length) container.append(el("section", {className:"lab-insight-block"}, el("h4", {textContent:fill("Referans dışı değerler · {0}", res.abnormal.length)}),
    el("ul", {className:"lab-insight-abnormal"}, ...res.abnormal.map(row => el("li", {className:"is-" + row.status},
      el("strong", {textContent:row.name}), el("span", {textContent:`${row.raw} ${row.unit}`.trim()}),
      el("em", {}, el("span", {textContent:row.status === "high" ? "↑ Yüksek" : "↓ Düşük"}), " · ", el("span", {textContent:row.degree})),
      el("small", {textContent:Number.isFinite(row.min) ? fill(row.source === "genel" ? "genel ref. {0}" : "ref. {0}", `${fmt(row.min)}–${fmt(row.max)}`) : ""}))))));
  else container.append(el("p", {className:"lab-insight-ok", textContent:"Okunan tüm değerler referans aralığında."}));
  if (res.findings.length) container.append(el("section", {className:"lab-insight-block"}, el("h4", {textContent:"Değerlendirme"}),
    ...res.findings.map(item => el("article", {className:"lab-insight-finding is-" + item.level}, el("strong", {textContent:item.title}), item.parts.length ? el("p", {}, ...item.parts.flatMap((part, i) => [i ? " " : null, el("span", {textContent:part})]).filter(Boolean)) : null))));
  const longList = (title, items, cls = "") => {
    if (!items.length) return null;
    const block = el("section", {className:"lab-insight-block " + cls}, el("h4", {textContent:title}), el("ul", {}, ...items.slice(0, 10).map(item => el("li", {textContent:item}))));
    if (items.length > 10) block.append(el("details", {}, el("summary", {textContent:fill("Diğer olasılıklar · {0}", items.length - 10)}), el("ul", {}, ...items.slice(10).map(item => el("li", {textContent:item})))));
    return block;
  };
  container.append(...[longList("Olası nedenler (ayırıcı tanı)", res.differentials), longList("Önerilen ek tetkikler", res.tests), list("Genel yaklaşım ve tedavi önerileri", res.approach, "is-approach")].filter(Boolean));
  if (res.trends.length) container.append(el("section", {className:"lab-insight-block"}, el("h4", {textContent:"Önceki sonuçlara göre değişim"}),
    el("ul", {className:"lab-insight-trends"}, ...res.trends.map(item => el("li", {}, el("strong", {textContent:item.name}),
      el("span", {textContent:`${fmt(item.before)} → ${fmt(item.now)}`}), el("em", {className:item.change > 0 ? "up" : "down", textContent:`${item.change > 0 ? "↑" : "↓"} %${fmt(Math.abs(Math.round(item.change)))}`}), el("small", {textContent:item.date || ""}))))));
  if (res.notes.length) container.append(list("Notlar", res.notes, "is-notes"));
  if (typeof onAppend === "function") {
    const button = el("button", {type:"button", className:"button small", textContent:"Yorumu «Sonuç ve değerlendirme» alanına ekle"});
    button.addEventListener("click", () => onAppend(summaryText(res)));
    container.append(el("div", {className:"lab-insight-actions"}, button));
  }
  return res;
}
