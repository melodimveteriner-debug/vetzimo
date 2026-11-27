// Klinik: hasta sahibi kartında "Aile fotoğrafları". Bekleyen fotoğraf onaylanır/reddedilir; onaylanan, hasta sahibi
// izin verdiyse kliniğin web sitesinde "... Ailesi" iskambil kartı olarak yayınlanır. Silme hasta sahibi yazma iznine bağlı.
const CSS = `
.fam-clinic h2{display:flex;align-items:center;gap:8px}
.fam-clinic h2 .fam-badge{font-size:.72rem;font-weight:800;background:#fff3d6;color:#8a5a00;border-radius:999px;padding:2px 9px}
.fam-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:12px}
.fam-item{display:grid;gap:6px;border:1px solid var(--line,#e6e0f5);border-radius:14px;padding:8px;background:var(--paper,#fff);min-width:0}
.fam-item.is-pending{border-color:#f0c36a;box-shadow:0 0 0 3px #fff3d6}
.fam-item img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block;background:#f3f0fb;cursor:zoom-in}
.fam-item strong{font-size:.9rem}
.fam-item small{opacity:.75;font-size:.76rem;overflow-wrap:anywhere}
.fam-tags{display:flex;flex-wrap:wrap;gap:4px}
.fam-tag{font-size:.7rem;font-weight:700;border-radius:999px;padding:2px 8px;background:#efeaff;color:#4b2fa8}
.fam-tag.pending{background:#fff3d6;color:#8a5a00}.fam-tag.approved{background:#e3f6ee;color:#0b5c43}.fam-tag.rejected{background:#fdebef;color:#8c2240}
.fam-acts{display:flex;flex-wrap:wrap;gap:6px}
.fam-zoom{border:0;padding:0;border-radius:14px;max-width:min(92vw,900px)}
.fam-zoom img{max-width:100%;max-height:86dvh;display:block}
`;

export function mountFamilyClinic(main, client, {api, tr = s => s, canWrite = false}) {
  if (!document.getElementById("fam-clinic-css")) document.head.append(Object.assign(document.createElement("style"), {id: "fam-clinic-css", textContent: CSS}));
  const el = (tag, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (text) n.textContent = text; return n; };
  const box = el("section", "", {className: "panel fam-clinic"});
  box.dataset.client = client;
  const anchor = main.querySelector(".record-section-portal") || main.querySelector(".record-section-contact");
  anchor ? anchor.after(box) : main.append(box);
  const status = s => ({pending: tr("Onay bekliyor"), approved: tr("Onaylandı"), rejected: tr("Reddedildi")})[s] || s;
  const date = t => t ? new Intl.DateTimeFormat("tr-TR", {dateStyle: "medium", timeStyle: "short"}).format(new Date(t * 1000)) : "";

  async function load() {
    let data = {items: [], canDecide: false};
    try { const r = await api("/api/family-photos?client=" + encodeURIComponent(client)); if (r.ok) data = await r.json(); } catch {}
    if (!box.isConnected) return;
    if (!data.items.length) { box.remove(); return; }
    const pending = data.items.filter(p => p.status === "pending").length;
    const head = el("h2", tr("Aile fotoğrafları"));
    if (pending) head.append(el("span", pending + " " + tr("onay bekliyor"), {className: "fam-badge"}));
    const grid = el("div", "", {className: "fam-grid"});
    for (const p of data.items) {
      const card = el("article", "", {className: "fam-item is-" + p.status});
      const img = el("img", "", {src: p.url, alt: p.caption || p.family, loading: "lazy"});
      img.addEventListener("click", () => zoom(p));
      const tags = el("div", "", {className: "fam-tags"});
      tags.append(el("span", status(p.status), {className: "fam-tag " + p.status}), el("span", p.publish ? "🌐 " + tr("Web sitesinde paylaşım izni var") : "🔒 " + tr("Gizli (yalnız panel)"), {className: "fam-tag"}));
      card.append(img, el("strong", p.family), ...(p.caption ? [el("small", p.caption)] : []), tags,
        el("small", date(p.createdAt) + (p.decidedBy ? " · " + status(p.status) + ": " + p.decidedBy : "")));
      if (data.canDecide && canWrite) {
        const acts = el("div", "", {className: "fam-acts"});
        if (p.status !== "approved") acts.append(btn("✓ " + tr("Onayla"), "button small primary", () => decide(p, true)));
        if (p.status === "pending") acts.append(btn(tr("Reddet"), "button small", () => decide(p, false)));
        let armed = false;
        const del = btn(tr("Sil"), "button small danger-outline", async () => {
          if (!armed) { armed = true; del.textContent = tr("Silinsin mi?"); return; }
          await send("/api/family-photos/delete", {id: p.id});
        });
        acts.append(del);
        card.append(acts);
      }
      grid.append(card);
    }
    box.replaceChildren(head, el("p", tr("Hasta sahibinin eklediği aile fotoğrafları. Onaylanan ve paylaşım izni olan fotoğraflar web sitenizde “... Ailesi” kartı olarak yayınlanır."), {className: "muted"}), grid);
  }
  function btn(text, className, fn) {
    const b = el("button", text, {type: "button", className});
    b.addEventListener("click", async () => { b.disabled = true; try { await fn(); } finally { if (b.isConnected) b.disabled = false; } });
    return b;
  }
  async function send(url, body) {
    const r = await api(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alertMsg(j.error || tr("İşlem tamamlanamadı.")); return; }
    await load();
  }
  const decide = (p, approve) => send("/api/family-photos/decide", {id: p.id, approve});
  function alertMsg(m) { const n = el("p", m, {className: "form-error", role: "alert"}); box.prepend(n); setTimeout(() => n.remove(), 5000); }
  function zoom(p) {
    const d = el("dialog", "", {className: "fam-zoom"});
    d.append(el("img", "", {src: p.url, alt: p.caption || p.family}));
    d.addEventListener("click", () => d.close()); d.addEventListener("close", () => d.remove());
    document.body.append(d); d.showModal();
  }
  load();
}
