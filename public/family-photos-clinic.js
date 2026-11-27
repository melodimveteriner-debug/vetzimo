// Klinik: Aile fotoğrafları.
// 1) Hasta sahibi kartında bölüm: ekle (bayi/şube yöneticisi/personel, hasta sahibi yazma yetkisiyle), onayla/reddet/sil.
// 2) Müşteriler › Aile Fotoğrafları sayfası: tüm aileler, durum süzgeci, arama, sayfalama.
const CSS = `
.fam-clinic h2,.fam-page h1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fam-badge{font-size:.72rem;font-weight:800;background:#fff3d6;color:#8a5a00;border-radius:999px;padding:2px 9px}
.fam-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:12px}
.fam-item{display:grid;gap:6px;align-content:start;border:1px solid var(--line,#e6e0f5);border-radius:14px;padding:8px;background:var(--paper,#fff);min-width:0}
.fam-item.is-pending{border-color:#f0c36a;box-shadow:0 0 0 3px #fff3d6}
.fam-item img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block;background:#f3f0fb;cursor:zoom-in}
.fam-item strong{font-size:.9rem}
.fam-item small{opacity:.75;font-size:.76rem;overflow-wrap:anywhere}
.fam-item a.fam-owner{font-size:.8rem;font-weight:700;overflow-wrap:anywhere}
.fam-tags{display:flex;flex-wrap:wrap;gap:4px}
.fam-tag{font-size:.7rem;font-weight:700;border-radius:999px;padding:2px 8px;background:#efeaff;color:#4b2fa8}
.fam-tag.pending{background:#fff3d6;color:#8a5a00}.fam-tag.approved{background:#e3f6ee;color:#0b5c43}.fam-tag.rejected{background:#fdebef;color:#8c2240}
.fam-acts{display:flex;flex-wrap:wrap;gap:6px}
.fam-empty{border:2px dashed var(--line,#e0d8f3);border-radius:14px;padding:16px;text-align:center;opacity:.8}
.fam-addcard{display:grid;place-items:center;gap:6px;min-height:150px;border:2px dashed var(--line,#d9cff3);border-radius:14px;background:transparent;font:inherit;font-weight:700;color:var(--accent,#6a3df0);cursor:pointer}
.fam-addcard span{font-size:1.8rem}
.fam-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin:6px 0 14px}
.fam-tabs{display:flex;flex-wrap:wrap;gap:6px}
.fam-tabs button[aria-pressed=true]{background:var(--accent,#6a3df0);color:#fff;border-color:transparent}
.fam-search{min-height:40px;padding:8px 12px;border:1px solid var(--line,#d8d1ec);border-radius:10px;font:inherit;flex:0 1 280px;min-width:min(220px,100%)}
.fam-pager{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center;margin-top:16px}
.fam-pager button[aria-current=page]{background:var(--accent,#6a3df0);color:#fff;border-color:transparent}
.fam-pager small{opacity:.7;margin-inline:6px}
.fam-zoom{border:0;padding:0;border-radius:14px;max-width:min(92vw,900px)}
.fam-zoom img{max-width:100%;max-height:86dvh;display:block}
.fam-dialog{border:0;border-radius:18px;padding:0;width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);box-shadow:0 30px 60px -20px rgba(20,10,60,.5)}
.fam-dialog::backdrop{background:rgba(20,10,50,.45)}
.fam-dialog form{display:grid;gap:12px;padding:18px}
.fam-dialog h2{margin:0;font-size:1.1rem}
.fam-dialog label{display:grid;gap:5px;font-size:.86rem;font-weight:600}
.fam-dialog input[type=text]{padding:10px 12px;border:1px solid #d8d1ec;border-radius:10px;font:inherit}
.fam-pick{display:grid;place-items:center;gap:6px;min-height:140px;border:2px dashed #cfc4f0;border-radius:14px;cursor:pointer;text-align:center;font-size:.84rem;overflow:hidden;background:#faf8ff}
.fam-pick img{max-width:100%;max-height:200px;border-radius:10px}
.fam-ask{border:1px solid #e3dcf6;border-radius:12px;padding:10px 12px;font-size:.84rem}
.fam-ask legend{font-weight:700;padding:0 4px}
.fam-ask label{display:flex;gap:8px;align-items:flex-start;font-weight:500;margin-top:6px}
.fam-note{font-size:.78rem;opacity:.75;margin:0}
.fam-err{color:#b3261e;font-size:.84rem;margin:0}
.fam-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
`;
const css = () => { if (!document.getElementById("fam-clinic-css")) document.head.append(Object.assign(document.createElement("style"), {id: "fam-clinic-css", textContent: CSS})); };
const el = (tag, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (text) n.textContent = text; return n; };
const titled = v => String(v || "").trim().toLocaleLowerCase("tr").replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("tr"));

function helpers(api, tr) {
  const status = s => ({pending: tr("Onay bekliyor"), approved: tr("Onaylandı"), rejected: tr("Reddedildi")})[s] || s;
  const date = t => t ? new Intl.DateTimeFormat("tr-TR", {dateStyle: "medium", timeStyle: "short"}).format(new Date(t * 1000)) : "";
  async function send(url, body) {
    const r = await api(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error || tr("İşlem tamamlanamadı."));
    return j;
  }
  function zoom(p) {
    const d = el("dialog", "", {className: "fam-zoom"});
    d.append(el("img", "", {src: p.url, alt: p.caption || p.family}));
    d.addEventListener("click", () => d.close()); d.addEventListener("close", () => d.remove());
    document.body.append(d); d.showModal();
  }
  function btn(text, className, fn) {
    const b = el("button", text, {type: "button", className});
    b.addEventListener("click", async () => { b.disabled = true; try { await fn(b); } finally { if (b.isConnected) b.disabled = false; } });
    return b;
  }
  // Ortak kart: fotoğraf, aile, adlar, durum, paylaşım, (sayfada) hasta sahibi bağlantısı, işlemler.
  function card(p, {canDecide, onChange, onError, owner}) {
    const c = el("article", "", {className: "fam-item is-" + p.status});
    const img = el("img", "", {src: p.url, alt: p.caption || p.family, loading: "lazy"});
    img.addEventListener("click", () => zoom(p));
    const tags = el("div", "", {className: "fam-tags"});
    tags.append(el("span", status(p.status), {className: "fam-tag " + p.status}), el("span", p.publish ? "🌐 " + tr("Web sitesinde paylaşım izni var") : "🔒 " + tr("Gizli (yalnız panel)"), {className: "fam-tag"}));
    c.append(img, el("strong", p.family));
    if (owner) c.append(owner);
    if (p.caption) c.append(el("small", p.caption));
    c.append(tags, el("small", date(p.createdAt) + (p.decidedBy ? " · " + status(p.status) + ": " + p.decidedBy : "")));
    if (canDecide) {
      const acts = el("div", "", {className: "fam-acts"});
      const run = fn => async () => { try { await fn(); await onChange(); } catch (e) { onError(e.message); } };
      if (p.status !== "approved") acts.append(btn("✓ " + tr("Onayla"), "button small primary", run(() => send("/api/family-photos/decide", {id: p.id, approve: true}))));
      if (p.status === "pending") acts.append(btn(tr("Reddet"), "button small", run(() => send("/api/family-photos/decide", {id: p.id, approve: false}))));
      let armed = false;
      acts.append(btn(tr("Sil"), "button small danger-outline", async b => {
        if (!armed) { armed = true; b.textContent = tr("Silinsin mi?"); return; }
        await run(() => send("/api/family-photos/delete", {id: p.id}))();
      }));
      c.append(acts);
    }
    return c;
  }
  // Ekip ekler: hasta sahibinin onayını (web sitesinde paylaşım) sorar; klinik eklediği için doğrudan onaylı yayınlanır.
  function editor(client, surname, done) {
    const d = el("dialog", "", {className: "fam-dialog"}), f = el("form");
    d.addEventListener("close", () => d.remove());
    let image = "";
    const file = el("input", "", {type: "file", accept: "image/*", hidden: true});
    const pick = el("label", "", {className: "fam-pick"});
    pick.append(el("span", "📷", {style: "font-size:2rem"}), el("span", tr("Fotoğraf çekin veya galeriden seçin")), file);
    const err = el("p", "", {className: "fam-err", role: "alert"});
    file.addEventListener("change", async () => {
      const x = file.files?.[0]; if (!x) return;
      try {
        const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(Error(tr("Fotoğraf açılamadı."))); r.readAsDataURL(x); });
        const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(tr("Fotoğraf açılamadı."))); i.src = url; });
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = Object.assign(document.createElement("canvas"), {width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k)});
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        image = cv.toDataURL("image/jpeg", .82);
        pick.replaceChildren(el("img", "", {src: image, alt: ""}), file); err.textContent = "";
      } catch (e) { err.textContent = e.message; }
    });
    const caption = el("input", "", {type: "text", maxLength: 120, placeholder: tr("Örn. Ayşe, Mehmet ve Pamuk")});
    const capL = el("label", tr("Fotoğraftakilerin adları")); capL.append(caption);
    const sur = el("input", "", {type: "text", maxLength: 40, required: true, value: surname || ""});
    const surL = el("label", tr("Soyadı")); surL.append(sur);
    const preview = el("p", "", {className: "fam-note"});
    const upd = () => { preview.textContent = sur.value.trim() ? tr("Sitede şöyle görünür:") + " " + titled(sur.value) + " " + tr("Ailesi") : ""; };
    sur.addEventListener("input", upd); upd();
    const ask = el("fieldset", "", {className: "fam-ask"});
    ask.append(el("legend", tr("Hasta sahibi fotoğrafların ve soyadının web sitesinde paylaşılmasını onayladı mı?")));
    const yes = el("input", "", {type: "radio", name: "publish", value: "yes"}), no = el("input", "", {type: "radio", name: "publish", value: "no"});
    const yL = el("label"); yL.append(yes, el("span", tr("Evet, web sitesinde de paylaşılabilir.")));
    const nL = el("label"); nL.append(no, el("span", tr("Hayır. Yalnız gizli olarak hasta sahibinde ve VetZimo panelinde görünecek.")));
    ask.append(yL, nL);
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
    cancel.addEventListener("click", () => d.close());
    const ok = el("button", tr("Kaydet"), {type: "submit", className: "button primary"});
    const foot = el("div", "", {className: "fam-foot"}); foot.append(cancel, ok);
    f.append(el("h2", tr("Aile fotoğrafı ekle")), pick, capL, surL, preview, ask, el("p", tr("Klinik eklediği için fotoğraf onaylı kaydedilir; hasta sahibinin panelinde de görünür."), {className: "fam-note"}), err, foot);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      if (!image) { err.textContent = tr("Önce bir fotoğraf seçin."); return; }
      if (!yes.checked && !no.checked) { err.textContent = tr("Web sitesinde paylaşım sorusunu yanıtlayın."); return; }
      ok.disabled = true; err.textContent = "";
      try { await send("/api/family-photos", {client, image, caption: caption.value.trim(), surname: sur.value.trim(), publish: yes.checked}); d.close(); done(); }
      catch (x) { err.textContent = x.message; ok.disabled = false; }
    });
    d.append(f); document.body.append(d); d.showModal();
  }
  return {status, card, editor, send};
}

/** Hasta sahibi kartı: bölüm her zaman görünür (yazma yetkisi varsa ekleme düğmesiyle). */
export function mountFamilyClinic(main, client, {api, tr = s => s, canWrite = false, clientName = ""}) {
  css();
  const h = helpers(api, tr);
  const box = el("section", "", {className: "panel fam-clinic"});
  box.dataset.client = client;
  const anchor = main.querySelector(".record-section-portal") || main.querySelector(".record-section-contact");
  anchor ? anchor.after(box) : main.append(box);
  const surname = String(clientName || "").trim().split(/\s+/).slice(-1)[0] || "";
  const error = m => { const n = el("p", m, {className: "form-error", role: "alert"}); box.prepend(n); setTimeout(() => n.remove(), 5000); };
  async function load() {
    let data = {items: [], canDecide: false, max: 3};
    try { const r = await api("/api/family-photos?client=" + encodeURIComponent(client)); if (r.ok) data = await r.json(); } catch {}
    if (!box.isConnected) return;
    if (!data.items.length && !canWrite) { box.remove(); return; }
    const pending = data.items.filter(p => p.status === "pending").length;
    const head = el("h2", tr("Aile fotoğrafları"));
    if (pending) head.append(el("span", pending + " " + tr("onay bekliyor"), {className: "fam-badge"}));
    const grid = el("div", "", {className: "fam-grid"});
    for (const p of data.items) grid.append(h.card(p, {canDecide: data.canDecide && canWrite, onChange: load, onError: error}));
    if (canWrite && data.items.length < (data.max || 3)) {
      const add = el("button", "", {type: "button", className: "fam-addcard"});
      add.append(el("span", "📷"), el("strong", tr("Aile fotoğrafı ekle")), el("small", data.items.length + "/" + (data.max || 3)));
      add.addEventListener("click", () => h.editor(client, surname, load));
      grid.append(add);
    }
    box.replaceChildren(head, el("p", tr("Hasta sahibinin veya ekibin eklediği aile fotoğrafları (en fazla 3). Onaylanan ve paylaşım izni olan fotoğraflar web sitenizde “... Ailesi” kartı olarak yayınlanır."), {className: "muted"}), grid);
  }
  load();
}

/** Müşteriler › Aile Fotoğrafları: tüm aileler, süzgeç, arama, sayfalama (12'şer). */
export function mountFamilyGallery(root, {api, tr = s => s, canWrite = false, clientName = () => "", findClients = () => []}) {
  css();
  const h = helpers(api, tr);
  const state = {status: "", q: "", page: 1};
  const page = el("section", "", {className: "panel fam-page"});
  const title = el("h1", tr("Aile Fotoğrafları"));
  const tabs = el("div", "", {className: "fam-tabs"});
  for (const [k, label] of [["", "Tümü"], ["pending", "Onay bekleyen"], ["public", "Web sitesinde"], ["private", "Gizli"], ["rejected", "Reddedilen"]]) {
    const b = el("button", tr(label), {type: "button", className: "button small"});
    b.dataset.famStatus = k;
    b.addEventListener("click", () => { state.status = k; state.page = 1; load(); });
    tabs.append(b);
  }
  const search = el("input", "", {type: "search", className: "fam-search", placeholder: tr("Soyad, isim veya hasta sahibi ara")});
  let t = 0;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value.trim(); state.page = 1; load(); }, 300); });
  const tools = el("div", "", {className: "fam-tools"}); tools.append(tabs, search);
  const list = el("div"), pager = el("nav", "", {className: "fam-pager", ariaLabel: tr("Sayfalar")});
  page.append(title, el("p", tr("Hasta sahiplerinin ve ekibin eklediği tüm aile fotoğrafları. Yeni fotoğrafı hasta sahibi kartındaki “Aile fotoğrafları” bölümünden ekleyin."), {className: "muted"}), tools, list, pager);
  root.replaceChildren(page);
  const error = m => { const n = el("p", m, {className: "form-error", role: "alert"}); page.prepend(n); setTimeout(() => n.remove(), 5000); };
  async function load() {
    for (const b of tabs.children) b.setAttribute("aria-pressed", String(b.dataset.famStatus === state.status));
    const qs = new URLSearchParams({all: "1", page: String(state.page), per: "12", status: state.status, q: state.q});
    if (state.q.length >= 2) for (const id of findClients(state.q).slice(0, 200)) qs.append("clients[]", id);
    let data = {items: [], total: 0, page: 1, pages: 1, pending: 0, canDecide: false};
    try { const r = await api("/api/family-photos?" + qs); if (r.ok) data = await r.json(); else error((await r.json().catch(() => ({}))).error || tr("Liste alınamadı.")); } catch {}
    if (!root.isConnected) return;
    title.replaceChildren(document.createTextNode(tr("Aile Fotoğrafları")));
    if (data.pending) title.append(el("span", data.pending + " " + tr("onay bekliyor"), {className: "fam-badge"}));
    const grid = el("div", "", {className: "fam-grid"});
    for (const p of data.items) {
      const name = clientName(p.client);
      const owner = p.client ? el("a", "👤 " + (name || tr("Hasta sahibi kartı")), {href: "#owner/" + encodeURIComponent(p.client), className: "fam-owner"}) : null;
      grid.append(h.card(p, {canDecide: data.canDecide && canWrite, onChange: load, onError: error, owner}));
    }
    list.replaceChildren(data.items.length ? grid : el("p", state.q || state.status ? tr("Bu seçimde aile fotoğrafı yok.") : tr("Henüz aile fotoğrafı yok. Hasta sahipleri panellerinden veya ekip hasta sahibi kartından ekleyebilir."), {className: "fam-empty"}));
    state.page = data.page;
    pager.replaceChildren();
    if (data.pages > 1) {
      const go = n => { state.page = n; load(); page.scrollIntoView({block: "start"}); };
      const prev = el("button", "‹ " + tr("Önceki"), {type: "button", className: "button small", disabled: data.page <= 1}); prev.addEventListener("click", () => go(data.page - 1));
      pager.append(prev);
      const nums = [...new Set([1, data.page - 1, data.page, data.page + 1, data.pages])].filter(n => n >= 1 && n <= data.pages).sort((a, b) => a - b);
      let last = 0;
      for (const n of nums) {
        if (n - last > 1) pager.append(el("small", "…"));
        const b = el("button", String(n), {type: "button", className: "button small"});
        if (n === data.page) b.setAttribute("aria-current", "page");
        b.addEventListener("click", () => go(n)); pager.append(b); last = n;
      }
      const next = el("button", tr("Sonraki") + " ›", {type: "button", className: "button small", disabled: data.page >= data.pages}); next.addEventListener("click", () => go(data.page + 1));
      pager.append(next, el("small", data.total + " " + tr("fotoğraf")));
    }
  }
  load();
}
