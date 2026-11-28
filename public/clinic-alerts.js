// Klinik uyarıları: sağ üstte açılan bildirim kartları + zil paneli listesi.
// Yeni uyarı gelince kart düşer (önemli olanlar kapatılana kadar kalır); "Tamamlandı" ya da "Aç" ile işlem yapılan uyarı
// kişi bazında listeden kalkar. Okunan mesaj ve çözülen işler sunucuda kendiliğinden düşer.
const STYLE = "/clinic-alerts.css?v=2";
const ICON = {daily: "📋", pregnancy: "🍼", inbox: "💬", permit: "🛡", job: "⚠", phone: "📱", web: "🌐", subscription: "⏳", device: "🧪", family: "📷", reset: "🔑", stay: "🛏"};
let dailyEditable = false, api, scope, tr = s => s, onChange = () => {}, items = [], seen = new Set(), timer = 0, stack, started = false;

const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? tr("az önce") : s < 3600 ? Math.round(s / 60) + " " + tr("dk önce") : s < 86400 ? Math.round(s / 3600) + " " + tr("sa önce") : new Date(t * 1000).toLocaleDateString("tr-TR"); };

// Sesli uyarı: yeni düşen her bildirimde türüne göre kısa bir ton çalınır. "Ses açık/kapalı" (vetnet-alert-sound) ayarına uyar.
// Tarayıcılar sesi ilk dokunuştan önce engellediği için bekleyen ses ilk tıklama/tuşta çalınır.
let audio = null, pendingTone = "";
const soundOn = () => { try { return localStorage.getItem("vetnet-alert-sound") !== "off"; } catch { return true; } };
const TONES = {
  danger: [[0, 880, .18], [.2, 660, .18], [.4, 880, .22]],
  warn: [[0, 740, .16], [.18, 988, .2]],
  daily: [[0, 523, .18], [.16, 659, .18], [.32, 784, .28]],
  info: [[0, 660, .14], [.14, 880, .18]],
  ok: [[0, 587, .14], [.14, 784, .2]],
};
async function chime(kind) {
  if (!soundOn()) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    audio ||= new Ctx();
    if (audio.state === "suspended") await audio.resume().catch(() => {});
    if (audio.state !== "running") { pendingTone = kind; return; }
    const t0 = audio.currentTime + .02;
    for (const [at, freq, len] of TONES[kind] || TONES.info) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq, t0 + at);
      g.gain.setValueAtTime(1e-4, t0 + at);
      g.gain.exponentialRampToValueAtTime(.22, t0 + at + .02);
      g.gain.exponentialRampToValueAtTime(1e-4, t0 + at + len);
      o.connect(g).connect(audio.destination); o.start(t0 + at); o.stop(t0 + at + len + .02);
    }
    pendingTone = "";
  } catch {}
}
const unlock = () => { if (pendingTone) chime(pendingTone); else if (audio?.state === "suspended") audio.resume().catch(() => {}); };
document.addEventListener("pointerup", unlock, {passive: true});
document.addEventListener("keydown", unlock);

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
    const j = await r.json(); dailyEditable = !!j.dailyEditable;
    set(j.items || [], !first || seen.size > 0);
  } catch {}
}

function set(list, toastNew) {
  items = list;
  const fresh = list.filter(i => !seen.has(i.key));
  for (const i of list) seen.add(i.key);
  try { sessionStorage.setItem("vz-alert-seen", JSON.stringify([...seen].slice(-300))); } catch {}
  // Günlük ekip notu gibi "yapışkan" uyarılar ilk açılışta da düşer ve okunana kadar kalır.
  const shown = [...fresh.filter(i => i.sticky), ...(toastNew ? fresh.filter(i => !i.sticky).slice(0, 3) : [])];
  shown.forEach(toast);
  if (shown.length) {
    const rank = i => i.kind === "daily" ? "daily" : i.tone;
    const order = ["danger", "warn", "daily", "info", "ok"];
    chime(shown.map(rank).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]);
  }
  if (!toastNew && list.some(i => i.tone === "danger")) list.filter(i => i.tone === "danger").slice(0, 2).forEach(toast);
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

// Gün sonu kontrol listesi: her soru ayrı satır; "Okudum" ile bu kişide kaybolur.
function dailyBody(item) {
  const box = h("div", "ca-daily");
  const lines = String(item.body || "").split("\n").filter(Boolean);
  const qs = h("ul", "ca-daily-list");
  const rest = [];
  for (const l of lines) { if (/\?\s*$/.test(l)) { const li = h("li", "", l); qs.append(li); } else rest.push(l); }
  if (qs.children.length) box.append(qs);
  for (const l of rest) box.append(h("p", "ca-daily-note", l));
  return box;
}
function dailyActions(item) {
  const ok = h("button", "ca-btn primary", "✓ " + tr("Okudum")); ok.type = "button"; ok.addEventListener("click", () => ack(item.key));
  const out = [ok];
  if (item.editable || dailyEditable) { const ed = h("button", "ca-btn", tr("Düzenle")); ed.type = "button"; ed.addEventListener("click", openDailyEditor); out.push(ed); }
  return out;
}

export async function openDailyEditor() {
  let data;
  try { const r = await api("/api/clinic/daily-note"); data = await r.json(); if (!r.ok) throw Error(data.error); } catch (e) { alert(e.message || tr("Yüklenemedi.")); return; }
  const dlg = h("dialog", "ca-daily-dialog");
  const form = h("form", "ca-daily-form");
  form.append(h("h2", "", "📋 " + tr("Günlük ekip notu")),
    h("p", "ca-daily-hint", tr("Her gün seçtiğiniz saatte tüm klinik personeline sağ üst bildirim ve uygulama bildirimi olarak gider. Her soru işaretinden sonra yeni satıra geçilir; {klinik} yerine klinik adı yazılır.")));
  const row = h("div", "ca-daily-row");
  const en = Object.assign(h("input"), {type: "checkbox", checked: !!data.enabled});
  const enL = h("label", "ca-daily-check"); enL.append(en, h("span", "", tr("Bildirimi gönder")));
  const time = Object.assign(h("input"), {type: "time", value: data.time || "16:00", required: true});
  const timeL = h("label", "", tr("Saat")); timeL.append(time);
  row.append(enL, timeL);
  const body = Object.assign(h("textarea"), {rows: 12, maxLength: 2000, value: data.body || "", required: true});
  const err = h("p", "ca-daily-err"); err.setAttribute("role", "alert");
  const foot = h("div", "ca-toast-actions");
  const save = h("button", "ca-btn primary", tr("Kaydet")); save.type = "submit";
  const reset = h("button", "ca-btn", tr("Hazır şablona dön")); reset.type = "button"; reset.addEventListener("click", () => { body.value = data.default || ""; });
  const close = h("button", "ca-btn", tr("Kapat")); close.type = "button"; close.addEventListener("click", () => dlg.close());
  foot.append(save, reset, close);
  form.append(row, body, err, foot);
  if (!data.editable) { [en, time, body, save, reset].forEach(x => { x.disabled = true; }); err.textContent = tr("Notu yalnızca klinik yöneticisi düzenleyebilir."); }
  form.addEventListener("submit", async e => {
    e.preventDefault(); save.disabled = true; err.textContent = "";
    try {
      const r = await api("/api/clinic/daily-note", {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify({enabled: en.checked, time: time.value, body: body.value})});
      const j = await r.json(); if (!r.ok) throw Error(j.error || tr("Kaydedilemedi."));
      dlg.close(); poll();
    } catch (x) { err.textContent = x.message; save.disabled = false; }
  });
  dlg.append(form); dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

function toast(item) {
  if (!stack || stack.querySelector(`[data-key="${CSS.escape(item.key)}"]`)) return;
  const t = h("div", "ca-toast tone-" + item.tone); t.dataset.key = item.key; t.setAttribute("role", item.tone === "danger" ? "alert" : "status");
  const icon = h("span", "ca-toast-icon", ICON[item.kind] || "•"); icon.setAttribute("aria-hidden", "true");
  const body = h("div", "ca-toast-body");
  const daily = item.kind === "daily";
  if (daily) t.classList.add("ca-toast-daily");
  body.append(h("strong", "", tr(item.title)), daily ? dailyBody(item) : h("p", "", item.body));
  const actions = h("div", "ca-toast-actions");
  if (daily) actions.append(...dailyActions(item));
  else {
    const go = h("button", "ca-btn primary", tr("Aç")); go.type = "button"; go.addEventListener("click", () => open(item));
    const done = h("button", "ca-btn", tr("Tamamlandı")); done.type = "button"; done.addEventListener("click", () => ack(item.key));
    actions.append(go, ...callButton(item), done);
  }
  body.append(actions);
  const close = h("button", "ca-x", "×"); close.type = "button"; close.setAttribute("aria-label", tr("Kapat")); close.addEventListener("click", () => daily ? ack(item.key) : t.remove());
  t.append(icon, body, close);
  stack.prepend(t);
  while (stack.children.length > 4) stack.lastChild.remove();
  if (item.tone !== "danger" && !item.sticky) setTimeout(() => t.isConnected && !t.matches(":hover,:focus-within") && t.remove(), 9000);
}

/** Zil panelindeki liste (data-alert-list taşıyan öğeye çizilir). */
export function render(root) {
  root.replaceChildren();
  const head = h("div", "ca-list-head");
  head.append(h("h3", "", tr("Mesajlar, onaylar ve işlem bekleyenler")));
  if (dailyEditable) { const d = h("button", "ca-btn", "📋 " + tr("Günlük ekip notu")); d.type = "button"; d.addEventListener("click", openDailyEditor); head.append(d); }
  if (items.length) { const all = h("button", "ca-btn", tr("Tümünü tamamlandı say")); all.type = "button"; all.addEventListener("click", () => ack(items.map(i => i.key))); head.append(all); }
  root.append(head);
  if (!items.length) { root.append(h("p", "ca-empty", tr("Bekleyen bildirim yok. İşlemi tamamlanan bildirimler listeden kaldırılır."))); return; }
  const ul = h("ul", "ca-list");
  for (const item of items) {
    const li = h("li", "tone-" + item.tone);
    const text = h("div", "ca-list-text");
    text.append(h("strong", "", (ICON[item.kind] || "") + " " + tr(item.title)), item.kind === "daily" ? dailyBody(item) : h("span", "", item.body), h("small", "", ago(item.time)));
    const actions = h("div", "ca-toast-actions");
    if (item.kind === "daily") actions.append(...dailyActions(item));
    else {
      const go = h("button", "ca-btn primary", tr("Aç")); go.type = "button"; go.addEventListener("click", () => open(item));
      const done = h("button", "ca-btn", tr("Tamamlandı")); done.type = "button"; done.addEventListener("click", () => ack(item.key));
      actions.append(go, ...callButton(item), done);
    }
    li.append(text, actions);
    ul.append(li);
  }
  root.append(ul);
}
