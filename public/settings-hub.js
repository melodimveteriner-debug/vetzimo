// Ayarlar merkezi: dağınık ayar sayfaları tek yerde, kategorilere ayrılmış sekmelerde. Her kart yalnız kullanıcının
// yetkili olduğu sayfayı gösterir; alt sayfalarda üstte "Ayarlar › kategori" şeridi ve kardeş sekmeler çıkar.
// Uygulama bildirim tercihleri (kategori sessize alma, ses, sessiz saatler), cihazlar ve hesap silme burada çalışır.
const STYLE = "/settings-hub.css?v=1";
export const GROUPS = [
  ["klinik", "Klinik", [
    ["settings", "Genel ayarlar", "Klinik adı, logo, iletişim, çalışma saatleri ve varsayılanlar"],
    ["branches", "Şubeler", "Şube bilgileri ve şubeler arası paylaşım"],
    ["services", "Hizmetler", "Hizmet listesi ve fiyatlar"],
    ["cikti-sablonlari", "Çıktı şablonları", "Reçete, fatura, onam ve rapor çıktıları"],
    ["google-yorum", "Google yorum bağlantısı", "Evde hizmet sonrası hasta sahibine gidecek değerlendirme bağlantısı"],
    ["hasta-sahibi-odemeleri", "Hasta sahibi ödemeleri", "Borcu olan hasta sahipleri kartla (PayTR) veya havale ile öder; havale onayları"],
  ]],
  ["ekip", "Ekip ve yetkiler", [
    ["users", "Kullanıcı ve ekip", "Personel hesapları ve roller"],
    ["merkezi-hesaplar", "Şube · kullanıcı · hasta sahibi yetkileri", "Kim neyi görür, hangi özellik açık"],
    ["bayi-yetkiler", "Şube ve kullanıcı yetkileri", "Bayi düzeyinde yetki matrisi"],
    ["bayi-admin", "Bayi yönetimi", "Bayi bilgileri ve şubeler"],
    ["personel-plani", "Vardiya ve izinler", "Çalışma planı, izin ve nöbet"],
    ["iki-adimli-dogrulama", "İki adımlı doğrulama", "Ekip hesapları için ek güvenlik"],
  ]],
  ["iletisim", "İletişim ve bildirimler", [
    ["bildirimler", "Uygulama bildirimleri", "Telefon, tablet ve bilgisayar bildirimleri, sesler, sessiz saatler"],
    ["bildirim-merkezi", "Bildirim merkezi (e-posta)", "Hasta sahibine giden e-posta bildirimleri"],
    ["hatirlaticilar", "Müşteri hatırlatıcıları", "Aşı, randevu ve borç hatırlatmaları"],
    ["templates", "Mesaj şablonları", "SMS ve WhatsApp metinleri"],
    ["messages", "SMS ve WhatsApp", "Gönderim ayarları"],
    ["telefon-baglantisi", "Telefon bağlantısı", "Kliniğin kendi hattından SMS ve WhatsApp"],
    ["gelen-kutusu", "Gelen kutusu kanalları", "WhatsApp, Instagram, Facebook, Telegram, e-posta"],
    ["bildirim-epostasi", "Bildirim e-postası", "Kliniğe gelen sistem e-postaları"],
  ]],
  ["entegrasyon", "Entegrasyonlar", [
    ["cihaz-entegrasyonu", "Cihaz entegrasyonu", "Hemogram, biyokimya, kan gazı, idrar, röntgen, ultrason, MR ve tomografi"],
    ["e-belgeler", "e-Fatura / e-Arşiv / e-SMM", "Ajanla API'siz e-belge"],
    ["bakanlik-koprusu", "Bakanlık köprüsü", "e-Reçete ve aşı kayıtları"],
    ["ajanlar", "Ajanlar ve indirmeler", "Klinik ajanı ve telefon ajanı kurulum dosyaları"],
    ["okc", "Yazar kasa (ÖKC)", "Ödeme kaydedici cihazlar"],
    ["web-sitem", "Web sitesi", "Klinik web sitesi ve online randevu"],
    ["evde-hizmet", "Evde hizmet", "Bölgeler, fiyatlar ve rota"],
  ]],
  ["gorunum", "Görünüm ve ses", [
    ["tema", "Tema", "Prizma · Işıltı, Nebula veya Orkide · Safir"],
    ["bas-konus", "Bas Konuş", "Sesli komut ve dikte ayarları"],
  ]],
  ["hesap", "Hesap ve abonelik", [
    ["hesap-ayarlari", "Hesap ayarları", "Şifre ve oturum"],
    ["abonelik", "Abonelik", "Paket ve bitiş tarihi"],
    ["kredi-magazasi", "Abonelik mağazası", "Paket yükseltme ve online ödeme"],
    ["bayi-hesabim", "Aylık gönderim hakkı", "SMS ve WhatsApp kullanımı"],
    ["cihazlarim", "Cihazlarım ve hesabımı sil", "Bildirim alan cihazlar, hesap silme talebi"],
    ["kurum-sec", "Kurum değiştir", "Birden fazla klinikte çalışanlar için"],
  ]],
  ["veri", "Veri", [
    ["import", "Yedekleme ve içe aktarma", "Excel/CSV, diğer yazılımlardan aktarma, yedek"],
    ["activity", "İşlem geçmişi", "Kim, ne zaman, ne yaptı"],
    ["son-degisiklikler", "Son değişiklikler", "VetZimo sürüm notları"],
  ]],
];
const INLINE = new Set(["bildirimler", "cihazlarim", "tema", "bas-konus", "google-yorum", "ajanlar", "hasta-sahibi-odemeleri"]);
const ROUTE_GROUP = Object.fromEntries(GROUPS.flatMap(([g, , items]) => items.map(([r]) => [r, g])));
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const css = () => { if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE})); };

/** ctx: {allowed(route), tr, api(path, init), scope, openTheme(), openVoice(), inline: {google-yorum: fn(root)}} */
export function mountSettingsHub(root, ctx) {
  css();
  const tr = ctx.tr || (s => s);
  const visible = GROUPS.map(([k, l, items]) => [k, l, items.filter(([r]) => INLINE.has(r) ? (ctx.inlineAllowed?.(r) ?? true) : ctx.allowed(r))]).filter(([, , items]) => items.length);
  let tab = (new URLSearchParams(location.hash.split("?")[1] || "").get("sekme")) || sessionStorage.getItem("vz-settings-tab") || visible[0]?.[0];
  if (!visible.some(([k]) => k === tab)) tab = visible[0]?.[0];
  const wrap = h("section", "sh-root");
  const head = h("header", "sh-head");
  head.append(h("h2", "", tr("Ayarlar")), h("p", "", tr("Kliniğinizin tüm ayarları tek yerde. Yalnız yetkili olduğunuz bölümler görünür.")));
  const search = h("input", "sh-search", null, {type: "search", placeholder: tr("Ayar ara…"), autocomplete: "off"});
  search.setAttribute("aria-label", tr("Ayar ara"));
  head.append(search);
  const nav = h("div", "sh-tabs"); nav.setAttribute("role", "tablist");
  const body = h("div", "sh-body");
  wrap.append(head, nav, body);
  root.replaceChildren(wrap);
  const card = ([route, title, desc]) => {
    const a = h("a", "sh-card", null, {href: INLINE.has(route) ? "#ayarlar?sekme=" + ROUTE_GROUP[route] + "&bolum=" + route : "#" + route});
    a.append(h("strong", "", tr(title)), h("span", "", tr(desc)));
    if (INLINE.has(route)) a.addEventListener("click", e => { e.preventDefault(); openInline(route, title); });
    else a.addEventListener("click", () => { try { sessionStorage.setItem("vz-sh", "1"); } catch {} });
    return a;
  };
  function openInline(route, title) {
    if (route === "tema") return ctx.openTheme?.();
    if (route === "bas-konus") return ctx.openVoice?.();
    const panel = h("div", "sh-inline");
    const back = h("button", "sh-back", null, {type: "button"}); back.append(h("span", "", "← "), h("span", "", tr("Ayarlar")));
    back.addEventListener("click", draw);
    panel.append(back, h("h3", "", tr(title)));
    const area = h("div", "sh-inline-body");
    panel.append(area);
    body.replaceChildren(panel);
    if (route === "bildirimler") notificationPrefs(area, ctx);
    else if (route === "cihazlarim") devicesAndAccount(area, ctx);
    else if (route === "ajanlar") import("./agent-access.js?v=1").then(m => m.mountAgentDownloads(area, {tr}));
    else if (route === "hasta-sahibi-odemeleri") import("./owner-pay.js?v=1").then(m => m.mountOwnerPayAdmin(area, {api: ctx.api, scope: ctx.scope, tr}));
    else ctx.inline?.[route]?.(area);
  }
  function draw() {
    const q = search.value.trim().toLocaleLowerCase("tr");
    nav.hidden = !!q;
    nav.replaceChildren(...visible.map(([k, l]) => {
      const b = h("button", "sh-tab", tr(l), {type: "button"}); b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === tab));
      b.addEventListener("click", () => { tab = k; try { sessionStorage.setItem("vz-settings-tab", k); } catch {} draw(); });
      return b;
    }));
    const items = q ? visible.flatMap(([, , it]) => it).filter(([, t, d]) => (tr(t) + " " + tr(d)).toLocaleLowerCase("tr").includes(q)) : (visible.find(([k]) => k === tab)?.[2] || []);
    const grid = h("div", "sh-grid");
    items.forEach(i => grid.append(card(i)));
    body.replaceChildren(items.length ? grid : h("p", "sh-empty", tr("Eşleşen ayar bulunamadı.")));
  }
  search.addEventListener("input", draw);
  draw();
  const want = new URLSearchParams(location.hash.split("?")[1] || "").get("bolum");
  if (want && INLINE.has(want)) { const it = GROUPS.flatMap(([, , x]) => x).find(([r]) => r === want); if (it) openInline(want, it[1]); }
}

/** Ayar alt sayfalarında üst şerit: Ayarlar › kategori ve kardeş sekmeler. */
export function settingsCrumb(route, main, ctx) {
  const g = ROUTE_GROUP[route];
  main.querySelector(":scope > .sh-crumb")?.remove();
  if (!g || !main) return;
  css();
  const tr = ctx.tr || (s => s);
  const [, label, items] = GROUPS.find(([k]) => k === g);
  const bar = h("nav", "sh-crumb"); bar.setAttribute("aria-label", tr("Ayarlar"));
  const top = h("div", "sh-crumb-top");
  const home = h("a", "", null, {href: "#ayarlar?sekme=" + g}); home.append(h("span", "", "← "), h("span", "", tr("Ayarlar")));
  top.append(home, h("span", "", "›"), h("strong", "", tr(label)));
  const tabs = h("div", "sh-crumb-tabs");
  items.filter(([r]) => INLINE.has(r) ? false : ctx.allowed(r)).forEach(([r, t]) => {
    const a = h("a", r === route ? "on" : "", tr(t), {href: "#" + r}); if (r === route) a.setAttribute("aria-current", "page");
    a.addEventListener("click", () => { try { sessionStorage.setItem("vz-sh", "1"); } catch {} });
    tabs.append(a);
  });
  bar.append(top, tabs);
  const nav = main.querySelector(":scope > .module-nav");
  nav ? nav.after(bar) : main.prepend(bar);
}

async function json(ctx, path, body) {
  const r = await ctx.api(path, body ? {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": ctx.scope}, body: JSON.stringify(body)} : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "İşlem tamamlanamadı.");
  return d;
}

const SOUND = {default: "Sistem sesi", vz_chime: "VetZimo · çan", vz_soft: "VetZimo · yumuşak", vz_alert: "VetZimo · dikkat", silent: "Sessiz"};

export async function notificationPrefs(root, ctx) {
  const tr = ctx.tr || (s => s);
  let s;
  try { s = await json(ctx, "/api/app/config"); } catch (e) { root.replaceChildren(h("p", "sh-error", e.message)); return; }
  const native = window.VetZimoNative;
  const form = h("form", "sh-form");
  const status = h("p", "sh-status", "", {hidden: true});
  const permission = h("div", "sh-perm");
  const permText = () => native?.permissionState?.() || (typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const drawPerm = () => {
    const st = permText();
    permission.replaceChildren(h("strong", "", tr("Bu cihaz")), h("span", "", st === "granted" ? tr("Bildirimler açık") : st === "denied" ? tr("Bildirimler cihaz ayarlarından kapatılmış") : st === "unsupported" ? tr("Bu tarayıcı bildirim desteklemiyor") : tr("Bildirim izni henüz verilmedi")));
    if (st !== "granted" && st !== "unsupported") {
      const b = h("button", "sh-btn primary", st === "denied" ? tr("Cihaz ayarlarını aç") : tr("Bildirimleri aç"), {type: "button"});
      b.addEventListener("click", async () => {
        try { await (native?.enablePush?.() ?? window.vzEnablePush?.()); } catch (e) { status.hidden = false; status.textContent = e.message; }
        drawPerm();
      });
      permission.append(b);
    }
  };
  drawPerm();
  const cats = h("fieldset", "sh-cats"); cats.append(h("legend", "", tr("Hangi bildirimler gelsin?")));
  s.categories.forEach(c => {
    const l = h("label", "sh-switch"); const i = h("input", "", null, {type: "checkbox", name: "cat", value: c.key, checked: c.critical || !s.muted.includes(c.key), disabled: c.critical});
    l.append(i, h("span", "", tr(c.label)), c.critical ? h("small", "", tr("Kapatılamaz")) : ""); cats.append(l);
  });
  const sound = h("select", "", null, {name: "sound"}); s.sounds.forEach(k => sound.append(new Option(tr(SOUND[k] || k), k, false, k === s.sound)));
  const try1 = h("button", "sh-btn", tr("Dinle"), {type: "button"});
  try1.addEventListener("click", () => { if (sound.value !== "silent") new Audio("/sounds/" + (sound.value === "default" ? "vz_chime" : sound.value) + ".wav").play().catch(() => {}); });
  const soundRow = h("div", "sh-row"); soundRow.append(h("label", "sh-field", null), try1); soundRow.firstChild.append(h("span", "", tr("Bildirim sesi")), sound);
  const quietOn = h("input", "", null, {type: "checkbox", checked: !!s.quiet?.on});
  const from = h("input", "", null, {type: "time", value: s.quiet?.from || "22:00"}), to = h("input", "", null, {type: "time", value: s.quiet?.to || "08:00"});
  const quiet = h("div", "sh-row"); const ql = h("label", "sh-switch"); ql.append(quietOn, h("span", "", tr("Sessiz saatler (kritik bildirimler yine gelir)")));
  quiet.append(ql, from, h("span", "", "–"), to);
  form.append(permission, cats, soundRow, quiet, h("button", "sh-btn primary", tr("Kaydet"), {type: "submit"}), status);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const muted = [...cats.querySelectorAll("input:not(:checked):not(:disabled)")].map(i => i.value);
    try {
      s = await json(ctx, "/api/app/preferences", {muted, sound: sound.value, quiet: {on: quietOn.checked, from: from.value, to: to.value}});
      status.hidden = false; status.textContent = tr("Kaydedildi."); native?.setSound?.(sound.value);
    } catch (er) { status.hidden = false; status.textContent = er.message; }
  });
  root.replaceChildren(form);
}

const PLATFORM = {android: "Android", ios: "iPhone / iPad", web: "Tarayıcı", windows: "Windows", macos: "macOS", linux: "Linux"};

export async function devicesAndAccount(root, ctx) {
  const tr = ctx.tr || (s => s);
  let s;
  try { s = await json(ctx, "/api/app/config"); } catch (e) { root.replaceChildren(h("p", "sh-error", e.message)); return; }
  const list = h("ul", "sh-devices");
  const draw = () => list.replaceChildren(...(s.devices.length ? s.devices.map(d => {
    const li = h("li"); li.append(h("strong", "", (PLATFORM[d.platform] || d.platform) + (d.model ? " · " + d.model : "")), h("span", "", tr("Son görülme") + ": " + new Date(d.seen_at * 1000).toLocaleString()));
    const b = h("button", "sh-btn", tr("Kaldır"), {type: "button"});
    b.addEventListener("click", async () => { s = await json(ctx, "/api/app/device", {action: "revoke", id: d.id}); draw(); });
    li.append(b); return li;
  }) : [h("li", "sh-empty", tr("Bildirim alan cihaz yok."))]));
  draw();
  const del = h("form", "sh-danger");
  const state = await json(ctx, "/api/app/deletion").catch(() => null);
  del.append(h("h4", "", tr("Hesabımı sil")), h("p", "", tr("Giriş bilgileriniz, cihaz kayıtlarınız ve bildirimleriniz silinir. Kliniklerin tuttuğu tıbbi kayıtlar yasal saklama yükümlülüğü nedeniyle klinikte kalır.")));
  if (state?.status === "pending") del.append(h("p", "sh-status", tr("Silme talebiniz alındı; en geç 30 gün içinde tamamlanır.")));
  else if (state) {
    const pw = h("input", "", null, {type: "password", autocomplete: "current-password", required: true, placeholder: tr("Şifreniz")});
    const ok = h("input", "", null, {type: "checkbox", required: true}); const l = h("label", "sh-switch"); l.append(ok, h("span", "", tr("Hesabımın silinmesini istiyorum.")));
    const msg = h("p", "sh-status", "", {hidden: true});
    del.append(pw, l, h("button", "sh-btn danger", tr("Silme talebi gönder"), {type: "submit"}), msg);
    del.addEventListener("submit", async e => { e.preventDefault(); try { await json(ctx, "/api/app/deletion", {confirm: true, password: pw.value}); msg.hidden = false; msg.textContent = tr("Silme talebiniz alındı; en geç 30 gün içinde tamamlanır."); pw.value = ""; } catch (er) { msg.hidden = false; msg.textContent = er.message; } });
  } else del.append(h("p", "", tr("Bu hesap türü uygulama üzerinden silinemez; VetZimo destek ile iletişime geçin.")));
  const extra = [];
  const N = window.VetZimoNative;
  if (N?.native) {
    // Uygulamada: Face ID / Touch ID / parmak izi ile kilit (uygulama 5 dk arka planda kalınca)
    const bio = h("input", "", null, {type: "checkbox", checked: N.biometricOn()});
    const l = h("label", "sh-switch"); l.append(bio, h("span", "", tr("Biyometrik kilit (Face ID, Touch ID veya parmak izi)")));
    const msg = h("p", "sh-status", "", {hidden: true});
    bio.addEventListener("change", async () => { try { await N.setBiometric(bio.checked); msg.hidden = false; msg.textContent = bio.checked ? tr("Biyometrik kilit açıldı.") : tr("Biyometrik kilit kapatıldı."); } catch (e) { bio.checked = !bio.checked; msg.hidden = false; msg.textContent = e.message; } });
    extra.push(h("h4", "", tr("Güvenlik")), l, msg);
  }
  root.replaceChildren(...extra, h("h4", "", tr("Bildirim alan cihazlar")), list, del);
}
