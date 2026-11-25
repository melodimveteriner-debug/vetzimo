// VetZimo cihaz sonucu çözümleyicileri (tarayıcı ve klinik ajanı ortak kullanır; bağımlılık yok).
// HL7 v2 ORU^R01 (Mindray, Seamaty, Skyla, Zoetis, Heska...), ASTM E1394 / E1381 çerçeveleri (IDEXX, Fujifilm,
// Scil, Exigo, Abaxis...), CSV/TXT dışa aktarımları, basit XML ve DICOM üstbilgisi (röntgen, ultrason, MR, BT).

const MODALITY = {CR: "xray", DX: "xray", DR: "xray", RG: "xray", MG: "xray", XA: "xray", RF: "xray", IO: "xray", PX: "xray", US: "ultrasound", MR: "mr", CT: "ct", OT: "other"};
const BG = /^(pH|pCO2|pO2|HCO3|HCO3-|BE|BEecf|BE\(B\)|TCO2|sO2|SO2|Lac|LAC|AnGap|iCa|Ca\+\+|Na\+|K\+|Cl-|tHb|Hct|cHCO3)$/i;
const URINE = /^(SG|USG|PRO|GLU|KET|BIL|URO|UBG|BLD|ERY|LEU|WBC|NIT|pH|COL|CLA|ASC)$/i;
const HEMA = /^(WBC|RBC|HGB|HCT|MCV|MCH|MCHC|RDW|RDW-CV|RDW-SD|PLT|MPV|PCT|PDW|NEU|LYM|MON|EOS|BAS|GRA|RETIC|RET)[#%]?$/i;
const CHEM = /^(ALT|AST|ALP|GGT|TBIL|DBIL|BUN|UREA|CREA|CRE|GLU|TP|ALB|GLOB|CHOL|TRIG|AMY|LIPA|CK|LDH|PHOS|Ca|Mg|SDMA|FRU|T4|BA|NH3|CRP|fPL|cPL)$/i;

export function guessKind(params, fallback = "other") {
  let h = 0, c = 0, b = 0, u = 0;
  for (const p of params) { const k = String(p.code || p.name).replace(/\s/g, ""); if (HEMA.test(k)) h++; if (CHEM.test(k)) c++; if (BG.test(k)) b++; if (URINE.test(k)) u++; }
  const best = Math.max(h, c, b, u);
  if (!best) return fallback;
  return best === h ? "hematology" : best === b ? "bloodgas" : best === u ? "urine" : "biochemistry";
}

const flagOf = (value, low, high, given = "") => {
  const f = String(given || "").toUpperCase().replace(/[^HLNA*]/g, "");
  if (f === "H" || f === "HH" || f === "L" || f === "LL") return f[0];
  const v = parseFloat(String(value).replace(",", ".")), lo = parseFloat(String(low).replace(",", ".")), hi = parseFloat(String(high).replace(",", "."));
  if (Number.isFinite(v) && Number.isFinite(hi) && v > hi) return "H";
  if (Number.isFinite(v) && Number.isFinite(lo) && v < lo) return "L";
  return "";
};
const range = r => { const m = String(r || "").match(/(-?\d+(?:[.,]\d+)?)\s*[-–~]\s*(-?\d+(?:[.,]\d+)?)/); return m ? [m[1], m[2]] : ["", ""]; };
const ymd = s => { const m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; };

/** HL7 v2 (ORU^R01). MLLP çerçevesi (0x0B ... 0x1C 0x0D) varsa ayıklanır. */
export function parseHL7(text) {
  const raw = String(text).replace(/[\x0b\x1c]/g, "").replace(/\r\n?|\n/g, "\r");
  const segs = raw.split("\r").filter(s => /^[A-Z][A-Z0-9]{2}\|/.test(s));
  if (!segs.length || !segs[0].startsWith("MSH")) return null;
  const fs = segs[0][3], cs = segs[0][4] || "^";
  const out = {format: "hl7", hint: {}, params: [], sample: "", date: "", control: "", meta: {}};
  for (const seg of segs) {
    const f = seg.split(fs);
    const comp = (i, j = 0) => String(f[i] || "").split(cs)[j] || "";
    switch (f[0]) {
      case "MSH": out.control = f[9] || ""; out.meta.sender = comp(2) || comp(3); out.date = out.date || ymd(f[6]); break;
      case "PID":
        out.hint.patientId = comp(3) || comp(2) || comp(4);
        out.hint.name = [comp(5, 0), comp(5, 1)].filter(Boolean).join(" ").trim();
        if (f[9]) out.hint.owner = [comp(9, 1), comp(9, 0)].filter(Boolean).join(" ").trim(); // takma ad alanı sahip adı için sık kullanılır
        if (f[8]) out.hint.sex = comp(8);
        if (f[7]) out.hint.birth = ymd(f[7]);
        if (f[35]) out.hint.species = comp(35, 1) || comp(35);
        break;
      case "NK1": if (!out.hint.owner) out.hint.owner = [comp(2, 1), comp(2, 0)].filter(Boolean).join(" ").trim(); break;
      case "PV1": if (!out.hint.owner && f[7]) out.hint.owner = [comp(7, 2), comp(7, 1)].filter(Boolean).join(" ").trim(); break;
      case "OBR": out.sample = comp(3) || comp(2); out.date = ymd(f[7]) || ymd(f[8]) || ymd(f[6]) || ymd(f[14]) || out.date; out.meta.test = comp(4, 1) || comp(4); break;
      case "OBX": {
        const value = String(f[5] || "").split(cs)[0];
        if (!value || ["ED", "RP"].includes(f[2])) break;
        const code = comp(3, 1) || comp(3, 0), name = comp(3, 1) || comp(3, 0);
        const [low, high] = range(f[7]);
        out.params.push({code: code.trim(), name: name.trim(), value: value.trim(), unit: comp(6).trim(), low, high, flag: flagOf(value, low, high, f[8])});
        break;
      }
    }
  }
  return out.params.length || out.hint.name ? out : null;
}

export function hl7Ack(control, ok = true) {
  const t = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return "\x0b" + `MSH|^~\\&|VETZIMO|VETZIMO|||${t}||ACK^R01|${t}|P|2.3.1\rMSA|${ok ? "AA" : "AE"}|${control}\r` + "\x1c\r";
}

/** ASTM E1381 çerçevelerini (STX nr ... ETX/ETB csum CR LF) birleştirip E1394 kayıtlarını çıkarır. */
export function unframeASTM(text) {
  const s = String(text);
  if (!s.includes("\x02")) return s;
  let out = "";
  for (const m of s.matchAll(/\x02\d([\s\S]*?)[\x03\x17][0-9A-F]{2}\r?\n?/g)) out += m[1];
  return out;
}

export function parseASTM(text) {
  const body = unframeASTM(text).replace(/\r\n?|\n/g, "\r");
  const recs = body.split("\r").filter(Boolean);
  if (!recs.some(r => /^\d?H\|/.test(r))) return null;
  const head = recs.find(r => /^\d?H\|/.test(r));
  const fd = head[head.indexOf("H") + 1] || "|", cd = head[head.indexOf("H") + 3] || "^";
  const out = {format: "astm", hint: {}, params: [], sample: "", date: "", meta: {}};
  for (const r0 of recs) {
    const r = r0.replace(/^\d(?=[A-Z]\|)/, "");
    const f = r.split(fd);
    const comp = (i, j = 0) => String(f[i] || "").split(cd)[j] || "";
    switch (f[0]) {
      case "H": out.meta.sender = comp(4); out.date = ymd(f[13]); break;
      case "P":
        out.hint.patientId = f[3] || f[2] || f[4] || "";
        out.hint.name = [comp(5, 0), comp(5, 1)].filter(Boolean).join(" ").trim();
        if (f[7]) out.hint.birth = ymd(f[7]);
        if (f[8]) out.hint.sex = f[8];
        if (f[9]) out.hint.owner = f[9].split(cd).filter(Boolean).reverse().join(" ").trim();
        if (f[13]) out.hint.species = comp(13);
        break;
      case "O": out.sample = comp(2) || comp(3); out.date = ymd(f[7]) || out.date; break;
      case "R": {
        const id = String(f[2] || "").split(cd).filter(Boolean);
        const code = id[id.length > 3 ? 3 : id.length - 1] || "";
        const value = String(f[3] || "").split(cd)[0];
        if (!value) break;
        const [low, high] = range(f[5]);
        out.params.push({code: code.trim(), name: code.trim(), value: value.trim(), unit: comp(4).trim(), low, high, flag: flagOf(value, low, high, f[6])});
        break;
      }
    }
  }
  return out.params.length ? out : null;
}

/** CSV / sekmeli / "ad: değer birim (alt-üst)" biçimli dışa aktarımlar. */
export function parseDelimited(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r\n?|\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const out = {format: "csv", hint: {}, params: [], sample: "", date: "", meta: {}};
  // Ayırıcı, tablo satırlarına göre seçilir (üstteki "Hasta: ..." satırlarında ayırıcı olmayabilir).
  const sep = [";", "\t", ",", "|"].map(s => [s, Math.max(...lines.map(l => l.split(s).length - 1))]).sort((a, b) => b[1] - a[1])[0];
  const meta = (k, v) => {
    const key = k.toLocaleLowerCase("tr").replace(/[^a-zçğıöşü0-9 ]/g, "").trim();
    if (/^(hasta adı|hasta|patient|patient name|animal|pet|name|adı|ad)$/.test(key)) out.hint.name = v;
    else if (/^(sahip|sahibi|owner|client|müşteri|hasta sahibi|owner name)$/.test(key)) out.hint.owner = v;
    else if (/^(hasta no|hasta id|patient id|id|protokol|protocol|dosya no)$/.test(key)) out.hint.patientId = v;
    else if (/^(mikroçip|mikrocip|chip|microchip|çip)$/.test(key)) out.hint.chip = v;
    else if (/^(tür|species|cins|tur)$/.test(key)) out.hint.species = v;
    else if (/^(örnek|numune|sample|sample id|barkod|barcode)$/.test(key)) out.sample = v;
    else if (/^(tarih|date|test date)$/.test(key)) { const m = v.match(/(\d{4})[-./](\d{2})[-./](\d{2})|(\d{2})[-./](\d{2})[-./](\d{4})/); if (m) out.date = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`; }
    else return false;
    return true;
  };
  let header = null;
  for (const line of lines) {
    const kv = line.match(/^([^:=;\t,]{2,30})\s*[:=]\s*(.+)$/);
    if (kv && meta(kv[1], kv[2].trim())) continue;
    const cells = sep[1] ? line.split(sep[0]).map(c => c.trim().replace(/^"|"$/g, "")) : [line];
    if (!header && cells.length >= 2 && cells.some(c => /^(parametre|parameter|test|item|analit|analyte|ad)$/i.test(c))) { header = cells.map(c => c.toLowerCase()); continue; }
    if (header) {
      const at = re => header.findIndex(h => re.test(h));
      const ni = at(/param|test|item|analit|analyte|^ad$/), vi = at(/sonu|value|result|değer|deger/), ui = at(/birim|unit/), ri = at(/aral|range|ref/), li = at(/alt|low|min/), hi = at(/üst|ust|high|max/), fi = at(/flag|işaret|durum/);
      const name = cells[ni], value = cells[vi];
      if (!name || !value || !/\d|neg|poz|pos|trace|\+/i.test(value)) continue;
      let [low, high] = ri >= 0 ? range(cells[ri]) : [cells[li] || "", cells[hi] || ""];
      out.params.push({code: name, name, value, unit: cells[ui] || "", low, high, flag: flagOf(value, low, high, cells[fi])});
      continue;
    }
    const free = line.match(/^([\p{L}][\p{L}\p{N} ./%#()+-]{0,24}?)\s*[:=\t;,| ]\s*([<>]?[-+]?\d+(?:[.,]\d+)?|neg(?:atif|ative)?|poz(?:itif)?|pos(?:itive)?|trace|[+]{1,4})\s*([^\d\s(\[][^\s(\[]{0,12})?\s*[(\[]?\s*(-?\d+(?:[.,]\d+)?)?\s*[-–~]?\s*(-?\d+(?:[.,]\d+)?)?/iu);
    if (free) {
      const [, name, value, unit = "", low = "", high = ""] = free;
      out.params.push({code: name.trim(), name: name.trim(), value, unit, low, high, flag: flagOf(value, low, high)});
    }
  }
  return out.params.length ? out : null;
}

export function parseXML(text) {
  const s = String(text);
  if (!/^\s*<\?xml|^\s*</.test(s)) return null;
  const tag = (t, src = s) => (src.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`, "i")) || [])[1]?.trim() || "";
  const out = {format: "xml", hint: {name: tag("PatientName") || tag("AnimalName") || tag("Name"), owner: tag("OwnerName") || tag("ClientName"), patientId: tag("PatientID") || tag("PatientId"), species: tag("Species"), chip: tag("Microchip")}, params: [], sample: tag("SampleID") || tag("SampleId"), date: "", meta: {}};
  for (const m of s.matchAll(/<(?:Result|Test|Parameter|Item)\b[^>]*>([\s\S]*?)<\/(?:Result|Test|Parameter|Item)>/gi)) {
    const b = m[1], name = tag("Name", b) || tag("Code", b) || tag("TestName", b), value = tag("Value", b) || tag("Result", b);
    if (!name || !value) continue;
    const low = tag("Low", b) || tag("Min", b) || range(tag("Range", b))[0], high = tag("High", b) || tag("Max", b) || range(tag("Range", b))[1];
    out.params.push({code: tag("Code", b) || name, name, value, unit: tag("Unit", b) || tag("Units", b), low, high, flag: flagOf(value, low, high, tag("Flag", b))});
  }
  for (const k of Object.keys(out.hint)) if (!out.hint[k]) delete out.hint[k];
  return out.params.length ? out : null;
}

/** DICOM üstbilgisi (Part 10 dosyası veya ham veri seti; açık/örtük VR, little endian). */
export function parseDICOM(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 0;
  if (u8.length > 132 && String.fromCharCode(u8[128], u8[129], u8[130], u8[131]) === "DICM") p = 132;
  const want = {"00100010": "name", "00100020": "patientId", "00101000": "otherIds", "00102297": "owner", "00102201": "species", "00102292": "breed", "00100040": "sex", "00100030": "birth",
    "00080060": "modality", "00081030": "study", "0008103E": "series", "00080020": "date", "00080050": "accession", "0020000D": "studyUid", "00080080": "institution", "00180015": "bodyPart", "00020010": "transfer"};
  const found = {};
  const ascii = (o, n) => { let s = ""; for (let i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]); return s; };
  const utf8 = (o, n) => new TextDecoder("utf-8").decode(u8.subarray(o, Math.min(u8.length, o + n))).replace(/\0/g, "").trim();
  let explicit = true;
  const LONG = new Set(["OB", "OW", "OF", "SQ", "UT", "UN", "OD", "OL", "UC", "UR", "OV"]);
  let guard = 0;
  while (p + 8 <= u8.length && guard++ < 20000) {
    const group = dv.getUint16(p, true), element = dv.getUint16(p + 2, true);
    const tag = group.toString(16).padStart(4, "0").toUpperCase() + element.toString(16).padStart(4, "0").toUpperCase();
    if (group === 0x7fe0) break; // piksel verisi: üstbilgi bitti
    if (group !== 0x0002 && found.transfer !== undefined) explicit = !/^1\.2\.840\.10008\.1\.2\0?$/.test(found.transfer);
    let vr = ascii(p + 4, 2), len, head;
    if ((group === 0x0002 || explicit) && /^[A-Z]{2}$/.test(vr)) {
      if (LONG.has(vr)) { len = dv.getUint32(p + 8, true); head = 12; } else { len = dv.getUint16(p + 6, true); head = 8; }
    } else { vr = ""; len = dv.getUint32(p + 4, true); head = 8; }
    if (len === 0xffffffff) { // tanımsız uzunluk (sekans): öğelerin içinde aramadan sonraki sınırlayıcıya atla
      let q = p + head; while (q + 8 <= u8.length && !(dv.getUint16(q, true) === 0xfffe && dv.getUint16(q + 2, true) === 0xe0dd)) q += 2; p = q + 8; continue;
    }
    if (want[tag]) found[want[tag]] = utf8(p + head, len);
    p += head + len;
  }
  if (!found.modality && !found.name) return null;
  const pn = s => String(s || "").split("=")[0].split("^").filter(Boolean);
  const name = pn(found.name), owner = pn(found.owner);
  // Veteriner DICOM'da hasta adı çoğu cihazda "SAHİP SOYADI^HAYVAN ADI" ya da "HAYVAN^SAHİP" biçimindedir.
  const hint = {patientId: found.patientId || "", species: found.species || "", accession: found.accession || ""};
  if (owner.length) { hint.name = name.slice(-1)[0] || name.join(" "); hint.owner = owner.reverse().join(" "); if (name.length > 1) hint.ownerSurname = name[0]; }
  else if (name.length >= 2) { hint.name = name[1]; hint.owner = name[0]; }
  else hint.name = name[0] || "";
  if (/^\d{15}$/.test(String(found.otherIds || "").replace(/\D/g, ""))) hint.chip = String(found.otherIds).replace(/\D/g, "");
  for (const k of Object.keys(hint)) if (!hint[k]) delete hint[k];
  return {format: "dicom", kind: MODALITY[String(found.modality || "").toUpperCase()] || "other", hint, params: [], sample: found.accession || "", date: ymd(found.date),
    title: [found.study, found.bodyPart, found.series].filter(Boolean).join(" · "), meta: {modality: found.modality || "", studyUid: found.studyUid || "", institution: found.institution || ""}};
}

/** Dosya adından ipucu: "Pamuk_Ayse-Yilmaz_2026-11-25.pdf", "900123456789012.jpg", "H-B12 hemogram.pdf". */
export function hintFromName(fileName) {
  const base = String(fileName).replace(/\.[a-z0-9]{2,5}$/i, "");
  const chip = (base.match(/(?<!\d)\d{15}(?!\d)/) || [])[0];
  if (chip) return {chip};
  const proto = (base.match(/\b[A-Z]{1,3}-[A-Z]?\d{1,9}\b/) || [])[0];
  const parts = base.replace(/\d{4}[-_.]\d{2}[-_.]\d{2}.*$/, "").split(/[_]+/).map(s => s.replace(/-/g, " ").trim()).filter(s => s && !/^\d+$/.test(s));
  const out = {};
  if (proto) out.patientId = proto;
  if (parts[0] && !proto) out.name = parts[0];
  if (parts[1] && !proto) out.owner = parts[1];
  return out;
}

/** Metin içeriği için otomatik biçim tespiti. */
export function parseText(text) {
  const s = String(text);
  if (/(^|[\r\n\x0b])MSH\|/.test(s)) return parseHL7(s);
  if (/(^|[\r\n\x02])\d?H\|[\\^&]/.test(s)) return parseASTM(s);
  if (/^\s*</.test(s)) return parseXML(s);
  return parseDelimited(s);
}

/** Tetkik kaydının `values` tablosu: ad|değer|birim|alt|üst|işaret|kod (laboratuvar yorumu ve trend grafikleri bunu okur). */
export function valuesTable(params) {
  return params.map(p => [p.name, p.value, p.unit, p.low, p.high, p.flag, p.code].map(v => String(v ?? "").replace(/\|/g, "/")).join("|")).join("\n");
}

export function summaryText(params) {
  const abnormal = params.filter(p => p.flag === "H" || p.flag === "L");
  return abnormal.length ? "Referans dışı: " + abnormal.map(p => `${p.name} ${p.value}${p.unit ? " " + p.unit : ""} (${p.flag === "H" ? "yüksek" : "düşük"})`).join(", ") : "Tüm değerler referans aralığında.";
}
