// Cihaz ajanı uçtan uca: TCP üzerinden HL7 (MLLP + ACK) ve ASTM (ENQ/ACK/EOT), klasör izleme ve DICOM C-ECHO + C-STORE.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createDevices} from "../bridge-agent/devices.mjs";
import {parseDICOM} from "../bridge-agent/device-parsers.mjs";
const ok = (v, m) => { if (!v) { console.error("FAIL", m); process.exit(1); } };
const home = fs.mkdtempSync(path.join(os.tmpdir(), "vz-dev-")), dir = path.join(home, "sonuclar"); fs.mkdirSync(dir);
const results = [], files = {};
// Boş portları işletim sistemi verir (rastgele port, yükte giden bağlantıların geçici portlarıyla çakışabiliyordu).
const freePort = () => new Promise(r => { const srv = net.createServer().listen(0, "127.0.0.1", () => { const {port} = srv.address(); srv.close(() => r(port)); }); });
let base = await freePort(); for (let i = 0; i < 50; i++) { const next = await freePort(); if (next === base + 1) break; base = next; }
const pair = async () => { for (let i = 0; i < 200; i++) { const p = await freePort(); const ok = await new Promise(r => { const t = net.createServer().once("error", () => r(false)).listen(p + 1, "127.0.0.1", () => t.close(() => r(true))); }); if (ok) return p; } return base; };
base = await pair();
const devices = [
  {id: "a".repeat(32), name: "Hemogram", kind: "hematology", connection: "tcp", settings: {port: base}, active: true},
  {id: "b".repeat(32), name: "Biyokimya", kind: "biochemistry", connection: "folder", settings: {path: dir}, active: true},
  {id: "c".repeat(32), name: "Röntgen", kind: "xray", connection: "dicom", settings: {port: base + 1, aeTitle: "VETZIMO"}, active: true},
];
const api = async (op, body) => { if (op === "devices") return {devices}; if (op === "device-result") { results.push(body); return {status: "matched"}; } return {}; };
const upload = async (id, i, total, name, type, bytes) => { (files[id] ||= []).push(Buffer.from(bytes)); return {complete: i === total - 1}; };
const hub = createDevices({api, upload, home, log: () => {}, folderMs: 300});
await hub.refresh();
await new Promise(r => setTimeout(r, 300));
// Dinleyici yükte geç açılabilir: bağlantı reddedilirse kısa aralıklarla yeniden dener (sabit bekleme yarışı yok).
const ready = async port => { for (let i = 0; i < 50; i++) { const ok = await new Promise(r => { const c = net.connect(port, "127.0.0.1"); c.on("connect", () => { c.destroy(); r(true); }); c.on("error", () => r(false)); }); if (ok) return; await new Promise(r => setTimeout(r, 100)); } };
const talk = async (port, chunks, until) => { await ready(port); return talkNow(port, chunks, until); };
const talkNow = (port, chunks, until) => new Promise((res, rej) => {
  const s = net.connect(port, "127.0.0.1"); let got = Buffer.alloc(0);
  let done = false; s.on("data", d => { got = Buffer.concat([got, d]); if (!done && until(got)) { done = true; setTimeout(() => { s.end(); res(got); }, 400); } });
  s.on("error", rej); s.on("connect", async () => { for (const c of chunks) { s.write(c); await new Promise(r => setTimeout(r, 30)); } });
  setTimeout(() => { s.destroy(); res(got); }, 4000);
});
// HL7
const hl7 = "\x0bMSH|^~\\&|BC30|M|||20261125||ORU^R01|C77|P|2.3.1\rPID|1||H-B12||Pamuk||||Ayşe Yılmaz\rOBX|1|NM|WBC^WBC||24.5|10*9/L|6-17|H\r\x1c\r";
const ack = await talk(base, [Buffer.from(hl7)], g => g.includes(0x1c));
ok(ack.toString().includes("MSA|AA|C77"), "HL7 onayı yok: " + JSON.stringify(ack.toString()));
ok(results.at(-1)?.hint?.name === "Pamuk" && results.at(-1).params[0].value === "24.5" && results.at(-1).kind === "hematology", "HL7 sonucu gönderilmedi");
// ASTM çerçeveli
const frame = (n, body) => { let sum = 0; const s = `${n}${body}\r\x03`; for (const c of s) sum = (sum + c.charCodeAt(0)) % 256; return `\x02${s}${sum.toString(16).toUpperCase().padStart(2, "0")}\r\n`; };
const before = results.length;
const acks = await talk(base, [Buffer.from([5]), Buffer.from(frame(1, "H|\\^&|||X")), Buffer.from(frame(2, "P|1||H-B7||Boncuk")), Buffer.from(frame(3, "R|1|^^^ALT|112|U/L|10-100|H")), Buffer.from(frame(4, "L|1|N")), Buffer.from([4])], g => g.filter(b => b === 6).length >= 5);
await new Promise(r => setTimeout(r, 200));
ok(acks.filter(b => b === 6).length >= 5 && results.length === before + 1 && results.at(-1).params[0].name === "ALT", "ASTM akışı çalışmadı");
// Klasör
fs.writeFileSync(path.join(dir, "sonuc.csv"), "Hasta: Paşa\nSahip: Zeynep Demir\nParametre;Sonuç;Birim;Referans\nCREA;2,4;mg/dL;0,5-1,8\n");
await new Promise(r => setTimeout(r, 1500));
ok(results.some(r => r.device === "b".repeat(32) && r.hint.name === "Paşa" && r.params[0].flag === "H"), "Klasördeki dosya okunmadı");
ok(fs.existsSync(path.join(dir, "VetZimo-gonderildi", "sonuc.csv")), "Gönderilen dosya taşınmadı");
// DICOM SCU
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }, u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const item = (t, v) => Buffer.concat([Buffer.from([t, 0]), u16(v.length), v]);
const padS = s => Buffer.from(s.length % 2 ? s + "\0" : s);
const ctx = Buffer.concat([Buffer.from([0x20, 0]), (() => { const body = Buffer.concat([Buffer.from([1, 0, 0, 0]), item(0x30, padS("1.2.840.10008.5.1.4.1.1.1.1")), item(0x40, padS("1.2.840.10008.1.2.1"))]); return Buffer.concat([u16(body.length), body]); })()]);
const echoCtx = Buffer.concat([Buffer.from([0x20, 0]), (() => { const body = Buffer.concat([Buffer.from([3, 0, 0, 0]), item(0x30, padS("1.2.840.10008.1.1")), item(0x40, padS("1.2.840.10008.1.2"))]); return Buffer.concat([u16(body.length), body]); })()]);
const rqBody = Buffer.concat([u16(1), Buffer.alloc(2), Buffer.from("VETZIMO         "), Buffer.from("DRCONSOLE       "), Buffer.alloc(32), item(0x10, Buffer.from("1.2.840.10008.3.1.1.1")), ctx, echoCtx, item(0x50, item(0x51, u32(65536)))]);
const assoc = Buffer.concat([Buffer.from([1, 0]), u32(rqBody.length), rqBody]);
const cmd = (fields) => { const parts = []; const el = (g, e, v) => { const h = Buffer.alloc(8); h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.writeUInt32LE(v.length, 4); parts.push(h, v); }; const us = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  if (fields.cls) el(0, 2, padS(fields.cls)); el(0, 0x100, us(fields.command)); el(0, 0x110, us(fields.id)); if (fields.cls) el(0, 0x700, us(0)); el(0, 0x800, us(fields.data ? 0 : 0x0101)); if (fields.inst) el(0, 0x1000, padS(fields.inst)); return Buffer.concat(parts); };
const pdata = (c, flags, d) => { const pdv = Buffer.concat([u32(d.length + 2), Buffer.from([c, flags]), d]); return Buffer.concat([Buffer.from([4, 0]), u32(pdv.length), pdv]); };
const del = (g, e, vr, v) => { let b = Buffer.from(v); if (b.length % 2) b = Buffer.concat([b, Buffer.from(" ")]); const h = Buffer.alloc(8); h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4); h.writeUInt16LE(b.length, 6); return Buffer.concat([h, b]); };
const dataset = Buffer.concat([del(8, 0x20, "DA", "20261125"), del(8, 0x60, "CS", "DX"), del(8, 0x1030, "LO", "Toraks VD"), del(0x10, 0x10, "PN", "Kaya^Boncuk"), del(0x10, 0x20, "LO", "H-B7"), del(0x10, 0x2297, "PN", "Kaya^Mehmet")]);
const reply = await talk(base + 1, [assoc, pdata(3, 3, cmd({command: 0x30, id: 1})), pdata(1, 3, cmd({command: 1, id: 2, cls: "1.2.840.10008.5.1.4.1.1.1.1", inst: "1.2.3.4.5", data: true})), pdata(1, 2, dataset)],
  g => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === 4 && g[i + 1] === 0) n++; return g[0] === 2 && n >= 2 && g.length > 300; });
ok(reply[0] === 2, "DICOM ilişkisi kabul edilmedi: " + reply.subarray(0, 12).toString("hex") + " len " + reply.length);
await new Promise(r => setTimeout(r, 400));
ok(reply.includes(Buffer.from([0x30, 0x80])) , "C-ECHO yanıtı yok");
ok(reply.includes(Buffer.from([0x01, 0x80])), "C-STORE yanıtı yok");
const dicomResult = results.find(r => r.device === "c".repeat(32));
ok(dicomResult && dicomResult.file && dicomResult.hint.name === "Boncuk" && dicomResult.hint.owner === "Mehmet Kaya" && dicomResult.kind === "xray", "DICOM sonucu gönderilmedi: " + JSON.stringify(dicomResult));
const part10 = Buffer.concat(files[dicomResult.file]);
const meta = parseDICOM(new Uint8Array(part10));
ok(part10.toString("ascii", 128, 132) === "DICM" && meta.hint.patientId === "H-B7" && meta.title.includes("Toraks"), "Part 10 dosyası okunamadı");
hub.stopAll();
fs.rmSync(home, {recursive: true, force: true});
console.log("PASS cihaz ajanı: HL7 MLLP + ACK, ASTM ENQ/ACK/EOT, klasör izleme, DICOM C-ECHO + C-STORE ve Part 10 dosyası");
process.exit(0);
