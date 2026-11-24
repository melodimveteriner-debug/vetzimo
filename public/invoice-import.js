// Faturadan stok girişi: e-Fatura (UBL-TR XML) dosyasını kesin olarak, kâğıt faturanın fotoğrafını yerel OCR ile okur.
// Satırlar mevcut ürünlerle (barkod, kod, ad benzerliği) eşleştirilir; onaydan sonra tedarikçi, yeni ürünler ve
// alış kayıtları tek seferde oluşturulur. Fotoğraf ve XML sunucuya gönderilmez, yalnız sonuç kayıtları kaydedilir.

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
export const norm = v => String(v ?? "").toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
export function money(text) {
  let s = String(text ?? "").replace(/[₺TLtl\s]/g, "");
  if (!s) return NaN;
  if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  return Number(s);
}
const round2 = n => Math.round(n * 100) / 100;

/** UBL-TR e-Fatura/e-Arşiv XML: satıcı, belge no, tarih ve kalemler. */
export function parseUbl(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML dosyası okunamadı.");
  const all = (root, name) => Array.from(root.getElementsByTagNameNS("*", name));
  const first = (root, ...path) => {
    let nodes = [root];
    for (const name of path) { nodes = nodes.flatMap(n => all(n, name).filter(c => c.parentNode === n)); if (!nodes.length) return null; }
    return nodes[0];
  };
  const text = (root, ...path) => first(root, ...path)?.textContent.trim() || "";
  const invoice = doc.documentElement;
  if (!/Invoice$/.test(invoice.localName)) throw new Error("Bu dosya bir e-Fatura (UBL) belgesi değil.");
  const party = first(invoice, "AccountingSupplierParty", "Party");
  const supplier = party ? (text(party, "PartyName", "Name") || [text(party, "Person", "FirstName"), text(party, "Person", "FamilyName")].filter(Boolean).join(" ")) : "";
  const taxId = party ? all(party, "ID").find(n => /VKN|TCKN/i.test(n.getAttribute("schemeID") || ""))?.textContent.trim() || "" : "";
  const lines = all(invoice, "InvoiceLine").filter(n => n.parentNode === invoice).map(line => {
    const item = first(line, "Item");
    const qty = Number(text(line, "InvoicedQuantity")) || 1;
    const unit = Number(text(line, "Price", "PriceAmount"));
    const net = Number(text(line, "LineExtensionAmount"));
    const vat = Number(text(line, "TaxTotal", "TaxSubtotal", "Percent"));
    return {
      name: item ? text(item, "Name") : "",
      code: item ? (text(item, "SellersItemIdentification", "ID") || text(item, "ManufacturersItemIdentification", "ID")) : "",
      barcode: item ? text(item, "StandardItemIdentification", "ID") : "",
      quantity: qty, unitCost: Number.isFinite(unit) && unit > 0 ? unit : (net && qty ? net / qty : 0),
      vat: Number.isFinite(vat) ? vat : 0, total: Number.isFinite(net) && net > 0 ? net : qty * unit, confident: true,
    };
  }).filter(l => l.name);
  if (!lines.length) throw new Error("Faturada ürün satırı bulunamadı.");
  return {supplier, taxId, number: text(invoice, "ID"), date: text(invoice, "IssueDate"), lines, source: "xml"};
}

const SKIP = /toplam|ara top|kdv|vergi|iskonto|indirim|genel|yekun|iban|banka|tarih|fatura no|belge no|vkn|tckn|tel|adres|sayfa|irsaliye|odeme|ödeme|matrah/i;
/** OCR metninden kalem satırları (sezgisel). Miktar × birim ≈ tutar tutan satırlar "güvenilir" işaretlenir. */
export function parseOcr(textIn) {
  const out = {supplier: "", number: "", date: "", lines: [], source: "ocr"};
  const rows = String(textIn).split(/\r?\n/).map(r => r.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  out.supplier = rows.find(r => /[A-Za-zÇĞİÖŞÜçğıöşü]{3}/.test(r) && !/fatura|e-arşiv|e-arsiv/i.test(r)) || "";
  for (const r of rows) {
    const d = r.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
    if (d && !out.date) out.date = `${d[3]}-${d[2]}-${d[1]}`;
    const n = r.match(/(?:fatura|belge)\s*(?:no|numaras[ıi])\s*[:.]?\s*([A-Z0-9]{3,20})/i);
    if (n && !out.number) out.number = n[1];
  }
  const NUMBER = /^(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,4})?|\d+(?:[.,]\d{1,4})?)$/;
  for (const r of rows) {
    if (SKIP.test(r)) continue;
    // Satır sonundaki sayı bloğu (miktar, birim fiyat, KDV, tutar); ürün adı bloğun öncesidir. Ad içinde sayı olabilir.
    const tokens = r.split(" ");
    const tail = [];
    let vat = 0;
    while (tokens.length) {
      const tok = tokens.at(-1).replace(/^(?:₺|TL)|(?:₺|TL)$/gi, "");
      if (tok === "" || /^(?:adet|ad|tl|₺)$/i.test(tokens.at(-1))) { tokens.pop(); continue; }
      const pct = tok.match(/^%?(\d{1,2})%?$/);
      if (/%/.test(tok) && pct) { vat = Number(pct[1]); tokens.pop(); continue; }
      if (!NUMBER.test(tok)) break;
      tail.unshift(money(tok));
      tokens.pop();
    }
    const name = tokens.join(" ").replace(/^\d+[.)]?\s+/, "").replace(/[\s:;*x×-]+$/i, "").trim();
    if (tail.length < 2 || name.length < 3 || !/[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(name)) continue;
    const values = tail.filter(Number.isFinite);
    let quantity = 1, unitCost = 0, total = 0, confident = false;
    for (let i = values.length - 3; i >= 0 && !confident; i--) {
      const [q, u, t] = values.slice(i, i + 3);
      if (q > 0 && q < 100000 && Math.abs(q * u - t) <= Math.max(0.05, t * 0.02)) { quantity = q; unitCost = u; total = t; confident = true; }
    }
    if (!confident) {
      total = values.at(-1) || 0;
      quantity = values.length >= 3 && Number.isInteger(values[0]) && values[0] < 1000 ? values[0] : 1;
      unitCost = quantity ? total / quantity : total;
    }
    if (total <= 0) continue;
    out.lines.push({name, code: "", barcode: (r.match(/\b\d{8,14}\b/) || [""])[0], quantity, unitCost: round2(unitCost), vat, total: round2(total), confident});
  }
  if (!out.lines.length) throw new Error("Fotoğrafta kalem satırı bulunamadı. Daha düz ve net bir fotoğraf deneyin ya da e-Fatura XML dosyasını yükleyin.");
  return out;
}

/** Ürün eşleştirme: barkod/kod kesin, değilse ad kelime benzerliği (Jaccard). */
export function matchProduct(line, products) {
  if (line.barcode) { const p = products.find(x => x.barcode && x.barcode === line.barcode); if (p) return {product: p, score: 1}; }
  if (line.code) { const p = products.find(x => x.sku && norm(x.sku) === norm(line.code)); if (p) return {product: p, score: 1}; }
  const words = new Set(norm(line.name).split(" ").filter(w => w.length > 1));
  let best = null, score = 0;
  for (const p of products) {
    const other = new Set(norm(p.name).split(" ").filter(w => w.length > 1));
    if (!other.size) continue;
    let common = 0;
    for (const w of words) if (other.has(w)) common++;
    const s = common / (words.size + other.size - common || 1);
    if (s > score) { score = s; best = p; }
  }
  return score >= 0.5 ? {product: best, score} : {product: null, score};
}

export function mountInvoiceImport(root, api) {
  const {tr} = api;
  const state = {invoice: null, rows: [], markup: "30", supplierId: "", busy: false, status: "", error: ""};

  function prepare(invoice) {
    const products = api.products();
    state.invoice = invoice;
    state.rows = invoice.lines.map(line => {
      const m = matchProduct(line, products);
      return {...line, include: true, target: m.product ? m.product.id : "new", score: m.score, salePrice: ""};
    });
    const sup = api.suppliers().find(s => norm(s.name) === norm(invoice.supplier)) || api.suppliers().find(s => invoice.supplier && norm(s.name).includes(norm(invoice.supplier).split(" ")[0] || "@"));
    state.supplierId = sup ? sup.id : "new";
    state.error = ""; state.status = "";
    draw();
  }

  async function readFile(file) {
    state.error = ""; state.status = "";
    try {
      if (/\.xml$/i.test(file.name) || file.type.includes("xml")) {
        if (file.size > 10e6) throw new Error(tr("Dosya çok büyük."));
        prepare(parseUbl(await file.text()));
      } else if (file.type.startsWith("image/")) {
        state.busy = true; state.status = tr("Fatura okunuyor… (ilk seferde dil dosyası yükleneceği için biraz sürebilir)"); draw();
        const texts = [].concat(await api.ocr(file, m => { state.status = m; draw(); }));
        state.busy = false;
        // Birden çok okuma geçişinden en çok tutarlı satır (miktar × fiyat = tutar) veren seçilir.
        const score = inv => inv.lines.filter(l => l.confident).length * 10 + inv.lines.length;
        let best = null;
        for (const text of texts) {
          try { const inv = parseOcr(text); inv.raw = text; if (!best || score(inv) > score(best)) best = inv; } catch {}
        }
        if (!best) throw new Error(tr("Fotoğrafta kalem satırı bulunamadı. Daha düz ve net bir fotoğraf deneyin ya da e-Fatura XML dosyasını yükleyin."));
        for (const text of texts) { // Başlık bilgisi eksikse diğer geçişlerden tamamla.
          try { const inv = parseOcr(text); best.number ||= inv.number; best.date ||= inv.date; } catch {}
        }
        prepare(best);
      } else throw new Error(tr("e-Fatura XML dosyası ya da fatura fotoğrafı seçin."));
    } catch (e) { state.busy = false; state.error = e.message; draw(); }
  }

  async function apply() {
    const chosen = state.rows.filter(r => r.include && r.target !== "skip");
    if (!chosen.length) return;
    for (const r of chosen) {
      if (!(r.quantity > 0) || !Number.isInteger(Number(r.quantity))) { state.error = tr("Adetler pozitif tam sayı olmalı") + ": " + r.name; draw(); return; }
      if (!(r.unitCost >= 0)) { state.error = tr("Birim maliyeti kontrol edin") + ": " + r.name; draw(); return; }
    }
    state.busy = true; state.error = ""; draw();
    try {
      const markup = Number(String(state.markup).replace(",", ".")) || 0;
      const result = await api.commit({
        supplier: state.supplierId === "new" ? {name: state.invoice.supplier || tr("Faturadan eklenen tedarikçi"), notes: state.invoice.taxId ? "VKN/TCKN: " + state.invoice.taxId : ""} : {id: state.supplierId},
        invoice: state.invoice.number, date: /^\d{4}-\d{2}-\d{2}$/.test(state.invoice.date) ? state.invoice.date : "",
        lines: chosen.map(r => ({
          product: r.target === "new" ? null : r.target, name: r.name.slice(0, 160), barcode: r.barcode, quantity: Number(r.quantity),
          amount: round2(r.quantity * r.unitCost * (1 + (r.vat || 0) / 100)), vat: r.vat || 0,
          salePrice: r.salePrice !== "" ? money(r.salePrice) : round2(r.unitCost * (1 + markup / 100) * (1 + (r.vat || 0) / 100)),
        })),
      });
      api.toast(tr("Stoğa işlendi") + ": " + result.lines + " " + tr("kalem") + (result.created ? " · " + result.created + " " + tr("yeni ürün") : ""));
      state.invoice = null; state.rows = [];
    } catch (e) { state.error = e.message; }
    state.busy = false; draw();
  }

  function draw() {
    const head = el("div", "", {className: "ii-head"});
    const t = el("div");
    t.append(el("h1", tr("Faturadan Stok Girişi")), el("p", tr("e-Fatura XML dosyasını ya da kâğıt faturanın fotoğrafını yükleyin; kalemleri kontrol edip tek seferde stoğa işleyin.")));
    head.append(t);
    const drop = el("label", "", {className: "ii-drop"});
    const input = el("input", "", {type: "file", accept: ".xml,application/xml,text/xml,image/*", disabled: state.busy});
    input.addEventListener("change", () => input.files[0] && readFile(input.files[0]));
    drop.append(el("strong", tr("Dosya seçin veya buraya bırakın")), el("span", tr("e-Fatura / e-Arşiv XML (kesin) · Fatura fotoğrafı JPG/PNG (yerel OCR, kontrol gerekir)")), input);
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) readFile(f); });
    const parts = [head, drop];
    if (state.status) parts.push(el("p", state.status, {className: "ii-status", role: "status"}));
    if (state.error) parts.push(el("p", state.error, {className: "form-error", role: "alert"}));
    if (state.invoice) {
      const inv = state.invoice;
      const card = el("section", "", {className: "ii-card"});
      const meta = el("div", "", {className: "ii-meta"});
      const sup = el("label");
      const sel = el("select");
      sel.append(el("option", tr("Yeni tedarikçi oluştur") + (inv.supplier ? ": " + inv.supplier : ""), {value: "new"}));
      for (const s of api.suppliers()) sel.append(el("option", s.name, {value: s.id, selected: s.id === state.supplierId}));
      sel.value = state.supplierId;
      sel.addEventListener("change", () => { state.supplierId = sel.value; });
      sup.append(el("span", tr("Tedarikçi")), sel);
      const num = el("label"); const n = el("input", "", {value: inv.number, maxLength: 40}); n.addEventListener("input", () => { inv.number = n.value; }); num.append(el("span", tr("Fatura numarası")), n);
      const dt = el("label"); const d = el("input", "", {type: "date", value: inv.date}); d.addEventListener("input", () => { inv.date = d.value; }); dt.append(el("span", tr("Fatura tarihi")), d);
      const mk = el("label"); const m = el("input", "", {value: state.markup, inputMode: "decimal"}); m.addEventListener("input", () => { state.markup = m.value; draw(); }); mk.append(el("span", tr("Yeni ürünlerde kâr oranı (%)")), m);
      meta.append(sup, num, dt, mk);
      card.append(el("h2", (inv.source === "xml" ? "e-Fatura" : tr("Fotoğraftan okunan fatura")) + " · " + state.rows.length + " " + tr("kalem")), meta);
      if (inv.source === "ocr") card.append(el("p", tr("Fotoğraftan okunan değerleri mutlaka kontrol edin. Sarı satırlarda miktar × fiyat tutarla uyuşmuyor."), {className: "ii-note"}));
      const products = api.products();
      const wrap = el("div", "", {className: "ii-table"});
      const table = el("table");
      const h = el("tr");
      for (const l of ["", "Kalem", "Adet", "Birim maliyet", "KDV %", "Tutar", "Stok ürünü", "Satış fiyatı"]) h.append(el("th", l ? tr(l) : ""));
      const thead = el("thead"); thead.append(h);
      const tbody = el("tbody");
      state.rows.forEach(r => {
        const row = el("tr", "", {className: r.confident ? "" : "ii-check"});
        if (!r.include) row.classList.add("off");
        const cb = el("input", "", {type: "checkbox", checked: r.include});
        cb.addEventListener("change", () => { r.include = cb.checked; draw(); });
        const c0 = el("td"); c0.append(cb);
        const nameCell = el("td");
        const nameInput = el("input", "", {value: r.name, maxLength: 160});
        nameInput.addEventListener("input", () => { r.name = nameInput.value; });
        nameCell.append(nameInput);
        if (r.barcode || r.code) nameCell.append(el("small", [r.barcode, r.code].filter(Boolean).join(" · ")));
        const numCell = (key, step) => { const td = el("td"); const i = el("input", "", {value: String(r[key]), inputMode: "decimal", className: "num"}); i.addEventListener("change", () => { const v = money(i.value); if (Number.isFinite(v)) { r[key] = v; if (key !== "vat") r.total = round2(r.quantity * r.unitCost); r.confident = true; draw(); } }); td.append(i); return td; };
        const target = el("td");
        const s = el("select");
        s.append(el("option", "＋ " + tr("Yeni ürün oluştur"), {value: "new"}), el("option", tr("Bu satırı atla"), {value: "skip"}));
        const suggestions = new Map();
        if (r.target !== "new" && r.target !== "skip") { const p = products.find(x => x.id === r.target); if (p) suggestions.set(p.id, p); }
        const words = norm(r.name).split(" ").filter(w => w.length > 2);
        for (const p of products) { if (suggestions.size >= 12) break; const n2 = norm(p.name); if (words.some(w => n2.includes(w))) suggestions.set(p.id, p); }
        for (const p of suggestions.values()) s.append(el("option", p.name + (p.stock !== undefined ? " (" + tr("stok") + ": " + p.stock + ")" : ""), {value: p.id}));
        s.value = r.target;
        s.addEventListener("change", () => { r.target = s.value; draw(); });
        target.append(s);
        if (r.target !== "new" && r.target !== "skip" && r.score < 1) target.append(el("small", tr("Ad benzerliği") + ": %" + Math.round(r.score * 100)));
        const price = el("td");
        if (r.target === "new") {
          const markup = Number(String(state.markup).replace(",", ".")) || 0;
          const auto = round2(r.unitCost * (1 + markup / 100) * (1 + (r.vat || 0) / 100));
          const pi = el("input", "", {value: r.salePrice, placeholder: String(auto), inputMode: "decimal", className: "num"});
          pi.addEventListener("input", () => { r.salePrice = pi.value; });
          price.append(pi);
        } else price.append(el("span", "—"));
        row.append(c0, nameCell, numCell("quantity"), numCell("unitCost"), numCell("vat"), el("td", api.money(r.quantity * r.unitCost), {className: "num"}), target, price);
        tbody.append(row);
      });
      table.append(thead, tbody);
      wrap.append(table);
      const chosen = state.rows.filter(r => r.include && r.target !== "skip");
      const totalNet = chosen.reduce((a, r) => a + r.quantity * r.unitCost, 0), totalGross = chosen.reduce((a, r) => a + r.quantity * r.unitCost * (1 + (r.vat || 0) / 100), 0);
      const foot = el("div", "", {className: "ii-foot"});
      foot.append(el("span", tr("KDV hariç") + ": " + api.money(totalNet) + " · " + tr("KDV dahil") + ": " + api.money(totalGross)));
      const go = el("button", tr("Stoğa işle") + " (" + chosen.length + ")", {type: "button", className: "button primary", disabled: state.busy || !chosen.length || !api.canWrite});
      go.addEventListener("click", apply);
      const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
      cancel.addEventListener("click", () => { state.invoice = null; draw(); });
      foot.append(cancel, go);
      card.append(wrap, foot);
      if (inv.raw) { const raw = el("details"); raw.append(el("summary", tr("Okunan metni göster")), el("pre", inv.raw)); card.append(raw); }
      parts.push(card);
    }
    root.replaceChildren(...parts);
  }
  draw();
}
