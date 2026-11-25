// VetZimo cihaz köprüsü: laboratuvar ve görüntüleme cihazlarından gelen sonuçları okuyup sunucuya gönderir.
// Bağlantılar: klasör izleme (dışa aktarılan dosyalar), TCP/LIS (HL7 MLLP veya ASTM), seri port (ASTM/HL7, isteğe
// bağlı "serialport" paketi) ve DICOM C-STORE alıcısı (röntgen, ultrason, MR, BT). Eşleştirmeyi sunucu yapar.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import {parseText, parseDICOM, hintFromName, guessKind, hl7Ack} from "./device-parsers.mjs";

const CHUNK = 4 * 1024 * 1024;
const TEXT_EXT = /\.(hl7|txt|csv|tsv|xml|astm|res|out|dat|lis)$/i;
const FILE_EXT = /\.(pdf|jpe?g|png|bmp|tiff?|dcm|dicom)$/i;
const MIME = {pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", dcm: "application/dicom", dicom: "application/dicom"};

export function createDevices({api, upload, home, log, folderMs = 4000}) {
  const stateFile = path.join(home, "cihaz-durumu.json");
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const saveSeen = () => { try { const keys = Object.keys(seen); if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete seen[k]; fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch {} };
  const running = new Map(); // device id -> {stop(), key}
  const status = {};
  let devices = [];

  async function send(device, parsed, extra = {}) {
    const kind = parsed.kind || (parsed.params?.length ? guessKind(parsed.params, device.kind) : device.kind);
    const body = {device: device.id, kind: ["hematology", "biochemistry", "bloodgas", "urine"].includes(device.kind) && parsed.format !== "dicom" ? (parsed.params?.length ? guessKind(parsed.params, device.kind) : device.kind) : kind,
      hint: parsed.hint || {}, params: parsed.params || [], sample: parsed.sample || "", date: parsed.date || "", title: parsed.title || "", format: parsed.format || "",
      meta: parsed.meta || {}, summary: parsed.summary || "", ...extra};
    const r = await api("device-result", body);
    status[device.id] = {last: Date.now(), result: r.duplicate ? "aynı sonuç (atlandı)" : r.status === "matched" ? "hastayla eşleşti" : "onay bekliyor", error: ""};
    log(`${device.name}: sonuç gönderildi (${status[device.id].result})`);
    return r;
  }

  async function sendFile(device, buffer, name, parsed) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    const id = crypto.randomBytes(16).toString("hex");
    const total = Math.max(1, Math.ceil(buffer.length / CHUNK));
    for (let i = 0; i < total; i++) await upload(id, i, total, name, MIME[ext] || (parsed?.format === "dicom" ? "application/dicom" : "application/octet-stream"), buffer.subarray(i * CHUNK, (i + 1) * CHUNK));
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return send(device, parsed || {hint: hintFromName(name), params: [], format: ext}, {file: id, hash, title: parsed?.title || name.replace(/\.[^.]+$/, "")});
  }

  async function handleBuffer(device, buffer, name) {
    const isDicom = buffer.length > 132 && buffer.toString("ascii", 128, 132) === "DICM" || /\.(dcm|dicom)$/i.test(name);
    if (isDicom) {
      const d = parseDICOM(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      return sendFile(device, buffer, name.endsWith(".dcm") ? name : name + ".dcm", d || {hint: hintFromName(name), params: [], format: "dicom", kind: device.kind});
    }
    if (FILE_EXT.test(name)) return sendFile(device, buffer, name, null);
    const text = buffer.toString(/[\xC0-\xFF]/.test(buffer.toString("latin1")) && !buffer.toString("utf8").includes("�") ? "utf8" : "latin1");
    const parsed = parseText(text);
    if (!parsed) throw new Error("Dosya biçimi tanınmadı: " + name);
    if (!parsed.hint?.name && !parsed.hint?.patientId) parsed.hint = {...hintFromName(name), ...(parsed.hint || {})};
    return send(device, parsed, {hash: crypto.createHash("sha256").update(buffer).digest("hex")});
  }

  // ── Klasör izleme: dosya boyutu iki turda aynı kalınca (yazma bitti) okunur.
  function startFolder(device) {
    const dir = device.settings.path;
    const sizes = {};
    let stop = false;
    const pattern = device.settings.pattern ? new RegExp(device.settings.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "i") : null;
    const done = path.join(dir, "VetZimo-gonderildi");
    async function scan() {
      if (stop) return;
      try {
        const list = fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isFile() && (TEXT_EXT.test(e.name) || FILE_EXT.test(e.name) || !path.extname(e.name)) && (!pattern || pattern.test(e.name)));
        for (const e of list) {
          const full = path.join(dir, e.name);
          const st = fs.statSync(full);
          const key = device.id + ":" + full + ":" + st.size + ":" + st.mtimeMs;
          if (seen[key]) continue;
          if (sizes[full] !== st.size) { sizes[full] = st.size; continue; }
          try {
            await handleBuffer(device, fs.readFileSync(full), e.name);
            seen[key] = Date.now(); saveSeen();
            try { fs.mkdirSync(done, {recursive: true}); fs.renameSync(full, path.join(done, e.name)); } catch {}
          } catch (err) {
            seen[key] = Date.now(); saveSeen();
            status[device.id] = {...(status[device.id] || {}), error: err.message};
            log(`${device.name}: ${e.name} okunamadı · ${err.message}`);
            api("device-error", {device: device.id, error: e.name + ": " + err.message}).catch(() => {});
          }
        }
        status[device.id] = {...(status[device.id] || {}), listening: "klasör izleniyor"};
      } catch (err) {
        status[device.id] = {...(status[device.id] || {}), error: "Klasör okunamadı: " + err.message};
      }
      if (!stop) setTimeout(scan, folderMs);
    }
    scan();
    return {stop: () => { stop = true; }};
  }

  // ── ASTM E1381 ve HL7 MLLP akışı (TCP ve seri port ortak)
  function streamHandler(device, write) {
    let buf = Buffer.alloc(0), astm = "";
    const ENQ = 0x05, ACK = Buffer.from([0x06]), EOT = 0x04, STX = 0x02, LF = 0x0a;
    return async function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      // HL7 MLLP: 0x0B ... 0x1C 0x0D
      for (;;) {
        const s = buf.indexOf(0x0b), e = buf.indexOf(0x1c, s + 1);
        if (s < 0 || e < 0) break;
        const msg = buf.subarray(s + 1, e).toString("utf8");
        buf = buf.subarray(e + 2);
        const parsed = parseText(msg);
        const control = (msg.split("\r")[0] || "").split("|")[9] || "";
        try { if (parsed) await send(device, parsed, {hash: crypto.createHash("sha256").update(msg).digest("hex")}); write(Buffer.from(hl7Ack(control, true), "binary")); }
        catch (err) { log(device.name + ": " + err.message); write(Buffer.from(hl7Ack(control, false), "binary")); }
      }
      // ASTM: ENQ → ACK, her çerçeve → ACK, EOT → mesajı işle
      while (buf.length) {
        const b = buf[0];
        if (b === 0x0b) break; // tamamlanmamış HL7
        if (b === ENQ) { write(ACK); buf = buf.subarray(1); continue; }
        if (b === EOT) {
          buf = buf.subarray(1);
          const text = astm; astm = "";
          const parsed = text && parseText(text);
          if (parsed) send(device, parsed, {hash: crypto.createHash("sha256").update(text).digest("hex")}).catch(err => log(device.name + ": " + err.message));
          continue;
        }
        if (b === STX) {
          const end = buf.indexOf(LF);
          if (end < 0) break;
          astm += buf.subarray(0, end + 1).toString("latin1");
          buf = buf.subarray(end + 1);
          write(ACK);
          continue;
        }
        // Çerçevesiz düz ASTM/HL7 satırları (bazı cihazlar doğrudan gönderir)
        const nl = buf.indexOf(0x0d);
        if (nl < 0) break;
        const line = buf.subarray(0, nl + 1).toString("latin1");
        buf = buf.subarray(nl + 1);
        astm += line;
        if (/^L\|/.test(line)) { const text = astm; astm = ""; const p = parseText(text); if (p) send(device, p, {hash: crypto.createHash("sha256").update(text).digest("hex")}).catch(err => log(device.name + ": " + err.message)); }
      }
    };
  }

  function startTcp(device) {
    const server = net.createServer(sock => {
      const onData = streamHandler(device, b => sock.write(b));
      sock.on("data", d => onData(d).catch(e => log(device.name + ": " + e.message)));
      sock.on("error", () => {});
    });
    server.on("error", e => { status[device.id] = {...(status[device.id] || {}), error: `Bağlantı noktası ${device.settings.port} açılamadı: ${e.message}`}; });
    server.listen(device.settings.port, () => { status[device.id] = {...(status[device.id] || {}), listening: `TCP ${device.settings.port} dinleniyor`}; });
    return {stop: () => server.close()};
  }

  async function startSerial(device) {
    let SerialPort;
    try { ({SerialPort} = await import("serialport")); }
    catch { status[device.id] = {error: "Seri port desteği kurulu değil. Ajan klasöründe 'npm install serialport' çalıştırın."}; return {stop() {}}; }
    const port = new SerialPort({path: device.settings.port, baudRate: device.settings.baud || 9600});
    const onData = streamHandler(device, b => port.write(b));
    port.on("data", d => onData(d).catch(e => log(device.name + ": " + e.message)));
    port.on("open", () => { status[device.id] = {listening: `${device.settings.port} · ${device.settings.baud} baud`}; });
    port.on("error", e => { status[device.id] = {error: "Seri port: " + e.message}; });
    return {stop: () => port.close(() => {})};
  }

  // ── DICOM C-STORE alıcısı (SCP): A-ASSOCIATE kabul, C-ECHO ve C-STORE; açık/örtük VR little endian.
  function startDicom(device) {
    const ae = (device.settings.aeTitle || "VETZIMO").padEnd(16, " ").slice(0, 16);
    const server = net.createServer(sock => dicomSession(sock, ae, async (dataset, meta) => {
      const file = buildPart10(dataset, meta);
      await handleBuffer(device, file, (meta.sopInstance || crypto.randomBytes(8).toString("hex")) + ".dcm");
    }, msg => log(device.name + ": " + msg)));
    server.on("error", e => { status[device.id] = {error: `DICOM ${device.settings.port} açılamadı: ${e.message}`}; });
    server.listen(device.settings.port, () => { status[device.id] = {listening: `DICOM ${device.settings.aeTitle || "VETZIMO"} @ ${device.settings.port}`}; });
    return {stop: () => server.close()};
  }

  async function refresh() {
    try { ({devices} = await api("devices")); }
    catch (e) { if (e.status === 401) throw e; return; }
    const want = new Map(devices.map(d => [d.id, JSON.stringify([d.connection, d.settings])]));
    for (const [id, r] of running) if (want.get(id) !== r.key) { try { r.stop(); } catch {} running.delete(id); }
    for (const d of devices) {
      if (running.has(d.id)) continue;
      const key = want.get(d.id);
      const r = d.connection === "folder" ? startFolder(d) : d.connection === "tcp" ? startTcp(d) : d.connection === "dicom" ? startDicom(d) : d.connection === "serial" ? await startSerial(d) : null;
      if (r) { running.set(d.id, {...r, key}); log(`${d.name}: dinleme başladı (${d.connection})`); }
    }
  }
  return {refresh, status: () => devices.map(d => ({id: d.id, name: d.name, connection: d.connection, ...(status[d.id] || {})})), handleBuffer, stopAll: () => { for (const r of running.values()) try { r.stop(); } catch {} running.clear(); }};
}

// ─────────────────────────── DICOM ağ protokolü (PS3.8) ───────────────────────────
const IMPLICIT = "1.2.840.10008.1.2", EXPLICIT = "1.2.840.10008.1.2.1", VERIFICATION = "1.2.840.10008.1.1";
const pad = s => (s.length % 2 ? s + "\0" : s);
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const item = (type, body) => Buffer.concat([Buffer.from([type, 0]), u16(body.length), body]);

function parseAssociate(pdu) {
  // PDU: tür(1) ayrılmış(1) uzunluk(4) | sürüm(2) ayrılmış(2) çağrılan AE(16) çağıran AE(16) ayrılmış(32) | öğeler
  const called = pdu.toString("ascii", 10, 26), calling = pdu.toString("ascii", 26, 42);
  const contexts = [];
  let p = 74;
  while (p + 4 <= pdu.length) {
    const type = pdu[p], len = pdu.readUInt16BE(p + 2), body = pdu.subarray(p + 4, p + 4 + len);
    if (type === 0x20) {
      const id = body[0]; let q = 4, abstract = "", syntaxes = [];
      while (q + 4 <= body.length) { const t = body[q], l = body.readUInt16BE(q + 2), v = body.toString("ascii", q + 4, q + 4 + l).replace(/\0+$/, ""); if (t === 0x30) abstract = v; if (t === 0x40) syntaxes.push(v); q += 4 + l; }
      contexts.push({id, abstract, syntaxes});
    }
    p += 4 + len;
  }
  return {called, calling, contexts};
}

function acceptPdu(req, ae) {
  const ctx = req.contexts.map(c => {
    const ts = c.syntaxes.includes(EXPLICIT) ? EXPLICIT : c.syntaxes.includes(IMPLICIT) ? IMPLICIT : null;
    c.ts = ts;
    return Buffer.concat([Buffer.from([0x21, 0]), u16(4 + 4 + Buffer.byteLength(pad(ts || IMPLICIT))), Buffer.from([c.id, 0, ts ? 0 : 4, 0]), item(0x40, Buffer.from(pad(ts || IMPLICIT)))]);
  });
  const app = item(0x10, Buffer.from("1.2.840.10008.3.1.1.1"));
  const user = item(0x50, Buffer.concat([item(0x51, u32(1048576)), item(0x52, Buffer.from(pad("1.2.826.0.1.3680043.10.1083"))), item(0x55, Buffer.from("VETZIMO_1"))]));
  const body = Buffer.concat([u16(1), Buffer.alloc(2), Buffer.from(req.called.padEnd(16).slice(0, 16)), Buffer.from(req.calling.padEnd(16).slice(0, 16)), Buffer.alloc(32), app, ...ctx, user]);
  return Buffer.concat([Buffer.from([0x02, 0]), u32(body.length), body]);
}

/** Komut veri kümesi (örtük VR LE) içinden basit alanlar. */
function readCommand(buf) {
  const out = {}; let p = 0;
  while (p + 8 <= buf.length) {
    const g = buf.readUInt16LE(p), e = buf.readUInt16LE(p + 2), len = buf.readUInt32LE(p + 4), v = buf.subarray(p + 8, p + 8 + len);
    const tag = (g << 16 | e) >>> 0;
    if (tag === 0x00000100) out.command = v.readUInt16LE(0);
    if (tag === 0x00000110) out.messageId = v.readUInt16LE(0);
    if (tag === 0x00000002) out.sopClass = v.toString("ascii").replace(/\0+$/, "");
    if (tag === 0x00001000) out.sopInstance = v.toString("ascii").replace(/\0+$/, "");
    if (tag === 0x00000800) out.hasData = v.readUInt16LE(0) !== 0x0101;
    p += 8 + len;
  }
  return out;
}

function writeCommand(fields) {
  const parts = [];
  const el = (g, e, v) => { const b = Buffer.alloc(8); b.writeUInt16LE(g, 0); b.writeUInt16LE(e, 2); b.writeUInt32LE(v.length, 4); parts.push(b, v); };
  const us = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  if (fields.sopClass) el(0, 0x0002, Buffer.from(pad(fields.sopClass)));
  el(0, 0x0100, us(fields.command));
  el(0, 0x0120, us(fields.respondTo));
  el(0, 0x0800, us(0x0101));
  el(0, 0x0900, us(fields.status || 0));
  if (fields.sopInstance) el(0, 0x1000, Buffer.from(pad(fields.sopInstance)));
  const body = Buffer.concat(parts);
  const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from([0, 0, 0, 0, 4, 0, 0, 0]), len, body]); // (0000,0000) UL grup uzunluğu
}

function pdata(ctx, isCommand, last, data) {
  const pdv = Buffer.concat([u32(data.length + 2), Buffer.from([ctx, (isCommand ? 1 : 0) | (last ? 2 : 0)]), data]);
  return Buffer.concat([Buffer.from([0x04, 0]), u32(pdv.length), pdv]);
}

function dicomSession(sock, ae, onStore, log) {
  let buf = Buffer.alloc(0), contexts = new Map(), cmd = [], data = [], current = null;
  sock.on("error", () => {});
  sock.on("data", async chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 6) {
      const type = buf[0], len = buf.readUInt32BE(2);
      if (buf.length < 6 + len) break;
      const pdu = buf.subarray(0, 6 + len); buf = buf.subarray(6 + len);
      if (type === 0x01) {
        const req = parseAssociate(pdu);
        if (req.called.trim() && req.called.trim() !== ae.trim()) { sock.write(Buffer.from([0x03, 0, 0, 0, 0, 4, 0, 1, 1, 7])); log(`Çağrılan AE (${req.called.trim()}) bu cihazla eşleşmiyor; reddedildi.`); continue; }
        sock.write(acceptPdu(req, ae));
        for (const c of req.contexts) contexts.set(c.id, c);
      } else if (type === 0x04) {
        let p = 6;
        while (p < pdu.length) {
          const l = pdu.readUInt32BE(p), ctx = pdu[p + 4], h = pdu[p + 5], v = pdu.subarray(p + 6, p + 4 + l);
          p += 4 + l;
          if (h & 1) { cmd.push(v); if (h & 2) { current = {ctx, ...readCommand(Buffer.concat(cmd))}; cmd = []; if (current.command === 0x0030) { sock.write(pdata(ctx, true, true, writeCommand({command: 0x8030, respondTo: current.messageId, sopClass: VERIFICATION}))); current = null; } } }
          else { data.push(v); if (h & 2 && current) {
            const ds = Buffer.concat(data); data = [];
            const c = current; current = null;
            let status = 0;
            try { await onStore(ds, {sopClass: c.sopClass, sopInstance: c.sopInstance, ts: contexts.get(ctx)?.ts || IMPLICIT}); }
            catch (e) { status = 0xa700; log("DICOM kaydı gönderilemedi: " + e.message); }
            sock.write(pdata(ctx, true, true, writeCommand({command: 0x8001, respondTo: c.messageId, sopClass: c.sopClass, sopInstance: c.sopInstance, status})));
          } }
        }
      } else if (type === 0x05) { sock.write(Buffer.from([0x06, 0, 0, 0, 0, 4, 0, 0, 0, 0])); sock.end(); }
      else if (type === 0x07) sock.destroy();
    }
  });
}

/** Ağdan gelen veri kümesini Part 10 dosyasına çevirir (görüntüleyici ve arşiv için). */
function buildPart10(dataset, meta) {
  const el = (e, vr, value) => {
    let v = Buffer.from(pad(value), "ascii");
    const long = vr === "OB";
    const h = Buffer.alloc(long ? 12 : 8); h.writeUInt16LE(2, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, "ascii");
    if (long) h.writeUInt32LE(v.length, 8); else h.writeUInt16LE(v.length, 6);
    return Buffer.concat([h, v]);
  };
  const version = Buffer.concat([Buffer.from([2, 0, 1, 0]), Buffer.from("OB"), Buffer.alloc(2), Buffer.from([2, 0, 0, 0, 0, 1])]);
  const body = Buffer.concat([version, el(2, "UI", meta.sopClass || ""), el(3, "UI", meta.sopInstance || ""), el(0x10, "UI", meta.ts || IMPLICIT), el(0x12, "UI", "1.2.826.0.1.3680043.10.1083")]);
  const groupLen = Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from("UL"), Buffer.from([4, 0]), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(body.length); return b; })()]);
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), groupLen, body, dataset]);
}
