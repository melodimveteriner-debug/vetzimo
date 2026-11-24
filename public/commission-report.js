// Personel prim raporu: satışın "Personel" alanına göre hizmet ve ürün cirosu, prim oranları ve tutarları.
// Oranlar klinik ayarlarında (preferences.commissionRules) saklanır; yalnız yönetici değiştirebilir.
import {workbook} from "./xlsx.js";

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
const num = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseRules(text) {
  try {
    const r = JSON.parse(text || "{}");
    return {service: num(r.service), product: num(r.product), basis: r.basis === "collected" ? "collected" : "sales", staff: r.staff && typeof r.staff === "object" ? r.staff : {}};
  } catch { return {service: 0, product: 0, basis: "sales", staff: {}}; }
}

export function mountCommissionReport(root, api) {
  const {tr} = api;
  const lang = document.documentElement.lang || "tr";
  const now = new Date();
  const state = {
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now),
    rules: parseRules(api.rules()), editing: false, open: null,
  };
  const money = cents => api.money(cents / 100);

  function compute() {
    const {from, to, rules} = state;
    const products = api.productIndex();
    const collected = api.collectedBySale();
    const staff = new Map();
    for (const sale of api.sales()) {
      const date = String(sale.date || "");
      if (date < from || date > to) continue;
      const amount = Math.round(num(sale.amount) * 100);
      if (amount <= 0) continue;
      const assigned = (sale.clinician || "").trim();
      const name = assigned || tr("Atanmamış");
      const lines = api.lines(sale);
      const gross = lines.map(l => Math.max(0, num(l.price) * (num(l.quantity) || 1) - num(l.discountAmount)));
      const sum = gross.reduce((a, b) => a + b, 0);
      let service = 0, product = 0;
      lines.forEach((l, i) => {
        const share = sum > 0 ? gross[i] / sum * amount : amount / lines.length;
        const p = products.get(l.product) || products.get((l.name || "").toLocaleLowerCase("tr"));
        const isService = p ? p.category === "Hizmet" : l.stock === "Hayır";
        if (isService) service += share; else product += share;
      });
      if (!lines.length) service = amount;
      let ratio = 1;
      if (rules.basis === "collected") ratio = Math.min(1, Math.max(0, (Math.round(num(sale.paid) * 100) + (collected.get(sale.id) || 0)) / amount));
      const row = staff.get(name) || {name, count: 0, service: 0, product: 0, total: 0, commission: 0, sales: []};
      const rate = rules.staff[name] || {};
      const sr = rate.service !== undefined && rate.service !== "" ? num(rate.service) : rules.service;
      const pr = rate.product !== undefined && rate.product !== "" ? num(rate.product) : rules.product;
      const c = assigned ? (service * ratio * sr + product * ratio * pr) / 100 : 0; // Personeli girilmemiş satışa prim yazılmaz.
      row.count++; row.service += service * ratio; row.product += product * ratio; row.total += amount * ratio; row.commission += c;
      row.sales.push({id: sale.id, date, client: api.clientName(sale.client), detail: sale.detail || lines.map(l => l.name).filter(Boolean).join(", "), amount: amount * ratio, commission: c});
      row.sr = sr; row.pr = pr;
      staff.set(name, row);
    }
    return [...staff.values()].sort((a, b) => b.commission - a.commission || b.total - a.total);
  }

  function exportRows(rows) {
    const bytes = workbook([
      {name: tr("Prim özeti"), headers: [tr("Personel"), tr("Satış sayısı"), tr("Hizmet cirosu"), tr("Ürün cirosu"), tr("Toplam"), tr("Hizmet primi %"), tr("Ürün primi %"), tr("Prim tutarı")],
        rows: rows.map(r => [r.name, r.count, Math.round(r.service) / 100, Math.round(r.product) / 100, Math.round(r.total) / 100, r.sr, r.pr, Math.round(r.commission) / 100])},
      {name: tr("Satış detayı"), headers: [tr("Personel"), tr("Tarih"), tr("Müşteri"), tr("Açıklama"), tr("Tutar"), tr("Prim")],
        rows: rows.flatMap(r => r.sales.map(s => [r.name, s.date, s.client, s.detail, Math.round(s.amount) / 100, Math.round(s.commission) / 100]))},
    ]);
    const url = URL.createObjectURL(new Blob([bytes], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a = el("a", "", {href: url, download: `prim-raporu-${state.from}-${state.to}.xlsx`});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function rulesEditor(names) {
    const card = el("section", "", {className: "cr-card"});
    card.append(el("h2", tr("Prim oranları")));
    const form = el("form", "", {className: "cr-rules"});
    const field = (label, value, name) => { const l = el("label"); const i = el("input", "", {name, value: String(value ?? ""), inputMode: "decimal", placeholder: "%"}); l.append(el("span", tr(label)), i); return l; };
    const base = el("div", "", {className: "cr-grid"});
    const basis = el("label");
    const sel = el("select", "", {name: "basis"});
    for (const [k, l] of [["sales", "Satış tutarı üzerinden"], ["collected", "Yalnız tahsil edilen tutar üzerinden"]]) sel.append(el("option", tr(l), {value: k, selected: state.rules.basis === k}));
    basis.append(el("span", tr("Hesaplama")), sel);
    base.append(field("Hizmet primi (%)", state.rules.service, "service"), field("Ürün primi (%)", state.rules.product, "product"), basis);
    const table = el("table", "", {className: "cr-staff-rates"});
    const h = el("tr"); for (const l of ["Personel", "Hizmet primi (%)", "Ürün primi (%)"]) h.append(el("th", tr(l)));
    table.append(h);
    for (const n of names) {
      const r = el("tr"), rate = state.rules.staff[n] || {};
      const c = el("td", n); c.setAttribute("data-ui-preserve", "");
      const s = el("input", "", {value: rate.service ?? "", placeholder: tr("Genel"), inputMode: "decimal"}); s.dataset.staff = n; s.dataset.kind = "service";
      const p = el("input", "", {value: rate.product ?? "", placeholder: tr("Genel"), inputMode: "decimal"}); p.dataset.staff = n; p.dataset.kind = "product";
      const ts = el("td"); ts.append(s); const tp = el("td"); tp.append(p);
      r.append(c, ts, tp); table.append(r);
    }
    const error = el("p", "", {className: "form-error", role: "alert"});
    const save = el("button", tr("Oranları kaydet"), {type: "submit", className: "button primary"});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
    cancel.addEventListener("click", () => { state.editing = false; draw(); });
    const actions = el("div", "", {className: "cr-actions"}); actions.append(save, cancel);
    form.append(base, el("p", tr("Boş bırakılan personel oranlarında genel oran uygulanır."), {className: "cr-muted"}), el("div", "", {className: "cr-table"}), error, actions);
    form.querySelector(".cr-table").append(table);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const valid = v => v === "" || (/^\d{1,2}([.,]\d{1,2})?$/.test(v) && num(v) <= 100);
      const next = {service: form.elements.service.value.trim(), product: form.elements.product.value.trim(), basis: sel.value, staff: {}};
      if (![next.service, next.product].every(valid)) { error.textContent = tr("Oranlar 0 ile 100 arasında olmalı."); return; }
      for (const i of form.querySelectorAll("input[data-staff]")) {
        const v = i.value.trim();
        if (!valid(v)) { error.textContent = tr("Oranlar 0 ile 100 arasında olmalı."); i.focus(); return; }
        if (v !== "") (next.staff[i.dataset.staff] ||= {})[i.dataset.kind] = v.replace(",", ".");
      }
      next.service = num(next.service); next.product = num(next.product);
      const text = JSON.stringify(next);
      if (text.length > 4000) { error.textContent = tr("Çok fazla personel oranı var."); return; }
      save.disabled = true;
      try { await api.saveRules(text); state.rules = parseRules(text); state.editing = false; api.toast(tr("Prim oranları kaydedildi.")); draw(); }
      catch (x) { error.textContent = x.message; save.disabled = false; }
    });
    card.append(form);
    return card;
  }

  function draw() {
    const rows = compute();
    const head = el("div", "", {className: "cr-head"});
    const t = el("div");
    t.append(el("h1", tr("Personel Prim Raporu")), el("p", tr("Satışlardaki 'Personel' alanına göre hizmet ve ürün cirosu ile prim tutarları.")));
    const tools = el("div", "", {className: "cr-tools"});
    const from = el("input", "", {type: "date", value: state.from}), to = el("input", "", {type: "date", value: state.to});
    from.addEventListener("change", () => { state.from = from.value; draw(); });
    to.addEventListener("change", () => { state.to = to.value; draw(); });
    const preset = (label, f, t2) => { const b = el("button", tr(label), {type: "button", className: "button small"}); b.addEventListener("click", () => { state.from = iso(f); state.to = iso(t2); draw(); }); return b; };
    const y = now.getFullYear(), m = now.getMonth();
    const dates = el("div", "", {className: "cr-dates"});
    dates.append(from, el("span", "–"), to, preset("Bu ay", new Date(y, m, 1), now), preset("Geçen ay", new Date(y, m - 1, 1), new Date(y, m, 0)), preset("Bu yıl", new Date(y, 0, 1), now));
    const ex = el("button", tr("Excel'e aktar"), {type: "button", className: "button"});
    ex.addEventListener("click", () => exportRows(rows));
    tools.append(ex);
    if (api.canEditRules && !state.editing) { const ed = el("button", tr("Prim oranlarını düzenle"), {type: "button", className: "button"}); ed.addEventListener("click", () => { state.editing = true; draw(); }); tools.append(ed); }
    head.append(t, tools);

    const totals = rows.reduce((a, r) => ({total: a.total + r.total, commission: a.commission + r.commission, count: a.count + r.count}), {total: 0, commission: 0, count: 0});
    const tiles = el("div", "", {className: "cr-tiles"});
    const tile = (label, value) => { const d = el("div", "", {className: "cr-tile"}); d.append(el("strong", value), el("span", tr(label))); tiles.append(d); };
    tile("Toplam ciro", money(totals.total)); tile("Toplam prim", money(totals.commission)); tile("Satış sayısı", String(totals.count)); tile("Personel", String(rows.length));
    const unassigned = rows.find(r => r.name === tr("Atanmamış"));
    const rateNote = el("p", (unassigned ? tr("Personeli girilmemiş satışlara prim hesaplanmaz.") + " " : "") + tr("Genel oran") + ": " + tr("Hizmet") + " %" + state.rules.service + " · " + tr("Ürün") + " %" + state.rules.product + " · " + tr(state.rules.basis === "collected" ? "Yalnız tahsil edilen tutar üzerinden" : "Satış tutarı üzerinden"), {className: "cr-muted"});

    const card = el("section", "", {className: "cr-card"});
    if (!rows.length) card.append(el("p", tr("Bu dönemde satış yok."), {className: "cr-empty"}));
    else {
      const max = Math.max(...rows.map(r => r.total), 1);
      const list = el("div", "", {className: "cr-table"});
      const table = el("table");
      const h = el("tr"); for (const l of ["Personel", "Satış", "Hizmet cirosu", "Ürün cirosu", "Toplam", "Prim"]) h.append(el("th", tr(l)));
      const thead = el("thead"); thead.append(h);
      const tbody = el("tbody");
      for (const r of rows) {
        const tr0 = el("tr", "", {className: "cr-row"});
        const name = el("td");
        const b = el("button", r.name, {type: "button", className: "cr-name"});
        b.setAttribute("aria-expanded", String(state.open === r.name));
        b.setAttribute("data-ui-preserve", "");
        b.addEventListener("click", () => { state.open = state.open === r.name ? null : r.name; draw(); });
        const bar = el("i", "", {className: "cr-bar"}); bar.style.width = (r.total / max * 100).toFixed(1) + "%";
        name.append(b, bar);
        tr0.append(name, el("td", String(r.count)), el("td", money(r.service)), el("td", money(r.product)), el("td", money(r.total)), el("td", money(r.commission), {className: "cr-commission"}));
        tbody.append(tr0);
        if (state.open === r.name) {
          const d = el("tr", "", {className: "cr-detail"}); const td = el("td"); td.colSpan = 6;
          const ul = el("ul");
          for (const s of [...r.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200)) {
            const li = el("li");
            li.append(el("span", new Intl.DateTimeFormat(lang, {dateStyle: "medium"}).format(new Date(s.date + "T12:00:00"))), el("span", [s.client, s.detail].filter(Boolean).join(" · ")), el("strong", money(s.amount)), el("em", money(s.commission)));
            li.children[1].setAttribute("data-ui-preserve", "");
            ul.append(li);
          }
          td.append(ul); d.append(td); tbody.append(d);
        }
      }
      table.append(thead, tbody);
      list.append(table);
      card.append(list);
    }
    const parts = [head, el("div", "", {className: "cr-dates-wrap"}), tiles, rateNote];
    parts[1].append(dates);
    if (state.editing) parts.push(rulesEditor([...new Set([...api.staffNames(), ...rows.map(r => r.name)])].filter(n => n !== tr("Atanmamış")).sort((a, b) => a.localeCompare(b, "tr"))));
    parts.push(card);
    root.replaceChildren(...parts);
  }
  draw();
}
