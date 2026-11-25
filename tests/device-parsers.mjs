// Cihaz çözümleyicileri: HL7 ORU (MLLP), ASTM E1381/E1394 çerçeveli, CSV dışa aktarım, XML, DICOM üstbilgisi, dosya adı ipucu.
import {parseHL7, parseASTM, parseText, parseDICOM, hintFromName, guessKind, valuesTable, hl7Ack, summaryText} from "../public/device-parsers.js";
import {readFileSync} from "node:fs";
const ok = (v, m) => { if (!v) { console.error("FAIL", m); process.exit(1); } };

// 1) Mindray BC tipi HL7 (MLLP çerçeveli)
const hl7 = "\x0bMSH|^~\\&|BC-5000Vet|Mindray|||20261125101500||ORU^R01|MSG0001|P|2.3.1\r" +
  "PID|1||H-B12^^^^MR||Pamuk^||20200101|F|Ayşe Yılmaz\r" +
  "OBR|1||S12345|01001^Automated Count^99MRC||||20261125101000\r" +
  "OBX|1|NM|6690-2^WBC^LN||24.5|10*9/L|6.0-17.0|H|||F\r" +
  "OBX|2|NM|718-7^HGB^LN||13.1|g/dL|12.0-18.0|N|||F\r" +
  "OBX|3|NM|777-3^PLT^LN||95|10*9/L|200-500|L|||F\r" +
  "OBX|4|ED|WBCHistogram^^99MRC||^Image^BMP^Base64^AAAA||||||F\r\x1c\r";
const h = parseHL7(hl7);
ok(h && h.hint.name === "Pamuk" && h.hint.patientId === "H-B12" && h.hint.owner === "Ayşe Yılmaz", "HL7 hasta ipucu: " + JSON.stringify(h?.hint));
ok(h.params.length === 3 && h.params[0].flag === "H" && h.params[2].flag === "L" && h.params[0].low === "6.0", "HL7 parametreler: " + JSON.stringify(h.params));
ok(h.sample === "S12345" && h.date === "2026-11-25" && guessKind(h.params) === "hematology", "HL7 örnek/tarih/tür");
ok(hl7Ack(h.control).includes("MSA|AA|MSG0001"), "HL7 onay mesajı");

// 2) ASTM E1381 çerçeveli biyokimya (Fujifilm/IDEXX benzeri)
const frame = (n, body) => { let sum = 0; const s = `${n}${body}\r\x03`; for (const c of s) sum = (sum + c.charCodeAt(0)) % 256; return `\x02${s}${sum.toString(16).toUpperCase().padStart(2, "0")}\r\n`; };
const astm = frame(1, "H|\\^&|||DRI-CHEM NX600^V1||||||||P|1|20261125") + frame(2, "P|1||H-B7||Boncuk^||20190101|M|Mehmet^Kaya") +
  frame(3, "O|1|S77||^^^ALT\\^^^CREA") + frame(4, "R|1|^^^ALT|112|U/L|10-100|H") + frame(5, "R|2|^^^CREA|1.1|mg/dL|0.5-1.8|N") + frame(6, "L|1|N");
const a = parseASTM(astm);
ok(a && a.hint.name === "Boncuk" && a.hint.owner === "Kaya Mehmet" && a.params.length === 2 && a.params[0].flag === "H", "ASTM: " + JSON.stringify(a));
ok(guessKind(a.params) === "biochemistry", "ASTM tür tahmini");

// 3) CSV dışa aktarım (Türkçe başlıklar, ; ayırıcı)
const csv = "Hasta Adı: Paşa\nSahibi: Zeynep Demir\nTarih: 25.11.2026\nParametre;Sonuç;Birim;Referans\npH;7,21;;7,35-7,45\npCO2;55;mmHg;35-45\nHCO3;18;mmol/L;20-26\n";
const c = parseText(csv);
ok(c && c.hint.name === "Paşa" && c.hint.owner === "Zeynep Demir" && c.date === "2026-11-25" && c.params.length === 3, "CSV: " + JSON.stringify(c));
ok(c.params[0].flag === "L" && c.params[1].flag === "H" && guessKind(c.params) === "bloodgas", "CSV işaretleri/tür: " + JSON.stringify(c.params));

// 4) Serbest metin idrar şeridi
const u = parseText("Patient: Tarçın\nSG: 1.045\nPRO: 100 mg/dL (0-30)\nGLU: neg\nBLD: +++\n");
ok(u && u.params.length >= 3 && guessKind(u.params) === "urine", "İdrar serbest metin: " + JSON.stringify(u));

// 5) XML
const x = parseText('<?xml version="1.0"?><Report><PatientName>Duman</PatientName><OwnerName>Ali Veli</OwnerName><Result><Name>SDMA</Name><Value>19</Value><Unit>ug/dL</Unit><Range>0-14</Range></Result></Report>');
ok(x && x.hint.name === "Duman" && x.params[0].flag === "H", "XML: " + JSON.stringify(x));

// 6) DICOM Part 10 (açık VR) üstbilgisi
function el(group, element, vr, value) {
  let v = Buffer.from(value, "utf8"); if (v.length % 2) v = Buffer.concat([v, Buffer.from(vr === "UI" ? "\0" : " ")]);
  const long = ["OB", "OW", "SQ", "UN", "UT"].includes(vr);
  const head = Buffer.alloc(long ? 12 : 8); head.writeUInt16LE(group, 0); head.writeUInt16LE(element, 2); head.write(vr, 4, "ascii");
  if (long) head.writeUInt32LE(v.length, 8); else head.writeUInt16LE(v.length, 6);
  return Buffer.concat([head, v]);
}
const dicom = Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), el(2, 0x10, "UI", "1.2.840.10008.1.2.1"),
  el(8, 0x20, "DA", "20261125"), el(8, 0x50, "SH", "ACC991"), el(8, 0x60, "CS", "DX"), el(8, 0x1030, "LO", "Toraks LL"),
  el(0x10, 0x10, "PN", "Yilmaz^Pamuk"), el(0x10, 0x20, "LO", "H-B12"), el(0x10, 0x2201, "LO", "Kedi"), el(0x10, 0x2297, "PN", "Yilmaz^Ayse"),
  el(0x7fe0, 0x10, "OB", "\x00\x01")]);
const d = parseDICOM(new Uint8Array(dicom));
ok(d && d.kind === "xray" && d.hint.name === "Pamuk" && d.hint.owner === "Ayse Yilmaz" && d.hint.patientId === "H-B12" && d.date === "2026-11-25" && d.sample === "ACC991", "DICOM: " + JSON.stringify(d));

// 7) Dosya adı
ok(hintFromName("900123456789012_rontgen.jpg").chip === "900123456789012", "Dosya adı mikroçip");
ok(JSON.stringify(hintFromName("Pamuk_Ayse-Yilmaz_2026-11-25.pdf")) === JSON.stringify({name: "Pamuk", owner: "Ayse Yilmaz"}), "Dosya adı hasta/sahip: " + JSON.stringify(hintFromName("Pamuk_Ayse-Yilmaz_2026-11-25.pdf")));

// 8) Tetkik tablosu laboratuvar yorumu biçiminde
ok(valuesTable(h.params).split("\n")[0] === "WBC|24.5|10*9/L|6.0|17.0|H|WBC", "values tablosu: " + valuesTable(h.params));
ok(summaryText(h.params).includes("WBC 24.5") && summaryText(h.params).includes("düşük"), "özet");

// 9) Ajan kopyası aynı olmalı
ok(readFileSync(new URL("../bridge-agent/device-parsers.mjs", import.meta.url), "utf8") === readFileSync(new URL("../public/device-parsers.js", import.meta.url), "utf8"), "Ajandaki çözümleyici kopyası güncel değil");
console.log("PASS cihaz çözümleyicileri: HL7 (MLLP), ASTM E1381/E1394, CSV, serbest metin, XML, DICOM, dosya adı, tetkik tablosu");
