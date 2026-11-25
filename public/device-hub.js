// Cihaz entegrasyonu ekranı: gelen sonuçlar (onay bekleyen / eşleşen / tamamlanan), cihazlarım, elle yükleme, kurulum.
import {parseText, parseDICOM, hintFromName, guessKind} from "./device-parsers.js";
const STYLE = "/device-hub.css?v=1";
const KIND = {hematology: "Hemogram", biochemistry: "Biyokimya", bloodgas: "Kan gazı", urine: "İdrar", xray: "Röntgen", ultrasound: "Ultrason", mr: "MR", ct: "Tomografi", other: "Diğer"};
const CONN = {folder: "Klasör (dışa aktarılan dosyalar)", tcp: "Ağ / LIS (TCP · HL7 veya ASTM)", serial: "Seri port (RS-232 / USB)", dicom: "DICOM (görüntü alıcısı)", manual: "Elle yükleme"};
// Yaygın veteriner cihazları ve önerilen bağlantı. Model listesi rehberdir; her LIS çıkışlı cihaz çalışır.
export const PRESETS = [
  ["Mindray", "BC-30Vet / BC-60R Vet", "hematology", "tcp", {port: 5600, protocol: "hl7"}],
  ["Mindray", "BC-5000Vet / BC-5300Vet", "hematology", "tcp", {port: 5600, protocol: "hl7"}],
  ["Exigo", "H400 / Eos", "hematology", "folder", {path: "C:\\Exigo\\Export"}],
  ["IDEXX", "ProCyte Dx / LaserCyte (VetLab Station)", "hematology", "tcp", {port: 5601, protocol: "hl7"}],
  ["IDEXX", "Catalyst One / Dx (VetLab Station)", "biochemistry", "tcp", {port: 5602, protocol: "hl7"}],
  ["Fujifilm", "DRI-CHEM NX600 / NX700", "biochemistry", "serial", {port: "COM3", baud: 9600, protocol: "astm"}],
  ["Skyla", "VB1 / Solution", "biochemistry", "tcp", {port: 5603, protocol: "hl7"}],
  ["Seamaty", "SMT-120VP", "biochemistry", "tcp", {port: 5604, protocol: "hl7"}],
  ["Abaxis / Zoetis", "VetScan VS2 / HM5", "biochemistry", "serial", {port: "COM4", baud: 9600, protocol: "astm"}],
  ["Scil", "Element DC / HT5", "biochemistry", "folder", {path: "C:\\scil\\export"}],
  ["Edan", "i15 Vet", "bloodgas", "tcp", {port: 5605, protocol: "hl7"}],
  ["IDEXX", "VetStat", "bloodgas", "tcp", {port: 5606, protocol: "hl7"}],
  ["IDEXX", "SediVue Dx / VetLab UA", "urine", "tcp", {port: 5607, protocol: "hl7"}],
  ["Dirui / URIT", "İdrar şerit okuyucu", "urine", "serial", {port: "COM5", baud: 9600, protocol: "astm"}],
  ["DR / CR", "Röntgen konsolu (DICOM)", "xray", "dicom", {port: 11112, aeTitle: "VETZIMO"}],
  ["Ultrason", "Mindray / Esaote / GE / Samsung", "ultrasound", "dicom", {port: 11113, aeTitle: "VETZIMO"}],
  ["Tomografi", "BT konsolu / PACS", "ct", "dicom", {port: 11114, aeTitle: "VETZIMO"}],
  ["MR", "MR konsolu / PACS", "mr", "dicom", {port: 11115, aeTitle: "VETZIMO"}],
];
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const when = t => new Date(t * 1000).toLocaleString("tr-TR", {dateStyle: "short", timeStyle: "short"});
const fold = s => String(s || "").toLocaleLowerCase("tr").replace(/[çğıöşü]/g, c => ({ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u"})[c]);

export async function mountDevices(root, ctx) {
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  const tr = ctx.tr || (s => s);
  const call = async (path, body) => {
    const r = await ctx.api(path, body ? {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": ctx.scope}, body: JSON.stringify(body)} : {});
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || tr("İşlem tamamlanamadı.")); return d;
  };
  let tab = "inbox", state = "pending", info = await call("/api/clinic/devices").catch(e => ({error: e.message}));
  if (info.error) { root.replaceChildren(h("p", "dv-error", info.error)); return; }
  const access = await import("./agent-access.js?v=1"), paid = (await access.agentAccess()).paid;
  if (!root.isConnected) return;
  const wrap = h("section", "dv-root");
  const head = h("header", "dv-head");
  const agentOk = !!info.agent?.online;
  const agentLink = h("a", "dv-agent " + (agentOk ? "on" : "off"), null, {href: agentOk ? "#bakanlik-koprusu" : "#cihaz-entegrasyonu"});
  agentLink.append(h("span", "", agentOk ? "● " : "○ "), h("span", "", tr(agentOk ? "Klinik bilgisayarı ajanı bağlı" : "Ajan bağlı değil · kurulum")));
  head.append(h("div", "", null), ...(paid ? [agentLink] : []));
  head.firstChild.append(h("h2", "", tr("Cihaz entegrasyonu")), h("p", "", tr("Hemogram, biyokimya, kan gazı, idrar, röntgen, ultrason, MR ve tomografi sonuçları otomatik olarak hasta sahibi ve hastayla eşleşir, hastanın muayenesine tetkik olarak eklenir.")));
  const nav = h("div", "dv-tabs"), body = h("div", "dv-body"), note = h("p", "dv-note", "", {hidden: true});
  wrap.append(head, nav, note, body);
  root.replaceChildren(wrap);
  const say = (t, bad) => { note.hidden = !t; note.textContent = t || ""; note.classList.toggle("bad", !!bad); };
  const canManage = ctx.canManage ?? true;
  const tabs = [["inbox", "Gelen sonuçlar"], ["devices", "Cihazlarım"], ["manual", "Elle yükle"], ["setup", "Kurulum rehberi"]];
  if (paid && !agentOk && !info.devices.length) tab = "setup";
  function drawNav() {
    nav.replaceChildren(...tabs.map(([k, l]) => { const b = h("button", "dv-tab", null, {type: "button"}); b.append(h("span", "", tr(l))); if (k === "inbox" && info.counts?.pending) b.append(h("span", "dv-count", " (" + info.counts.pending + ")")); b.setAttribute("aria-selected", String(k === tab)); b.addEventListener("click", () => { tab = k; say(""); draw(); }); return b; }));
  }
  const paramList = params => {
    const ul = h("ul", "dv-params");
    for (const p of params.slice(0, 12)) { const li = h("li", p.flag === "H" ? "hi" : p.flag === "L" ? "lo" : ""); li.append(h("b", "", p.name), h("span", "", `${p.value} ${p.unit || ""}`.trim()), h("small", "", p.low || p.high ? `${p.low}–${p.high}` : "")); ul.append(li); }
    if (params.length > 12) ul.append(h("li", "more", `+${params.length - 12}`));
    return ul;
  };
  async function inbox() {
    const seg = h("div", "dv-seg");
    [["pending", "Onay bekleyen"], ["matched", "Eşleşen (eklenecek)"], ["done", "Tamamlanan"]].forEach(([k, l]) => { const b = h("button", k === state ? "on" : "", tr(l), {type: "button"}); b.addEventListener("click", () => { state = k; draw(); }); seg.append(b); });
    const list = h("div", "dv-list");
    body.replaceChildren(seg, list);
    const data = await call("/api/clinic/devices/inbox?state=" + state).catch(e => ({items: [], error: e.message}));
    info.counts = data.counts || info.counts; drawNav();
    if (!data.items.length) { list.append(h("p", "dv-empty", state === "pending" ? tr("Onay bekleyen sonuç yok. Eşleşmeyen sonuçlar burada görünür.") : tr("Kayıt yok."))); return; }
    for (const r of data.items) {
      const card = h("article", "dv-card");
      const hint = r.hint || {};
      const top = h("div", "dv-card-top");
      top.append(h("span", "dv-kind k-" + r.kind, tr(r.kindLabel)), h("strong", "", r.data?.title || r.deviceName || ""), h("small", "", when(r.receivedAt)));
      const who = h("p", "dv-who", [hint.name && tr("Hasta") + ": " + hint.name, hint.owner && tr("Sahip") + ": " + hint.owner, hint.patientId && "No: " + hint.patientId, hint.chip && tr("Çip") + ": " + hint.chip, r.sample && tr("Örnek") + ": " + r.sample].filter(Boolean).join(" · ") || tr("Cihaz hasta bilgisi göndermedi"));
      card.append(top, who);
      if (r.data?.params?.length) card.append(paramList(r.data.params));
      if (r.file) {
        const a = h("a", "dv-file", (r.data?.file?.type === "application/dicom" ? "🩻 " + tr("Görüntüyü aç") : "📎 ") + " " + (r.data?.file?.name || tr("Dosya")), {href: "/api/clinic/devices/file/" + r.file, target: "_blank", rel: "noopener"});
        if (r.data?.file?.type === "application/dicom") a.addEventListener("click", async e => {
          e.preventDefault();
          try { const blob = await (await ctx.api("/api/clinic/devices/file/" + r.file)).blob(); const m = await import("./dicom-viewer.js?v=1"); m.openViewer(new File([blob], r.data.file.name, {type: "application/dicom"}), {esc: s => String(s)}); }
          catch (er) { say(er.message, true); }
        });
        card.append(a);
      }
      const actions = h("div", "dv-actions");
      if (r.status === "pending") {
        if (r.candidates.length) { actions.append(h("span", "dv-muted", tr("Aynı adlı hastalar:"))); r.candidates.forEach(c => { const b = h("button", "dv-btn primary", `${c.name} · ${c.owner || "—"}${c.species ? " · " + c.species : ""}`, {type: "button"}); b.addEventListener("click", () => resolve(r.id, "assign", c.id)); actions.append(b); }); }
        const search = h("input", "dv-search", null, {type: "search", placeholder: tr("Hasta veya sahip adıyla ara…")});
        const found = h("div", "dv-found");
        search.addEventListener("input", () => {
          const q = fold(search.value.trim()); found.replaceChildren();
          if (q.length < 2) return;
          const owners = new Map((ctx.owners() || []).map(o => [o.id, o.name]));
          (ctx.patients() || []).filter(p => fold(p.name).includes(q) || fold(owners.get(p.owner)).includes(q) || String(p.chip || "").includes(q) || String(p.protocol || "").toLowerCase() === q).slice(0, 8)
            .forEach(p => { const b = h("button", "dv-btn", `${p.name} · ${owners.get(p.owner) || "—"} · ${p.species || ""}`, {type: "button"}); b.addEventListener("click", () => resolve(r.id, "assign", p.id)); found.append(b); });
        });
        const ignore = h("button", "dv-btn ghost", tr("Yok say"), {type: "button"}); ignore.addEventListener("click", () => resolve(r.id, "ignore"));
        const retry = h("button", "dv-btn ghost", tr("Yeniden eşleştir"), {type: "button"}); retry.addEventListener("click", () => resolve(r.id, "retry"));
        card.append(actions, search, found, h("div", "dv-actions", null)); card.lastChild.append(retry, ignore);
      } else if (r.patient) {
        const open = h("button", "dv-btn", tr("Hasta dosyasını aç"), {type: "button"}); open.addEventListener("click", () => ctx.openPatient(r.patient));
        actions.append(h("span", "dv-ok", r.status === "imported" ? tr("Tetkik olarak eklendi") : tr("Hastayla eşleşti") + " (" + ({chip: tr("mikroçip"), protocol: tr("protokol no"), id: tr("hasta no"), "name+owner": tr("ad ve sahip"), name: tr("ad"), manual: tr("elle")}[r.by] || r.by) + ")"), open);
        card.append(actions);
      } else card.append(h("p", "dv-muted", tr("Yok sayıldı")));
      list.append(card);
    }
  }
  async function resolve(id, action, patient) {
    try { await call("/api/clinic/devices", {action: "resolve", id, ...(patient ? {patient} : {}), ...(action ? {action} : {})}); say(action === "ignore" ? tr("Sonuç yok sayıldı.") : tr("Sonuç hastaya bağlandı; muayeneye tetkik olarak eklenecek.")); ctx.onMatched?.(); draw(); }
    catch (e) { say(e.message, true); }
  }
  function devices() {
    if (!paid) { body.replaceChildren(access.paidNotice(tr)); return; }
    const list = h("div", "dv-grid");
    for (const d of info.devices) {
      const card = h("article", "dv-card");
      const st = d.lastError ? h("span", "dv-bad", "⚠ " + d.lastError) : h("span", "dv-muted", d.lastSeen ? tr("Son sinyal") + ": " + when(d.lastSeen) : tr("Henüz sinyal yok"));
      card.append(h("div", "dv-card-top", null), h("p", "dv-who", `${d.vendor} ${d.model}`.trim() || CONN[d.connection]), h("p", "dv-muted", tr(CONN[d.connection]) + " · " + Object.values(d.settings || {}).join(" · ")), st);
      card.firstChild.append(h("span", "dv-kind k-" + d.kind, tr(KIND[d.kind])), h("strong", "", d.name), d.active ? "" : h("small", "", tr("Duraklatıldı")));
      if (canManage) { const a = h("div", "dv-actions"); const e = h("button", "dv-btn", tr("Düzenle"), {type: "button"}); e.addEventListener("click", () => form(d)); const x = h("button", "dv-btn ghost", tr("Kaldır"), {type: "button"}); x.addEventListener("click", async () => { if (!x.dataset.sure) { x.dataset.sure = 1; x.textContent = tr("Emin misiniz? Kaldır"); return; } info.devices = (await call("/api/clinic/devices", {action: "remove", id: d.id})).devices; draw(); }); a.append(e, x); card.append(a); }
      list.append(card);
    }
    const add = h("button", "dv-btn primary", "+ " + tr("Cihaz ekle"), {type: "button"}); add.addEventListener("click", () => form(null));
    body.replaceChildren(...(canManage ? [add] : []), info.devices.length ? list : h("p", "dv-empty", tr("Henüz cihaz eklenmedi.")));
  }
  function form(d) {
    const f = h("form", "dv-form");
    const preset = h("select"); preset.append(new Option(tr("Hazır cihaz seçin (isteğe bağlı)"), ""));
    PRESETS.forEach((p, i) => preset.append(new Option(`${p[0]} · ${p[1]} — ${tr(KIND[p[2]])}`, String(i))));
    const name = h("input", "", null, {required: true, maxLength: 80, value: d?.name || "", placeholder: tr("Ör. Hemogram cihazı")});
    const kind = h("select"); Object.entries(KIND).forEach(([k, l]) => kind.append(new Option(tr(l), k, false, d?.kind === k)));
    const vendor = h("input", "", null, {maxLength: 60, value: d?.vendor || ""}), model = h("input", "", null, {maxLength: 60, value: d?.model || ""});
    const conn = h("select"); Object.entries(CONN).forEach(([k, l]) => conn.append(new Option(tr(l), k, false, d?.connection === k)));
    const extra = h("div", "dv-extra");
    const s = {...(d?.settings || {})};
    const drawExtra = () => {
      extra.replaceChildren();
      const field = (label, key, attrs = {}) => { const l = h("label", "dv-field"); const i = h("input", "", null, {value: s[key] ?? "", ...attrs}); i.addEventListener("input", () => s[key] = attrs.type === "number" ? Number(i.value) : i.value); l.append(h("span", "", label), i); extra.append(l); };
      const select = (label, key, opts) => { const l = h("label", "dv-field"); const i = h("select"); opts.forEach(([v, t]) => i.append(new Option(t, v, false, String(s[key] ?? opts[0][0]) === String(v)))); s[key] ??= opts[0][0]; i.addEventListener("change", () => s[key] = /^\d+$/.test(i.value) ? Number(i.value) : i.value); l.append(h("span", "", label), i); extra.append(l); };
      if (conn.value === "folder") { field(tr("Sonuç klasörü (klinik bilgisayarında)"), "path", {required: true, placeholder: "C:\\Cihaz\\Export"}); field(tr("Dosya deseni (isteğe bağlı)"), "pattern", {placeholder: "*.csv"}); }
      if (conn.value === "tcp") { field(tr("Dinlenecek TCP bağlantı noktası"), "port", {type: "number", min: 1024, max: 65535, required: true}); select(tr("Protokol"), "protocol", [["auto", tr("Otomatik")], ["hl7", "HL7"], ["astm", "ASTM"]]); }
      if (conn.value === "serial") { field(tr("Seri port"), "port", {required: true, placeholder: "COM3"}); select(tr("Hız (baud)"), "baud", [9600, 19200, 38400, 57600, 115200, 4800, 2400, 1200].map(v => [v, String(v)])); select(tr("Protokol"), "protocol", [["auto", tr("Otomatik")], ["hl7", "HL7"], ["astm", "ASTM"]]); }
      if (conn.value === "dicom") { field(tr("DICOM bağlantı noktası"), "port", {type: "number", min: 104, max: 65535, required: true}); field("AE Title", "aeTitle", {maxLength: 16}); extra.append(h("p", "dv-muted", tr("Cihazın DICOM ayarlarında hedef olarak klinik bilgisayarının IP adresini, bu bağlantı noktasını ve AE Title değerini girin."))); }
      if (conn.value === "manual") extra.append(h("p", "dv-muted", tr("Sonuç dosyaları 'Elle yükle' sekmesinden seçilir.")));
    };
    preset.addEventListener("change", () => { const p = PRESETS[preset.value]; if (!p) return; vendor.value = p[0]; model.value = p[1]; kind.value = p[2]; conn.value = p[3]; Object.assign(s, p[4]); if (!name.value) name.value = `${p[0]} ${p[1]}`.slice(0, 80); drawExtra(); });
    conn.addEventListener("change", () => { for (const k of Object.keys(s)) delete s[k]; drawExtra(); });
    drawExtra();
    const lab = (t, el) => { const l = h("label", "dv-field"); l.append(h("span", "", t), el); return l; };
    const cancel = h("button", "dv-btn ghost", tr("Vazgeç"), {type: "button"}); cancel.addEventListener("click", draw);
    f.append(h("h3", "", d ? tr("Cihazı düzenle") : tr("Cihaz ekle")), lab(tr("Hazır cihaz"), preset), lab(tr("Cihaz adı"), name), lab(tr("Tür"), kind), lab(tr("Marka"), vendor), lab(tr("Model"), model), lab(tr("Bağlantı"), conn), extra, h("div", "dv-actions", null));
    f.lastChild.append(h("button", "dv-btn primary", tr("Kaydet"), {type: "submit"}), cancel);
    f.addEventListener("submit", async e => { e.preventDefault(); try { info.devices = (await call("/api/clinic/devices", {action: "save", id: d?.id, name: name.value, kind: kind.value, vendor: vendor.value, model: model.value, connection: conn.value, settings: s})).devices; say(tr("Cihaz kaydedildi. Ajan 30 saniye içinde dinlemeye başlar.")); draw(); } catch (er) { say(er.message, true); } });
    body.replaceChildren(f);
  }
  function manual() {
    const f = h("form", "dv-form");
    const dev = h("select"); info.devices.forEach(d => dev.append(new Option(d.name, d.id)));
    const file = h("input", "", null, {type: "file", accept: ".hl7,.txt,.csv,.tsv,.xml,.astm,.dcm,.pdf,.jpg,.jpeg,.png", required: true});
    const preview = h("div", "dv-preview");
    let parsed = null, raw = null;
    file.addEventListener("change", async () => {
      const fl = file.files[0]; preview.replaceChildren(); parsed = null; raw = null;
      if (!fl) return;
      if (fl.size > 60 * 1024 * 1024) { preview.append(h("p", "dv-bad", tr("Dosya 60 MB'tan büyük."))); return; }
      raw = new Uint8Array(await fl.arrayBuffer());
      const isDicom = raw.length > 132 && String.fromCharCode(...raw.subarray(128, 132)) === "DICM" || /\.dcm$/i.test(fl.name);
      parsed = isDicom ? parseDICOM(raw) : /\.(pdf|jpe?g|png)$/i.test(fl.name) ? {hint: hintFromName(fl.name), params: [], format: "file"} : parseText(new TextDecoder().decode(raw));
      if (!parsed) { preview.append(h("p", "dv-bad", tr("Dosya biçimi tanınmadı."))); return; }
      if (!parsed.hint?.name && !parsed.hint?.patientId && !parsed.hint?.chip) parsed.hint = {...hintFromName(fl.name), ...(parsed.hint || {})};
      preview.append(h("p", "dv-who", [parsed.hint?.name && tr("Hasta") + ": " + parsed.hint.name, parsed.hint?.owner && tr("Sahip") + ": " + parsed.hint.owner, parsed.hint?.patientId && "No: " + parsed.hint.patientId, parsed.hint?.chip && tr("Çip") + ": " + parsed.hint.chip].filter(Boolean).join(" · ") || tr("Hasta bilgisi yok; gönderince onay bekleyenlere düşer.")));
      if (parsed.params?.length) preview.append(paramList(parsed.params));
    });
    if (!info.devices.length) { body.replaceChildren(h("p", "dv-empty", tr("Önce 'Cihazlarım' sekmesinden bir cihaz ekleyin."))); return; }
    const lab = (t, el) => { const l = h("label", "dv-field"); l.append(h("span", "", t), el); return l; };
    f.append(h("h3", "", tr("Sonuç dosyası yükle")), h("p", "dv-muted", tr("Ajan kurulu değilse ya da cihaz yalnız dosya veriyorsa: HL7, ASTM, CSV, TXT, XML, DICOM, PDF veya görüntü seçin.")), lab(tr("Cihaz"), dev), lab(tr("Dosya"), file), preview, h("button", "dv-btn primary", tr("Gönder ve eşleştir"), {type: "submit"}));
    f.addEventListener("submit", async e => {
      e.preventDefault(); if (!parsed || !raw) return;
      try {
        let fileId = null;
        const fl = file.files[0];
        if (parsed.format === "dicom" || parsed.format === "file") {
          fileId = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
          const CH = 4 * 1024 * 1024, total = Math.max(1, Math.ceil(raw.length / CH));
          for (let i = 0; i < total; i++) {
            const r = await ctx.api("/api/clinic/devices/upload", {method: "POST", headers: {"Content-Type": "application/octet-stream", "X-VeTNet-Scope": ctx.scope, "X-Upload-Id": fileId, "X-Chunk-Index": String(i), "X-Chunk-Total": String(total), "X-File-Name": encodeURIComponent(fl.name), "X-File-Type": fl.type || "application/octet-stream"}, body: raw.subarray(i * CH, (i + 1) * CH)});
            if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || tr("Dosya yüklenemedi."));
          }
        }
        const d = info.devices.find(x => x.id === dev.value);
        const kind = parsed.kind || (parsed.params?.length ? guessKind(parsed.params, d.kind) : d.kind);
        const r = await call("/api/clinic/devices", {action: "manual", device: dev.value, kind, hint: parsed.hint || {}, params: parsed.params || [], sample: parsed.sample || "", date: parsed.date || "", title: parsed.title || fl.name.replace(/\.[^.]+$/, ""), format: parsed.format, meta: parsed.meta || {}, file: fileId});
        say(r.duplicate ? tr("Bu sonuç daha önce gönderilmiş.") : r.status === "matched" ? tr("Sonuç hastayla eşleşti; muayeneye tetkik olarak eklenecek.") : tr("Sonuç onay bekleyenlere düştü.")); ctx.onMatched?.();
        f.reset(); preview.replaceChildren();
      } catch (er) { say(er.message, true); }
    });
    body.replaceChildren(f);
  }
  function setup() {
    if (!paid) { body.replaceChildren(access.paidNotice(tr)); return; }
    const steps = h("ol", "dv-steps");
    [[tr("Ajanı kurun"), tr("Klinikte cihazların bağlı olduğu bilgisayara VetZimo ajanını kurun ve eşleştirin (Bakanlık köprüsü ile aynı program). Ajan Windows açılınca kendiliğinden başlar."), "#bakanlik-koprusu", tr("Ajanı indir ve eşleştir")],
      [tr("Cihazı ekleyin"), tr("'Cihazlarım' sekmesinde hazır listeden cihazınızı seçin; bağlantı türü ve ayarlar önerilir."), null, null],
      [tr("Cihazı yönlendirin"), tr("Laboratuvar cihazında LIS / Host ayarına klinik bilgisayarının IP adresini ve bağlantı noktasını girin; dosya veren cihazlarda dışa aktarma klasörünü seçin. Röntgen, ultrason, BT ve MR konsolunda DICOM hedefi olarak aynı IP, bağlantı noktası ve AE Title'ı ekleyin."), null, null],
      [tr("Hasta bilgisini cihaza girin"), tr("En kesin eşleşme için cihaza hasta numarası olarak mikroçip veya VetZimo protokol numarasını yazın. Hasta adı ve sahip adı da yeterlidir; aynı adlı birden çok hasta varsa sonuç onayınıza düşer."), null, null],
      [tr("Sonuçlar kendiliğinden gelir"), tr("Eşleşen sonuç hastanın o günkü muayenesine tetkik olarak eklenir, değerler referans aralığıyla işaretlenir, trend grafiklerinde ve tetkik yorumunda görünür; 'Tetkik sonucu hazır' bildirimi gelir."), null, null]]
      .forEach(([t, d, href, link], i) => { const li = h("li"); li.append(h("strong", "", t), h("p", "", d)); if (i === 0) { const dl = h("div"); li.append(dl); access.mountAgentDownloads(dl, {tr, keys: ["agent"], compact: true}); } if (href) li.append(h("a", "dv-btn", tr("Eşleştirme kodu al"), {href})); steps.append(li); });
    body.replaceChildren(steps, h("h4", "", tr("Desteklenen bağlantılar")), h("p", "dv-muted", "HL7 v2 (ORU^R01, MLLP) · ASTM E1381/E1394 · CSV / TXT / XML dışa aktarma · DICOM C-STORE (CR, DX, US, CT, MR) · PDF ve görüntü"));
  }
  function draw() { drawNav(); ({inbox, devices, manual, setup})[tab](); }
  draw();
}
