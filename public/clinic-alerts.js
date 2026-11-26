// Klinik uyarıları: sağ üstte açılan bildirim kartları + zil paneli listesi.
// Yeni uyarı gelince kart düşer (önemli olanlar kapatılana kadar kalır); "Tamamlandı" ya da "Aç" ile işlem yapılan uyarı
// kişi bazında listeden kalkar. Okunan mesaj ve çözülen işler sunucuda kendiliğinden düşer.
const STYLE = "/clinic-alerts.css?v=1";
const ICON = {pregnancy: "🍼", inbox: "💬", permit: "🛡", job: "⚠", phone: "📱", web: "🌐", subscription: "⏳", device: "🧪"};
let api, scope, tr = s => s, onChange = () => {}, items = [], seen = new Set(), timer = 0, stack, started = false;

const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? tr("az önce") : s < 3600 ? Math.round(s / 60) + " " + tr("dk önce") : s < 86400 ? Math.round(s / 3600) + " " + tr("sa önce") : new Date(t * 1000).toLocaleDateString("tr-TR"); };

export function startAlerts(options) {
  ({fetch: api, scope, tr = s => s, onChange = () => {}} = options);
  if (started) return; started = true;
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  stack = h("div", "ca-toasts"); stack.setAttribute("aria-live", "polite"); stack.setAttribute("aria-label", tr("Bildirimler"));
  document.body.append(stack);
  try { seen = new Set(JSON.parse(sessionStorage.getItem("vz-alert-seen") || "[]")); } catch {}
  poll(true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
}

async function poll(first = false) {
  clearTimeout(timer);
  timer = setTimeout(poll, document.hidden ? 120000 : 30000);
  if (document.hidden && !first) return;
  try {
    const r = await api("/api/clinic/alerts");
    if (!r.ok) return;
    set((await r.json()).items || [], !first || seen.size > 0);
  } catch {}
}

function set(list, toastNew) {
  items = list;
  const fresh = list.filter(i => !seen.has(i.key));
  for (const i of list) seen.add(i.key);
  try { sessionStorage.setItem("vz-alert-seen", JSON.stringify([...seen].slice(-300))); } catch {}
  if (toastNew) fresh.slice(0, 3).forEach(toast);
  else if (list.some(i => i.tone === "danger")) list.filter(i => i.tone === "danger").slice(0, 2).forEach(toast);
  onChange(items.length);
  document.querySelectorAll("[data-alert-list]").forEach(render);
}

export const alertCount = () => items.length;

export async function ack(keys) {
  keys = [].concat(keys);
  items = items.filter(i => !keys.includes(i.key));
  onChange(items.length);
  document.querySelectorAll("[data-alert-list]").forEach(render);
  stack?.querySelectorAll(".ca-toast").forEach(t => { if (keys.includes(t.dataset.key)) t.remove(); });
  try {
    const r = await api("/api/clinic/alerts", {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify({keys})});
    if (r.ok) set((await r.json()).items || [], false);
  } catch {}
}

// Gebelik uyarıları: "Arandı" kimin aradığını kaydeder; uyarı "Tamamlandı" denene kadar notla birlikte kalır.
async function called(item) {
  try {
    const r = await api("/api/clinic/alerts", {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify({call: item.key})});
    if (!r.ok) return;
    stack?.querySelector(`[data-key="${CSS.escape(item.key)}"]`)?.remove();
    set((await r.json()).items || [], false);
  } catch {}
}
function callButton(item) {
  if (!item.callable || item.called) return [];
  const b = h("button", "ca-btn", "📞 " + tr("Arandı")); b.type = "button"; b.addEventListener("click", () => called(item));
  return [b];
}

function open(item) {
  if (!item.auto) ack(item.key);
  else stack?.querySelector(`[data-key="${CSS.escape(item.key)}"]`)?.remove();
  location.hash = item.href;
}

function toast(item) {
  if (!stack || stack.querySelector(`[data-key="${CSS.escape(item.key)}"]`)) return;
  const t = h("div", "ca-toast tone-" + item.tone); t.dataset.key = item.key; t.setAttribute("role", item.tone === "danger" ? "alert" : "status");
  const icon = h("span", "ca-toast-icon", ICON[item.kind] || "•"); icon.setAttribute("aria-hidden", "true");
  const body = h("div", "ca-toast-body");
  body.append(h("strong", "", tr(item.title)), h("p", "", item.body));
  const actions = h("div", "ca-toast-actions");
  const go = h("button", "ca-btn primary", tr("Aç")); go.type = "button"; go.addEventListener("click", () => open(item));
  const done = h("button", "ca-btn", tr("Tamamlandı")); done.type = "button"; done.addEventListener("click", () => ack(item.key));
  actions.append(go, ...callButton(item), done);
  body.append(actions);
  const close = h("button", "ca-x", "×"); close.type = "button"; close.setAttribute("aria-label", tr("Kapat")); close.addEventListener("click", () => t.remove());
  t.append(icon, body, close);
  stack.prepend(t);
  while (stack.children.length > 4) stack.lastChild.remove();
  if (item.tone !== "danger") setTimeout(() => t.isConnected && !t.matches(":hover,:focus-within") && t.remove(), 9000);
}

/** Zil panelindeki liste (data-alert-list taşıyan öğeye çizilir). */
export function render(root) {
  root.replaceChildren();
  const head = h("div", "ca-list-head");
  head.append(h("h3", "", tr("Mesajlar, onaylar ve işlem bekleyenler")));
  if (items.length) { const all = h("button", "ca-btn", tr("Tümünü tamamlandı say")); all.type = "button"; all.addEventListener("click", () => ack(items.map(i => i.key))); head.append(all); }
  root.append(head);
  if (!items.length) { root.append(h("p", "ca-empty", tr("Bekleyen bildirim yok. İşlemi tamamlanan bildirimler listeden kaldırılır."))); return; }
  const ul = h("ul", "ca-list");
  for (const item of items) {
    const li = h("li", "tone-" + item.tone);
    const text = h("div", "ca-list-text");
    text.append(h("strong", "", (ICON[item.kind] || "") + " " + tr(item.title)), h("span", "", item.body), h("small", "", ago(item.time)));
    const actions = h("div", "ca-toast-actions");
    const go = h("button", "ca-btn primary", tr("Aç")); go.type = "button"; go.addEventListener("click", () => open(item));
    const done = h("button", "ca-btn", tr("Tamamlandı")); done.type = "button"; done.addEventListener("click", () => ack(item.key));
    actions.append(go, ...callButton(item), done);
    li.append(text, actions);
    ul.append(li);
  }
  root.append(ul);
}
