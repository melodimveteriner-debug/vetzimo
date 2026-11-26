// VetZimo · VeBot belirti → hastalık eşleştirici (tamamen tarayıcıda, API'siz, ücretsiz).
// Hekimin yazdığı belirtileri (ör. "köpekte öksürük, ateş, burun akıntısı") 70'i aşkın kanonik belirtiye ayırır; olgu kütüphanesindeki
// her hastalığın belirti metnini aynı sözlükle etiketler ve nadir belirtilere daha yüksek ağırlık vererek olası hastalıkları sıralar.
// Karar desteğidir; kesin tanı hekime aittir.
import {CASES} from "./vet-cases.js?v=2";

const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// [kanonik ad, ...kalıplar]  — kalıplar katlanmış (ASCII) ve kelime başından eşleşir; "\w*" ile ek almış biçimleri yakalar.
export const SYMPTOMS = [
  ["Kusma", "kus(?:ma\\w*|uyor\\w*|tu\\w*|ar\\b|ari\\w*|acak\\w*|abil\\w*|muyor\\w*|mus\\b)", "istifra", "emesis"],
  ["Kanlı kusma", "kanli kus\\w*", "hematemez\\w*", "kan kus\\w*"],
  ["Regürjitasyon", "regurjit\\w*", "yemegi geri cikar\\w*"],
  ["Öğürme / kusamama", "ogur\\w*", "kusamiyor", "kusamama\\w*", "kusmaya calis\\w*", "verimsiz kusma"],
  ["İshal", "ishal\\w*", "diyare\\w*", "sulu diski", "yumusak diski", "cikti sulu"],
  ["Kanlı ishal / dışkıda kan", "kanli ishal\\w*", "kanli diski", "diskida kan", "hematokezi\\w*", "melena\\w*", "siyah diski"],
  ["Kabızlık", "kabiz\\w*", "konstipasyon\\w*", "diski yapam\\w*", "obstipasyon\\w*"],
  ["Dışkılamada zorlanma", "tenezm\\w*", "diskilarken zorlan\\w*", "ikinma\\w*"],
  ["İştahsızlık", "istahsiz\\w*", "istah\\w* (yok|azal\\w*|kesil\\w*|kayb\\w*)", "anoreksi\\w*", "yemek yemiyor", "mama yemiyor", "yemiyor", "yemek yemi\\w*"],
  ["Polifaji (çok yeme)", "polifaji\\w*", "cok yiyor", "asiri istah\\w*", "istah\\w* art\\w*"],
  ["Kilo kaybı", "kilo kayb\\w*", "kilo veriyor", "zayifl\\w*", "kaslar eri\\w*", "kaseksi\\w*"],
  ["Kilo artışı", "kilo al\\w*", "kilo artis\\w*", "sisman\\w*", "obez\\w*"],
  ["Çok su içme (polidipsi)", "polidipsi\\w*", "cok su ic\\w*", "su tuketimi art\\w*", "asiri su", "susuzluk art\\w*"],
  ["Çok idrar (poliüri)", "poliuri\\w*", "cok idrar\\w*", "idrar miktari art\\w*", "cok cis\\w*"],
  ["İdrar yapamama / zorlanma", "idrar yapam\\w*", "idrar cikmiyor", "stranguri\\w*", "disuri\\w*", "idrar yaparken zorlan\\w*", "kumda zorlan\\w*", "isiyemiyor", "cis yapam\\w*", "kumda cok vakit"],
  ["Sık idrar", "sik idrar\\w*", "polakiuri\\w*", "sik sik isi\\w*", "sik cis\\w*"],
  ["İdrarda kan", "hematuri\\w*", "idrarda kan", "kanli idrar", "kirmizi idrar", "pembe idrar"],
  ["İdrar kaçırma", "idrar kacir\\w*", "inkontinans\\w*", "idrar damlat\\w*", "altina kacir\\w*"],
  ["Ateş", "ates\\w*", "hipertermi\\w*", "yuksek ates", "sicak\\w* (vucut|kulak)"],
  ["Düşük vücut ısısı", "hipotermi\\w*", "vucudu soguk", "ates dusuk"],
  ["Halsizlik / letarji", "halsiz\\w*", "letarji\\w*", "durgun\\w*", "keyifsiz\\w*", "uyusuk\\w*", "bitkin\\w*", "enerjisi yok", "depresyon"],
  ["Kollaps / bayılma", "kollaps\\w*", "bayil\\w*", "senkop\\w*", "yere yigil\\w*", "dustu kalkamadi"],
  ["Egzersiz intoleransı", "egzersiz intolerans\\w*", "cabuk yorul\\w*", "yurumek istemiyor", "yorgunluk"],
  ["Öksürük", "oksur\\w*", "kuru oksuruk", "balgam\\w*", "kaz sesi"],
  ["Hapşırma", "hapsir\\w*"],
  ["Burun akıntısı", "burun\\w*(?: \\w+){0,2} akinti\\w*", "burn\\w*(?: \\w+){0,2} akinti\\w*", "burun akinti\\w*", "burun aki\\w*", "nazal akinti\\w*", "rinore\\w*", "burnu akiyor", "sumuk\\w*"],
  ["Burun kanaması", "burun kanama\\w*", "epistaksis\\w*", "burnundan kan"],
  ["Solunum güçlüğü", "dispne\\w*", "nefes darlig\\w*", "solunum guclug\\w*", "zor nefes", "nefes alamiyor", "agiz acik nefes", "hizli nefes", "takipne\\w*", "hirilti\\w*", "solunum sikinti\\w*"],
  ["Hırıltılı / gürültülü solunum", "horlama\\w*", "stridor\\w*", "gurultulu solunum", "hiriltili", "hirlama"],
  ["Siyanoz (morarma)", "siyanoz\\w*", "dil mor", "mukoza mor", "morarma"],
  ["Göz akıntısı", "goz\\w*(?: \\w+){0,3} akinti\\w*", "goz akinti\\w*", "gozu akiyor", "gozleri akiyor", "capak\\w*", "gozyasi art\\w*", "epifora\\w*"],
  ["Gözde kızarıklık", "gozde kizarik\\w*", "kirmizi goz", "gozler kizar\\w*", "goz kizar\\w*", "konjonktiv\\w*"],
  ["Gözde bulanıklık / görme kaybı", "gozde bulanik\\w*", "gozde beyaz\\w*", "kornea bulanik\\w*", "gorme kayb\\w*", "kor\\b", "gormuyor", "carpiyor esyalara"],
  ["Gözü kısma / ağrı", "gozunu kisi\\w*", "blefarospazm\\w*", "gozunu acamiyor", "goz agri\\w*"],
  ["Kulak kaşıntısı / baş sallama", "kulak kasin\\w*", "kulagini kasi\\w*", "bas sall\\w*", "kafasini sall\\w*"],
  ["Kulak akıntısı / koku", "kulak akinti\\w*", "kulak kokusu", "kulaktan akinti", "kulak kiri\\w*", "kulakta siyah"],
  ["Kaşıntı", "kasin\\w*", "pruritus\\w*", "kasiyor", "yalaniyor", "isiriyor kendini", "kasinip"],
  ["Tüy dökülmesi", "tuy dokul\\w*", "kil dokul\\w*", "alopesi\\w*", "tuysuz\\w*", "kellik", "tuyleri dokul\\w*"],
  ["Deride kızarıklık / döküntü", "deride kizarik\\w*", "eritem\\w*", "dokuntu\\w*", "papul\\w*", "pustul\\w*", "kabuklan\\w*", "kepek\\w*", "pul pul"],
  ["Deride yara / akıntı", "deride yara", "yara\\b", "akintili yara", "ulser\\w*", "hot spot", "nemli dermatit"],
  ["Deri / deri altı kitle", "kitle\\w*", "sislik\\w*", "yumru\\w*", "tumor\\w*", "kist\\w*", "ur\\b"],
  ["Lenf bezi büyümesi", "lenf\\w* buyu\\w*", "lenfadenopati\\w*", "lenf bezleri sis\\w*", "lenf nodu"],
  ["Topallık", "topall\\w*", "aksiyor", "aksama\\w*", "aksak\\w*", "ayagini basmiyor", "bacagini kaldir\\w*", "bacagini tutuyor", "seke seke"],
  ["Eklem ağrısı / tutukluk", "eklem agri\\w*", "eklemde sislik", "tutukluk", "sabah tutuk\\w*", "kalkmakta zorlan\\w*", "merdiven cikam\\w*"],
  ["Sırt / boyun ağrısı", "sirt\\w*(?: \\w+)? agri\\w*", "bel\\w*(?: \\w+)? agri\\w*", "sirt agri\\w*", "boyun agri\\w*", "kambur dur\\w*", "dokununca bagir\\w*", "kambur"],
  ["Arka bacak güçsüzlüğü / felç", "arka bacak\\w*", "felc\\w*", "parezi\\w*", "parapleji\\w*", "paraliz\\w*", "yuruyemiyor", "ayaga kalkam\\w*"],
  ["Ataksi / denge kaybı", "ataksi\\w*", "dengesiz\\w*", "denge kayb\\w*", "sendele\\w*", "sarhos gibi", "koordinasyon bozuk\\w*"],
  ["Baş eğikliği / nistagmus", "bas egik\\w*", "kafa egik\\w*", "kafasi yana", "nistagmus\\w*", "donuyor\\b", "daire cizerek"],
  ["Nöbet / kasılma", "nobet\\w*", "kasilma\\w*", "konvulziyon\\w*", "epilep\\w*", "krize gir\\w*", "kriz\\b", "ses getir\\w*"],
  ["Titreme / kas seğirmesi", "titre\\w*", "tremor\\w*", "segirme\\w*", "fasikulasyon\\w*"],
  ["Davranış değişikliği", "davranis degis\\w*", "saldirgan\\w*", "yon kayb\\w*", "saskin\\w*", "bilinc bulanik\\w*", "duvara bas\\w*", "huzursuz\\w*"],
  ["Sarılık", "sarilik\\w*", "ikter\\w*", "mukozalar sari", "gozun aki sari", "deri sari"],
  ["Solgun mukoza / kansızlık", "solgun\\w*", "anemi\\w*", "kansiz\\w*", "mukoza beyaz", "dis eti beyaz"],
  ["Kanama / morarma", "kanama\\w*", "pesteki\\w*", "petesi\\w*", "ekimoz\\w*", "morluk\\w*", "kanamasi durmuyor"],
  ["Karın şişliği", "karin sis\\w*", "sis\\w* karin", "karni sis\\w*", "karin\\w*(?: \\w+)? sis\\w*", "karin buyu\\w*", "asit\\b", "asites\\w*", "gergin karin", "karin dolgun", "distansiyon\\w*"],
  ["Karın ağrısı", "karin agri\\w*", "karna dokununca", "dua pozisyon\\w*", "abdominal agri\\w*"],
  ["Salya / ağızdan köpük", "salya\\w*", "hipersalivasyon\\w*", "agizdan kopuk", "ptyalizm\\w*", "agzi sulan\\w*"],
  ["Ağız kokusu / diş-dişeti sorunu", "agiz kokusu", "halitozis\\w*", "dis tasi", "dis eti\\w*", "dis\\w* sallan\\w*", "dis agri\\w*", "cigneme\\w* zorl\\w*"],
  ["Yutma güçlüğü", "yutma gucl\\w*", "yutamiyor", "disfaji\\w*"],
  ["Dehidrasyon", "dehidrasyon\\w*", "susuz kal\\w*", "deri kivrimi", "goz cukur\\w*"],
  ["Vulva akıntısı", "vulva akinti\\w*", "vajinal akinti\\w*", "akinti var arkadan", "dogum yolundan akinti"],
  ["Meme şişliği / akıntı", "meme sis\\w*", "memede sert\\w*", "memede kitle", "sut\\w* geliyor", "meme akinti\\w*"],
  ["Gebelik / doğum sorunu", "dogum\\w* yap\\w*am\\w*", "ikiniyor ama", "yavru cikm\\w*", "dogum sanc\\w*", "gebe\\w*"],
  ["Testis / prostat sorunu", "testis\\w*", "hayalar\\w*", "prostat\\w*", "penis\\w*"],
  ["Anüs bölgesinde kaşıntı / sürtme", "kizak\\w*", "popo sur\\w*", "anal kese\\w*", "makatini sur\\w*", "makat\\w*"],
  ["Pire / kene / parazit görülmesi", "pire\\w*", "kene\\w*", "bit\\b", "solucan\\w*", "kurt dok\\w*", "diskida kurt"],
  ["Kalp üfürümü / aritmi", "ufurum\\w*", "aritmi\\w*", "duzensiz kalp", "murmur\\w*", "kalp hizi\\w*"],
  ["Tüy yolma", "tuy\\w* yol\\w*", "kendini yol\\w*", "feather pluck\\w*"],
  ["Kabarık oturma (kuş)", "kabarik\\w*", "tuylerini kabart\\w*", "kafes dibinde", "tunekten dus\\w*"],
  ["Kuyruk sallayarak solunum", "kuyruk sallay\\w*", "kuyrugu inip kalk\\w*"],
  ["Ses değişikliği", "ses\\w* degis\\w*", "sesi kisil\\w*", "konusmuyor", "otmuyor", "sesi cikmiyor"],
  ["Yumurta bağlama / yumurtlayamama", "yumurta bagla\\w*", "yumurtlayam\\w*", "yumurta tikan\\w*", "yumurta tutul\\w*"],
  ["Gaga / tırnak sorunu", "gaga\\w*", "sungerimsi", "beyaz kabuk\\w*", "tirnak\\w* uza\\w*"],
  ["Diş uzaması / çiğneme güçlüğü", "dis\\w* uza\\w*", "kesici dis\\w*", "malokluzyon\\w*", "dis gicirdat\\w*", "secici ye\\w*"],
  ["Dışkı azalması / yokluğu", "diski yok", "diski azal\\w*", "diski yapmiyor", "kakasi yok", "kucuk diski", "kuru diski", "diskilam\\w* yok"],
  ["Kabuk / kemik yumuşaması", "kabu\\w* yumusa\\w*", "kemik\\w* yumusa\\w*", "cene\\w* yumusa\\w*", "cene\\w* sis\\w*", "bacak\\w* egri\\w*", "kabuk sekil\\w*"],
  ["Kabukta yara / koku", "kabuk\\w* yara\\w*", "kabuk\\w* curu\\w*", "kabuk\\w* koku\\w*", "plak\\w* kalk\\w*"],
  ["Deri değiştirememe", "deri degistirem\\w*", "gomlek atam\\w*", "kabuk degistirem\\w*", "eski deri"],
  ["Göz kapağı şişliği", "goz\\w* kapa[gk]\\w*(?: \\w+)? sis\\w*", "gozler\\w* kapali", "gozunu acam\\w*", "goz\\w* sis\\w*"],
  ["Ağız açık soluma", "agz\\w* acik\\w*", "agiz acik", "agzi acik"],
  ["Larva / kurtlanma", "kurtlan\\w*", "larva\\w*", "sinek kurdu"],
  ["Islak kuyruk / kirli arka bölge", "islak kuyruk", "wet tail", "kuyruk\\w* islak", "arkasi kirli", "makat\\w* kirli"],
  ["Ağrı", "agri\\w*", "aci cek\\w*", "inliyor", "agliyor", "sizlan\\w*"],
  ["Ani ölüm / ağır tablo", "ani olum", "agir tablo", "sok\\b", "soka gir\\w*"],
];

const REGEXES = SYMPTOMS.map(([name, ...pats]) => [name, new RegExp("\\b(?:" + pats.join("|") + ")", "")]);
// Olumsuz ifade: "ishal yok", "ateşi yok" → belirti sayılmaz.
const NEG = /^\s*(yok|olmamis|gorulmedi|izlenmedi|yokmus|degil)\b/;

/** Metindeki belirtiler (katlanmış metin üzerinden). */
export function extractSymptoms(text) {
  const t = fold(text), found = [];
  for (const [name, re] of REGEXES) {
    const m = re.exec(t);
    if (!m) continue;
    if (NEG.test(t.slice(m.index + m[0].length, m.index + m[0].length + 14))) continue;
    found.push(name);
  }
  // Daha özgül belirti varsa genel olanı düş (kanlı ishal ⊃ ishal, kanlı kusma ⊃ kusma)
  const drop = new Set();
  if (found.includes("Kanlı ishal / dışkıda kan")) drop.add("İshal");
  if (found.includes("Kanlı kusma")) drop.add("Kusma");
  return found.filter(n => !drop.has(n));
}

// Her olgunun belirtileri: belirti metninden çıkarılır; metnin başında geçen belirtiler "ana belirti" sayılır (daha yüksek ağırlık).
const INDEX = CASES.map(c => {
  const signs = String(c[4] || ""), head = signs.slice(0, Math.max(60, Math.floor(signs.length * 0.45)));
  const set = new Set(extractSymptoms(signs + " " + c[0])), primary = new Set(extractSymptoms(head + " " + c[0]));
  for (const [a, b] of [["Kanlı ishal / dışkıda kan", "İshal"], ["Kanlı kusma", "Kusma"]]) { if (set.has(a)) set.add(b); if (primary.has(a)) primary.add(b); }
  return {c, set, primary, who: fold((c[3] || "") + " " + c[0])};
});
// Ters belge sıklığı: nadir belirtiler (ör. "idrar yapamama") genel belirtilerden (ör. "halsizlik") daha belirleyicidir.
const DF = {};
for (const {set} of INDEX) for (const s of set) DF[s] = (DF[s] || 0) + 1;
const IDF = s => Math.log((INDEX.length + 1) / ((DF[s] || 0) + 1)) + 0.4;
// Yaş / grup ipuçları: soru ve olgunun "kimlerde" alanı aynı grubu anıyorsa sıralamada öne çıkar.
const GROUPS = [
  [/\b(yavru\w*|genc|bebek|puppy|kitten|asisiz)\b/, /\b(yavru\w*|genc\w*|asisiz|yeni dogan|neonatal)/],
  [/\b(yasli|geriatri\w*|ihtiyar)\b/, /\b(yasli|orta yas|geriatri\w*|\d+ yas ustu)/],
  [/\b(disi|kisirlastirilmamis disi|gebe\w*|dogum\w*|emzir\w*)\b/, /\b(disi|gebe\w*|laktasyon|dogum)/],
  [/\b(erkek)\b/, /\b(erkek)/],
  [/\b(buyuk irk|iri irk|alman coban\w*|labrador|golden)\b/, /\b(buyuk irk|dev irk|orta buyuk irk|buyuk ve dev)/],
  [/\b(kucuk irk|oyuncak irk|toy|pomeranyan|yorkshire|chihuahua|maltese)\b/, /\b(kucuk irk|oyuncak irk|toy)/],
];

const SP_TR = {dog: "köpek", cat: "kedi"};

/**
 * Belirtilerden olası hastalıklar. Dönüş VeBot yanıt nesnesi ya da null.
 * opts.species: "dog" | "cat" | "" ; opts.min: en az belirti sayısı (varsayılan 1)
 */
export function symptomAnswer(text, {species = "", min = 1} = {}) {
  const asked = extractSymptoms(text);
  if (asked.length < min) return null;
  const scored = [];
  const q = fold(text);
  for (const {c, set, primary, who} of INDEX) {
    if (species && c[2] !== "both" && c[2] !== species) continue;
    const hit = asked.filter(s => set.has(s));
    if (!hit.length) continue;
    let score = hit.reduce((a, s) => a + IDF(s) * (primary.has(s) ? 1.6 : 1), 0) / (1 + set.size / 25);
    for (const [qa, ca] of GROUPS) if (qa.test(q) && ca.test(who)) score *= 1.5;
    scored.push({c, hit, score, cover: hit.length / asked.length});
  }
  if (!scored.length) return null;
  // Önce kaç belirtiyi karşıladığı, sonra ağırlıklı puan
  scored.sort((a, b) => b.hit.length - a.hit.length || b.score - a.score);
  const best = scored[0].hit.length;
  const list = scored.filter(x => x.hit.length >= Math.max(1, Math.min(best, Math.ceil(asked.length / 2)))).slice(0, 8);
  const top = list.slice(0, 3);
  const firstClause = s => String(s).split(/[;.]/)[0].trim();
  const who = species ? SP_TR[species] : "kedi ve köpek";
  return {
    text: "Bu belirtiler şu hastalıklarda görülebilir · " + who,
    stats: [["Değerlendirilen belirtiler", asked.join(", ")], ["İlk tetkik önerisi", [...new Set(top.map(x => firstClause(x.c[5])))].join(" · ")]],
    items: list.map(x => [x.c[0], "Eşleşen: " + x.hit.join(", ").toLocaleLowerCase("tr-TR") + (x.c[2] === "both" ? "" : " · " + SP_TR[x.c[2]]), "ask:" + x.c[0] + " tedavisi"]),
    note: "Sıralama, yazdığınız belirtilerin olgu kütüphanesindeki " + INDEX.length + " hastalıkla örtüşmesine göredir. Bir hastalığa dokunursanız belirti, tanı ve tedavi kartını açarım. Yaş, ırk, aşı durumu ve muayene bulgularını ekleyerek listeyi daraltın. Karar desteğidir; kesin tanı ve tedavi hekime aittir.",
  };
}

/** Yanıt bulunamayınca en yakın hastalık adları (yazım hatalarına dayanıklı). */
export function suggestCases(text, limit = 4) {
  const STOP = /^(kedi|kopek|tedav|belirt|nedir|nasil|hasta|yavru|tani|ilac|doz|olur|olabilir|neden|hangi|icin|ile|gibi|cok|var|yok)/;
  const words = fold(text).split(" ").filter(w => w.length >= 5 && !STOP.test(w));
  if (!words.length) return [];
  const dist = (a, b) => {
    const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 9;
    const d = Array.from({length: m + 1}, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  };
  const out = [];
  for (const c of CASES) {
    const keys = [fold(c[0]), ...c[1].map(fold)].flatMap(k => k.split(" ")).filter(k => k.length >= 5 && !STOP.test(k));
    let best = 9;
    for (const w of words) for (const k of keys) { const v = (k.startsWith(w.slice(0, 5)) || w.startsWith(k.slice(0, 5))) ? Math.min(1, dist(w, k)) : dist(w, k), lim = Math.max(1, Math.floor(Math.min(w.length, k.length) / 4)); if (v <= lim && v < best) best = v; }
    if (best < 9) out.push([best, c[0]]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, limit).map(x => x[1]);
}

export const SYMPTOM_STATS = {symptoms: SYMPTOMS.length, cases: CASES.length};
