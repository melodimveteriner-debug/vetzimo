// Evden takip ön değerlendirmesi (tarayıcı). Sunucudaki HomeCareTriage.php ile aynı kuralları ve aynı
// metin katlama adımlarını uygular; kurallar homecare-triage.json dosyasındadır. Tanı koymaz, yönlendirir.
const MAP = {"ç":"c","ğ":"g","ı":"i","ö":"o","ş":"s","ü":"u","á":"a","à":"a","â":"a","ä":"a","ã":"a","å":"a","é":"e","è":"e","ê":"e","ë":"e",
  "í":"i","ì":"i","î":"i","ï":"i","ó":"o","ò":"o","ô":"o","õ":"o","ú":"u","ù":"u","û":"u","ñ":"n","ß":"ss","œ":"oe","æ":"ae","ё":"е","ي":"ی","ك":"ک"};
const MARKS = /\p{M}/gu, ZWNJ = /‌/g, SPACE = /\s+/gu, WORD = /[\p{L}\p{N}]/u;
const NO_BOUNDARY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export const LEVELS = ["routine", "soon", "urgent"];

export function fold(text) {
  return String(text ?? "").toLowerCase().replace(MARKS, "").replace(/[^\u0000-\u007f]/gu, c => MAP[c] ?? c)
    .replace(ZWNJ, "").replace(SPACE, " ").trim();
}

let cache = null;
export function prepare(rules) {
  if (cache?.rules === rules) return cache.prepared;
  const groups = level => Object.entries(rules[level] || {}).map(([code, words]) => [code, [...new Set(words.map(fold).filter(Boolean))]]);
  const prepared = {
    urgent: groups("urgent"), soon: groups("soon"),
    after: (rules.negation?.after || []).map(w => " " + fold(w)),
    before: (rules.negation?.before || []).map(w => fold(w) + " "),
  };
  cache = {rules, prepared};
  return prepared;
}

function negated(text, start, end, p) {
  let tail = end;
  while (tail < text.length && WORD.test(text[tail])) tail++;
  const after = text.slice(tail), before = " " + text.slice(0, start);
  return p.after.some(w => after.startsWith(w)) || p.before.some(w => before.endsWith(" " + w));
}

function found(text, word, p) {
  const boundary = !NO_BOUNDARY.test(word), whole = boundary && [...word].length <= 4;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    const end = at + word.length;
    if (boundary && at > 0 && WORD.test(text[at - 1])) continue;
    if (whole && end < text.length && WORD.test(text[end])) continue;
    if (!negated(text, at, end, p)) return true;
  }
  return false;
}

/** @returns {{level:"routine"|"soon"|"urgent", reasons:string[]}} */
export function evaluate(rules, {observation = "", details = {}, note = ""} = {}) {
  const p = prepare(rules), text = fold(note), reasons = [];
  let level = 0;
  const raise = (value, code) => { level = Math.max(level, value); if (!reasons.includes(code)) reasons.push(code); };
  if (text) {
    for (const [code, words] of p.urgent) if (words.some(w => found(text, w, p))) raise(2, code);
    for (const [code, words] of p.soon) if (words.some(w => found(text, w, p))) raise(1, code);
  }
  if (details?.appetite === "none") raise(1, "appetite_none");
  if (details?.water === "less") raise(1, "water_less");
  if (details?.appetite === "none" && details?.activity === "less") raise(1, "appetite_activity");
  if (details?.stool === "bloody") raise(2, "stool_blood");
  if (details?.stool === "diarrhea") raise(1, "stool_diarrhea");
  if (details?.urine === "unable") raise(2, "urine_unable");
  if (details?.urine === "bloody") raise(1, "urine_blood");
  if (details?.vomit === "3plus") raise(1, "vomit_many");
  if (details?.comfort === "pain") raise(1, "pain_seen");
  if (details?.wound === "discharge" || details?.wound === "open") raise(details.wound === "open" ? 2 : 1, "wound_" + details.wound);
  if (details?.temperature != null && details.temperature !== "") { const t = Number(String(details.temperature).replace(",", ".")); if (t >= 40.5 || t < 37) raise(2, "temp_critical"); else if (t >= 39.5) raise(1, "temp_high"); }
  if (observation === "contact") raise(1, "contact");
  if (details?.medication === "missed") { if (!reasons.includes("med_missed")) reasons.push("med_missed"); }
  const order = code => (p.urgent.some(([c]) => c === code) ? 0 : 1);
  reasons.sort((a, b) => order(a) - order(b));
  return {level: LEVELS[level], reasons};
}

let loading = null;
export function loadRules() {
  loading ||= fetch("/homecare-triage.json?v=1", {credentials: "same-origin"}).then(r => {
    if (!r.ok) throw Error("rules");
    return r.json();
  }).catch(error => { loading = null; throw error; });
  return loading;
}
