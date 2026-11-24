// Borç hatırlatma ve alacak yaşlandırma: açık bakiyeli müşteriler, yaş dilimleri, toplu SMS (önizleme + onay),
// WhatsApp'ta tek tek gönderme bağlantısı ve Excel'e aktarma. Tutar sunucuda yeniden hesaplanır ({bakiye}).
import {workbook} from "./xlsx.js";

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
const BUCKETS = [[0, 30, "0–30 gün"], [31, 60, "31–60 gün"], [61, 90, "61–90 gün"], [91, Infinity, "90+ gün"]];
const DEFAULT_MESSAGE = "Sayın {sahip}, {klinik} kliniğimizde {bakiye} TL açık bakiyeniz bulunmaktadır. Ödeme ve bilgi için: {klinik_telefon}";

export function mountDebtReminders(root, api) {
  const {tr} = api;
  const state = {min: "", days: "", text: "", selected: new Set(), message: tr(DEFAULT_MESSAGE), channels: null, preview: null, busy: false, status: "", bucket: -1};
  const lang = document.documentElement.lang || "tr";
  const money = cents => api.money(cents / 100);
  const plain = cents => (cents / 100).toLocaleString("tr-TR", {minimumFractionDigits: 2, maximumFractionDigits: 2});

  const all = api.debtors(); // [{client, name, phone, cents, oldest, count, sms, whatsapp}]
  const age = d => Math.max(0, Math.floor((Date.now() - Date.parse(d + "T12:00:00")) / 86400000));
  for (const d of all) d.age = d.oldest ? age(d.oldest) : 0;

  function filtered() {
    const min = Number(String(state.min).replace(",", ".")) || 0, days = Number(state.days) || 0;
    const q = state.text.toLocaleLowerCase("tr").trim();
    return all.filter(d => d.cents / 100 >= min && d.age >= days && (!q || d.name.toLocaleLowerCase("tr").includes(q) || String(d.phone).includes(q))
      && (state.bucket < 0 || (d.age >= BUCKETS[state.bucket][0] && d.age <= BUCKETS[state.bucket][1])));
  }
  const fill = d => state.message.replace(/\{sahip\}/g, d.name).replace(/\{bakiye\}/g, plain(d.cents)).replace(/\{klinik\}/g, api.clinic().name).replace(/\{klinik_telefon\}/g, api.clinic().phone || "");
  const waLink = d => {
    let phone = String(d.phone).replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "90" + phone.slice(1);
    else if (phone.length === 10) phone = "90" + phone;
    return "https://wa.me/" + phone + "?text=" + encodeURIComponent(fill(d));
  };

  function exportList(rows) {
    const bytes = workbook([{name: tr("Açık bakiyeler"), headers: [tr("Müşteri"), tr("Telefon"), tr("Açık bakiye (TL)"), tr("En eski borç tarihi"), tr("Gün"), tr("Satış sayısı")],
      rows: rows.map(d => [d.name, d.phone, Math.round(d.cents) / 100, d.oldest || "", d.age, d.count])}]);
    const url = URL.createObjectURL(new Blob([bytes], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a = el("a", "", {href: url, download: "acik-bakiyeler-" + new Date().toISOString().slice(0, 10) + ".xlsx"});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function preview() {
    const targets = all.filter(d => state.selected.has(d.client) && d.sms).map(d => ({client: d.client, patient: "", vaccine: ""}));
    if (!targets.length || !state.message.trim()) { state.status = tr("Mesaj metni ve en az bir izinli alıcı seçin."); draw(); return; }
    state.busy = true; state.status = ""; draw();
    try {
      const results = [];
      for (let i = 0; i < targets.length; i += 60) {
        state.status = Math.min(i + 60, targets.length) + " / " + targets.length + " " + tr("alıcı inceleniyor."); draw();
        results.push(...(await api.call("dealer/messages/bulk-preview", {branchId: api.branch(), templateId: "", channel: "sms", message: state.message.trim(), iysfilter: "0", targets: targets.slice(i, i + 60)})).results);
      }
      state.preview = {results, ready: results.filter(r => r.status === "ready"), request: crypto.randomUUID(), confirm: false};
      state.status = "";
    } catch (e) { state.status = e.message; }
    state.busy = false; draw();
  }
  async function send() {
    const p = state.preview;
    if (!p?.ready.length || !p.confirm) return;
    state.busy = true; draw();
    const done = [];
    try {
      for (let i = 0; i < p.ready.length; i += 8) {
        state.status = Math.min(i + 8, p.ready.length) + " / " + p.ready.length + " " + tr("alıcı işleniyor."); draw();
        const chunk = p.ready.slice(i, i + 8).map(({client, patient, vaccine, proof}) => ({client, patient, vaccine, proof}));
        done.push(...(await api.call("dealer/messages/bulk", {branchId: api.branch(), templateId: "", channel: "sms", message: state.message.trim(), iysfilter: "0", requestId: p.request, confirm: true, targets: chunk})).results);
      }
      const queued = done.filter(r => r.status === "queued" || r.status === "sent").length;
      api.toast(tr("Kuyruğa alınan hatırlatma") + ": " + queued);
      state.preview = {...p, results: done, ready: [], sent: true};
      state.status = "";
    } catch (e) { state.status = (done.length ? done.length + " " + tr("alıcı işlendi.") + " " : "") + e.message; }
    state.busy = false; draw();
  }

  function draw() {
    const rows = filtered();
    const total = all.reduce((n, d) => n + d.cents, 0);
    const head = el("div", "", {className: "dr-head"});
    const t = el("div");
    t.append(el("h1", tr("Borç Hatırlatma")), el("p", tr("Açık bakiyesi olan müşterileri yaşlarına göre görün, hatırlatma mesajı gönderin.")));
    const tools = el("div", "", {className: "dr-tools"});
    const ex = el("button", tr("Excel'e aktar"), {type: "button", className: "button"});
    ex.addEventListener("click", () => exportList(rows));
    tools.append(ex);
    head.append(t, tools);

    const tiles = el("div", "", {className: "dr-tiles"});
    const tile = (label, value, tone, index = null) => {
      const b = el(index === null ? "div" : "button", "", {className: "dr-tile"});
      if (index !== null) { b.type = "button"; b.setAttribute("aria-pressed", String(state.bucket === index)); b.addEventListener("click", () => { state.bucket = state.bucket === index ? -1 : index; draw(); }); }
      b.dataset.tone = tone;
      b.append(el("strong", value), el("span", tr(label)));
      tiles.append(b);
    };
    tile("Toplam alacak", money(total), "base");
    tile("Borçlu müşteri", String(all.length), "base");
    BUCKETS.forEach(([lo, hi, label], i) => {
      const part = all.filter(d => d.age >= lo && d.age <= hi);
      tile(label + " · " + part.length, money(part.reduce((n, d) => n + d.cents, 0)), ["ok", "info", "warn", "danger"][i], i);
    });

    const filters = el("div", "", {className: "dr-filters"});
    const input = (label, key, props) => {
      const l = el("label");
      const i = el("input", "", {value: state[key], ...props});
      i.addEventListener("change", () => { state[key] = i.value; draw(); });
      l.append(el("span", tr(label)), i);
      filters.append(l);
    };
    input("Ara", "text", {type: "search", placeholder: tr("Ad veya telefon")});
    input("En az tutar (₺)", "min", {inputMode: "decimal"});
    input("En az gün", "days", {inputMode: "numeric"});

    const eligible = rows.filter(d => d.sms && d.phone);
    const list = el("div", "", {className: "dr-table"});
    const table = el("table");
    const hr = el("tr");
    const allBox = el("input", "", {type: "checkbox", checked: eligible.length > 0 && eligible.every(d => state.selected.has(d.client))});
    allBox.setAttribute("aria-label", tr("Tümünü seç"));
    allBox.addEventListener("change", () => { eligible.forEach(d => allBox.checked ? state.selected.add(d.client) : state.selected.delete(d.client)); state.preview = null; draw(); });
    const th0 = el("th"); th0.append(allBox); hr.append(th0);
    for (const l of ["Müşteri", "Telefon", "Açık bakiye", "En eski borç", "Gün", ""]) hr.append(el("th", l ? tr(l) : ""));
    const thead = el("thead"); thead.append(hr);
    const tbody = el("tbody");
    for (const d of rows.slice(0, 400)) {
      const r = el("tr");
      const cb = el("input", "", {type: "checkbox", checked: state.selected.has(d.client), disabled: !d.sms || !d.phone});
      cb.title = !d.phone ? tr("Telefon yok") : !d.sms ? tr("SMS izni yok") : "";
      cb.addEventListener("change", () => { cb.checked ? state.selected.add(d.client) : state.selected.delete(d.client); state.preview = null; draw(); });
      const c0 = el("td"); c0.append(cb);
      const name = el("td"); const a = el("a", d.name, {href: "#owner/" + encodeURIComponent(d.client)}); a.setAttribute("data-ui-preserve", ""); name.append(a);
      const actions = el("td", "", {className: "dr-actions"});
      if (d.phone) {
        actions.append(el("a", "WhatsApp", {href: waLink(d), target: "_blank", rel: "noopener", className: "button small"}));
        actions.append(el("a", tr("Ara"), {href: "tel:" + String(d.phone).replace(/[^+\d]/g, ""), className: "button small ghost"}));
      }
      const ageCell = el("td", String(d.age));
      ageCell.dataset.bucket = String(BUCKETS.findIndex(([lo, hi]) => d.age >= lo && d.age <= hi));
      r.append(c0, name, el("td", d.phone || "—"), el("td", money(d.cents), {className: "dr-amount"}), el("td", d.oldest ? new Intl.DateTimeFormat(lang, {dateStyle: "medium"}).format(new Date(d.oldest + "T12:00:00")) : "—"), ageCell, actions);
      tbody.append(r);
    }
    table.append(thead, tbody);
    list.append(table);
    const listCard = el("section", "", {className: "dr-card"});
    listCard.append(filters, el("p", tr("Gösterilen") + ": " + rows.length + " · " + tr("Seçili") + ": " + state.selected.size + (rows.length > 400 ? " · " + tr("İlk 400 satır gösteriliyor") : ""), {className: "dr-muted"}), rows.length ? list : el("p", tr("Açık bakiyeli müşteri yok."), {className: "dr-empty"}));

    const compose = el("section", "", {className: "dr-card"});
    compose.append(el("h2", tr("Toplu SMS hatırlatması")));
    if (state.channels && !state.channels.sms) {
      compose.append(el("p", tr("SMS sağlayıcısı bu klinik için bağlı değil. Listedeki WhatsApp düğmeleriyle hatırlatmayı tek tek gönderebilirsiniz."), {className: "dr-note"}));
    } else {
      const label = el("label", "", {className: "dr-message"});
      const ta = el("textarea", "", {rows: 3, maxLength: 900, value: state.message});
      ta.addEventListener("input", () => { state.message = ta.value; state.preview = null; });
      label.append(el("span", tr("Mesaj metni")), ta);
      const chips = el("p", tr("Kullanılabilir alanlar") + ": {sahip} {bakiye} {klinik} {klinik_telefon}", {className: "dr-muted"});
      const sample = all.find(d => state.selected.has(d.client));
      compose.append(label, chips);
      if (sample) compose.append(el("p", tr("Örnek") + ": " + fill(sample), {className: "dr-sample"}));
      const pv = el("button", tr("Önizle") + " (" + all.filter(d => state.selected.has(d.client)).length + ")", {type: "button", className: "button primary", disabled: state.busy || !state.selected.size});
      pv.addEventListener("click", preview);
      compose.append(pv);
      if (state.preview) {
        const p = state.preview;
        const ok = p.results.filter(r => ["ready", "queued", "sent"].includes(r.status)).length, skipped = p.results.length - ok;
        compose.append(el("p", (p.sent ? tr("Gönderim sonucu") : tr("Önizleme")) + ": " + ok + " " + tr("hazır") + (skipped ? " · " + skipped + " " + tr("atlandı") : ""), {className: "dr-note"}));
        const ul = el("ul", "", {className: "dr-results"});
        for (const r of p.results.slice(0, 50)) { const li = el("li"); li.dataset.status = r.status; li.append(el("strong", r.name || "—"), el("span", r.body || r.reason || "")); ul.append(li); }
        compose.append(ul);
        if (!p.sent && p.ready.length) {
          const c = el("label", "", {className: "dr-confirm"});
          const box = el("input", "", {type: "checkbox", checked: p.confirm});
          box.addEventListener("change", () => { p.confirm = box.checked; draw(); });
          c.append(box, el("span", tr("Mesajları kontrol ettim; gönderim kredimden düşülmesini onaylıyorum.")));
          const go = el("button", tr("Gönder") + " (" + p.ready.length + ")", {type: "button", className: "button primary", disabled: !p.confirm || state.busy});
          go.addEventListener("click", send);
          compose.append(c, go);
        }
      }
    }
    if (state.status) compose.append(el("p", state.status, {className: "dr-status", role: "status"}));
    root.replaceChildren(head, tiles, listCard, compose);
  }
  draw();
  api.call("dealer/session").then(s => { state.channels = s.provider || {}; draw(); }).catch(() => { state.channels = {sms: false}; draw(); });
}
