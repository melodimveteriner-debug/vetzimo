// Bildirim merkezi: geçmiş, okundu/okunmadı, kategoriye göre süzme, temizleme, sayfalama. Klinik ve hasta sahibi ortak.
const STYLE = "/notification-hub.css?v=1";
const ICON = {appointments: "📅", vaccines: "💉", homeVisits: "🚗", patients: "🐾", labs: "🧪", payments: "💳", stock: "📦", messages: "💬", homecare: "🏠", support: "🛟", announcements: "📣", security: "🔐", system: "⚙"};
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const ago = (t, tr) => { const s = Date.now() / 1000 - t; return s < 60 ? tr("az önce") : s < 3600 ? Math.floor(s / 60) + " " + tr("dk önce") : s < 86400 ? Math.floor(s / 3600) + " " + tr("sa önce") : new Date(t * 1000).toLocaleDateString(undefined, {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}); };

export async function mountNotificationHub(root, {tr = s => s, onSettings} = {}) {
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  let scope = "", filter = "all", category = "", items = [], more = false, cats = [];
  const call = async (path, body) => {
    const r = await fetch(path, body ? {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)} : {credentials: "same-origin", headers: scope ? {"X-VeTNet-Scope": scope} : {}});
  if (r.status === 409 && !body) { location.reload(); throw Error(""); }
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || tr("İşlem tamamlanamadı.")); return d;
  };
  try { const c = await call("/api/app/config"); scope = c.scope; cats = c.categories; } catch (e) { root.replaceChildren(h("p", "nh-error", e.message)); return; }
  const wrap = h("section", "nh-root");
  const head = h("header", "nh-head");
  const title = h("div"); title.append(h("h2", "", tr("Bildirimler")), h("p", "nh-sub", ""));
  const tools = h("div", "nh-tools");
  const readAll = h("button", "nh-btn", tr("Tümünü okundu say"), {type: "button"});
  const clearAll = h("button", "nh-btn ghost", tr("Tümünü temizle"), {type: "button"});
  const settings = h("button", "nh-btn ghost", null, {type: "button"}); settings.append(h("span", "", "⚙ "), h("span", "", tr("Bildirim ayarları")));
  tools.append(readAll, clearAll, ...(onSettings ? [settings] : []));
  head.append(title, tools);
  const bar = h("div", "nh-bar");
  const seg = h("div", "nh-seg");
  [["all", "Tümü"], ["unread", "Okunmamış"]].forEach(([k, l]) => { const b = h("button", "", tr(l), {type: "button"}); b.dataset.k = k; b.addEventListener("click", () => { filter = k; reload(); }); seg.append(b); });
  const sel = h("select", "nh-select"); sel.setAttribute("aria-label", tr("Kategori"));
  sel.append(new Option(tr("Tüm kategoriler"), ""), ...cats.map(c => new Option(tr(c.label), c.key)));
  sel.addEventListener("change", () => { category = sel.value; reload(); });
  bar.append(seg, sel);
  const list = h("ul", "nh-list");
  const moreBtn = h("button", "nh-btn more", tr("Daha eski bildirimler"), {type: "button", hidden: true});
  wrap.append(head, bar, list, moreBtn);
  root.replaceChildren(wrap);
  const status = n => { const sub = title.querySelector(".nh-sub"); sub.replaceChildren(...(n ? [h("b", "", String(n) + " "), h("span", "", tr("okunmamış bildirim"))] : [h("span", "", tr("Tüm bildirimler okundu"))])); window.VetZimoNative?.refreshBadge?.(n); };
  function row(i) {
    const li = h("li", "nh-item" + (i.unread ? " unread" : "") + " c-" + i.category);
    const main = h("button", "nh-main", null, {type: "button"});
    main.append(h("span", "nh-icon", ICON[i.category] || "•"), h("span", "nh-text"));
    main.lastChild.append(h("strong", "", i.title), ...(i.body && i.body !== i.clinic ? [h("span", "", i.body)] : []), h("small", "", [tr(i.label), i.clinic, ago(i.time, tr)].filter(Boolean).join(" · ")));
    main.addEventListener("click", () => window.VetZimoNative?.open ? window.VetZimoNative.open(i) : (call("/api/app/notifications", {action: "read", ids: [i.id]}).catch(() => {}), location.assign(i.href)));
    const act = h("div", "nh-actions");
    const toggle = h("button", "nh-icon-btn", i.unread ? "✓" : "●", {type: "button", title: i.unread ? tr("Okundu işaretle") : tr("Okunmadı işaretle")});
    toggle.setAttribute("aria-label", toggle.title);
    toggle.addEventListener("click", async () => { const r = await call("/api/app/notifications", {action: i.unread ? "read" : "unread", ids: [i.id]}); i.unread = !i.unread; li.replaceWith(row(i)); status(r.unread); });
    const del = h("button", "nh-icon-btn", "×", {type: "button", title: tr("Temizle")}); del.setAttribute("aria-label", tr("Temizle"));
    del.addEventListener("click", async () => { const r = await call("/api/app/notifications", {action: "clear", ids: [i.id]}); li.classList.add("gone"); setTimeout(() => li.remove(), 250); items = items.filter(x => x.id !== i.id); status(r.unread); if (!items.length) empty(); });
    act.append(toggle, del);
    li.append(main, act);
    return li;
  }
  const empty = () => list.replaceChildren(h("li", "nh-empty", filter === "unread" ? tr("Okunmamış bildirim yok.") : tr("Henüz bildirim yok. Randevu, sonuç, mesaj ve evde hizmet gelişmeleri burada görünür.")));
  async function load(append) {
    const q = new URLSearchParams();
    if (filter === "unread") q.set("unread", "1");
    if (category) q.set("category", category);
    if (append && items.length) q.set("before", String(items[items.length - 1].id));
    const d = await call("/api/app/notifications?" + q);
    items = append ? items.concat(d.items) : d.items; more = d.more;
    if (!append) list.replaceChildren();
    d.items.forEach(i => list.append(row(i)));
    if (!items.length) empty();
    moreBtn.hidden = !more;
    status(d.unread);
  }
  function reload() { seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === filter))); load(false).catch(e => list.replaceChildren(h("li", "nh-error", e.message))); }
  moreBtn.addEventListener("click", () => load(true));
  readAll.addEventListener("click", async () => { const r = await call("/api/app/notifications", {action: "readAll", ...(category ? {category} : {})}); status(r.unread); reload(); });
  clearAll.addEventListener("click", async () => { if (!clearAll.dataset.sure) { clearAll.dataset.sure = "1"; clearAll.textContent = tr("Emin misiniz? Temizle"); setTimeout(() => { delete clearAll.dataset.sure; clearAll.textContent = tr("Tümünü temizle"); }, 4000); return; } const r = await call("/api/app/notifications", {action: "clearAll"}); status(r.unread); reload(); });
  settings.addEventListener("click", () => onSettings?.());
  reload();
}
