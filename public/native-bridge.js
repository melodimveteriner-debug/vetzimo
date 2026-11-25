// VetZimo uygulama köprüsü: aynı web arayüzü Android/iOS (Capacitor), Windows/macOS (Electron) ve tarayıcıda (PWA)
// çalışırken işletim sistemi özelliklerini kullanır: push bildirimi, simge rozeti, bildirime dokununca ilgili sayfa,
// izin açıklaması, biyometrik kilit, çevrimdışı bildirimi, sürüm denetimi ve hata raporu. Oturum yoksa hiçbir şey yapmaz.
const cap = window.Capacitor;
const native = !!cap?.isNativePlatform?.();
const desktop = window.vetzimoDesktop || null;
const platform = native ? cap.getPlatform() : desktop ? desktop.platform : "web";
const P = name => native ? cap.Plugins?.[name] : null;
const store = {get: k => { try { return localStorage.getItem("vz-" + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem("vz-" + k, v); } catch {} }};
let cfg = null, scope = "";
const tr = s => (window.vzT ? window.vzT(s) : s);

async function call(path, body) {
  const r = await fetch(path, body ? {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)} : {credentials: "same-origin"});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(d.error || "İşlem tamamlanamadı."); e.status = r.status; throw e; }
  return d;
}

function deviceInfo() {
  const ua = navigator.userAgent;
  return {appVersion: window.VZ_APP_VERSION || desktop?.version || "", osVersion: (ua.match(/(Android [\d.]+|OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+)/) || [""])[0].replace(/_/g, "."), model: "", locale: (navigator.language || "tr").slice(0, 2)};
}

// ── Bildirim izni: önce kısa açıklama, sonra işletim sisteminin gerçek izin penceresi.
function primer() {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = "vz-primer";
    d.innerHTML = `<form method="dialog"><div class="vz-primer-icon" aria-hidden="true">🔔</div><h2></h2><p></p><ul><li></li><li></li><li></li></ul><div class="vz-primer-actions"><button value="later" class="ghost"></button><button value="ok" class="primary"></button></div></form>`;
    d.querySelector("h2").textContent = tr("Önemli gelişmelerden anında haberdar olun");
    d.querySelector("p").textContent = tr("VetZimo yalnız sizin için önemli olanları bildirir. Hangi bildirimlerin geleceğini Ayarlar'dan istediğiniz zaman değiştirebilirsiniz.");
    const li = d.querySelectorAll("li");
    li[0].textContent = tr("Randevu, aşı ve kontrol hatırlatmaları");
    li[1].textContent = tr("Tetkik sonuçları, mesajlar ve evde hizmet durumu");
    li[2].textContent = tr("Hasta bilgileri kilit ekranında gösterilmez");
    d.querySelector('[value="later"]').textContent = tr("Şimdi değil");
    d.querySelector('[value="ok"]').textContent = tr("Bildirimlere izin ver");
    d.addEventListener("close", () => { d.remove(); resolve(d.returnValue === "ok"); });
    document.body.append(d);
    d.showModal();
  });
}

export function permissionState() {
  if (native) return store.get("push-perm") || "prompt";
  if (desktop) return "granted";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}

const CHANNELS = [["appointments", "Randevular", 4], ["vaccines", "Aşı ve kontroller", 3], ["homeVisits", "Evde hizmet", 4], ["patients", "Hasta işlemleri", 3], ["labs", "Tetkik sonuçları", 4],
  ["payments", "Ödeme ve tahsilat", 3], ["stock", "Stok uyarıları", 2], ["messages", "Mesajlar", 4], ["homecare", "Evden takip", 4], ["support", "Destek", 3], ["announcements", "Duyurular", 2], ["security", "Güvenlik", 5], ["system", "Sistem", 4]];

async function registerNative(ask) {
  const Push = P("PushNotifications");
  if (!Push) return false;
  let perm = await Push.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    if (!ask || !(await primer())) return false;
    perm = await Push.requestPermissions();
  }
  store.set("push-perm", perm.receive === "granted" ? "granted" : perm.receive === "denied" ? "denied" : "prompt");
  if (perm.receive !== "granted") return false;
  if (platform === "android") for (const [id, name, importance] of CHANNELS) {
    try { await Push.createChannel({id: "vz_" + id, name: tr(name), importance, visibility: id === "security" || id === "system" ? 1 : 0, sound: cfg?.sound && cfg.sound !== "default" && cfg.sound !== "silent" ? cfg.sound : undefined, vibration: true, lights: true}); } catch {}
  }
  await Push.removeAllListeners?.();
  Push.addListener("registration", async t => {
    try { await call("/api/app/device", {platform, provider: platform === "ios" ? "apns" : "fcm", token: t.value, sound: cfg?.sound, ...deviceInfo()}); } catch {}
  });
  Push.addListener("registrationError", e => report("Push kaydı: " + (e?.error || "")));
  Push.addListener("pushNotificationReceived", n => { inAppToast(n.title, n.body, n.data?.href); refreshBadge(); });
  Push.addListener("pushNotificationActionPerformed", a => open(a.notification?.data || {}));
  await Push.register();
  return true;
}

async function registerWeb(ask) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !cfg?.vapid) return false;
  const reg = await navigator.serviceWorker.ready;
  if (Notification.permission === "default") {
    if (!ask || !(await primer())) return false;
    if ((await Notification.requestPermission()) !== "granted") return false;
  }
  if (Notification.permission !== "granted") return false;
  const key = Uint8Array.from(atob(cfg.vapid.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((cfg.vapid.length + 3) % 4)), c => c.charCodeAt(0));
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
  await call("/api/app/device", {platform: "web", provider: "webpush", subscription: sub.toJSON(), sound: cfg?.sound, ...deviceInfo()});
  return true;
}

export async function enablePush() {
  if (!cfg) await load();
  if (native) {
    const ok = await registerNative(true);
    if (!ok && store.get("push-perm") === "denied") {
      // İzin reddedilmişse kullanıcıyı uygulama ayarlarına yönlendir.
      try { await P("NativeSettings")?.openAndroid?.({option: "application_details"}) ?? await P("App")?.openUrl?.({url: "app-settings:"}); } catch {}
    }
    return ok;
  }
  if (desktop) { await call("/api/app/device", {platform, provider: "desktop", ...deviceInfo()}); return true; }
  if (Notification.permission === "denied") throw Error(tr("Bildirimler tarayıcı ayarlarından engellenmiş. Adres çubuğundaki kilit simgesinden izin verin."));
  return registerWeb(true);
}

export function setSound(sound) { if (cfg) cfg.sound = sound; }

// ── Rozet: okunmamış bildirim sayısı simgede (destekleyen sistemlerde) ve uygulama içinde.
let lastBadge = -1;
export async function refreshBadge(count) {
  if (count == null) { try { count = (await call("/api/app/notifications?unread=1")).unread; } catch { return; } }
  if (count === lastBadge) return;
  lastBadge = count;
  document.documentElement.dataset.unread = String(count);
  window.dispatchEvent(new CustomEvent("vz-unread", {detail: count}));
  try {
    if (native) { const B = P("Badge"); if (B) count ? await B.set({count}) : await B.clear(); }
    else if (desktop) desktop.setBadge(count);
    else if (navigator.setAppBadge) count ? await navigator.setAppBadge(count) : await navigator.clearAppBadge();
  } catch {}
}

// ── Bildirime dokununca: doğru kurum (gerekirse geçiş) ve doğru sayfa; bildirim okundu sayılır.
async function open(data) {
  const id = Number(data.id || 0), href = typeof data.href === "string" && data.href.startsWith("/") ? data.href : "/app", membership = data.membership || "";
  try { if (id) await call("/api/app/notifications", {action: "read", ids: [id]}); } catch {}
  try { if (membership && cfg && membership !== cfg.scope && cfg.role !== "center") await call("/api/identity/select", {membershipId: membership}); } catch {}
  const target = new URL(href, location.origin);
  if (target.pathname === location.pathname && !membership) location.hash = target.hash; else location.assign(target.pathname + target.search + target.hash);
  refreshBadge();
}

function inAppToast(title, body, href) {
  const t = document.createElement("button");
  t.type = "button"; t.className = "vz-inapp";
  t.innerHTML = "<strong></strong><span></span>";
  t.querySelector("strong").textContent = title || "VetZimo";
  t.querySelector("span").textContent = body || "";
  t.addEventListener("click", () => { t.remove(); if (href) open({href}); });
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
}

// ── Masaüstü: işletim sistemi bildirimleri uygulama içinden (push servisi yok).
async function desktopPoll() {
  try {
    const d = await call("/api/app/notifications?unread=1");
    const seen = Number(store.get("desk-last") || 0);
    const fresh = d.items.filter(i => i.id > seen).reverse();
    for (const i of fresh.slice(-3)) desktop.notify({title: i.title, body: i.body || i.clinic, href: i.href, id: i.id, membership: i.membership});
    if (d.items[0]) store.set("desk-last", String(Math.max(seen, d.items[0].id)));
    refreshBadge(d.unread);
  } catch {}
}

// ── Biyometrik kilit (isteğe bağlı): uygulama 5 dakikadan uzun arka planda kalınca Face ID / parmak izi istenir.
let hiddenAt = 0;
async function biometricGate() {
  if (!native || store.get("bio") !== "1") return;
  const Bio = P("BiometricAuth");
  if (!Bio) return;
  const cover = document.createElement("div");
  cover.className = "vz-lock";
  cover.innerHTML = '<div><img src="/vetzimo-pwa-192.png" alt=""><h2>VetZimo kilitli</h2><button type="button" class="primary">Kilidi aç</button><a href="/app" data-out>Çıkış yap</a></div>';
  document.body.append(cover);
  const unlock = async () => { try { await Bio.authenticate({reason: tr("VetZimo'yu açmak için doğrulayın"), cancelTitle: tr("Vazgeç"), allowDeviceCredential: true}); cover.remove(); } catch {} };
  cover.querySelector("button").addEventListener("click", unlock);
  cover.querySelector("[data-out]").addEventListener("click", async e => { e.preventDefault(); try { await fetch("/api/identity/logout", {method: "POST", credentials: "same-origin", headers: {"X-VeTNet-Scope": scope}}); } catch {} location.assign("/app"); });
  unlock();
}
export async function setBiometric(on) {
  const Bio = P("BiometricAuth");
  if (!Bio) throw Error(tr("Bu cihazda biyometrik doğrulama yok."));
  const info = await Bio.checkBiometry();
  if (!info.isAvailable && !info.deviceIsSecure) throw Error(tr("Cihazda Face ID, Touch ID veya parmak izi tanımlı değil."));
  if (on) await Bio.authenticate({reason: tr("Biyometrik kilidi açmak için doğrulayın"), allowDeviceCredential: true});
  store.set("bio", on ? "1" : "0");
}
export const biometricOn = () => store.get("bio") === "1";

// ── Sürüm denetimi (mağaza ve masaüstü uygulamaları)
async function checkRelease() {
  if (!native && !desktop) return;
  let build = 0;
  try { build = native ? Number((await P("App").getInfo()).build) : Number(desktop.build || 0); } catch {}
  try {
    const r = await call(`/api/app/release?platform=${platform}&build=${build}`);
    if (!r.update) return;
    const bar = document.createElement("div");
    bar.className = "vz-update" + (r.required ? " required" : "");
    bar.innerHTML = "<span></span><a target='_blank' rel='noopener'></a>" + (r.required ? "" : "<button type='button' aria-label='Kapat'>×</button>");
    bar.querySelector("span").textContent = r.required ? tr("Devam etmek için VetZimo'yu güncelleyin.") : tr("Yeni VetZimo sürümü hazır") + " (" + r.latest.version + ")";
    const a = bar.querySelector("a"); a.textContent = tr("Güncelle"); a.href = r.latest.url || (platform === "ios" ? "https://apps.apple.com/" : "https://play.google.com/store/apps/details?id=com.vetzimo.app");
    bar.querySelector("button")?.addEventListener("click", () => bar.remove());
    document.body.append(bar);
  } catch {}
}

// ── Hata raporu: sayfa başına en çok 5 hata
let reported = 0;
function report(message, stack = "") {
  if (reported++ >= 5 || !message) return;
  fetch("/api/app/error", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, keepalive: true,
    body: JSON.stringify({platform, message: String(message).slice(0, 480), stack: String(stack).slice(0, 3900), page: location.pathname + location.hash.split("/")[0], version: window.VZ_APP_VERSION || ""})}).catch(() => {});
}
addEventListener("error", e => { if (e.message && !/ResizeObserver|Script error/.test(e.message)) report(e.message, e.error?.stack); });
addEventListener("unhandledrejection", e => { const m = e.reason?.message || String(e.reason || ""); if (m && !/Failed to fetch|NetworkError|AbortError|Load failed/.test(m)) report(m, e.reason?.stack); });

// ── Çevrimdışı bilgilendirme
function offlineBanner() {
  const bar = document.createElement("div");
  bar.className = "vz-offline"; bar.setAttribute("role", "status"); bar.hidden = navigator.onLine;
  bar.textContent = tr("İnternet bağlantısı yok. Bağlantı gelince bildirimler ve kayıtlar kendiliğinden güncellenir.");
  document.body.append(bar);
  addEventListener("offline", () => { bar.hidden = false; });
  addEventListener("online", () => { bar.hidden = true; refreshBadge(); });
}

async function load() {
  cfg = await call("/api/app/config");
  scope = cfg.scope || "";
  return cfg;
}

async function init() {
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/native-bridge.css?v=1"; document.head.append(css);
  if (!native && !desktop && "serviceWorker" in navigator && isSecureContext) navigator.serviceWorker.register("/vetzimo-sw.js", {scope: "/", updateViaCache: "none"}).catch(() => {});
  offlineBanner();
  try { await load(); } catch (e) { return; } // giriş yapılmamış
  document.documentElement.dataset.platform = platform;
  // Bildirimden açıldıysa (servis çalışanı ?vzn=..&vzm=.. ekler)
  const q = new URLSearchParams(location.search);
  if (q.get("vzn") || q.get("vzm")) { const id = q.get("vzn"), m = q.get("vzm"); history.replaceState(null, "", location.pathname + location.hash); if (id) call("/api/app/notifications", {action: "read", ids: [Number(id)]}).catch(() => {}); if (m && m !== cfg.scope && cfg.role !== "center") { try { await call("/api/identity/select", {membershipId: m}); location.reload(); return; } catch {} } }
  navigator.serviceWorker?.addEventListener?.("message", e => { if (e.data?.type === "vz-open") open(e.data); if (e.data?.type === "vz-resubscribe") registerWeb(false).catch(() => {}); });
  // İzin daha önce verildiyse sessizce yeniden kayıt (anahtar yenilenmiş olabilir); verilmediyse soru sorulmaz.
  if (native) registerNative(false).catch(() => {});
  else if (desktop) { call("/api/app/device", {platform, provider: "desktop", ...deviceInfo()}).catch(() => {}); desktop.onOpen?.(open); desktopPoll(); setInterval(() => document.hidden || desktopPoll(), 30000); }
  else if ("Notification" in window && Notification.permission === "granted") registerWeb(false).catch(() => {});
  refreshBadge(cfg.badge);
  setInterval(() => document.hidden || refreshBadge(), 60000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else { refreshBadge(); if (hiddenAt && Date.now() - hiddenAt > 300000) biometricGate(); } });
  if (native) { P("App")?.addListener?.("appUrlOpen", e => { try { const u = new URL(e.url); open({href: u.searchParams.get("href") || u.pathname}); } catch {} }); biometricGate(); }
  checkRelease();
  // Uygulamada ilk girişte bir kez nazikçe sorulur (zorunlu değil); reddedilirse 14 gün tekrar sorulmaz.
  if ((native || matchMedia("(display-mode: standalone)").matches) && permissionState() === "prompt" && Date.now() - Number(store.get("asked") || 0) > 14 * 86400000) {
    store.set("asked", String(Date.now()));
    setTimeout(() => enablePush().catch(() => {}), 4000);
  }
}

window.VetZimoNative = {platform, native, desktop: !!desktop, enablePush, permissionState, setSound, refreshBadge, setBiometric, biometricOn, open};
window.vzEnablePush = enablePush;
init();
