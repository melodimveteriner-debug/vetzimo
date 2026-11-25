// Bakanlık Köprüsü (klinik ekranı): ajan durumu, Bakanlık oturumu, gönderilecek reçete ve aşılar, kuyruk ve kararlar.
// Gönderim, klinik bilgisayarındaki ajan tarafından veterinerin kendi e-Devlet oturumunda yapılır.

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
const STATUS = {queued: "Kuyrukta", claimed: "Gönderiliyor", done: "Tamamlandı", error: "Hata", uncertain: "Kontrol edin", cancelled: "Kuyruktan çıkarıldı"};

export function mountBridge(root, api) {
  const {tr} = api;
  const lang = document.documentElement.lang || "tr";
  const ui = {data: null, tab: "pending", pair: null, error: "", busy: false};
  const fmt = t => t ? new Intl.DateTimeFormat(lang, {dateStyle: "medium", timeStyle: "short"}).format(new Date(t * 1000)) : "";
  const fdate = d => d ? new Intl.DateTimeFormat(lang, {dateStyle: "medium"}).format(new Date(d + "T12:00:00")) : "";

  async function request(body) {
    const r = await api.fetch("/api/bridge", body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || tr("Sunucu isteği tamamlayamadı."));
    return data;
  }
  async function load(quiet) {
    try { ui.data = await request(); ui.data.jobs = (ui.data.jobs || []).filter(j => ["prescription", "vaccine"].includes(j.kind)); ui.error = ""; } /* e-belge işleri e-Belgeler sayfasında */ catch (e) { ui.error = e.message; }
    if (!quiet || !root.querySelector("dialog[open]")) draw();
  }
  async function act(body, message) {
    try { const r = await request(body); if (message) api.toast(tr(message)); await load(); return r; }
    catch (e) { api.toast(e.message); return null; }
  }

  // Gönderilmemiş kayıtlar: son 60 günün reçeteleri (hasta + gün bazında tek reçete) ve uygulanmış aşılar.
  function pending() {
    const jobs = ui.data?.jobs || [];
    const used = new Set(jobs.filter(j => j.status !== "cancelled" && j.status !== "error").flatMap(j => j.records.map(r => j.kind + ":" + r)));
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const groups = new Map();
    for (const r of api.prescriptions()) {
      if (String(r.date || "") < since || used.has("prescription:" + r.id)) continue;
      const key = r.patient + "|" + String(r.date).slice(0, 10);
      if (!groups.has(key)) groups.set(key, {kind: "prescription", patient: r.patient, date: String(r.date).slice(0, 10), rows: []});
      groups.get(key).rows.push(r);
    }
    const out = [...groups.values()];
    for (const v of api.vaccines()) {
      const d = String(v.done || v.date || "").slice(0, 10);
      if (d < since || used.has("vaccine:" + v.id)) continue;
      out.push({kind: "vaccine", patient: v.patient, date: d, rows: [v]});
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  function strip() {
    const d = ui.data, box = el("div", "", {className: "br-strip"});
    const agent = d?.agent;
    const pill = (tone, text) => { const p = el("span", text, {className: "br-pill"}); p.dataset.tone = tone; box.append(p); };
    if (!agent) pill("muted", "⚪ " + tr("Ajan bağlı değil"));
    else if (!agent.online) pill("bad", "⚪ " + tr("Ajan çevrimdışı") + (agent.lastSeen ? " · " + fmt(agent.lastSeen) : ""));
    else {
      pill("ok", "🟢 " + tr("Ajan çalışıyor") + " · " + agent.name);
      const m = {open: ["ok", "🟢 Bakanlık oturumu açık"], closed: ["bad", "🔴 Bakanlık oturumu kapalı"], waiting: ["warn", "🟡 Bakanlık girişi bekleniyor"], unknown: ["warn", "🟡 Bakanlık oturumu bilinmiyor"]}[agent.ministry] || ["warn", agent.ministry];
      pill(m[0], tr(m[1]));
    }
    if (agent && api.canWrite) {
      const check = el("button", tr("Oturumu kontrol et"), {type: "button", className: "button small"});
      check.addEventListener("click", () => act({action: "check-session"}, "Kontrol isteği ajana iletildi."));
      const login = el("button", tr("Klinik bilgisayarında giriş penceresini aç"), {type: "button", className: "button small"});
      login.addEventListener("click", () => act({action: "login"}, "Giriş penceresi klinik bilgisayarında açılacak. Girişi o bilgisayardan siz yapın."));
      box.append(check, login);
    }
    return box;
  }

  function setup() {
    const card = el("section", "", {className: "br-card"});
    const d = ui.data;
    card.append(el("h2", tr(d?.agent ? "Ajan" : "Kurulum")));
    const steps = el("ol", "", {className: "br-steps"});
    for (const s of ["Gün boyu açık kalan klinik bilgisayarına ajanı indirin ve kur.cmd ile kurun (Windows 10/11; Microsoft Edge yeterli).",
      "Aşağıdaki \"Ajanı bağla\" ile kod alın ve ajanın paneline (127.0.0.1:5199) yazın.",
      "Ajan panelinde e-Devlet ile Bakanlık girişini siz yapın; şifreniz görülmez ve saklanmaz.",
      "Ajana reçete ve aşı ekranını bir kez öğretin (Kaydet'e basmadan işaretlersiniz; öğretirken kayıt oluşmaz)."]) steps.append(el("li", tr(s)));
    const row = el("div", "", {className: "br-row"});
    row.append(el("a", tr("Ajanı indir (.zip)"), {href: "/bakanlik-koprusu-ajani.zip", className: "button"}));
    if (api.canManage) {
      const pair = el("button", tr(d?.agent ? "Yeniden eşleştir" : "Ajanı bağla"), {type: "button", className: "button primary"});
      pair.addEventListener("click", async () => { const r = await act({action: "pair"}); if (r) { ui.pair = r; draw(); } });
      row.append(pair);
      if (d?.agent) {
        const revoke = el("button", tr("Ajanın erişimini kaldır"), {type: "button", className: "button ghost"});
        revoke.addEventListener("click", () => { if (revoke.dataset.sure) act({action: "revoke"}, "Ajanın erişimi kaldırıldı."); else { revoke.dataset.sure = "1"; revoke.textContent = tr("Kaldırmayı onayla"); } });
        row.append(revoke);
      }
    }
    card.append(steps, row);
    if (ui.pair) {
      const code = el("div", "", {className: "br-code"});
      code.append(el("span", tr("Eşleştirme kodu")), el("strong", ui.pair.code), el("small", tr("VetZimo adresi") + ": " + location.origin + " · " + tr("Geçerlilik") + ": " + fmt(ui.pair.expires)));
      card.append(code);
    }
    const recipes = d?.recipes || [];
    card.append(el("p", tr("Öğretilen ekranlar") + ": " + (recipes.length ? recipes.map(r => tr({session: "Oturum", prescription: "Reçete", vaccine: "Aşı", earsiv: "e-Arşiv", efatura: "e-Fatura", esmm: "e-SMM", session_gib: "GİB oturumu", session_efatura: "e-Fatura oturumu", session_esmm: "e-SMM oturumu"}[r.kind] || r.kind) + " (v" + r.version + ")").join(", ") : tr("henüz yok")), {className: "br-muted"}));
    return card;
  }

  function prepare(group) {
    const patient = api.patient(group.patient) || {};
    const owner = patient.owner ? api.client(patient.owner) : null;
    const maps = new Map((ui.data?.maps || []).map(m => [m.kind + ":" + m.local_key, m]));
    const dialog = el("dialog", "", {className: "br-dialog"});
    const form = el("form");
    form.append(el("h2", tr(group.kind === "vaccine" ? "Aşı belgesini Bakanlığa hazırla" : "Reçeteyi Bakanlığa hazırla")));
    const info = el("dl", "", {className: "br-info"});
    const add = (k, v, bad) => { info.append(el("dt", tr(k))); const dd = el("dd", v || "—"); if (bad) dd.className = "bad"; info.append(dd); };
    add("Hasta", [patient.name, patient.species, patient.breed].filter(Boolean).join(" · "));
    add("Mikroçip / pasaport", patient.chip || patient.passport, !(patient.chip || patient.passport));
    add("Sahibi", owner?.name);
    add("Sahibin T.C. no", owner?.nationalId, !owner?.nationalId);
    add("Tarih", fdate(group.date));
    form.append(info);
    const warn = [];
    if (!(patient.chip || patient.passport)) warn.push("Bakanlık kaydı için hastanın mikroçip ya da pasaport numarası gerekli. Önce hasta kartına ekleyin.");
    if (!owner?.nationalId) warn.push("Sahibin T.C. kimlik numarası boş. Bakanlık ekranı istiyorsa müşteri kartına ekleyin.");
    for (const w of warn) form.append(el("p", tr(w), {className: "br-warn"}));
    form.append(el("p", tr("Her ürün için Bakanlık listesindeki karşılığı bir kez girersiniz; sistem hatırlar ve bir daha sormaz."), {className: "br-muted"}));
    const inputs = [];
    for (const row of group.rows) {
      const label = group.kind === "vaccine" ? row.title : row.drug;
      const key = (group.kind === "vaccine" ? "vaccine:" + (row.vaccine || label) : "drug:" + (row.product || label)).toLocaleLowerCase("tr");
      const known = maps.get(key);
      const box = el("fieldset", "", {className: "br-item"});
      box.append(el("legend", label + (group.kind === "prescription" ? " · " + [row.dose, row.frequency, row.quantity ? row.quantity + " " + tr("kutu") : ""].filter(Boolean).join(" · ") : "")));
      const name = el("input", "", {value: known?.name || "", placeholder: tr("Bakanlık listesindeki adı (ör. AMOKSİSİLİN 250 MG 20 TABLET)"), maxLength: 200});
      const code = el("input", "", {value: known?.code || "", placeholder: tr("Bakanlık kodu / barkod (varsa)"), maxLength: 80});
      const l1 = el("label"); l1.append(el("span", tr("Bakanlık adı")), name);
      const l2 = el("label"); l2.append(el("span", tr("Kod")), code);
      box.append(l1, l2);
      if (known) box.append(el("small", "✓ " + tr("Daha önce eşleştirildi"), {className: "br-ok"}));
      inputs.push({id: row.id, name, code, known});
      form.append(box);
    }
    let lot, dose, next;
    if (group.kind === "vaccine") {
      const g = el("div", "", {className: "br-grid"});
      lot = el("input", "", {value: group.rows[0].vaccineLot || "", required: true, maxLength: 60});
      dose = el("input", "", {value: "1", maxLength: 20});
      next = el("input", "", {type: "date"});
      for (const [l, i] of [["Parti (lot) no", lot], ["Doz", dose], ["Sonraki aşı tarihi", next]]) { const x = el("label"); x.append(el("span", tr(l)), i); g.append(x); }
      form.append(g);
    }
    const error = el("p", "", {className: "form-error", role: "alert"});
    const foot = el("div", "", {className: "br-row br-end"});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
    cancel.addEventListener("click", () => dialog.close());
    const send = el("button", tr("Bakanlığa gönder"), {type: "submit", className: "button primary", disabled: warn.length > 0 && !(patient.chip || patient.passport)});
    foot.append(cancel, send);
    form.append(error, foot);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const map = {};
      for (const i of inputs) {
        const name = i.name.value.trim(), code = i.code.value.trim();
        if (!name && !code) { error.textContent = tr("Bakanlık listesindeki karşılığı girin."); i.name.focus(); return; }
        if (!i.known || name !== i.known.name || code !== i.known.code) map[i.id] = {name, code};
      }
      send.disabled = true;
      try {
        await request({action: "enqueue", kind: group.kind, records: group.rows.map(r => r.id), map, lot: lot?.value.trim(), dose: dose?.value.trim(), nextDate: next?.value});
        dialog.close(); api.toast(tr("Kuyruğa alındı. Ajan birkaç dakika içinde Bakanlığa girecek.")); ui.tab = "queue"; load();
      } catch (x) { error.textContent = x.message; send.disabled = false; }
    });
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function pendingList() {
    const list = pending();
    const box = el("div", "", {className: "br-list"});
    if (!list.length) { box.append(el("p", tr("Son 60 günde gönderilmemiş reçete ya da aşı yok."), {className: "br-empty"})); return box; }
    for (const g of list.slice(0, 200)) {
      const p = api.patient(g.patient);
      const item = el("article", "", {className: "br-item-row"});
      const text = el("div");
      const t = el("strong", (g.kind === "vaccine" ? "💉 " : "℞ ") + g.rows.map(r => g.kind === "vaccine" ? r.title : r.drug).join(", "));
      t.setAttribute("data-ui-preserve", "");
      const sub = el("span", [p?.name, fdate(g.date), p?.chip ? tr("Çip") + " " + p.chip : tr("Çip yok")].filter(Boolean).join(" · "));
      sub.setAttribute("data-ui-preserve", "");
      text.append(t, sub);
      item.append(text);
      if (api.canWrite) { const b = el("button", tr("Bakanlığa hazırla"), {type: "button", className: "button small primary"}); b.addEventListener("click", () => prepare(g)); item.append(b); }
      box.append(item);
    }
    return box;
  }

  function queueList() {
    const jobs = ui.data?.jobs || [];
    const box = el("div", "", {className: "br-list"});
    if (!jobs.length) { box.append(el("p", tr("Henüz Bakanlığa gönderim yok."), {className: "br-empty"})); return box; }
    for (const j of jobs) {
      const item = el("article", "", {className: "br-job"});
      item.dataset.status = j.status;
      const head = el("div", "", {className: "br-job-head"});
      const s = el("strong", j.summary); s.setAttribute("data-ui-preserve", "");
      const pill = el("span", tr(STATUS[j.status] || j.status) + (j.status === "claimed" && j.phase === "submitting" ? " · " + tr("kaydediliyor") : ""), {className: "br-pill"});
      pill.dataset.tone = {done: "ok", error: "bad", uncertain: "warn", claimed: "info", queued: "muted", cancelled: "muted"}[j.status];
      head.append(s, pill);
      item.append(head, el("small", [j.createdBy, fmt(j.updatedAt), j.documentNo ? tr(j.kind === "vaccine" ? "Belge no" : "Reçete no") + ": " + j.documentNo : ""].filter(Boolean).join(" · "), {className: "br-muted"}));
      if (j.error) item.append(el("p", j.error, {className: j.status === "uncertain" ? "br-warn" : "form-error"}));
      const row = el("div", "", {className: "br-row"});
      if (j.status === "uncertain" && api.canWrite) {
        item.append(el("p", tr("Kaydetme sırasında bağlantı koptu; belge Bakanlıkta oluşmuş olabilir. Ajan bu işi kendiliğinden asla yeniden denemez — çift kayıt olmasın diye. Önce Bakanlık sisteminde kontrol edin.") + (j.search ? " " + tr("Aranacak bilgi") + ": " + j.search : ""), {className: "br-muted"}));
        const no = el("input", "", {placeholder: tr("Bakanlıktaki belge numarası"), maxLength: 64});
        const link = el("button", tr("Belge var — bağla"), {type: "button", className: "button small primary"});
        link.addEventListener("click", () => no.value.trim() ? act({action: "link", id: j.id, documentNo: no.value.trim()}, "Belge bağlandı.") : no.focus());
        const confirm = el("label", "", {className: "br-check"});
        const cb = el("input", "", {type: "checkbox"});
        confirm.append(cb, el("span", tr("Bakanlıkta kontrol ettim, belge yok")));
        const resend = el("button", tr("Tekrar gönder"), {type: "button", className: "button small"});
        resend.addEventListener("click", () => cb.checked ? act({action: "resend", id: j.id, checked: true}, "Yeniden kuyruğa alındı.") : api.toast(tr("Önce Bakanlıkta belge olmadığını kontrol edin.")));
        row.append(no, link, confirm, resend);
      } else if (j.status === "error" && api.canWrite) {
        const resend = el("button", tr("Tekrar gönder"), {type: "button", className: "button small"});
        resend.addEventListener("click", () => act({action: "resend", id: j.id}, "Yeniden kuyruğa alındı."));
        const drop = el("button", tr("Kuyruktan çıkar"), {type: "button", className: "button small ghost"});
        drop.addEventListener("click", () => act({action: "cancel", id: j.id}));
        row.append(resend, drop);
      } else if (j.status === "queued" && api.canWrite) {
        const drop = el("button", tr("Kuyruktan çıkar"), {type: "button", className: "button small ghost"});
        drop.addEventListener("click", () => act({action: "cancel", id: j.id}, "Kuyruktan çıkarıldı."));
        row.append(drop);
      }
      if (row.children.length) item.append(row);
      box.append(item);
    }
    return box;
  }

  function draw() {
    if (!root.isConnected) return;
    const head = el("div", "", {className: "br-head"});
    const t = el("div");
    t.append(el("h1", tr("Bakanlık Köprüsü")), el("p", tr("Reçete ve aşı kayıtlarını, klinik bilgisayarındaki ajan sizin e-Devlet oturumunuzda Bakanlık sistemine girer. Bakanlık ekranlarını elle doldurmanıza gerek kalmaz.")));
    head.append(t);
    const parts = [head];
    if (ui.error) parts.push(el("p", ui.error, {className: "form-error"}));
    if (!ui.data) { parts.push(el("p", tr("Yükleniyor…"))); root.replaceChildren(...parts); return; }
    parts.push(strip());
    const jobs = ui.data.jobs || [];
    const counts = {uncertain: jobs.filter(j => j.status === "uncertain").length, error: jobs.filter(j => j.status === "error").length};
    if (counts.uncertain) parts.push(el("p", "⚠ " + counts.uncertain + " " + tr("iş için Bakanlıkta kontrol gerekiyor."), {className: "br-alert"}));
    const tabs = el("div", "", {className: "br-tabs", role: "tablist"});
    for (const [k, l] of [["pending", "Gönderilecekler"], ["queue", "Kuyruk ve geçmiş"], ["setup", "Kurulum ve ajan"]]) {
      const b = el("button", tr(l) + (k === "queue" && (counts.uncertain + counts.error) ? " (" + (counts.uncertain + counts.error) + ")" : ""), {type: "button"});
      b.setAttribute("aria-pressed", String(ui.tab === k));
      b.addEventListener("click", () => { ui.tab = k; draw(); });
      tabs.append(b);
    }
    parts.push(tabs);
    if (!ui.data.agent && ui.tab !== "setup") parts.push(el("p", tr("Önce \"Kurulum ve ajan\" sekmesinden klinik bilgisayarına ajanı kurup bağlayın. Kayıtları şimdiden kuyruğa alabilirsiniz; ajan bağlanınca gönderilir."), {className: "br-muted"}));
    parts.push(ui.tab === "pending" ? pendingList() : ui.tab === "queue" ? queueList() : setup());
    root.replaceChildren(...parts);
  }
  load();
  const timer = setInterval(() => { if (!root.isConnected) clearInterval(timer); else if (!document.hidden) load(true); }, 10000);
}
