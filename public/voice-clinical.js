// VetZimo · klinik dikte çözümleyici ve hızlı ses tanıma.
// "kilo 4 kg ateş 41,3 nabız 120 kusma öksürük, tanı gastroenterit, kontrol 3 gün sonra" gibi serbest konuşmayı
// muayene formunun alanlarına ayırır. Dolgu sözcükleri (ıı, şey, yani, tamam, yaz…) eklenmez. Tamamen tarayıcıda çalışır.

const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/\p{M}/gu, "");

const ONES = {sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9};
const TENS = {on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90};
const isNumWord = w => w in ONES || w in TENS || w === "yuz" || w === "bin";

/** "kirk bir virgul uc" → "41.3", "dort bucuk" → "4.5", "yuz yirmi" → "120". Girdi katlanmış (ASCII) metindir. */
export function wordsToNumbers(text) {
  const words = text.split(/\s+/).filter(Boolean), out = [];
  const readInt = (i) => { // [değer, sonraki indeks] ya da null
    let total = 0, cur = 0, j = i, any = false;
    while (j < words.length && isNumWord(words[j])) {
      const w = words[j];
      if (w === "bin") { total += (cur || 1) * 1000; cur = 0; }
      else if (w === "yuz") cur = (cur || 1) * 100;
      else if (w in TENS) { if (cur % 100 >= 10) break; cur += TENS[w]; }
      else { if (cur % 10 !== 0 || (any && cur === 0 && total === 0)) break; cur += ONES[w]; }
      any = true; j++;
    }
    return any ? [total + cur, j] : null;
  };
  for (let i = 0; i < words.length;) {
    const r = readInt(i);
    if (!r) { out.push(words[i]); i++; continue; }
    let [value, j] = r, text2 = String(value);
    if (words[j] === "bucuk") { text2 = value + ".5"; j++; }
    else if ((words[j] === "virgul" || words[j] === "nokta") && j + 1 < words.length) {
      if (/^\d+$/.test(words[j + 1])) { text2 = value + "." + words[j + 1]; j += 2; }
      else {
        // ondalık: "uc" → 3, "sifir bes" → 05, "yirmi bes" → 25
        let k = j + 1, digits = "";
        const single = [];
        while (k < words.length && words[k] in ONES && single.length < 3) { single.push(ONES[words[k]]); k++; }
        if (single.length > 1) digits = single.join("");
        else { const f = readInt(j + 1); if (f) { digits = String(f[0]); k = f[1]; } }
        if (digits) { text2 = value + "." + digits; j = k; }
      }
    }
    out.push(text2); i = j;
  }
  return out.join(" ").replace(/(\d)\s*[,.]\s*(\d)/g, "$1.$2");
}

const FILLER1 = new Set(["ii", "iii", "ee", "eee", "hmm", "mm", "sey", "yani", "iste", "tamam", "evet", "peki", "simdi", "aslinda", "bakalim", "lutfen", "yaz", "yazin", "yazalim", "ekle", "ekleyin", "gir", "girin", "kaydet", "tamamdir", "eklendi"]);
const FILLER2 = new Set(["not al", "bir de", "ve de", "hayir hayir", "su sekilde"]);

// Semptom sözlüğü: [kanonik ad, ...kalıplar (katlanmış; her kelime önek olarak eşleşir)]
const SYMPTOMS = [
  ["Kanlı kusma", "kanli kusma", "hematemez"],
  ["Kusma", "kusma", "kusuyor", "kustu", "kusmuk", "istifra"],
  ["Kanlı ishal", "kanli ishal", "kanli diski", "melena"],
  ["İshal", "ishal", "diyare", "sulu diski"],
  ["Kabızlık", "kabizlik", "kabiz", "diski yapamiyor"],
  ["Öksürük", "oksuruk", "oksuruyor"],
  ["Ters hapşırma", "ters hapsirma"],
  ["Hapşırma", "hapsirma", "hapsiriyor", "hapsirik"],
  ["Burun akıntısı", "burun akintisi", "burnu akiyor", "nazal akinti"],
  ["Göz akıntısı", "goz akintisi", "gozu akiyor", "gozlerinde akinti", "capaklanma"],
  ["Göz kızarıklığı", "goz kizarikligi", "gozu kizarmis", "konjonktivit"],
  ["İştahsızlık", "istahsizlik", "istahsiz", "istahi yok", "istahi azal", "yemek yemiyor", "mama yemiyor", "anoreksi"],
  ["Halsizlik", "halsizlik", "halsiz", "durgunluk", "durgun", "uyusukluk", "letarji", "bitkin"],
  ["Kilo kaybı", "kilo kaybi", "kilo verdi", "zayifladi"],
  ["Polidipsi", "polidipsi", "cok su iciyor", "su tuketimi artti", "asiri su"],
  ["Poliüri", "poliuri", "cok idrar", "sik idrar", "idrari artti"],
  ["İdrar yapamama", "idrar yapamiyor", "idrar yapamama", "anuri", "idrar yaparken zorlan"],
  ["Kanlı idrar", "kanli idrar", "hematuri"],
  ["Nefes darlığı", "nefes darligi", "dispne", "zor nefes", "nefes almakta zorlan", "solunum guclugu"],
  ["Hırıltı", "hirilti"],
  ["Kaşıntı", "kasinti", "kasiniyor", "pruritus"],
  ["Tüy dökülmesi", "tuy dokulmesi", "tuy dokuyor", "alopesi"],
  ["Topallık", "topallik", "topalliyor", "aksiyor", "aksama"],
  ["Nöbet", "nobet", "kasilma", "havale", "konvulziyon"],
  ["Titreme", "titreme", "titriyor"],
  ["Salya artışı", "salya", "hipersalivasyon"],
  ["Karın ağrısı", "karin agrisi", "karni agriyor", "abdominal agri"],
  ["Karında şişlik", "karin siskinligi", "karni sisti", "abdominal distansiyon"],
  ["Kulak kaşıma / baş sallama", "kulak kasima", "kulagini kasiyor", "bas sallama", "basini salliyor"],
  ["Sarılık", "sarilik", "ikterus"],
  ["Dehidrasyon", "dehidrasyon", "susuz kalmis"],
  ["Ağız kokusu", "agiz kokusu", "halitozis"],
  ["Yutkunma güçlüğü", "yutkunamiyor", "disfaji"],
  ["Denge kaybı", "denge kaybi", "dengesiz", "ataksi", "sendeliyor"],
  ["Kanama", "kanama", "kaniyor"],
  ["Şişlik", "sislik", "kitle"],
];

const SECTIONS = [
  ["symptoms", ["semptom", "belirti"]],
  ["complaint", ["sikayet", "anamnez", "oyku", "hikaye", "sahibinin beyani", "sahibi diyor ki"]],
  ["findings", ["fizik muayene", "fiziksel muayene", "muayene bulgu", "klinik bulgu", "bulgu"]],
  ["assessment", ["on tani", "ayirici tani", "tani", "teshis", "degerlendirme"]],
  ["tests", ["tetkik", "testler", "laboratuvar", "tahlil"]],
  ["plan", ["tedavi", "plan", "oneri", "recete"]],
];

// [alan, anahtar kalıpları, birimler, aralık]
const VITALS = [
  ["weight", ["kilo", "kilosu", "kiloyu", "vucut agirligi", "agirlik", "agirligi"], ["kg", "kilogram", "kilo", "gram", "gr"], [0.01, 150]],
  ["temperature", ["ates", "atesi", "vucut isisi", "vucut sicakligi", "sicaklik", "sicakligi", "rektal", "derece", "derecesi"], ["derece"], [30, 45]],
  ["pulse", ["nabiz", "nabzi", "kalp hizi", "kalp atimi", "kalp atisi"], ["atim"], [20, 400]],
  ["respiratory", ["solunum", "solunumu", "solunum sayisi", "nefes", "nefes sayisi", "soluk"], ["nefes"], [4, 200]],
];

const ftok = w => fold(w).replace(/[^a-z0-9.,%]/g, "").replace(/^[.,]+|[.,]+$/g, "");
const prefixMatch = (toks, i, pattern) => { // kalıbın her kelimesi sırayla tokenların öneki mi?
  const ws = pattern.split(" ");
  for (let k = 0; k < ws.length; k++) { const t = toks[i + k]; if (!t || !t.f.startsWith(ws[k])) return 0; }
  return ws.length;
};
const exactMatch = (toks, i, pattern) => {
  const ws = pattern.split(" ");
  for (let k = 0; k < ws.length; k++) { const t = toks[i + k]; if (!t || t.f !== ws[k]) return 0; }
  return ws.length;
};
// Başlık: düz biçim (tedavi, bulgular) her yerde; iyelikli biçim (tedavisi, şikâyeti) yalnız cümle başında ya da noktalamadan sonra.
function headerMatch(toks, i, pattern) {
  const ws = pattern.split(" ");
  for (let k = 0; k < ws.length; k++) {
    const t = toks[i + k];
    if (!t || !t.f.startsWith(ws[k])) return 0;
    if (k < ws.length - 1) continue;
    const rest = t.f.slice(ws[k].length);
    if (["", "lar", "ler", "lari", "leri"].includes(rest)) continue;
    if (["si", "i", "su", "u", "imiz", "niz"].includes(rest) && (i === 0 || toks[i - 1].used || /[.,;:]$/.test(toks[i - 1].raw))) continue;
    return 0;
  }
  return ws.length;
}
function readNumber(toks, i) { // {value, end}
  let best = null;
  for (let j = i; j < Math.min(toks.length, i + 8); j++) {
    const s = toks.slice(i, j + 1).map(t => t.f).join(" ");
    const n = wordsToNumbers(s);
    if (/^\d+(?:\.\d+)?$/.test(n)) best = {value: Number(n), raw: n, end: j + 1};
    else if (j > i && !/^[\d.]+$/.test(n.split(" ")[0])) break;
  }
  return best;
}

function addDays(days, now = new Date()) {
  const d = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const cap = s => s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : s;
function render(toks) {
  const kept = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (FILLER1.has(t.f)) continue;
    if (toks[i + 1] && FILLER2.has(t.f + " " + toks[i + 1].f)) { i++; continue; }
    if (!kept.length && /^(ve|ile|da|de|olarak|ise)$/.test(t.f)) continue;
    kept.push(t.raw);
  }
  return cap(kept.join(" ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").replace(/([,;])\1+/g, "$1").trim());
}

/**
 * Konuşmayı muayene alanlarına ayırır; bölüm metinleri orijinal (Türkçe karakterli) sözcüklerle yazılır.
 * Dönüş: {fields, warnings, count}
 */
export function parseDictation(raw, now = new Date()) {
  const toks = String(raw ?? "").replace(/(\d)\s*,\s*(\d)/g, "$1,$2").split(/\s+/).filter(Boolean).map(r => ({raw: r, f: ftok(r), used: false}));
  const fields = {}, warnings = [];
  const use = (a, b) => { for (let k = a; k < b; k++) toks[k].used = true; };
  // 1) Yaşamsal bulgular: "anahtar [olarak|:] SAYI [birim]" ya da "SAYI birim"
  for (const [key, keys, units, [min, max]] of VITALS) {
    if (fields[key]) continue;
    let hit = null;
    for (let i = 0; i < toks.length && !hit; i++) {
      if (toks[i].used) continue;
      for (const kp of keys) {
        const n = exactMatch(toks, i, kp) || (kp.length > 4 ? prefixMatch(toks, i, kp) : 0);
        if (!n) continue;
        let j = i + n;
        while (toks[j] && ["olarak", "is", "da", "de", "ise"].includes(toks[j].f)) j++;
        const num = toks[j] && readNumber(toks, j);
        if (!num) continue;
        let end = num.end, unit = "";
        if (toks[end] && units.some(u => toks[end].f.startsWith(u))) { unit = toks[end].f; end++; }
        hit = {start: i, end, value: num.value, raw: num.raw, unit};
        break;
      }
    }
    if (!hit) for (let i = 0; i < toks.length && !hit; i++) { // SAYI birim (kg / derece)
      if (toks[i].used || !["weight", "temperature"].includes(key)) continue;
      const num = readNumber(toks, i);
      if (!num || !toks[num.end]) continue;
      const u = toks[num.end].f;
      if (key === "weight" && ["kg", "kilogram", "kilo", "gram", "gr"].includes(u) || key === "temperature" && u.startsWith("derece"))
        hit = {start: i, end: num.end + 1, value: num.value, raw: num.raw, unit: u};
    }
    if (!hit) continue;
    let v = hit.value;
    if (key === "weight" && (hit.unit === "gram" || hit.unit === "gr")) v /= 1000;
    if (key === "temperature" && v > 300 && v < 450 && !hit.raw.includes(".")) v /= 10; // "413" → 41.3
    use(hit.start, hit.end);
    for (let k = hit.start; k < hit.end; k++) toks[k].vital = true;
    if (!Number.isFinite(v) || v < min || v > max) { warnings.push(key); continue; }
    fields[key] = String(Math.round(v * 1000) / 1000);
  }
  // 2) Kontrol tarihi: "kontrol 3 gün sonra / yarın / haftaya / 2 hafta sonra"
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used || !toks[i].f.startsWith("kontrol")) continue;
    const t1 = toks[i + 1]?.f;
    if (t1 === "yarin" || t1 === "ertesi") { fields.next = addDays(1, now); use(i, i + 2 + (t1 === "ertesi" ? 1 : 0)); break; }
    if (t1 === "haftaya") { fields.next = addDays(7, now); use(i, i + 2); break; }
    const num = toks[i + 1] && readNumber(toks, i + 1);
    const unit = num && toks[num.end]?.f;
    if (num && unit && /^(gun|hafta|ay)/.test(unit)) {
      const d = unit.startsWith("gun") ? num.value : unit.startsWith("hafta") ? num.value * 7 : num.value * 30;
      if (d >= 1 && d <= 365) { fields.next = addDays(d, now); let e = num.end + 1; if (toks[e] && /^(sonra|icinde)/.test(toks[e].f)) e++; use(i, e); break; }
    }
  }
  // 3) Bölüm başlıkları
  const marks = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    for (const [key, pats] of SECTIONS) {
      const n = pats.map(p => headerMatch(toks, i, p)).find(Boolean);
      if (n) { marks.push({key, start: i, end: i + n}); i += n - 1; break; }
    }
  }
  const segs = [{key: "head", from: 0, to: marks[0]?.start ?? toks.length}];
  marks.forEach((m, k) => { use(m.start, m.end); segs.push({key: m.key, from: m.end, to: marks[k + 1]?.start ?? toks.length}); });
  // 4) Semptomlar (başlıksız kısımda ve "semptomlar" bölümünde)
  const found = [], negative = [];
  for (const seg of segs) {
    if (seg.key !== "head" && seg.key !== "symptoms") continue;
    for (let i = seg.from; i < seg.to; i++) {
      if (toks[i].used) continue;
      for (const [name, ...pats] of SYMPTOMS) {
        const n = pats.map(p => prefixMatch(toks, i, p)).find(Boolean);
        if (!n || i + n > seg.to) continue;
        let e = i + n, neg = false;
        if (toks[e] && /^(yok|olmamis|gorulmedi|izlenmedi|yokmus)$/.test(toks[e].f)) { neg = true; e++; }
        else if (toks[e] && /^(var|vardi|mevcut|oluyor)$/.test(toks[e].f)) e++;
        use(i, e);
        (neg ? negative : found).includes(name) || (neg ? negative : found).push(name);
        i = e - 1;
        break;
      }
    }
  }
  const lc = n => n.toLocaleLowerCase("tr-TR");
  if (found.length || negative.length) fields.symptoms = [found.map((n, k) => k ? lc(n) : n).join(", "), negative.length ? "yok: " + negative.map(n => n.toLocaleLowerCase("tr-TR")).join(", ") : ""].filter(Boolean).join("; ");
  const textOf = seg => { const rest = toks.slice(seg.from, seg.to).filter(t => !t.used); return rest.some(t => !/^(ve|ile|var|da|de|olarak|ise)$/.test(t.f) && !FILLER1.has(t.f)) ? render(rest) : ""; };
  for (const seg of segs) {
    if (seg.key === "head") continue;
    const v = textOf(seg);
    if (!v) continue;
    fields[seg.key] = fields[seg.key] ? fields[seg.key] + (seg.key === "symptoms" ? ", " : "; ") + v : v;
  }
  // Başlıksız kalan anlamlı metin (en az iki anlamlı sözcük) şikâyete eklenir
  let head = toks.slice(segs[0].from, segs[0].to).filter(t => !t.used && !FILLER1.has(t.f) && !/^(ve|ile|var|da|de|hastanin|hasta|hastada|kg|derece)$/.test(t.f));
  // Süre/zaman içeren öykü cümlesi ("2 gündür yemek yemiyor") şikâyete bütün olarak yazılır.
  const timed = toks.slice(segs[0].from, segs[0].to).some(t => !t.used && /^(\d+|bir|iki|uc|dort|bes)$/.test(t.f) === false && /(gundur|haftadir|saattir|aydir|beri|dunden|sabahtan|aksamdan|geceden)$/.test(t.f));
  if (timed) head = toks.slice(segs[0].from, segs[0].to).filter(t => !t.vital && !FILLER1.has(t.f));
  if (head.length >= 2) fields.complaint = fields.complaint ? render(head) + "; " + fields.complaint : render(head);
  if (fields.symptoms) fields.symptoms = cap(fields.symptoms);
  return {fields, warnings, count: Object.keys(fields).length};
}

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const WEEKDAYS = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];
const pad2 = n => String(n).padStart(2, "0");
function isoDate(y, m, d) {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? y + "-" + pad2(m) + "-" + pad2(d) : "";
}
function istanbulNow(now) { return new Date(now.toLocaleString("en-US", {timeZone: "Europe/Istanbul"})); }

/** Kontrol tarihi ifadesi: yarın, öbür gün, haftaya, 3 gün sonra, pazartesi, 5 aralık (2026), 5.12.2026 → {date, used} */
function readDate(toks, i, now) {
  const f = k => toks[i + k]?.f || "";
  const today = istanbulNow(now);
  if (f(0) === "bugun") return {date: addDays(0, now), used: 1};
  if (f(0) === "yarin") return {date: addDays(1, now), used: 1};
  if ((f(0) === "obur" || f(0) === "ertesi") && f(1).startsWith("gun")) return {date: addDays(2, now), used: 2};
  if (f(0) === "haftaya") {
    const wd = WEEKDAYS.indexOf(f(1));
    if (wd >= 0) { const diff = ((wd - today.getDay() + 7) % 7) + 7; return {date: addDays(diff, now), used: 2}; }
    return {date: addDays(7, now), used: 1};
  }
  let k = 0;
  if (["gelecek", "onumuzdeki", "bu"].includes(f(0))) k = 1;
  const wd = WEEKDAYS.indexOf(f(k).replace(/(ye|ya|e|a|gunu|gun)$/, "")) >= 0 ? WEEKDAYS.indexOf(f(k).replace(/(ye|ya|e|a|gunu|gun)$/, "")) : WEEKDAYS.indexOf(f(k));
  if (wd >= 0) { let diff = (wd - today.getDay() + 7) % 7; if (diff === 0 || k === 1 && f(0) !== "bu") diff = diff || 7; return {date: addDays(diff, now), used: k + 1}; }
  const m1 = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(f(0));
  if (m1) {
    let y = m1[3] ? Number(m1[3]) : today.getFullYear(); if (y < 100) y += 2000;
    let d = isoDate(y, Number(m1[2]), Number(m1[1]));
    if (d && !m1[3] && d < addDays(0, now)) d = isoDate(y + 1, Number(m1[2]), Number(m1[1]));
    if (d) return {date: d, used: 1};
  }
  const num = readNumber(toks, i);
  if (num) {
    const unit = toks[num.end]?.f || "";
    if (/^(gun|hafta|ay)/.test(unit)) {
      const n = unit.startsWith("gun") ? num.value : unit.startsWith("hafta") ? num.value * 7 : num.value * 30;
      let e = num.end + 1; if (/^(sonra|icinde|sonraya)/.test(toks[e]?.f || "")) e++;
      if (n >= 0 && n <= 365) return {date: addDays(n, now), used: e - i};
    }
    const mi = MONTHS.findIndex(m => unit.startsWith(m));
    if (mi >= 0 && num.value >= 1 && num.value <= 31) {
      let e = num.end + 1, y = today.getFullYear(), explicit = false;
      const yr = toks[e] && /^\d{4}$/.test(toks[e].f) ? Number(toks[e].f) : null;
      if (yr) { y = yr; e++; explicit = true; }
      let d = isoDate(y, mi + 1, num.value);
      if (d && !explicit && d < addDays(0, now)) d = isoDate(y + 1, mi + 1, num.value);
      if (d) return {date: d, used: e - i};
    }
  }
  return null;
}

/** Saat ifadesi: 14 30, 14:30, on dört otuz, iki buçuk, sabah dokuz, öğleden sonra üç → {time, used} */
function readTime(toks, i) {
  let j = i, shift = 0;
  const part = () => toks[j]?.f || "";
  if (/^(sabah|ogle|ogleden|aksam|gece)/.test(part())) {
    const w = part(); j++;
    if (w.startsWith("ogleden") && /^sonra/.test(part())) { shift = 12; j++; }
    else if (w.startsWith("aksam") || w.startsWith("gece")) shift = 12;
    else if (w === "ogle" || w === "oglen") shift = 12;
  }
  if (/^saat/.test(part())) j++;
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(part());
  let h, min = 0, end;
  if (m) { h = Number(m[1]); min = Number(m[2]); end = j + 1; }
  else {
    const a = readNumber(toks, j); if (!a) return null;
    end = a.end;
    if (String(a.raw).includes(".")) { h = Math.floor(a.value); min = Math.round((a.value - h) * 60); }
    else {
      h = a.value;
      const b = toks[end] && /^\d{1,2}$/.test(wordsToNumbers(toks[end].f)) ? readNumber(toks, end) : null;
      if (b && b.value < 60 && !/^(gun|hafta|ay)/.test(toks[b.end]?.f || "")) { min = b.value; end = b.end; }
    }
  }
  if (toks[end] && /^(da|de|ta|te|gibi)$/.test(toks[end].f)) end++;
  if (shift && h < 12) h += shift;
  if (!Number.isInteger(h) || h > 23 || min > 59) return null;
  return {time: pad2(h) + ":" + pad2(min), used: end - i};
}

/**
 * Muayene formundaki düğme ve özel alan komutları; konuşmanın geri kalanı dikte olarak döner.
 * Desteklenen: "kontrol tarihi …", "kontrol saati …", "kalem ekle", "fotoğraf ekle", "ürün/hizmet/ilaç ekle ADI",
 * "barkod 869…", "kaydet" / "muayeneyi kaydet", "tetkik ekle" / "kaydet ve tetkik ekle".
 */
export function parseExamCommands(raw, now = new Date()) {
  const toks = String(raw ?? "").replace(/\b(\d{1,2})\s*:\s*(\d{2})\b/g, "$1:$2").split(/\s+/).filter(Boolean).map(r => ({raw: r, f: ftok(r).replace(/:/g, ":"), used: false}));
  for (const t of toks) t.f = fold(t.raw).replace(/[^a-z0-9.:,%/-]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  const actions = [], fields = {};
  const use = (a, b) => { for (let k = a; k < b; k++) if (toks[k]) toks[k].used = true; };
  const at = k => toks[k]?.f || "";
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    const w = at(i), n1 = at(i + 1);
    // kontrol tarihi / kontrol günü / kontrol saati
    if (w.startsWith("kontrol") && /^(tarih|gun|saat)/.test(n1)) {
      const isTime = n1.startsWith("saat");
      let j = i + 2; if (/^(olarak|ise|da|de)$/.test(at(j))) j++;
      if (isTime) { const t = readTime(toks, j); if (t) { fields.nextTime = t.time; use(i, j + t.used); continue; } }
      else {
        const d = readDate(toks, j, now);
        if (d) {
          fields.next = d.date; use(i, j + d.used);
          // "kontrol tarihi yarın saat 14 30"
          if (/^saat/.test(at(j + d.used))) { const t = readTime(toks, j + d.used); if (t) { fields.nextTime = t.time; use(j + d.used, j + d.used + t.used); } }
          continue;
        }
      }
    }
    if (w.startsWith("kontrol") && /^(saat)/.test(at(i + 2)) === false && /^(yarin|haftaya|bugun|obur|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|gelecek|onumuzdeki)/.test(n1)) {
      const d = readDate(toks, i + 1, now);
      if (d) { fields.next = d.date; use(i, i + 1 + d.used); const e = i + 1 + d.used; if (/^saat/.test(at(e))) { const t = readTime(toks, e); if (t) { fields.nextTime = t.time; use(e, e + t.used); } } continue; }
    }
    if (w === "baslik" || w === "basligi") {
      let j = i + 1; const words = [];
      while (toks[j] && toks[j].f !== "kontrol" && !/^(kaydet|kalem|fotograf|foto|tetkik|kilo|ates|nabiz|solunum|semptom|sikayet|bulgu|tani|tedavi|plan)/.test(toks[j].f)) { words.push(toks[j].raw); j++; }
      if (words.length) { fields.title = words.join(" ").replace(/[.,;]+$/, "").replace(/^./, c => c.toLocaleUpperCase("tr-TR")); use(i, j); continue; }
    }
    if ((w === "kalem" || w === "satir") && /^ekle/.test(n1) || w === "yeni" && n1 === "kalem") { actions.push({type: "lineAdd"}); use(i, i + 2); continue; }
    if (/^(fotograf|foto|resim|gorsel)/.test(w) && /^(ekle|yukle|cek|sec)/.test(n1)) { actions.push({type: "photo"}); use(i, i + 2); continue; }
    if (w === "barkod" || w === "barkodu") {
      let j = i + 1, code = "";
      while (toks[j] && /^\d+$/.test(toks[j].f)) { code += toks[j].f; j++; }
      if (!code) { const num = readNumber(toks, j); if (num) { code = String(num.raw).replace(/\D/g, ""); j = num.end; } }
      if (code) { actions.push({type: "product", value: code}); use(i, j); continue; }
    }
    if (/^(urun|hizmet|ilac|asi|malzeme)$/.test(w) && /^ekle/.test(n1)) {
      let j = i + 2; const name = [];
      while (toks[j] && !/^(kaydet|ve|kalem|fotograf|foto|tetkik|kontrol)/.test(toks[j].f)) { name.push(toks[j].raw); j++; }
      if (name.length) { actions.push({type: "product", value: name.join(" ").replace(/[.,;]+$/, "")}); use(i, j); continue; }
    }
    if (/^(tetkik|laboratuvar|tahlil)$/.test(w) && /^ekle/.test(n1)) { actions.push({type: "saveLab"}); use(i, i + 2); continue; }
    if (w.startsWith("kaydet")) {
      // "muayeneyi kaydet ve tetkik ekle" tek eylemdir
      if (at(i + 1) === "ve" && /^(tetkik|laboratuvar|tahlil)$/.test(at(i + 2)) && /^ekle/.test(at(i + 3))) { actions.push({type: "saveLab"}); use(i, i + 4); }
      else { actions.push({type: "save"}); use(i, i + 1); }
      if (i > 0 && /^(muayeneyi|muayene|kaydi|formu|bunu|hepsini|tamam)$/.test(at(i - 1)) && !toks[i - 1].used) toks[i - 1].used = true;
      continue;
    }
  }
  // Kaydetme en sona alınır (önce alanlar ve kalemler işlenir); birden fazla kaydetme komutu tek kez uygulanır.
  const saves = actions.filter(a => a.type === "save" || a.type === "saveLab");
  const others = actions.filter(a => a.type !== "save" && a.type !== "saveLab");
  const final = saves.find(a => a.type === "saveLab") || saves[0];
  const rest = toks.filter(t => !t.used).map(t => t.raw).join(" ");
  return {actions: final ? [...others, final] : others, fields, rest};
}

/** Muayene komutunu dikte kısmından ayırır: "pamuk icin yeni muayene ac kilo 4 ..." → {command, dictation}. */
export function splitExamCommand(raw) {
  const original = String(raw ?? "").trim();
  const f = fold(original);
  const verb = /\b(?:(?:yeni\s+)?(?:muayene|soap)\w*\s+(?:olustur|baslat|ac|acin|ekle|gir|yap)\w*|yeni\s+(?:muayene|soap)\w*)\b/.exec(f);
  if (!verb || /\b(?:son|onceki|gecen)\s+muayene/.test(f)) return null;
  // Komuttan sonraki ilk klinik anahtar sözcük dikte başlangıcıdır.
  const after = f.slice(verb.index + verb[0].length);
  const key = /\b(?:kilo\w*|agirlik\w*|ates\w*|derece|nabiz\w*|nabzi|solunum\w*|nefes|semptom\w*|belirti\w*|sikayet\w*|anamnez\w*|bulgu\w*|tani\w*|teshis\w*|tetkik\w*|tedavi\w*|plan\w*|kontrol\w*|\d)/.exec(after);
  const symptom = SYMPTOMS.flatMap(([, ...p]) => p).map(p => ({p, i: after.search(new RegExp("\\b" + p))})).filter(x => x.i >= 0).sort((a, b) => a.i - b.i)[0];
  let cut = Math.min(key ? key.index : Infinity, symptom ? symptom.i : Infinity);
  const headName = f.slice(0, verb.index).trim();
  const tail = Number.isFinite(cut) ? after.slice(0, cut) : after;
  const command = (headName + " " + verb[0] + " " + tail).replace(/\s+/g, " ").trim();
  const dictation = Number.isFinite(cut) ? after.slice(cut).trim() : "";
  // Dikte metnini orijinal yazımla döndür (ham metnin aynı uzunluktaki son kısmı)
  const rawWords = original.split(/\s+/), dictWords = dictation ? dictation.split(/\s+/).length : 0;
  return {command, dictation: dictWords ? rawWords.slice(-dictWords).join(" ") : ""};
}

// ---------------- Hızlı ses tanıma (tarayıcının yerleşik tanıyıcısı) ----------------
const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
let browserBroken = false;
export const browserSttAvailable = () => !!SR && !browserBroken;
export function markBrowserSttBroken() { browserBroken = true; }

/**
 * Basılı tutarken dinler, bırakınca (stop) son metni verir. MediaRecorder benzeri {state, stop(), onstop} döner.
 * Kesin sonuçlar birleşir; ara sonuçlar interim ile gösterilir.
 */
export function listen({lang = "tr-TR", interim, done}) {
  const rec = new SR();
  // Android Chrome'da sürekli (continuous) mod kesin sonuçları tekrarlar ve sessizce kapanır: orada tek cümlelik oturumlar
  // art arda açılır (onend içinde yeniden başlatılır), metin birikir.
  const android = /Android/i.test(navigator.userAgent || "");
  rec.lang = lang; rec.interimResults = true; rec.continuous = !android; rec.maxAlternatives = 1;
  let acc = "", finalText = "", lastInterim = "", finished = false, error = "";
  const handle = {state: "recording", onstop: null, stop() { if (handle.state !== "recording") return; handle.state = "stopping"; try { rec.stop(); } catch { finish(); } }};
  const all = () => (acc + " " + finalText).replace(/\s+/g, " ").trim();
  const finish = () => {
    if (finished) return; finished = true; handle.state = "inactive";
    const text = (all() || lastInterim).replace(/\s+/g, " ").trim();
    if (["service-not-allowed", "network", "language-not-supported", "audio-capture"].includes(error)) browserBroken = true;
    done?.(text, error);
  };
  rec.onresult = e => {
    let fin = "", tmp = "";
    for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript + " ") : (tmp += e.results[i][0].transcript));
    finalText = fin.trim(); lastInterim = tmp.trim();
    interim?.((all() + " " + lastInterim).trim());
  };
  rec.onerror = e => { error = e.error || "error"; if (error === "no-speech" && (all() || lastInterim)) error = ""; if (!error) handle.state = "stopping"; };
  // Chrome sessizlikte oturumu kapatabilir: basılı tutulduğu sürece kaldığı yerden devam eder.
  rec.onend = () => { if (handle.state === "recording" && !error) { acc = (all() + " " + (finalText ? "" : lastInterim)).trim(); finalText = ""; lastInterim = ""; try { rec.start(); return; } catch {} } if (!all() && lastInterim) finalText = lastInterim; finish(); };
  try { rec.start(); } catch { error = "start"; setTimeout(finish, 0); }
  return handle;
}
