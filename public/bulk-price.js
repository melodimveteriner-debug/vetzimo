// Toplu fiyat güncelleme: filtreye göre yüzde/tutar/sabit fiyat değişikliği, yuvarlama, önizleme ve geri alma.
// Ayrıca fiyat listesini Excel'e verir ve "Yeni fiyat" sütunu doldurulmuş Excel/CSV dosyasından fiyatları günceller.
import {workbook} from "./xlsx.js";
import {readMigrationFile} from "./migration-file.js";

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
const norm = v => String(v ?? "").toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const parseMoney = v => {
  let s = String(v ?? "").replace(/[₺\s]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
};
const ROUND = [["none", "Yuvarlama yok"], ["0.5", "En yakın 0,50 ₺"], ["1", "En yakın 1 ₺"], ["5", "En yakın 5 ₺"], ["10", "En yakın 10 ₺"], ["90", "Küsuratı ,90 olsun"]];
function round(value, mode) {
  if (mode === "none") return Math.round(value * 100) / 100;
  if (mode === "90") return Math.max(0.9, Math.floor(value) + 0.9);
  const step = Number(mode);
  return Math.max(0, Math.round(value / step) * step);
}
const store = v => String(Math.round(v * 100) / 100);

let lastBatch = null; // Oturum boyunca son toplu değişiklik (geri almak için).

export function mountBulkPrice(root, api) {
  const {tr} = api;
  const money = v => api.money(v);
  const state = {category: "", brand: "", family: "", text: "", mode: "percent", amount: "", rounding: "none", excluded: new Set(), imported: null, confirm: false};

  const products = () => api.products().filter(p => p.archived !== "Evet");
  function matches(p) {
    if (state.category && p.category !== state.category) return false;
    if (state.brand && (p.brand || "") !== state.brand) return false;
    if (state.family && (p.family || "") !== state.family) return false;
    if (state.text) { const q = norm(state.text); if (![p.name, p.sku, p.barcode].some(v => norm(v).includes(q))) return false; }
    return true;
  }
  function plan() {
    if (state.imported) return state.imported;
    const amount = parseMoney(state.amount);
    if (amount === null) return [];
    return products().filter(matches).map(p => {
      const old = parseMoney(p.price) ?? 0;
      let next = state.mode === "percent" ? old * (1 + amount / 100) : state.mode === "add" ? old + amount : amount;
      next = round(Math.max(0, next), state.rounding);
      return {product: p, old, next};
    }).filter(r => Math.abs(r.next - r.old) >= 0.005);
  }

  function select(label, key, values) {
    const wrap = el("label", "", {className: "bp-field"});
    const s = el("select");
    s.append(el("option", tr("Tümü"), {value: ""}));
    for (const v of values) s.append(el("option", tr(v), {value: v, selected: state[key] === v}));
    s.addEventListener("change", () => { state[key] = s.value; state.excluded.clear(); state.confirm = false; draw(); });
    wrap.append(el("span", tr(label)), s);
    return wrap;
  }
  const distinct = key => [...new Set(products().map(p => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));

  async function apply(rows, action) {
    const chosen = rows.filter(r => !state.excluded.has(r.product.id));
    if (!chosen.length) return;
    const undo = chosen.map(r => ({id: r.product.id, from: store(r.next), to: r.product.price}));
    try {
      await api.save(chosen.map(r => ({prior: r.product, next: {...r.product, price: store(r.next)}})), tr(action) + " (" + chosen.length + ")");
      lastBatch = undo;
      api.toast(tr("Fiyatlar güncellendi") + ": " + chosen.length);
      state.imported = null; state.excluded.clear(); state.confirm = false; state.amount = "";
      draw();
    } catch (e) { api.toast(e.message); }
  }
  async function undo() {
    if (!lastBatch) return;
    const rows = [];
    for (const u of lastBatch) {
      const p = api.find(u.id);
      if (p && p.price === u.from) rows.push({prior: p, next: {...p, price: u.to}});
    }
    if (!rows.length) { lastBatch = null; draw(); return; }
    try { await api.save(rows, tr("Toplu fiyat değişikliği geri alındı") + " (" + rows.length + ")"); lastBatch = null; api.toast(tr("Geri alındı")); draw(); }
    catch (e) { api.toast(e.message); }
  }

  function exportList() {
    const list = products().filter(matches).sort((a, b) => a.name.localeCompare(b.name, "tr"));
    const bytes = workbook([{name: tr("Fiyat listesi"), headers: [tr("Stok kodu"), tr("Barkod"), tr("Ürün / hizmet adı"), tr("Ürün türü"), tr("Marka"), tr("Mevcut fiyat"), tr("Yeni fiyat")],
      rows: list.map(p => [p.sku || "", p.barcode || "", p.name, p.category || "", p.brand || "", parseMoney(p.price) ?? 0, ""])}]);
    const url = URL.createObjectURL(new Blob([bytes], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a = el("a", "", {href: url, download: "fiyat-listesi-" + new Date().toISOString().slice(0, 10) + ".xlsx"});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function importFile(file, error) {
    error.textContent = "";
    try {
      const sheets = await readMigrationFile(file);
      const sheet = sheets[0];
      if (!sheet) throw new Error(tr("Dosyada okunabilir bir tablo bulunamadı."));
      const h = sheet.headers.map(norm);
      const col = names => h.findIndex(x => names.some(n => x === norm(n)));
      const sku = col(["Stok kodu", "SKU", "Kod"]), barcode = col(["Barkod", "Barkod kodu", "Barcode"]), name = col(["Ürün / hizmet adı", "Ürün adı", "Ad", "Name"]);
      const price = col(["Yeni fiyat", "New price", "Fiyat", "Satış fiyatı", "Birim satış fiyatı (₺)"]);
      if (price < 0 || (sku < 0 && barcode < 0 && name < 0)) throw new Error(tr("Dosyada 'Yeni fiyat' ve 'Stok kodu', 'Barkod' ya da 'Ürün adı' sütunları olmalı."));
      const list = products(), bySku = new Map(), byBarcode = new Map(), byName = new Map();
      for (const p of list) { if (p.sku) bySku.set(norm(p.sku), p); if (p.barcode) byBarcode.set(norm(p.barcode), p); byName.set(norm(p.name), p); }
      const rows = [], seen = new Set();
      let unmatched = 0, invalid = 0;
      for (const r of sheet.rows) {
        const value = parseMoney(r[price]);
        if (r[price] === undefined || String(r[price]).trim() === "") continue;
        if (value === null || value < 0 || value > 10_000_000) { invalid++; continue; }
        const p = (sku >= 0 && bySku.get(norm(r[sku]))) || (barcode >= 0 && r[barcode] && byBarcode.get(norm(r[barcode]))) || (name >= 0 && byName.get(norm(r[name])));
        if (!p) { unmatched++; continue; }
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const old = parseMoney(p.price) ?? 0, next = Math.round(value * 100) / 100;
        if (Math.abs(next - old) >= 0.005) rows.push({product: p, old, next});
      }
      state.imported = rows; state.excluded.clear(); state.confirm = false;
      state.importNote = [tr("Eşleşen değişiklik") + ": " + rows.length, unmatched ? tr("Eşleşmeyen satır") + ": " + unmatched : "", invalid ? tr("Geçersiz fiyat") + ": " + invalid : ""].filter(Boolean).join(" · ");
      draw();
    } catch (e) { error.textContent = e.message; }
  }

  function draw() {
    const rows = plan();
    const head = el("div", "", {className: "bp-head"});
    const titles = el("div");
    titles.append(el("h1", tr("Toplu Fiyat Güncelleme")), el("p", tr("Seçtiğiniz ürün ve hizmetlerin satış fiyatlarını tek seferde güncelleyin. Kaydetmeden önce tüm değişiklikleri görürsünüz.")));
    const tools = el("div", "", {className: "bp-tools"});
    const exp = el("button", tr("Fiyat listesini Excel'e aktar"), {type: "button", className: "button"});
    exp.addEventListener("click", exportList);
    tools.append(exp);
    if (lastBatch && api.canWrite) { const u = el("button", tr("Son değişikliği geri al"), {type: "button", className: "button"}); u.addEventListener("click", undo); tools.append(u); }
    head.append(titles, tools);

    const filters = el("section", "", {className: "bp-card"});
    filters.append(el("h2", tr("1. Hangi ürünler?")));
    const fg = el("div", "", {className: "bp-grid"});
    const search = el("label", "", {className: "bp-field"});
    const q = el("input", "", {type: "search", value: state.text, placeholder: tr("Ad, stok kodu veya barkod")});
    q.addEventListener("change", () => { state.text = q.value; state.excluded.clear(); draw(); });
    search.append(el("span", tr("Ara")), q);
    fg.append(select("Ürün türü", "category", distinct("category")), select("Marka", "brand", distinct("brand")), select("Kategori", "family", distinct("family")), search);
    filters.append(fg, el("p", tr("Filtreye uyan ürün") + ": " + products().filter(matches).length, {className: "bp-muted"}));

    const change = el("section", "", {className: "bp-card"});
    change.append(el("h2", tr("2. Nasıl değişsin?")));
    const cg = el("div", "", {className: "bp-grid"});
    const modeWrap = el("div", "", {className: "bp-modes", role: "radiogroup"});
    for (const [k, l] of [["percent", "Yüzde (%)"], ["add", "Tutar ekle / çıkar (₺)"], ["set", "Sabit fiyat (₺)"]]) {
      const b = el("button", tr(l), {type: "button"});
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(state.mode === k));
      b.addEventListener("click", () => { state.mode = k; state.imported = null; draw(); });
      modeWrap.append(b);
    }
    const amountWrap = el("label", "", {className: "bp-field"});
    const amount = el("input", "", {inputMode: "decimal", value: state.amount, placeholder: state.mode === "percent" ? "10 / -5" : state.mode === "add" ? "25 / -10" : "350"});
    amount.addEventListener("input", () => { state.amount = amount.value; state.imported = null; state.confirm = false; clearTimeout(amount.t); amount.t = setTimeout(draw, 350); });
    amountWrap.append(el("span", tr(state.mode === "percent" ? "Artış / indirim yüzdesi" : state.mode === "add" ? "Eklenecek tutar (eksi: indirim)" : "Yeni fiyat")), amount);
    const roundWrap = el("label", "", {className: "bp-field"});
    const r = el("select");
    for (const [k, l] of ROUND) r.append(el("option", tr(l), {value: k, selected: state.rounding === k}));
    r.addEventListener("change", () => { state.rounding = r.value; draw(); });
    roundWrap.append(el("span", tr("Yuvarlama")), r);
    cg.append(amountWrap, roundWrap);
    const importWrap = el("details", "", {className: "bp-import", open: !!state.imported});
    const file = el("input", "", {type: "file", accept: ".xlsx,.csv,.tsv"});
    const ierr = el("p", "", {className: "form-error", role: "alert"});
    file.addEventListener("change", () => file.files[0] && importFile(file.files[0], ierr));
    importWrap.append(el("summary", tr("Ya da Excel dosyasından fiyat yükleyin")),
      el("p", tr("Fiyat listesini Excel'e aktarın, 'Yeni fiyat' sütununu doldurun ve dosyayı buradan seçin. Ürünler stok kodu, barkod ya da adla eşleştirilir."), {className: "bp-muted"}), file, ierr);
    if (state.imported) {
      const clear = el("button", tr("Dosyayı bırak, filtreye dön"), {type: "button", className: "button small"});
      clear.addEventListener("click", () => { state.imported = null; draw(); });
      importWrap.append(el("p", state.importNote || "", {className: "bp-note"}), clear);
    }
    change.append(modeWrap, cg, importWrap);

    const preview = el("section", "", {className: "bp-card"});
    const chosen = rows.filter(x => !state.excluded.has(x.product.id));
    const before = chosen.reduce((n, x) => n + x.old, 0), after = chosen.reduce((n, x) => n + x.next, 0);
    preview.append(el("h2", tr("3. Önizleme ve onay")));
    if (!rows.length) preview.append(el("p", tr(state.imported ? "Dosyada güncellenecek fiyat bulunamadı." : "Değişiklik görmek için bir oran veya tutar girin."), {className: "bp-muted"}));
    else {
      const sum = el("div", "", {className: "bp-summary"});
      const stat = (label, value) => { const d = el("div"); d.append(el("span", tr(label)), el("strong", value)); sum.append(d); };
      stat("Değişecek ürün", String(chosen.length));
      stat("Ortalama değişim", before ? ((after / before - 1) * 100).toLocaleString(document.documentElement.lang || "tr", {maximumFractionDigits: 1}) + " %" : "—");
      stat("Fiyat toplamı", money(before) + " → " + money(after));
      const wrap = el("div", "", {className: "bp-table"});
      const table = el("table");
      const thead = el("thead"), tr0 = el("tr");
      const all = el("input", "", {type: "checkbox", checked: chosen.length === rows.length});
      all.setAttribute("aria-label", tr("Tümünü seç"));
      all.addEventListener("change", () => { if (all.checked) state.excluded.clear(); else rows.forEach(x => state.excluded.add(x.product.id)); state.confirm = false; draw(); });
      const th = el("th"); th.append(all); tr0.append(th);
      for (const l of ["Ürün / hizmet adı", "Stok kodu", "Mevcut fiyat", "Yeni fiyat", "Fark"]) tr0.append(el("th", tr(l)));
      thead.append(tr0);
      const tbody = el("tbody");
      for (const x of rows.slice(0, 500)) {
        const row = el("tr");
        const cb = el("input", "", {type: "checkbox", checked: !state.excluded.has(x.product.id)});
        cb.addEventListener("change", () => { cb.checked ? state.excluded.delete(x.product.id) : state.excluded.add(x.product.id); state.confirm = false; draw(); });
        const c0 = el("td"); c0.append(cb);
        const name = el("td", x.product.name); name.setAttribute("data-ui-preserve", ""); name.dir = "auto";
        const diff = x.next - x.old;
        const d = el("td", (diff > 0 ? "+" : "") + money(diff), {className: diff > 0 ? "up" : "down"});
        row.append(c0, name, el("td", x.product.sku || ""), el("td", money(x.old)), el("td", money(x.next), {className: "bp-new"}), d);
        if (state.excluded.has(x.product.id)) row.className = "off";
        tbody.append(row);
      }
      table.append(thead, tbody);
      wrap.append(table);
      preview.append(sum, wrap);
      if (rows.length > 500) preview.append(el("p", tr("İlk 500 satır gösteriliyor; tümü uygulanır."), {className: "bp-muted"}));
      if (api.canWrite) {
        const go = el("button", tr(state.confirm ? "Onaylıyorum, fiyatları güncelle" : "Fiyatları güncelle") + " (" + chosen.length + ")", {type: "button", className: "button " + (state.confirm ? "danger" : "primary"), disabled: !chosen.length});
        go.addEventListener("click", () => {
          if (!state.confirm) { state.confirm = true; draw(); return; }
          go.disabled = true;
          apply(rows, state.imported ? "Excel'den fiyat güncellendi" : "Toplu fiyat güncellendi");
        });
        preview.append(go);
        if (state.confirm) preview.append(el("p", tr("Bu işlem seçili ürünlerin satış fiyatlarını değiştirir. Gerekirse 'Son değişikliği geri al' ile geri dönebilirsiniz."), {className: "bp-note"}));
      }
    }
    const focus = document.activeElement?.closest?.(".bp-field") && document.activeElement.tagName === "INPUT" ? {ph: document.activeElement.placeholder, pos: document.activeElement.selectionStart} : null;
    root.replaceChildren(head, filters, change, preview);
    if (focus) { const i = [...root.querySelectorAll(".bp-field input")].find(x => x.placeholder === focus.ph); if (i) { i.focus(); try { i.setSelectionRange(focus.pos, focus.pos); } catch {} } }
  }
  draw();
}
