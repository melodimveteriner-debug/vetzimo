// Ayarlar › Klinik › Google yorum bağlantısı: evde hizmet sonrası hasta sahibine gidecek değerlendirme isteği.
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
export async function mountReviewLink(root, {api, scope, tr = s => s}) {
  const call = async body => { const r = await api("/api/clinic/review-link", body ? {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)} : {}); const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || tr("İşlem tamamlanamadı.")); return d; };
  let s;
  try { s = await call(); } catch (e) { root.replaceChildren(h("p", "sh-error", e.message)); return; }
  const f = h("form", "sh-form");
  const url = h("input", "", null, {value: s.url, placeholder: "https://g.page/r/… · maps.app.goo.gl/… · ChIJ…", maxLength: 500});
  const msg = h("textarea", "", null, {value: s.message, rows: 3, maxLength: 300});
  msg.style.cssText = "font:inherit;padding:8px 10px;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:var(--paper,#fff);color:inherit";
  url.style.cssText = msg.style.cssText;
  const auto = h("input", "", null, {type: "checkbox", checked: s.auto});
  const status = h("p", "sh-status", "", {hidden: true});
  const test = h("a", "sh-btn", tr("Bağlantıyı dene"), {href: s.url || "#", target: "_blank", rel: "noopener"});
  test.hidden = !s.url;
  const field = (t, el, help) => { const l = h("label", "sh-field"); l.append(h("span", "", t), el); if (help) l.append(h("small", "", help)); return l; };
  const sw = h("label", "sh-switch"); sw.append(auto, h("span", "", tr("Hizmet tamamlanınca personele 'değerlendirme isteği gönder' seçeneği varsayılan olarak açık gelsin")));
  f.append(h("p", "", tr("Google İşletme Profili'nizde 'Yorum iste' bağlantısını kopyalayıp yapıştırın ya da işletmenizin Place ID'sini girin; yorum penceresini doğrudan açan bağlantı otomatik oluşturulur.")),
    field(tr("Google yorum bağlantısı veya Place ID"), url), field(tr("Mesaj"), msg, tr("{klinik}, {hasta} ve {sahip} yer tutucuları kullanılabilir. Bağlantı mesajın sonuna eklenir.")), sw,
    h("div", "sh-row", null), status);
  f.querySelector(".sh-row").append(h("button", "sh-btn primary", tr("Kaydet"), {type: "submit"}), test);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    try { s = await call({url: url.value, message: msg.value, auto: auto.checked}); url.value = s.url; test.href = s.url; test.hidden = !s.url; status.hidden = false; status.textContent = tr("Kaydedildi."); }
    catch (er) { status.hidden = false; status.textContent = er.message; }
  });
  root.replaceChildren(f);
}
