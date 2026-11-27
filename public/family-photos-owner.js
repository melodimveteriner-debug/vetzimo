// Hasta sahibi paneli: Aile Fotoğrafları (en fazla 3). Sayfa yapısını bozmayan küçük bir şerit + "Aile fotoğrafı ekle".
// Fotoğraf cihazda küçültülür (en uzun kenar 1280 px, JPEG), kliniğin onayına gider; web sitesinde paylaşım izni sorulur.
const CSS = `
.fam-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 4px;padding:10px 12px;border:1px solid var(--line,#e6e0f5);border-radius:14px;background:var(--paper,#fff)}
.fam-strip h3{margin:0;font-size:.92rem;flex:1 1 140px}
.fam-strip h3 small{display:block;font-weight:500;opacity:.7;font-size:.74rem}
.fam-thumbs{display:flex;gap:8px}
.fam-thumb{position:relative;width:52px;height:52px;border-radius:10px;overflow:hidden;border:2px solid #fff;box-shadow:0 2px 8px -3px rgba(30,10,80,.4);padding:0;cursor:pointer;background:#f3f0fb}
.fam-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.fam-thumb i{position:absolute;left:0;right:0;bottom:0;font-style:normal;font-size:.56rem;font-weight:800;color:#fff;text-align:center;padding:1px 0;background:rgba(40,20,90,.72)}
.fam-thumb.is-pending i{background:rgba(180,110,0,.85)}
.fam-thumb.is-approved i{background:rgba(10,120,80,.85)}
.fam-add{border:1px dashed var(--accent,#6a3df0);color:var(--accent,#6a3df0);background:transparent;border-radius:999px;padding:7px 12px;font:inherit;font-size:.82rem;font-weight:700;cursor:pointer}
.fam-dialog{border:0;border-radius:18px;padding:0;width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);box-shadow:0 30px 60px -20px rgba(20,10,60,.5)}
.fam-dialog::backdrop{background:rgba(20,10,50,.45)}
.fam-dialog form{display:grid;gap:12px;padding:18px}
.fam-dialog h2{margin:0;font-size:1.1rem}
.fam-dialog label{display:grid;gap:5px;font-size:.86rem;font-weight:600}
.fam-dialog input[type=text]{padding:10px 12px;border:1px solid #d8d1ec;border-radius:10px;font:inherit}
.fam-pick{display:grid;place-items:center;gap:6px;min-height:150px;border:2px dashed #cfc4f0;border-radius:14px;cursor:pointer;text-align:center;font-size:.84rem;overflow:hidden;background:#faf8ff}
.fam-pick img{max-width:100%;max-height:220px;border-radius:10px}
.fam-ask{border:1px solid #e3dcf6;border-radius:12px;padding:10px 12px;font-size:.84rem}
.fam-ask legend{font-weight:700;padding:0 4px}
.fam-ask label{display:flex;gap:8px;align-items:flex-start;font-weight:500;margin-top:6px}
.fam-note{font-size:.78rem;opacity:.75;margin:0}
.fam-err{color:#b3261e;font-size:.84rem;margin:0}
.fam-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.fam-view img{width:100%;border-radius:12px;display:block}
`;

export function mountFamilyOwner(host, {scope, tr = s => s}) {
  if (!document.getElementById("fam-owner-css")) document.head.append(Object.assign(document.createElement("style"), {id: "fam-owner-css", textContent: CSS}));
  const el = (tag, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (text) n.textContent = text; return n; };
  const strip = el("section", "", {className: "fam-strip", ariaLabel: tr("Aile fotoğrafları")});
  host.append(strip);
  let state = {items: [], max: 3};
  const label = s => ({pending: tr("Onayda"), approved: tr("Yayında"), rejected: tr("Reddedildi")})[s] || s;

  async function load() {
    try { const r = await fetch("/api/family-photos", {credentials: "same-origin"}); if (r.ok) state = await r.json(); } catch {}
    draw();
  }
  function draw() {
    const head = el("h3", tr("Aile fotoğrafları"));
    head.append(el("small", state.items.length ? state.items.length + "/" + state.max + " · " + tr("klinik onayından sonra yayınlanır") : tr("Ailenizle fotoğrafınızı ekleyin (en fazla 3)")));
    const thumbs = el("div", "", {className: "fam-thumbs"});
    for (const p of state.items) {
      const b = el("button", "", {type: "button", className: "fam-thumb is-" + p.status, title: [p.family, p.caption, label(p.status), p.publish ? tr("web sitesinde paylaşılır") : tr("gizli")].filter(Boolean).join(" · ")});
      b.append(el("img", "", {src: p.url, alt: p.caption || p.family, loading: "lazy"}), el("i", label(p.status)));
      b.addEventListener("click", () => view(p));
      thumbs.append(b);
    }
    strip.replaceChildren(head, thumbs);
    if (state.items.length < state.max) {
      const add = el("button", "📷 " + tr("Aile fotoğrafı ekle"), {type: "button", className: "fam-add"});
      add.addEventListener("click", () => editor());
      strip.append(add);
    }
  }
  function dialog() {
    const d = el("dialog", "", {className: "fam-dialog"});
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
    document.body.append(d);
    return d;
  }
  function view(p) {
    const d = dialog(), f = el("form", "", {method: "dialog", className: "fam-view"});
    f.append(el("h2", p.family), el("img", "", {src: p.url, alt: p.caption || p.family}));
    if (p.caption) f.append(el("p", p.caption, {className: "fam-note"}));
    f.append(el("p", label(p.status) + " · " + (p.publish ? tr("Web sitesinde paylaşım izni verdiniz.") : tr("Yalnız sizde ve kliniğinizin VetZimo panelinde görünür (gizli).")), {className: "fam-note"}));
    const err = el("p", "", {className: "fam-err", role: "alert"});
    const del = el("button", tr("Fotoğrafı sil"), {type: "button", className: "button"});
    let armed = false;
    del.addEventListener("click", async () => {
      if (!armed) { armed = true; del.textContent = tr("Silinsin mi? Tekrar dokunun"); return; }
      del.disabled = true;
      try { await post("/api/family-photos/delete", {id: p.id}); d.close(); load(); } catch (e) { err.textContent = e.message; del.disabled = false; }
    });
    const close = el("button", tr("Kapat"), {type: "submit", className: "button primary"});
    const foot = el("div", "", {className: "fam-foot"}); foot.append(del, close);
    f.append(err, foot); d.append(f); d.showModal();
  }
  async function post(url, body) {
    const r = await fetch(url, {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error || tr("İşlem tamamlanamadı."));
    return j;
  }
  // Fotoğraf cihazda küçültülür: en uzun kenar 1280 px, JPEG %82 (yükleme hızlı, depolama küçük).
  async function shrink(file) {
    // blob: adresleri sayfa güvenlik kuralına takılır; dosya data: adresi olarak okunur.
    const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(Error(tr("Fotoğraf açılamadı."))); r.readAsDataURL(file); });
    {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(tr("Fotoğraf açılamadı."))); i.src = url; });
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = Object.assign(document.createElement("canvas"), {width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k)});
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", .82);
    }
  }
  function editor() {
    const d = dialog(), f = el("form");
    let image = "";
    const file = el("input", "", {type: "file", accept: "image/*", hidden: true});
    const pick = el("label", "", {className: "fam-pick"});
    pick.append(el("span", "📷", {style: "font-size:2rem"}), el("span", tr("Fotoğraf çekin veya galeriden seçin")), file);
    file.addEventListener("change", async () => {
      const x = file.files?.[0]; if (!x) return;
      try { image = await shrink(x); pick.replaceChildren(el("img", "", {src: image, alt: ""}), file); err.textContent = ""; } catch (e) { err.textContent = e.message; }
    });
    const caption = el("input", "", {type: "text", maxLength: 120, placeholder: tr("Örn. Ayşe, Mehmet ve Pamuk")});
    const capL = el("label", tr("Fotoğraftakilerin adları")); capL.append(caption);
    const surname = el("input", "", {type: "text", maxLength: 40, required: true, autocomplete: "family-name", placeholder: tr("Soyadınız")});
    const surL = el("label", tr("Soyadınız")); surL.append(surname);
    const preview = el("p", "", {className: "fam-note"});
    const titled = v => v.trim().toLocaleLowerCase("tr").replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("tr"));
    surname.addEventListener("input", () => { preview.textContent = surname.value.trim() ? tr("Sitede şöyle görünür:") + " " + titled(surname.value) + " " + tr("Ailesi") : ""; });
    const ask = el("fieldset", "", {className: "fam-ask"});
    ask.append(el("legend", tr("Fotoğraflarımın ve soyadımın web sitemizde de paylaşılmasını onaylıyor musunuz?")));
    const yes = el("input", "", {type: "radio", name: "publish", value: "yes", required: true}), no = el("input", "", {type: "radio", name: "publish", value: "no"});
    const yL = el("label"); yL.append(yes, el("span", tr("Evet, web sitesinde de paylaşılabilir.")));
    const nL = el("label"); nL.append(no, el("span", tr("Hayır. Yalnız gizli olarak sizde ve VetZimo programında panelinizde görünecek.")));
    ask.append(yL, nL);
    const err = el("p", "", {className: "fam-err", role: "alert"});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
    cancel.addEventListener("click", () => d.close());
    const ok = el("button", tr("Gönder"), {type: "submit", className: "button primary"});
    const foot = el("div", "", {className: "fam-foot"}); foot.append(cancel, ok);
    f.append(el("h2", tr("Aile fotoğrafı ekle")), pick, capL, surL, preview, ask,
      el("p", tr("Fotoğraf kliniğinizin onayından sonra yayınlanır."), {className: "fam-note"}), err, foot);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      if (!image) { err.textContent = tr("Önce bir fotoğraf seçin."); return; }
      if (!yes.checked && !no.checked) { err.textContent = tr("Web sitesinde paylaşım sorusunu yanıtlayın."); return; }
      ok.disabled = true; err.textContent = "";
      try { state = await post("/api/family-photos", {image, caption: caption.value.trim(), surname: surname.value.trim(), publish: yes.checked}); d.close(); draw(); }
      catch (x) { err.textContent = x.message; ok.disabled = false; }
    });
    d.append(f); d.showModal();
  }
  load();
}
