// Web Mesajları: klinik web sitesinin iletişim formundan gelenler. Telefon veya e-postaya göre müşteri kartı
// önerilir; mesaj ziyaretçi kaydına dönüştürülebilir, müşteri kartına bağlanabilir ve "işlendi" olarak kapatılır.

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
const digits = v => String(v || "").replace(/\D/g, "").replace(/^(90|0)/, "").slice(-10);

export function mountWebInbox(root, api) {
  const {tr} = api;
  const lang = document.documentElement.lang || "tr";
  const ui = {filter: "open", items: [], open: 0, loading: true, error: "", unavailable: false, linking: null};

  async function request(body) {
    const r = await api.fetch("/api/web-inbox" + (body ? "" : "?durum=" + ui.filter), body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || tr("Sunucu isteği tamamlayamadı."));
    return data;
  }
  async function load() {
    ui.loading = true; draw();
    try { const d = await request(); ui.items = d.items || []; ui.open = d.open || 0; ui.unavailable = !!d.unavailable; ui.error = ""; }
    catch (e) { ui.error = e.message; }
    ui.loading = false; draw();
  }
  async function act(body, message) {
    try { await request(body); if (message) api.toast(tr(message)); await load(); }
    catch (e) { api.toast(e.message); }
  }

  function card(m) {
    const article = el("article", "", {className: "wi-item"});
    article.dataset.state = m.handledAt ? "done" : "open";
    const head = el("header");
    const who = el("div");
    const name = el("strong", m.name); name.setAttribute("data-ui-preserve", "");
    who.append(name, el("span", [m.email, m.phone].filter(Boolean).join(" · ")));
    const when = el("time", new Intl.DateTimeFormat(lang, {dateStyle: "medium", timeStyle: "short"}).format(new Date(String(m.createdAt).replace(" ", "T") + "Z")));
    head.append(who, when);
    const body = el("p", m.body, {className: "wi-body"}); body.setAttribute("data-ui-preserve", ""); body.dir = "auto";
    article.append(head, body);

    const linked = m.client ? api.client(m.client) : null;
    const match = linked ? null : api.match(m.phone, m.email);
    const links = el("div", "", {className: "wi-match"});
    if (linked) {
      links.append(el("span", "🔗 " + tr("Bağlı müşteri") + ": "), el("a", linked.name, {href: "#owner/" + encodeURIComponent(linked.id)}));
      if (api.canWrite) { const un = el("button", tr("Bağlantıyı kaldır"), {type: "button", className: "button small ghost"}); un.addEventListener("click", () => act({action: "link", id: m.id, client: ""})); links.append(un); }
    } else if (match.length) {
      links.append(el("span", tr("Olası müşteri kartı") + ": "));
      for (const c of match.slice(0, 3)) {
        const a = el("a", c.name + (c.phone ? " · " + c.phone : ""), {href: "#owner/" + encodeURIComponent(c.id)});
        a.setAttribute("data-ui-preserve", "");
        links.append(a);
        if (api.canWrite) { const b = el("button", tr("Bağla"), {type: "button", className: "button small"}); b.addEventListener("click", () => act({action: "link", id: m.id, client: c.id}, "Mesaj müşteri kartına bağlandı.")); links.append(b); }
      }
    } else links.append(el("span", tr("Kayıtlı müşteri bulunamadı."), {className: "wi-muted"}));
    article.append(links);

    if (ui.linking === m.id) {
      const box = el("div", "", {className: "wi-search"});
      const input = el("input", "", {type: "search", placeholder: tr("Müşteri adı veya telefon")});
      const results = el("div");
      input.addEventListener("input", () => {
        results.replaceChildren(...api.search(input.value).map(c => {
          const b = el("button", c.name + (c.phone ? " · " + c.phone : ""), {type: "button"});
          b.addEventListener("click", () => { ui.linking = null; act({action: "link", id: m.id, client: c.id}, "Mesaj müşteri kartına bağlandı."); });
          return b;
        }));
      });
      box.append(input, results);
      article.append(box);
      setTimeout(() => input.focus());
    }

    const actions = el("div", "", {className: "wi-actions"});
    if (m.phone) {
      let p = digits(m.phone);
      actions.append(el("a", "WhatsApp", {href: "https://wa.me/90" + p + "?text=" + encodeURIComponent(tr("Merhaba") + " " + m.name + ", " + api.clinic() + " " + tr("web sitesi mesajınız için yazıyoruz.")), target: "_blank", rel: "noopener", className: "button small"}));
      actions.append(el("a", tr("Ara"), {href: "tel:" + m.phone.replace(/[^+\d]/g, ""), className: "button small ghost"}));
    }
    if (m.email) actions.append(el("a", tr("E-postayla yanıtla"), {href: "mailto:" + m.email + "?subject=" + encodeURIComponent(api.clinic() + " – " + tr("Mesajınız hakkında")), className: "button small ghost"}));
    if (api.canWrite) {
      if (!linked) { const s = el("button", tr("Müşteri ara ve bağla"), {type: "button", className: "button small ghost"}); s.addEventListener("click", () => { ui.linking = ui.linking === m.id ? null : m.id; draw(); }); actions.append(s); }
      if (api.canVisitor && !linked) {
        const v = el("button", tr("Ziyaretçi kaydı oluştur"), {type: "button", className: "button small"});
        v.addEventListener("click", async () => {
          v.disabled = true;
          try { const id = await api.createVisitor(m); api.toast(tr("Ziyaretçi kaydı oluşturuldu.")); location.hash = "record/visitors/" + id; }
          catch (e) { api.toast(e.message); v.disabled = false; }
        });
        actions.append(v);
      }
      const done = el("button", tr(m.handledAt ? "Yeniden aç" : "İşlendi olarak kapat"), {type: "button", className: "button small " + (m.handledAt ? "ghost" : "primary")});
      done.addEventListener("click", () => act({action: m.handledAt ? "reopen" : "handle", id: m.id}, m.handledAt ? "" : "Mesaj işlendi olarak kapatıldı."));
      actions.append(done);
    }
    article.append(actions);
    if (m.handledAt) article.append(el("small", tr("İşleyen") + ": " + [m.handledBy, new Intl.DateTimeFormat(lang, {dateStyle: "medium", timeStyle: "short"}).format(new Date(m.handledAt * 1000))].filter(Boolean).join(" · "), {className: "wi-muted"}));
    return article;
  }

  function draw() {
    if (!root.isConnected) return;
    const head = el("div", "", {className: "wi-head"});
    const t = el("div");
    t.append(el("h1", tr("Web Mesajları")), el("p", tr("Klinik web sitenizin iletişim formundan gelen mesajlar. Müşteri kartına bağlayın, yanıtlayın ve kapatın.")));
    head.append(t);
    const filters = el("div", "", {className: "wi-filters", role: "group"});
    for (const [k, l] of [["open", "Bekleyen"], ["done", "İşlenen"], ["all", "Tümü"]]) {
      const b = el("button", tr(l) + (k === "open" ? " (" + ui.open + ")" : ""), {type: "button"});
      b.setAttribute("aria-pressed", String(ui.filter === k));
      b.addEventListener("click", () => { ui.filter = k; load(); });
      filters.append(b);
    }
    const list = el("div", "", {className: "wi-list"});
    if (ui.loading) list.append(el("p", tr("Yükleniyor…"), {className: "wi-empty"}));
    else if (ui.error) list.append(el("p", ui.error, {className: "form-error"}));
    else if (!ui.items.length) list.append(el("p", tr(ui.unavailable ? "Web sitesi henüz yayında değil ya da güncelleme tamamlanmadı." : ui.filter === "open" ? "Bekleyen web mesajı yok." : "Mesaj yok."), {className: "wi-empty"}));
    else list.append(...ui.items.map(card));
    root.replaceChildren(head, filters, list);
  }
  load();
}
