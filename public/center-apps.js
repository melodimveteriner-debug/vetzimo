// Merkez · Uygulama Yönetimi: cihazlar, push durumu, bildirim politikaları (kritik / isteğe bağlı ayrı), kilit ekranı
// şablonları, duyuru, sürüm yayını, uygulama hataları, hesap silme talepleri ve FCM/APNs/Web Push ayarları.
const STYLE = "/center-apps.css?v=1";
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const date = t => t ? new Date(Number(t) * 1000).toLocaleString("tr-TR", {dateStyle: "short", timeStyle: "short"}) : "—";
const PLATFORM = {android: "Android", ios: "iPhone / iPad", web: "Web / PWA", windows: "Windows", macos: "macOS", linux: "Linux"};
const PROVIDER = {fcm: "Firebase (FCM)", apns: "Apple (APNs)", webpush: "Web Push", desktop: "Masaüstü bildirimi"};
const STATUS = {sent: "Teslim edildi", failed: "Başarısız", invalid: "Geçersiz anahtar (kapatıldı)", skipped: "Atlandı (okundu / ayarsız)", muted: "Kullanıcı sessize aldı", quiet: "Sessiz saatte", queued: "Sırada", retry: "Yeniden denenecek"};

export async function mountApps(root, {fetch: api, scope, reauth, tr = s => s}) {
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  const endpoint = "/api/center/app-management";
  let data = await api(endpoint, null, scope);
  let tab = sessionStorage.getItem("vz-apps-tab") || "overview";
  const wrap = h("div", "capp");
  const nav = h("div", "capp-tabs"); nav.setAttribute("role", "tablist");
  const body = h("div", "capp-body");
  const note = h("p", "capp-note", "", {hidden: true});
  wrap.append(nav, note, body);
  root.replaceChildren(wrap);
  const tabs = [["overview", "Genel durum"], ["policy", "Bildirim politikaları"], ["templates", "Kilit ekranı metinleri"], ["announce", "Duyuru gönder"],
    ["releases", "Sürümler"], ["errors", "Uygulama hataları"], ["deletion", "Hesap silme"], ["providers", "Push ayarları"]];
  const say = (text, bad = false) => { note.hidden = !text; note.textContent = text || ""; note.classList.toggle("bad", bad); };
  const send = async (payload, done) => {
    if (reauth) { say(tr("Değişiklik için merkez oturumunu yeniden doğrulayın (Güvenlik sekmesi)."), true); return; }
    try { data = await api(endpoint, payload, scope); say(done || tr("Kaydedildi.")); draw(); } catch (e) { say(e.message, true); }
  };
  const table = (head, rows) => {
    if (!rows.length) return h("p", "capp-empty", tr("Kayıt yok."));
    const w = h("div", "capp-table"), t = h("table"); const tr0 = t.createTHead().insertRow();
    head.forEach(x => tr0.append(h("th", "", x)));
    const tb = t.createTBody();
    rows.forEach(r => { const row = tb.insertRow(); r.forEach(c => { const td = row.insertCell(); c instanceof Node ? td.append(c) : td.textContent = c ?? "—"; }); });
    w.append(t); return w;
  };
  const btn = (text, fn, cls = "") => { const b = h("button", "capp-btn " + cls, text, {type: "button"}); b.addEventListener("click", fn); return b; };
  const field = (label, input) => { const l = h("label", "capp-field"); l.append(h("span", "", label), input); return l; };

  const views = {
    overview() {
      const t = data.totals || {}; const push = Object.fromEntries((data.push || []).map(r => [r.status, Number(r.total)]));
      const sent = push.sent || 0, fail = (push.failed || 0) + (push.invalid || 0);
      const tiles = h("div", "capp-tiles");
      [[tr("Etkin cihaz"), t.devices || 0], [tr("Uygulama kullanan hesap"), t.accounts || 0], [tr("7 günde teslim edilen push"), sent],
        [tr("Teslim oranı"), sent + fail ? Math.round(sent * 100 / (sent + fail)) + "%" : "—"]].forEach(([k, v]) => { const d = h("div", "capp-tile"); d.append(h("span", "", k), h("strong", "", String(v))); tiles.append(d); });
      const prov = data.providers || {};
      const chips = h("div", "capp-chips");
      [["Android · FCM", prov.fcm], ["iOS · APNs", prov.apns], ["Web / PWA · Web Push", prov.webpush], ["Masaüstü bildirimi", true]].forEach(([k, on]) => chips.append(h("span", "capp-chip " + (on ? "on" : "off"), (on ? "● " : "○ ") + k + (on ? "" : " · " + tr("ayar bekliyor")))));
      body.replaceChildren(tiles, chips, h("h4", "", tr("Son 14 günde push")), chart(data.pushByDay || []),
        h("h4", "", tr("Platform ve sürüme göre cihazlar")),
        table([tr("Platform"), tr("Kanal"), tr("Sürüm"), tr("Cihaz"), tr("Son 7 günde aktif")], (data.devices || []).map(r => [PLATFORM[r.platform] || r.platform, PROVIDER[r.provider] || r.provider, r.app_version || "—", r.total, r.week])),
        h("h4", "", tr("Gönderim durumları (7 gün)")), table([tr("Durum"), tr("Adet")], (data.push || []).map(r => [tr(STATUS[r.status] || r.status), r.total])));
    },
    policy() {
      const cats = data.categories, roles = Object.entries(data.roles);
      const block = (title, desc, list) => {
        const sec = h("section", "capp-sec"); sec.append(h("h4", "", title), h("p", "capp-muted", desc));
        sec.append(table([tr("Kategori"), ...roles.map(([, l]) => tr(l))], list.map(c => [tr(c.label) + (c.private ? " 🔒" : ""), ...roles.map(([role, l]) => {
          const on = data.policies[c.key]?.[role];
          if (c.critical) return h("span", "capp-lock", on ? tr("Her zaman açık") : "—");
          const b = btn(on ? tr("Açık") : tr("Kapalı"), () => send({action: "policy", category: c.key, role, enabled: !on}), on ? "on" : "off");
          b.setAttribute("aria-pressed", String(!!on)); b.setAttribute("aria-label", tr(c.label) + " · " + tr(l));
          return b;
        })])));
        return sec;
      };
      body.replaceChildren(
        block(tr("Kritik sistem bildirimleri"), tr("Güvenlik ve sistem uyarıları kapatılamaz; kullanıcılar da sessize alamaz."), cats.filter(c => c.critical)),
        block(tr("İsteğe bağlı bilgilendirmeler"), tr("Her kategori role göre açılıp kapatılır. Kullanıcılar kendi cihazlarında ayrıca sessize alabilir. 🔒 işaretli kategorilerde kilit ekranında ayrıntı gösterilmez."), cats.filter(c => !c.critical)));
    },
    templates() {
      const list = h("div", "capp-grid");
      data.categories.forEach(c => {
        const t = data.templates[c.key]; const card = h("form", "capp-card");
        const title = h("input", "", null, {value: t.title, maxLength: 80, required: true}); const text = h("input", "", null, {value: t.body, maxLength: 160});
        card.append(h("strong", "", tr(c.label) + (c.private ? " 🔒" : "")), field(tr("Başlık"), title), field(c.private ? tr("Kilit ekranı metni (ayrıntı gizli)") : tr("Ön ek (isteğe bağlı)"), text), h("button", "capp-btn primary", tr("Kaydet"), {type: "submit"}));
        card.addEventListener("submit", e => { e.preventDefault(); send({action: "template", category: c.key, title: title.value, body: text.value}); });
        list.append(card);
      });
      body.replaceChildren(h("p", "capp-muted", tr("Push bildiriminin kilit ekranında görünen metni. Hassas kategorilerde hasta, tutar veya mesaj içeriği yerine bu genel metin gösterilir; ayrıntı uygulama açılınca oturum doğrulanarak görünür.")), list);
    },
    announce() {
      const f = h("form", "capp-card wide");
      const title = h("input", "", null, {maxLength: 120, required: true, placeholder: tr("Örn. Planlı bakım")});
      const text = h("textarea", "", null, {maxLength: 400, rows: 3, placeholder: tr("Kısa açıklama")});
      const roles = h("div", "capp-checks");
      [["dealer", "Bayi yöneticisi"], ["branch", "Şube yöneticisi"], ["staff", "Personel"], ["customer", "Hasta sahibi"]].forEach(([k, l]) => {
        const c = h("label"); const i = h("input", "", null, {type: "checkbox", value: k, checked: k !== "customer"}); c.append(i, " " + tr(l)); roles.append(c);
      });
      f.append(field(tr("Başlık"), title), field(tr("Metin"), text), h("span", "capp-muted", tr("Kime gönderilsin?")), roles, h("button", "capp-btn primary", tr("Duyuruyu gönder"), {type: "submit"}));
      f.addEventListener("submit", async e => {
        e.preventDefault();
        const picked = [...roles.querySelectorAll("input:checked")].map(i => i.value);
        if (reauth) return say(tr("Değişiklik için merkez oturumunu yeniden doğrulayın (Güvenlik sekmesi)."), true);
        try { const r = await api(endpoint, {action: "announce", title: title.value, body: text.value, roles: picked}, scope); data = r; say(tr("Duyuru gönderildi") + ": " + r.sent); f.reset(); } catch (er) { say(er.message, true); }
      });
      body.replaceChildren(f);
    },
    releases() {
      const f = h("form", "capp-card wide");
      const plat = h("select"); Object.entries(PLATFORM).forEach(([k, l]) => plat.append(new Option(l, k)));
      const ver = h("input", "", null, {placeholder: "1.0.0", required: true, maxLength: 32}), build = h("input", "", null, {type: "number", min: 1, required: true, placeholder: "1"});
      const min = h("input", "", null, {type: "number", min: 0, value: 0}), url = h("input", "", null, {type: "url", placeholder: "https://play.google.com/store/apps/details?id=com.vetzimo.app"});
      const notes = h("textarea", "", null, {rows: 2, maxLength: 1000}); const pub = h("input", "", null, {type: "checkbox", checked: true});
      const pl = h("label", "capp-inline"); pl.append(pub, " " + tr("Hemen yayınla"));
      f.append(field(tr("Platform"), plat), field(tr("Sürüm"), ver), field(tr("Derleme no"), build), field(tr("Zorunlu en düşük derleme"), min), field(tr("Mağaza / indirme adresi"), url), field(tr("Sürüm notları"), notes), pl, h("button", "capp-btn primary", tr("Sürümü kaydet"), {type: "submit"}));
      f.addEventListener("submit", e => { e.preventDefault(); send({action: "release", platform: plat.value, version: ver.value, build: Number(build.value), minBuild: Number(min.value), url: url.value, notes: notes.value, publish: pub.checked}); });
      body.replaceChildren(h("p", "capp-muted", tr("Uygulama açılışta sürümünü sorar. Derlemesi en son sürümden eskiyse güncelleme önerilir; zorunlu sürümün altındaysa güncellemeden devam edilmez.")), f,
        table([tr("Platform"), tr("Sürüm"), tr("Derleme"), tr("Zorunlu"), tr("Yayın"), ""], (data.releases || []).map(r => [PLATFORM[r.platform], r.version, r.build, r.min_build, r.published_at ? date(r.published_at) : tr("Taslak"),
          btn(tr("Sil"), () => send({action: "releaseDelete", id: r.id}), "danger")])));
    },
    errors() {
      body.replaceChildren(h("div", "capp-row-end", null), table([tr("Son görülme"), tr("Platform"), tr("Sürüm"), tr("Hata"), tr("Sayfa"), tr("Adet"), ""],
        (data.errors || []).map(r => [date(r.last_at), PLATFORM[r.platform] || r.platform, r.version || "—", r.message, r.page || "—", r.count, btn(tr("Çözüldü"), () => send({action: "errorDelete", id: r.id}))])));
      if ((data.errors || []).length) body.firstChild.append(btn(tr("Tümünü temizle"), () => send({action: "errorDelete", id: "all"}), "danger"));
    },
    deletion() {
      const LABEL = {pending: "Bekliyor", done: "Tamamlandı", rejected: "Reddedildi"};
      body.replaceChildren(h("p", "capp-muted", tr("Tamamlandığında giriş bilgileri anonimleşir; oturumlar, cihazlar, bildirimler ve üyelikler kapanır. Kliniklerin tıbbi kayıtları yasal saklama gereği klinikte kalır. Mağaza kuralı gereği talepler en geç 30 gün içinde işlenmelidir.")),
        table([tr("Hesap"), tr("Talep"), tr("Durum"), tr("İşlem")], (data.deletionRequests || []).map(r => {
          const cell = h("div", "capp-actions");
          if (r.status === "pending") cell.append(btn(tr("Sil ve tamamla"), () => send({action: "deletion", account: r.account_id, decision: "done"}, tr("Hesap silindi.")), "danger"), btn(tr("Reddet"), () => send({action: "deletion", account: r.account_id, decision: "rejected", note: "Kimlik doğrulanamadı"})));
          else cell.append(h("span", "", date(r.processed_at)));
          const id = r.identifier && !String(r.identifier).startsWith("silindi:") ? String(r.identifier).replace(/^(\+?\d{3})\d+(\d{2})$/, "$1•••••$2") : "—";
          return [id, date(r.requested_at), tr(LABEL[r.status] || r.status), cell];
        })));
    },
    providers() {
      const p = data.providers || {};
      const f = h("form", "capp-card wide");
      const fcmProject = h("input", "", null, {value: p.fcmProject || "", placeholder: "vetzimo-app", maxLength: 64});
      const fcmCred = h("textarea", "", null, {rows: 3, placeholder: p.fcm ? tr("Kayıtlı · değiştirmek için yeni JSON yapıştırın") : tr("Firebase › Proje ayarları › Hizmet hesapları › Yeni özel anahtar (JSON)")});
      const keyId = h("input", "", null, {value: p.apnsKeyId || "", placeholder: "ABC123DEFG", maxLength: 10}), team = h("input", "", null, {value: p.apnsTeamId || "", placeholder: "TEAM123456", maxLength: 10});
      const topic = h("input", "", null, {value: p.apnsTopic || "com.vetzimo.app", maxLength: 120});
      const p8 = h("textarea", "", null, {rows: 3, placeholder: p.apns ? tr("Kayıtlı · değiştirmek için yeni .p8 içeriği yapıştırın") : "-----BEGIN PRIVATE KEY-----"});
      const sandbox = h("input", "", null, {type: "checkbox", checked: !!p.apnsSandbox}); const sl = h("label", "capp-inline"); sl.append(sandbox, " " + tr("Geliştirme (sandbox) ortamı"));
      const contact = h("input", "", null, {value: p.contact || "https://vetzimo.com", maxLength: 140});
      const sha = h("input", "", null, {value: p.androidSha256 || "", placeholder: "AA:BB:CC:…", maxLength: 95});
      f.append(h("h4", "", "Android · Firebase Cloud Messaging"), field(tr("Proje kimliği"), fcmProject), field(tr("Hizmet hesabı JSON"), fcmCred),
        h("h4", "", "iPhone / iPad · Apple Push Notification service"), field(tr("Anahtar kimliği (Key ID)"), keyId), field(tr("Ekip kimliği (Team ID)"), team), field(tr("Paket kimliği (Bundle ID)"), topic), field(tr("APNs .p8 anahtarı"), p8), sl,
        h("h4", "", "Web / PWA · Web Push (VAPID)"), h("p", "capp-muted", tr("Hesap gerektirmez, ücretsizdir; anahtar otomatik üretildi.") + " " + (p.vapid ? p.vapid.slice(0, 22) + "…" : "")), field(tr("İletişim adresi (VAPID)"), contact),
        h("h4", "", tr("Uygulama bağlantıları")), h("p", "capp-muted", tr("Bildirim ve e-posta bağlantıları uygulamada açılsın diye Google Play Console › Uygulama imzalama sayfasındaki SHA-256 parmak izini girin. iOS için Apple ekip kimliği ve paket kimliği yukarıdan alınır.")), field("Android SHA-256", sha),
        h("div", "capp-actions", null));
      f.lastChild.append(h("button", "capp-btn primary", tr("Ayarları kaydet"), {type: "submit"}), btn(tr("Kendi cihazıma deneme bildirimi"), async () => {
        try { const r = await api(endpoint, {action: "testPush"}, scope); data = r; say(tr("Deneme bildirimi gönderildi") + ": " + r.test + " " + tr("cihaz")); } catch (e) { say(e.message, true); }
      }));
      f.addEventListener("submit", e => { e.preventDefault(); send({action: "providers", fcmProject: fcmProject.value, fcmCredential: fcmCred.value, apnsKeyId: keyId.value, apnsTeamId: team.value, apnsTopic: topic.value, apnsKey: p8.value, apnsSandbox: sandbox.checked, contact: contact.value, androidSha256: sha.value}); });
      body.replaceChildren(h("p", "capp-muted", tr("Anahtarlar sunucuda şifreli saklanır ve bir daha gösterilmez.")), f);
    },
  };
  function draw() {
    nav.replaceChildren(...tabs.map(([k, l]) => {
      const b = h("button", "capp-tab", tr(l), {type: "button"}); b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === tab));
      b.addEventListener("click", () => { tab = k; try { sessionStorage.setItem("vz-apps-tab", k); } catch {} say(""); draw(); });
      return b;
    }));
    (views[tab] || views.overview)();
  }
  draw();
}

function chart(rows) {
  const W = 640, H = 160, P = 28, max = Math.max(1, ...rows.map(r => Number(r.sent) + Number(r.failed)));
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "capp-chart"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Günlük push teslimatı");
  if (!rows.length) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", W / 2); t.setAttribute("y", H / 2); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "capp-axis"); t.textContent = "Henüz gönderim yok"; svg.append(t); return svg; }
  const bw = (W - P * 2) / rows.length;
  rows.forEach((r, i) => {
    const s = Number(r.sent), f = Number(r.failed), x = P + i * bw + 3, w = Math.max(4, bw - 6);
    const hs = (H - P * 2) * s / max, hf = (H - P * 2) * f / max;
    const a = document.createElementNS(ns, "rect"); a.setAttribute("x", x); a.setAttribute("y", H - P - hs); a.setAttribute("width", w); a.setAttribute("height", hs); a.setAttribute("rx", 4); a.setAttribute("class", "capp-bar ok");
    const b = document.createElementNS(ns, "rect"); b.setAttribute("x", x); b.setAttribute("y", H - P - hs - hf - (f ? 2 : 0)); b.setAttribute("width", w); b.setAttribute("height", hf); b.setAttribute("rx", 4); b.setAttribute("class", "capp-bar bad");
    const t = document.createElementNS(ns, "title"); t.textContent = `${r.day}: ${s} teslim, ${f} başarısız`; a.append(t);
    const l = document.createElementNS(ns, "text"); l.setAttribute("x", x + w / 2); l.setAttribute("y", H - 8); l.setAttribute("text-anchor", "middle"); l.setAttribute("class", "capp-axis"); l.textContent = r.day.slice(8);
    svg.append(a, b, l);
  });
  return svg;
}
