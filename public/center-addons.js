// Merkez yönetimi · Ek paketler: SMS / WhatsApp kredisi, kullanıcı, şube, hasta ve hasta sahibi kaydı, depolama ve "Diğer" ek hizmet paketleri.
// Paketler bayinin Abonelik mağazasında (Ek paketler) satılır; kart (PayTR) ödemesi otomatik, havale "Ödeme Kanalları"ndan onayla krediye dönüşür.
const money = cents => new Intl.NumberFormat("tr-TR", {style: "currency", currency: "TRY"}).format((cents || 0) / 100);
const ORDER = ["sms", "whatsapp", "users", "branches", "patients", "clients", "storage", "other"];
const UNIT = {sms: "adet SMS", whatsapp: "adet mesaj", users: "kullanıcı", branches: "şube", patients: "hasta kaydı", clients: "hasta sahibi kaydı", storage: "GB", other: "adet"};

export async function mountAddonAdmin(content, {call, el, status}) {
  const [{packages, kinds}, orders, partnerData] = await Promise.all([call("addons"), call("saas-orders"), call("partners").catch(() => ({partners: []}))]);
  let rows = packages.map(p => ({...p}));
  const editor = el("div", "", {className: "addon-editor"});
  const input = (value, props = {}) => { const i = el("input", "", props); i.value = value ?? ""; return i; };

  function draw() {
    editor.replaceChildren();
    for (const kind of ORDER) {
      const group = el("section", "", {className: "addon-group"});
      const head = el("header", "", {className: "addon-group-head"});
      head.append(el("h4", kinds[kind] || kind));
      const add = el("button", "+ " + (kinds[kind] || kind) + " paketi ekle", {type: "button", className: "button small"});
      add.addEventListener("click", () => { rows.push({id: "", kind, name: "", quantity: kind === "sms" || kind === "whatsapp" ? 1000 : 1, price: null, vat: "included", active: true, description: ""}); draw(); });
      head.append(add);
      group.append(head);
      const list = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === kind);
      if (!list.length) group.append(el("p", "Bu türde paket yok.", {className: "muted"}));
      for (const [r, i] of list) {
        const card = el("div", "", {className: "addon-row" + (r.active ? "" : " is-off")});
        const name = input(r.name, {maxLength: 80, placeholder: "Paket adı (ör. SMS 1.000)", ariaLabel: "Paket adı"});
        name.addEventListener("input", () => { r.name = name.value; });
        const qty = input(r.quantity, {type: "number", min: 1, max: 10000000, step: 1, ariaLabel: "Adet"});
        qty.addEventListener("input", () => { r.quantity = parseInt(qty.value, 10) || 0; });
        const price = input(r.price != null ? (r.price / 100).toFixed(2) : "", {type: "number", min: 0, step: "0.01", placeholder: "Fiyat (TL)", ariaLabel: "Fiyat TL"});
        price.addEventListener("input", () => { const v = parseFloat(price.value.replace(",", ".")); r.price = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null; });
        const vat = el("select", "", {ariaLabel: "KDV"});
        for (const [v, t] of [["included", "KDV dahil"], ["excluded", "+ KDV"]]) vat.append(el("option", t, {value: v, selected: r.vat === v}));
        vat.addEventListener("change", () => { r.vat = vat.value; });
        const active = el("label", "", {className: "addon-check"});
        const box = el("input", "", {type: "checkbox", checked: !!r.active});
        box.addEventListener("change", () => { r.active = box.checked; card.classList.toggle("is-off", !box.checked); });
        active.append(box, document.createTextNode(" Satışta"));
        const desc = input(r.description, {maxLength: 240, placeholder: "Kısa açıklama (bayi mağazasında görünür)", ariaLabel: "Açıklama"});
        desc.addEventListener("input", () => { r.description = desc.value; });
        const del = el("button", "Sil", {type: "button", className: "button small danger"});
        del.addEventListener("click", () => { rows.splice(i, 1); draw(); });
        const unit = el("span", UNIT[kind] || "", {className: "muted"});
        const q = el("div", "", {className: "addon-qty"}); q.append(qty, unit);
        card.append(name, q, price, vat, active, del, desc);
        group.append(card);
      }
      editor.append(group);
    }
  }
  const save = el("button", "Ek paketleri kaydet", {type: "button", className: "button primary"});
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const r = await call("addons", {packages: rows.map(({id, kind, name, quantity, price, vat, active, description}) => ({id, kind, name: name.trim(), quantity, price, vat, active, description: (description || "").trim()}))});
      rows = r.packages.map(p => ({...p})); draw();
      status.textContent = "Ek paketler kaydedildi. Bayi mağazasında hemen görünür.";
    } catch (e) { status.textContent = e.message; }
    finally { save.disabled = false; }
  });

  // Elle kredi: kampanya, telafi veya düzeltme için bayiye ek kredi tanımlama / düşme.
  const credit = el("form", "", {className: "addon-credit"});
  const partner = el("select", "", {required: true, ariaLabel: "Bayi"});
  partner.append(el("option", "Bayi seçin", {value: ""}));
  for (const p of partnerData.partners || []) partner.append(el("option", p.name + (p.code ? " · " + p.code : ""), {value: p.id}));
  const kind = el("select", "", {ariaLabel: "Tür"});
  for (const k of ORDER) kind.append(el("option", kinds[k] || k, {value: k}));
  const delta = input("", {type: "number", required: true, step: 1, placeholder: "Adet (+ ekler, − düşer)", ariaLabel: "Adet"});
  const reason = input("", {required: true, maxLength: 200, placeholder: "Açıklama (ör. kampanya hediyesi)", ariaLabel: "Açıklama"});
  const go = el("button", "Krediyi kaydet", {type: "submit", className: "button"});
  credit.append(partner, kind, delta, reason, go);
  credit.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const r = await call("addon-credit", {partnerId: partner.value, kind: kind.value, delta: parseInt(delta.value, 10), reason: reason.value.trim()});
      status.textContent = "Kredi kaydedildi. Bayinin " + (kinds[kind.value] || kind.value) + " bakiyesi: " + r.balances[kind.value];
      delta.value = ""; reason.value = "";
    } catch (err) { status.textContent = err.message; }
  });

  const addonOrders = (orders.rows || []).filter(r => r.period === "addon");
  const labels = {pending: "Ödeme bekleniyor", review: "Havale kontrolü", paid: "Ödendi · kredi tanımlandı", failed: "Başarısız", rejected: "Reddedildi"};
  const tbl = el("div", "", {className: "table-wrap"});
  if (addonOrders.length) {
    const t = el("table");
    t.innerHTML = "<thead><tr><th>Tarih</th><th>Bayi</th><th>Paket</th><th>Tutar</th><th>Yöntem</th><th>Durum</th></tr></thead>";
    const body = el("tbody");
    for (const r of addonOrders) {
      const tr = el("tr");
      for (const v of [new Date(r.created_at * 1000).toLocaleString("tr-TR"), r.partner_name || r.partner_id, r.plan_name, money(r.amount), r.method === "card" ? "Kredi kartı" : "EFT / Havale", labels[r.status] || r.status]) tr.append(el("td", v));
      body.append(tr);
    }
    t.append(body); tbl.append(t);
  } else tbl.append(el("p", "Henüz ek paket siparişi yok.", {className: "muted"}));

  draw();
  content.replaceChildren(
    el("h3", "Ek paketler"),
    el("p", "Bayiler aylık SMS / WhatsApp hakkı bittiğinde bu paketlerden alır; ek kredi süresizdir ve aylık hak bittikten sonra kullanılır. Kullanıcı, şube, hasta, hasta sahibi kaydı ve depolama paketleri bayinin paket sınırına eklenir. \"Diğer\" türüyle kurulum, eğitim gibi serbest ek hizmetler satabilirsiniz. Fiyatı boş bırakılan paket satışta görünmez.", {className: "muted"}),
    editor, save,
    el("h3", "Bayiye elle kredi tanımla"), credit,
    el("h3", "Ek paket siparişleri"),
    el("p", "Havale ile ödenen ek paketleri \"Ödeme Kanalları\" sekmesinde tutarı doğrulayıp onaylayın; onayla kredi bayiye otomatik tanımlanır. Kartla ödemeler otomatik onaylanır.", {className: "muted"}),
    tbl);
}
