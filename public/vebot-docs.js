// VeBot · belgeden stok: e-Fatura XML (UBL-TR), Excel/CSV veya fotoğraftan alış / fiyat listesi taslağı.
// Her şey tarayıcıda çalışır; kayıt yalnızca kullanıcı taslağı onaylayınca uygulamanın kendi doğrulamasından geçerek yapılır.

const MAX_LINES = 300;
const fold = value => String(value ?? "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
const round2 = value => Math.round(value * 100) / 100;

export function parseNumber(raw) {
  let text = String(raw ?? "").replace(/[₺$€\s]|TL|TRY/gi, "");
  if (!/\d/.test(text)) return NaN;
  const comma = text.lastIndexOf(","), dot = text.lastIndexOf(".");
  if (comma > -1 && dot > -1) text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else if (comma > -1) text = /,\d{3}$/.test(text) && text.split(",").length > 2 ? text.replace(/,/g, "") : text.replace(/\./g, "").replace(",", ".");
  else if (dot > -1 && /^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
}

function isoDate(raw) {
  const text = String(raw ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? "20" + m[3] : m[3];
    const month = m[2].padStart(2, "0"), day = m[1].padStart(2, "0");
    if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= 31) return `${year}-${month}-${day}`;
  }
  m = /^(\d{1,2})[./-](\d{4})$/.exec(text);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, "0")}-28`;
  if (/^\d{5}$/.test(text)) { // Excel seri tarihi
    const date = new Date(Date.UTC(1899, 11, 30) + Number(text) * 864e5);
    return date.toISOString().slice(0, 10);
  }
  return "";
}

const line = (name, qty, unit, extra = {}) => ({
  name: String(name || "").replace(/\s+/g, " ").trim().slice(0, 160),
  qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
  unit: Number.isFinite(unit) && unit >= 0 ? round2(unit) : 0,
  barcode: extra.barcode || "", sku: extra.sku || "", expiry: extra.expiry || "", lot: extra.lot || "",
  checked: extra.checked ?? true,
});

// ---- e-Fatura (UBL-TR) ----
export function linesFromUbl(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error("Güvenli olmayan XML içeriği.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw Error("XML dosyası okunamadı.");
  const all = (root, name) => Array.from(root.getElementsByTagNameNS("*", name));
  const first = (root, path) => {
    let node = root;
    for (const part of path.split("/")) { node = node && all(node, part)[0]; }
    return node?.textContent?.trim() || "";
  };
  const invoiceLines = all(doc, "InvoiceLine").concat(all(doc, "DespatchLine"));
  if (!invoiceLines.length) throw Error("Bu XML dosyasında fatura kalemi bulunamadı.");
  const supplier = first(doc, "AccountingSupplierParty/PartyName/Name") || first(doc, "DespatchSupplierParty/PartyName/Name")
    || [first(doc, "AccountingSupplierParty/Person/FirstName"), first(doc, "AccountingSupplierParty/Person/FamilyName")].filter(Boolean).join(" ");
  const root = doc.documentElement;
  const invoice = Array.from(root.children).find(node => node.localName === "ID")?.textContent?.trim() || "";
  const date = isoDate(Array.from(root.children).find(node => node.localName === "IssueDate")?.textContent);
  const lines = invoiceLines.slice(0, MAX_LINES).map(node => {
    const qty = parseNumber(first(node, "InvoicedQuantity") || first(node, "DeliveredQuantity"));
    const extension = parseNumber(first(node, "LineExtensionAmount"));
    let unit = parseNumber(first(node, "Price/PriceAmount"));
    if (!Number.isFinite(unit) && Number.isFinite(extension) && qty > 0) unit = extension / qty;
    // İskonto varsa satır tutarından birim maliyet hesaplanır.
    if (Number.isFinite(extension) && qty > 0 && Number.isFinite(unit) && Math.abs(unit * qty - extension) > 0.05) unit = extension / qty;
    const item = all(node, "Item")[0] || node;
    const name = first(item, "Name") || first(item, "Description") || first(node, "Note");
    const sku = first(item, "SellersItemIdentification/ID") || first(item, "BuyersItemIdentification/ID");
    const barcode = /^\d{8,14}$/.test(sku) ? sku : (first(item, "StandardItemIdentification/ID").match(/^\d{8,14}$/)?.[0] || "");
    const lot = first(item, "ItemInstance/LotIdentification/LotNumberID") || first(item, "ItemInstance/SerialID");
    const expiry = isoDate(first(item, "ItemInstance/LotIdentification/ExpiryDate") || first(item, "ItemInstance/BestBeforeDate"));
    return line(name, qty, unit, {sku: barcode ? "" : sku, barcode, lot, expiry});
  }).filter(item => item.name);
  return {lines, supplier, invoice, date, source: "xml"};
}

// ---- Excel / CSV ----
const headerAliases = {
  name: ["urun adi", "urun", "malzeme adi", "malzeme", "stok adi", "aciklama", "mal hizmet", "mal/hizmet", "hizmet", "ad", "adi", "name", "product", "item", "description"],
  qty: ["miktar", "adet", "miktari", "qty", "quantity", "amount qty"],
  unit: ["birim fiyat", "birim fiyati", "alis fiyati", "fiyat", "net fiyat", "liste fiyati", "satis fiyati", "price", "unit price", "cost"],
  total: ["tutar", "toplam", "satir tutari", "mal hizmet tutari", "total", "line total"],
  barcode: ["barkod", "barcode", "ean", "gtin"],
  sku: ["stok kodu", "urun kodu", "kod", "malzeme kodu", "sku", "code"],
  expiry: ["skt", "son kullanma", "son kullanma tarihi", "miad", "expiry", "exp"],
  lot: ["lot", "parti", "seri", "seri no", "lot no", "batch"],
};
function columnFor(headers, key) {
  const folded = headers.map(fold);
  for (const alias of headerAliases[key]) {
    const index = folded.findIndex(header => header === alias);
    if (index > -1) return index;
  }
  for (const alias of headerAliases[key]) {
    const index = folded.findIndex(header => header.includes(alias));
    if (index > -1) return index;
  }
  return -1;
}
export function linesFromSheets(sheets) {
  for (const sheet of sheets) {
    const headers = sheet.headers.map(String);
    const col = Object.fromEntries(Object.keys(headerAliases).map(key => [key, columnFor(headers, key)]));
    if (col.name < 0 || (col.unit < 0 && col.total < 0)) continue;
    const lines = [];
    for (const row of sheet.rows) {
      const name = row[col.name];
      if (!name || !/\p{L}{2}/u.test(name)) continue;
      const qty = col.qty > -1 ? parseNumber(row[col.qty]) : 1;
      let unit = col.unit > -1 ? parseNumber(row[col.unit]) : NaN;
      const total = col.total > -1 ? parseNumber(row[col.total]) : NaN;
      if (!Number.isFinite(unit) && Number.isFinite(total)) unit = total / (qty > 0 ? qty : 1);
      const barcode = col.barcode > -1 ? String(row[col.barcode] || "").replace(/\D/g, "") : "";
      lines.push(line(name, qty, unit, {
        barcode: /^\d{8,14}$/.test(barcode) ? barcode : "",
        sku: col.sku > -1 ? String(row[col.sku] || "").trim().slice(0, 60) : "",
        expiry: col.expiry > -1 ? isoDate(row[col.expiry]) : "",
        lot: col.lot > -1 ? String(row[col.lot] || "").trim().slice(0, 60) : "",
      }));
      if (lines.length >= MAX_LINES) break;
    }
    if (lines.length) return {lines, source: "sheet"};
  }
  throw Error("Tabloda ürün adı ve fiyat sütunu bulunamadı. İlk satırda «Ürün», «Miktar», «Birim fiyat» gibi başlıklar olmalı.");
}

// ---- Fotoğraf / serbest metin ----
const skipLine = /\b(ara ?toplam|genel ?toplam|toplam|kdv|iskonto|indirim|odenecek|vergi|v\.?d\.?|vkn|tckn|mersis|fatura|irsaliye|tarih|sayfa|adres|tel|e-?posta|banka|iban|yalniz|ettn|senaryo)\b/;
export function linesFromText(text) {
  const lines = [];
  for (let raw of String(text || "").split(/\r?\n/)) {
    raw = raw.replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
    if (raw.length < 4 || skipLine.test(fold(raw))) continue;
    let expiry = "", barcode = "";
    let rest = raw.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}[./]\d{4}\b/g, match => { expiry ||= isoDate(match); return " "; });
    rest = rest.replace(/\b\d{8,14}\b/g, match => { barcode ||= match; return " "; });
    rest = rest.replace(/(^|\s)(?:%\s?\d{1,2}(?:[.,]\d+)?|\d{1,2}(?:[.,]\d+)?\s?%)(?=\s|$)/g, " ");
    rest = rest.replace(/(\d)(adet|ad|kutu|kt|sise|şişe|paket|pk|doz|amp|flakon)\b/gi, "$1 $2");
    const tokens = rest.split(/\s+/).filter(Boolean);
    const isNum = token => /^\d[\d.,]*$/.test(token) && Number.isFinite(parseNumber(token));
    const isUnit = token => /^(adet|ad|kutu|kt|sise|şişe|paket|pk|kg|gr|g|mg|ml|lt|l|doz|tb|tablet|tbl|amp|flakon|fl)\.?$/i.test(token);
    // Fiyat bloğundan önceki son sözcük ürün adının sonudur.
    let last = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (/\p{L}{2}/u.test(tokens[i]) && !isUnit(tokens[i]) && tokens.slice(i + 1).some(isNum)) last = i;
    }
    if (last < 0) continue;
    const startAt = tokens.length > 1 && /^\d{1,3}[.)]?$/.test(tokens[0]) && last > 0 ? 1 : 0;
    const after = [];
    for (let i = last + 1; i < tokens.length; i++) if (isNum(tokens[i])) after.push({value: parseNumber(tokens[i]), index: i});
    let nameEnd = last + 1, qty = 1, unit = after[after.length - 1]?.value ?? 0, confident = false;
    if (after.length >= 3) {
      const total = after[after.length - 1].value;
      outer: for (let i = 0; i < after.length - 1; i++) for (let j = i + 1; j < after.length - 1; j++) {
        const q = after[i].value, u = after[j].value;
        if (Number.isInteger(q) && q > 0 && q < 100000 && Math.abs(q * u - total) <= Math.max(0.05, total * 0.01)) {
          qty = q; unit = u; confident = true; nameEnd = after[i].index; break outer;
        }
      }
      if (!confident && Number.isInteger(after[0].value) && after[0].value > 0 && after[0].value < 10000) { qty = after[0].value; unit = total / qty; }
    } else if (after.length === 2) {
      if (Number.isInteger(after[0].value) && after[0].value > 0 && after[0].value < 10000) { qty = after[0].value; unit = after[1].value; }
      else unit = after[1].value;
    }
    let nameTokens = tokens.slice(startAt, nameEnd);
    while (nameTokens.length > 1 && isUnit(nameTokens[nameTokens.length - 1]) && !confident) nameTokens.pop();
    const name = nameTokens.join(" ").replace(/^[\s.)-]+|[\s:;,-]+$/g, "").trim();
    if (!/\p{L}{3}/u.test(name)) continue;
    lines.push(line(name, qty, unit, {barcode, expiry, checked: after.length > 0}));
    if (lines.length >= MAX_LINES) break;
  }
  if (!lines.length) throw Error("Belgede ürün satırı okunamadı. Fotoğrafı daha yakından, düz ve aydınlık çekin ya da Excel/XML dosyası ekleyin.");
  const source = String(text || "");
  const invoice = /fatura\s*(?:no|numaras[iı])\s*[:.]?\s*([A-Z0-9][A-Z0-9-]{5,})/i.exec(source)?.[1] || "";
  const date = isoDate(/tarih[i]?\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i.exec(source)?.[1] || "");
  const supplier = source.split(/\r?\n/).map(item => item.trim()).slice(0, 6)
    .find(item => /\b(depo|depos[uü]|ecza|ltd|a\.?\s?ş|tic|san|pazarlama|medikal|veteriner)\b/i.test(item) && !/fatura|tarih/i.test(item)) || "";
  return {lines, invoice, date, supplier: supplier.slice(0, 120), source: "text"};
}

// ---- Ürün eşleştirme ----
const bigrams = text => {
  const value = fold(text).replace(/[^a-z0-9]/g, "");
  const set = new Map();
  for (let i = 0; i < value.length - 1; i++) { const key = value.slice(i, i + 2); set.set(key, (set.get(key) || 0) + 1); }
  return set;
};
function similarity(a, b) {
  const x = bigrams(a), y = bigrams(b);
  let overlap = 0, total = 0;
  for (const [key, count] of x) { overlap += Math.min(count, y.get(key) || 0); total += count; }
  for (const count of y.values()) total += count;
  return total ? 2 * overlap / total : 0;
}
export function matchProducts(lines, products) {
  const active = products.filter(product => product.archived !== "Evet" && product.category !== "Hizmet");
  const byCode = new Map();
  for (const product of active) {
    if (product.barcode) byCode.set("b:" + String(product.barcode).trim(), product);
    if (product.sku) byCode.set("s:" + fold(product.sku), product);
  }
  for (const item of lines) {
    let product = (item.barcode && byCode.get("b:" + item.barcode)) || (item.sku && byCode.get("s:" + fold(item.sku)));
    let score = product ? 1 : 0;
    if (!product) for (const candidate of active) {
      const value = similarity(item.name, candidate.name);
      if (value > score) { score = value; product = candidate; }
    }
    item.product = product && score >= 0.55 ? product.id : "new";
    item.score = item.product === "new" ? 0 : score;
  }
  return lines;
}

export async function readDocument(file, {ocr, readSheets, onStatus = () => {}} = {}) {
  if (!file?.size) throw Error("Dosya boş.");
  if (file.size > 12_000_000) throw Error("En fazla 12 MB boyutunda bir dosya seçin.");
  const name = file.name || "";
  if (/\.xml$/i.test(name) || /xml/.test(file.type)) return linesFromUbl(await file.text());
  if (/\.(xlsx|csv|tsv)$/i.test(name)) return linesFromSheets(await readSheets(file));
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") throw Error("PDF doğrudan okunamıyor. e-Faturanın XML dosyasını ya da sayfanın fotoğrafını veya ekran görüntüsünü ekleyin.");
  if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|bmp)$/i.test(name)) {
    if (typeof ocr !== "function") throw Error("Fotoğraf okuma bu cihazda kullanılamıyor.");
    onStatus("Fotoğraf okunuyor…");
    const text = await ocr(file, onStatus);
    return linesFromText(typeof text === "string" ? text : text?.text || "");
  }
  throw Error("Fotoğraf, e-Fatura XML, Excel (XLSX) veya CSV dosyası seçin.");
}

// ---- Taslak penceresi ----
export function openDocDraft(ctx, parsed, fileName, say) {
  const products = ctx.data("products").filter(product => product.archived !== "Evet" && product.category !== "Hizmet");
  const suppliers = ctx.data("suppliers");
  const productById = new Map(products.map(product => [product.id, product]));
  const lines = matchProducts(parsed.lines, products);
  const locale = document.documentElement.lang || "tr";
  const money = value => new Intl.NumberFormat(locale, {style: "currency", currency: "TRY"}).format(value || 0);
  const canPurchase = ctx.canEdit("purchases") && ctx.canEdit("products");
  const canPrice = ctx.canEdit("products");
  const el = (tag, props = {}, ...children) => {
    const {dataset, ...rest} = props;
    const node = Object.assign(document.createElement(tag), rest);
    if (dataset) Object.assign(node.dataset, dataset);
    for (const child of children) if (child != null && child !== false) node.append(child);
    return node;
  };
  const option = (value, text, selected) => el("option", {value, textContent: text, selected: !!selected});

  const dialog = el("dialog", {className: "vebot-doc"});
  dialog.setAttribute("aria-labelledby", "vebotDocTitle");
  const close = el("button", {type: "button", className: "button small vebot-close", textContent: "×"});
  close.setAttribute("aria-label", "Kapat");
  const modeSelect = el("select", {id: "vebotDocMode"},
    canPurchase ? option("purchase", "Alış faturası · stoğa ekle", true) : null,
    canPrice ? option("price", "Fiyat listesi · satış fiyatlarını güncelle", !canPurchase) : null);
  const matchedSupplier = parsed.supplier && suppliers.find(item => fold(item.name) === fold(parsed.supplier) || similarity(item.name, parsed.supplier) > 0.8);
  const supplierSelect = el("select", {id: "vebotDocSupplier"},
    option("", "Tedarikçi seçin", !matchedSupplier && !parsed.supplier),
    ...suppliers.map(item => option(item.id, item.name, matchedSupplier?.id === item.id)),
    ctx.canEdit("suppliers") ? option("new", "+ Yeni tedarikçi", !matchedSupplier && !!parsed.supplier) : null);
  const supplierName = el("input", {type: "text", id: "vebotDocSupplierName", value: matchedSupplier ? "" : parsed.supplier || "", placeholder: "Firma adı", maxLength: 120});
  const invoiceInput = el("input", {type: "text", id: "vebotDocInvoice", value: parsed.invoice || "", maxLength: 60});
  const dateInput = el("input", {type: "date", id: "vebotDocDate", value: parsed.date || ctx.today()});
  const field = (label, control, extra = "") => el("label", {className: "vebot-doc-field " + extra}, el("span", {textContent: label}), control);
  const supplierField = field("Tedarikçi", supplierSelect);
  const supplierNameField = field("Yeni tedarikçi adı", supplierName);
  const invoiceField = field("Fatura numarası", invoiceInput);
  const dateField = field("Alış tarihi", dateInput);

  const body = el("div", {className: "vebot-doc-rows"});
  const summary = el("p", {className: "vebot-doc-summary", role: "status"});
  const error = el("p", {className: "vebot-doc-error", role: "alert"});
  const save = el("button", {type: "button", className: "button primary", textContent: "Kaydet"});
  const cancel = el("button", {type: "button", className: "button", textContent: "Vazgeç"});
  const productOptions = selected => [
    option("new", "+ Yeni ürün olarak ekle", selected === "new"),
    ...products.map(product => option(product.id, product.name + (product.sku ? " · " + product.sku : ""), selected === product.id)),
  ];

  function renderRows() {
    const mode = modeSelect.value;
    body.replaceChildren(...lines.map((item, index) => {
      const product = productById.get(item.product);
      const row = el("div", {className: "vebot-doc-row" + (item.checked ? "" : " is-off")});
      const check = el("input", {type: "checkbox", checked: item.checked});
      check.setAttribute("aria-label", "Bu kalemi ekle");
      check.addEventListener("change", () => { item.checked = check.checked; row.classList.toggle("is-off", !item.checked); update(); });
      const nameInput = el("input", {type: "text", value: item.name, maxLength: 160});
      nameInput.addEventListener("input", () => { item.name = nameInput.value; });
      const select = el("select", {}, ...productOptions(item.product));
      select.addEventListener("change", () => { item.product = select.value; item.score = 1; renderRows(); update(); });
      const num = (key, step, min, label) => {
        const input = el("input", {type: "number", inputMode: "decimal", step, min, value: item[key] ?? ""});
        input.setAttribute("aria-label", label);
        input.addEventListener("input", () => { item[key] = input.value === "" ? "" : Number(input.value); update(); });
        return field(label, input, "is-num");
      };
      if (item.sale === undefined) item.sale = item.unit;
      const parts = [
        el("div", {className: "vebot-doc-check"}, check, el("small", {textContent: String(index + 1)})),
        field("Belgedeki kalem", nameInput, "is-name"),
        field("Stok ürünü", select, "is-product"),
      ];
      if (item.product !== "new" && item.score < 1) parts.push(el("small", {className: "vebot-doc-hint", textContent: "Benzer ada göre eşleşti, kontrol edin."}));
      if (mode === "purchase") {
        parts.push(num("qty", "1", "1", "Adet"), num("unit", "0.01", "0", "Birim alış (₺)"));
        if (item.product === "new") parts.push(num("sale", "0.01", "0", "Satış fiyatı (₺)"));
        const expiry = el("input", {type: "date", value: item.expiry || ""});
        expiry.addEventListener("input", () => { item.expiry = expiry.value; });
        const lot = el("input", {type: "text", value: item.lot || "", maxLength: 60});
        lot.addEventListener("input", () => { item.lot = lot.value; });
        parts.push(field("SKT", expiry), field("Lot", lot));
        if (product && product.track === "Hayır") parts.push(el("small", {className: "vebot-doc-hint is-warn", textContent: "Bu ürünün stok takibi kapalı; alış eklenemez."}));
      } else {
        parts.push(num("sale", "0.01", "0", "Yeni satış fiyatı (₺)"));
        if (product) parts.push(el("small", {className: "vebot-doc-hint", textContent: "Şu anki fiyat: " + money(Number(product.price))}));
      }
      row.append(...parts);
      return row;
    }));
  }

  const purchasesSeen = ctx.data("purchases");
  const duplicateNote = el("p", {className: "vebot-doc-hint is-warn vebot-doc-dup", hidden: true});
  function update() {
    const mode = modeSelect.value;
    const purchase = mode === "purchase";
    const invoiceNo = fold(invoiceInput.value);
    const seen = purchase && invoiceNo && purchasesSeen.some(item => fold(item.invoice) === invoiceNo);
    duplicateNote.hidden = !seen;
    duplicateNote.textContent = seen ? "Bu fatura numarasıyla daha önce alış kaydedilmiş. Aynı faturayı ikinci kez eklemediğinizden emin olun." : "";
    supplierField.hidden = invoiceField.hidden = dateField.hidden = !purchase;
    supplierNameField.hidden = !purchase || supplierSelect.value !== "new";
    const chosen = lines.filter(item => item.checked);
    const total = chosen.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unit) || 0), 0);
    summary.textContent = purchase ? `${chosen.length} kalem · toplam ${money(round2(total))}` : `${chosen.length} kalem`;
    save.textContent = chosen.length ? `Kaydet (${chosen.length})` : "Kaydet";
    save.disabled = !chosen.length;
  }

  function uniqueSku(taken) {
    for (let i = 0; i < 1000; i++) {
      const sku = "BLG-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      if (!taken.has(fold(sku))) { taken.add(fold(sku)); return sku; }
    }
    throw Error("Stok kodu üretilemedi.");
  }

  async function submit() {
    error.textContent = "";
    const mode = modeSelect.value;
    const chosen = lines.filter(item => item.checked);
    const batch = [];
    const taken = new Set(ctx.data("products").map(product => fold(product.sku)));
    const barcodes = new Set(ctx.data("products").map(product => String(product.barcode || "")).filter(Boolean));
    let supplier = supplierSelect.value;
    try {
      if (mode === "purchase") {
        if (!supplier) throw Error("Tedarikçi seçin.");
        if (supplier === "new") {
          const name = supplierName.value.trim();
          if (!name) throw Error("Yeni tedarikçinin adını yazın.");
          supplier = crypto.randomUUID();
          batch.push(["suppliers", {id: supplier, name}]);
        }
        if (!dateInput.value) throw Error("Alış tarihini girin.");
      }
      chosen.forEach((item, index) => {
        const label = `${index + 1}. ${item.name || "kalem"}`;
        if (!String(item.name || "").trim()) throw Error(label + ": ürün adı boş.");
        let productId = item.product;
        if (productId === "new") {
          const price = Number(item.sale);
          if (!Number.isFinite(price) || price < 0) throw Error(label + ": satış fiyatı geçersiz.");
          productId = crypto.randomUUID();
          const barcode = item.barcode && !barcodes.has(item.barcode) ? item.barcode : "";
          if (barcode) barcodes.add(barcode);
          batch.push(["products", {id: productId, category: "Ürün", name: item.name.trim(), sku: item.sku && !taken.has(fold(item.sku)) ? (taken.add(fold(item.sku)), item.sku) : uniqueSku(taken),
            barcode, price: String(round2(price)), vat: "", taxMode: "KDV Dahil", unit: "Adet", track: "Evet", stock: "0", min: "0"}]);
        } else if (mode === "price") {
          const price = Number(item.sale);
          if (!Number.isFinite(price) || price < 0) throw Error(label + ": fiyat geçersiz.");
          batch.push(["products", {id: productId, price: String(round2(price))}]);
          return;
        }
        if (mode === "purchase") {
          const qty = Number(item.qty), unit = Number(item.unit);
          if (!Number.isInteger(qty) || qty < 1) throw Error(label + ": adet pozitif tam sayı olmalı.");
          const amount = round2(qty * unit);
          if (!(amount >= 0.01)) throw Error(label + ": birim alış fiyatı girin.");
          const existing = productById.get(productId);
          if (existing && existing.track === "Hayır") throw Error(label + ": ürünün stok takibi kapalı.");
          batch.push(["purchases", {date: dateInput.value, supplier, product: productId, quantity: String(qty), amount: amount.toFixed(2),
            invoice: invoiceInput.value.trim(), expiry: item.expiry || "", serial: (item.lot || "").trim(), notes: "VeBot belgeden aktarıldı · " + fileName}]);
        }
      });
      save.disabled = true;
      save.textContent = "Kaydediliyor…";
      await ctx.save(batch, mode === "purchase" ? "Belgeden alış kaydedildi" : "Fiyat listesi uygulandı");
      dialog.close();
      const purchases = batch.filter(([type]) => type === "purchases").length;
      const created = batch.filter(([type, row]) => type === "products" && row.sku).length;
      const updated = batch.filter(([type, row]) => type === "products" && !row.sku).length;
      say(mode === "purchase"
        ? {text: "Belgedeki kalemler kaydedildi.", stats: [["Alış kalemi", String(purchases)], ["Yeni ürün", String(created)]], links: [["Alışları aç", "#purchases"], ["Stoğu aç", "#products"]]}
        : {text: "Fiyat listesi uygulandı.", stats: [["Güncellenen ürün", String(updated)], ["Yeni ürün", String(created)]], links: [["Stoğu aç", "#products"]]});
    } catch (problem) {
      error.textContent = problem?.message || "Kaydedilemedi.";
      update();
    }
  }

  modeSelect.addEventListener("change", () => { renderRows(); update(); });
  supplierSelect.addEventListener("change", update);
  invoiceInput.addEventListener("input", update);
  save.addEventListener("click", submit);
  cancel.addEventListener("click", () => dialog.close());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());

  dialog.append(
    el("header", {className: "vebot-doc-head"},
      el("div", {}, el("h2", {id: "vebotDocTitle", textContent: "Belgeden stok"}), el("small", {textContent: fileName})),
      close),
    el("div", {className: "vebot-doc-controls"}, field("İşlem", modeSelect), supplierField, supplierNameField, invoiceField, dateField),
    duplicateNote,
    el("p", {className: "vebot-note", textContent: "Belgeden okunan değerleri kaydetmeden önce kontrol edin. Hatalı okunan satırların işaretini kaldırabilir veya düzeltebilirsiniz."}),
    body,
    el("footer", {className: "vebot-doc-foot"}, summary, error, el("div", {className: "vebot-doc-actions"}, cancel, save)),
  );
  document.body.append(dialog);
  renderRows();
  update();
  dialog.showModal();
}
