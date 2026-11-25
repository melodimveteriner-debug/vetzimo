// Merkez paneli · Merkez Bildirimleri (yöneticinin telefonu/e-postası, merkez mesaj hattı) ve Merkez Ekibi
// (Destek departmanı, Bayi departmanı hesapları; her biri kendi şifresi ve doğrulama uygulaması koduyla girer).
import {qrSvg} from "./qr.js?v=1";

const STYLE = "/center-market.css?v=2";
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const css = () => { if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE})); };
const when = t => t ? new Date(typeof t === "number" ? t * 1000 : t.replace(" ", "T") + "Z").toLocaleString("tr-TR", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "—";
const lab = (text, input, note) => { const l = h("label", "mk-label"); l.append(h("span", "", text), input); if (note) l.append(h("small", "mk-muted", note)); return l; };

export async function mountCenterContact(root, {call}) {
  css();
  const draw = data => {
    const s = data.settings;
    const form = h("form", "mk-card mk-demo", null, {noValidate: true});
    const phone = h("input", "mk-input", null, {type: "tel", value: s.phone, placeholder: "05xx xxx xx xx", autocomplete: "tel"});
    const email = h("input", "mk-input", null, {type: "email", value: s.email, placeholder: "ornek@vetzimo.com", autocomplete: "email"});
    const line = h("select", "mk-input"); line.append(new Option("— Mesajları gönderecek hattı seçin —", ""), ...data.lines.map(l => new Option(`${l.name} · ${l.phones} telefon`, l.id)));
    if (s.linePartner && !data.lines.some(l => l.id === s.linePartner)) line.append(new Option(`${s.lineName || s.linePartner} · bağlı telefon yok`, s.linePartner));
    line.value = s.linePartner;
    const chk = (label, on) => { const l = h("label", "mk-switch"); const c = h("input", "", null, {type: "checkbox", checked: on}); l.append(c, h("span", "", label)); return [l, c]; };
    const [smsL, sms] = chk("SMS", s.sms), [waL, wa] = chk("WhatsApp", s.whatsapp), [mailL, mail] = chk("E-posta", s.mail);
    const row = h("div", "mk-row"); row.append(smsL, waL, mailL);
    const msg = h("p", "mk-status", "", {role: "status"});
    const save = h("button", "mk-btn primary", "Kaydet", {type: "submit"});
    const test = h("button", "mk-btn", "Deneme bildirimi gönder", {type: "button"});
    const actions = h("div", "mk-row"); actions.append(msg, test, save);
    form.append(h("h3", "", "Bana gelecek bildirimler"),
      h("p", "mk-free", "SMS ve WhatsApp ücretsizdir: mesajlar VetZimo’ya ait Android telefondan, Telefon Bağlantısı ile gider. Netgsm veya Meta API gerekmez."),
      h("p", "mk-muted", "Bayilerin havale bildirimleri ve kartla ödemeleri yalnız merkez paneline uyarı olarak düşer ve aşağıdaki numara ile e-postaya gönderilir. Bu bildirimler hiçbir bayiye gitmez."),
      lab("Cep telefonum (SMS ve WhatsApp)", phone), lab("E-posta adresim", email, "Boş bırakılırsa Bildirim Merkezi’ndeki yönetici e-postası kullanılır."),
      h("strong", "", "Kanallar"), row,
      lab("Mesajları gönderecek telefon hattı", line, "Telefon Bağlantısı’nda Android telefonu bağlı, VetZimo’ya ait bir bayi hesabı seçin. Bu hattan giden merkez mesajları (size gelen uyarılar, bayilere abonelik hatırlatmaları, demo doğrulama kodları) o hesabın gönderim listesinde görünmez ve paket sınırına sayılmaz."),
      actions);
    form.addEventListener("submit", async e => {
      e.preventDefault(); save.disabled = true; msg.textContent = "Kaydediliyor…";
      try { draw(await call("center-contact", {phone: phone.value, email: email.value, linePartner: line.value, sms: sms.checked, whatsapp: wa.checked, mail: mail.checked})); }
      catch (er) { msg.textContent = er.message; save.disabled = false; }
    });
    test.addEventListener("click", async () => { test.disabled = true; try { await call("center-contact-test", {}); msg.textContent = "Deneme bildirimi gönderildi."; } catch (er) { msg.textContent = er.message; } test.disabled = false; });
    const info = h("section", "mk-card");
    info.append(h("h3", "", "Neler gönderilir?"));
    const ul = h("ul", "mk-list");
    for (const t of ["Satış sitesinden yeni demo başvurusu veya iletişim mesajı geldiğinde: size SMS ve WhatsApp.", "Bayi havale ile ödediğini bildirdiğinde: panel uyarısı + size SMS, WhatsApp ve e-posta.", "Bayi kartla (PayTR) ödediğinde: abonelik otomatik yenilenir, size bilgi gider.",
      "Bayilere abonelik bitimine 3 ay, 1 ay ve son 48 saat kala e-posta, SMS ve WhatsApp hatırlatması (yenilenmemişse). Demo veya paket almamış bayiye son 48 saatte verilerinin silineceği bildirilir.",
      "Otomatik demo doğrulama kodları (Satış Sitesi Stüdyosu › Otomatik demo)."]) ul.append(h("li", "", t));
    info.append(ul);
    const log = h("section", "mk-card");
    log.append(h("h3", "", "Son merkez mesajları"));
    if (!data.log.length) log.append(h("p", "mk-muted", "Henüz merkez mesajı gönderilmedi."));
    else {
      const t = h("div", "mk-table"), tbl = h("table");
      tbl.innerHTML = "<thead><tr><th scope=col>Zaman</th><th scope=col>Kanal</th><th scope=col>Numara</th><th scope=col>Durum</th><th scope=col>Mesaj</th></tr></thead>";
      const tb = h("tbody");
      const st = {queued: "Sırada", claimed: "Gönderiliyor", sent: "Gönderildi", failed: "Hata", expired: "Süresi doldu", cancelled: "İptal", unknown: "Belirsiz"};
      for (const r of data.log) { const tr = h("tr"); tr.append(h("td", "", when(r.created_at)), h("td", "", r.channel === "sms" ? "SMS" : "WhatsApp"), h("td", "", r.phone), h("td", "", st[r.status] || r.status), h("td", "", r.body)); tb.append(tr); }
      tbl.append(tb); t.append(tbl); log.append(t);
    }
    const cols = h("div", "mk-cols"); cols.append(form, info);
    root.replaceChildren(h("div", "mk"));
    root.firstChild.append(cols, log);
  };
  draw(await call("center-contact"));
}

export async function mountCenterTeam(root, {call}) {
  css();
  const draw = (data, created) => {
    const wrap = h("div", "mk");
    if (created) {
      const card = h("section", "mk-card");
      const q = h("div", "mk-qr"); const box = h("div"); box.innerHTML = qrSvg(created.uri, {size: 180, label: "Doğrulama uygulaması QR kodu"}); q.append(box);
      card.append(h("h3", "", "Hesap oluşturuldu · bu bilgiler yalnız bir kez gösterilir"),
        h("p", "", `E-posta: ${created.email}`), h("p", "", `Geçici şifre: ${created.password}`),
        h("p", "mk-muted", "Çalışan, Google Authenticator (veya benzeri) uygulamasıyla bu QR kodu okutmalı; girişte e-posta, şifre ve uygulamadaki 6 haneli kodu kullanır (/yonetim)."),
        q, h("code", "", "Elle giriş anahtarı: " + created.secret));
      wrap.append(card);
    }
    const form = h("form", "mk-card mk-demo", null, {noValidate: true});
    const email = h("input", "mk-input", null, {type: "email", placeholder: "calisan@vetzimo.com", required: true});
    const dep = h("select", "mk-input"); for (const [k, v] of Object.entries(data.departments)) dep.append(new Option(v, k));
    const msg = h("p", "mk-status", "", {role: "status"});
    const add = h("button", "mk-btn primary", "Hesap oluştur", {type: "submit"});
    form.append(h("h3", "", "Yeni ekip hesabı"),
      h("p", "mk-muted", "Destek departmanı yalnız destek taleplerini görür ve yanıtlar. Bayi departmanı havale ile ödeme yapan bayilerin siparişlerini onaylar ve abonelik geçişlerini yapar. Diğer tüm bölümler yalnız size açıktır."),
      lab("E-posta", email), lab("Departman", dep), msg, add);
    form.addEventListener("submit", async e => {
      e.preventDefault(); add.disabled = true; msg.textContent = "Oluşturuluyor…";
      try { const r = await call("team", {op: "create", email: email.value, department: dep.value}); draw(r, r.created); }
      catch (er) { msg.textContent = er.message; add.disabled = false; }
    });
    const list = h("section", "mk-card");
    list.append(h("h3", "", "Merkez ekibi"));
    const t = h("div", "mk-table"), tbl = h("table");
    tbl.innerHTML = "<thead><tr><th scope=col>E-posta</th><th scope=col>Departman</th><th scope=col>Son giriş</th><th scope=col>Durum</th><th scope=col>İşlem</th></tr></thead>";
    const tb = h("tbody");
    for (const m of data.team) {
      const tr = h("tr");
      const owner = Number(m.is_owner) === 1;
      tr.append(h("td", "", m.identifier), h("td", "", owner ? "Yönetici (tam yetki)" : (data.departments[m.department] || "—")), h("td", "", when(m.last_login)),
        h("td", Number(m.blocked) ? "" : "ok", Number(m.blocked) ? "Kapalı" : "Etkin"));
      const act = h("td");
      if (!owner) {
        const sel = h("select", "mk-input"); for (const [k, v] of Object.entries(data.departments)) sel.append(new Option(v, k)); sel.value = m.department;
        sel.addEventListener("change", async () => draw(await call("team", {op: "department", id: m.id, department: sel.value})));
        const b = h("button", "mk-btn small", Number(m.blocked) ? "Aç" : "Kapat", {type: "button"});
        b.addEventListener("click", async () => draw(await call("team", {op: Number(m.blocked) ? "unblock" : "block", id: m.id})));
        const row = h("div", "mk-row"); row.append(sel, b); act.append(row);
      }
      tr.append(act); tb.append(tr);
    }
    tbl.append(tb); t.append(tbl); list.append(t);
    const cols = h("div", "mk-cols"); cols.append(form);
    wrap.append(cols, list);
    root.replaceChildren(wrap);
  };
  draw(await call("team"));
}
