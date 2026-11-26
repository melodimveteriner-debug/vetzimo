// Klinik paneli · Yasal Metinler: şirket bilgileri + logo ve kliniğin 5 yasal metni.
// Bilgiler girildiğinde ortak şablondaki {klinik}, {adres}, {telefon} gibi alanlar otomatik dolar; metin değiştirilmezse
// ayrıca saklanmaz (ortak şablon kullanılır). Değişiklik yalnız bayi yöneticisine (satın alan hesap) açıktır.
import {renderLegal} from "./legal-admin.js?v=2";

const STYLE = "/clinic-legal.css?v=1";
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ""); else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
};
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const stamp = ts => {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const p = new Intl.DateTimeFormat("tr-TR", {timeZone: "Europe/Istanbul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false}).formatToParts(d);
  const g = t => p.find(x => x.type === t)?.value || "";
  return `${+g("day")} ${MONTHS[+g("month") - 1]} ${g("year")}, ${g("hour")}:${g("minute")}`;
};

export async function mountClinicLegal(root, {fetch, tr = s => s, toast = () => {}, scope = "", prefs = () => ({})}) {
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  const call = async (body) => {
    const r = await fetch("/api/clinic-legal", body ? {method: "POST", headers: {"Content-Type": "application/json", "X-VetNet-Scope": scope}, body: JSON.stringify(body)} : {cache: "no-store"});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || tr("Sunucu isteği tamamlayamadı."));
    return data;
  };
  root.replaceChildren(h("p", {class: "clg-muted", text: tr("Yükleniyor…")}));
  let data;
  try { data = await call(); } catch (e) { root.replaceChildren(h("p", {class: "clg-error", text: e.message})); return; }

  const draw = () => {
    if (!root.isConnected) return;
    const p = prefs() || {};
    // Şirket bilgisi henüz kaydedilmediyse klinik ayarlarındaki bilgilerle önerilir.
    const suggest = data.filled ? data.company : {
      ...data.company, klinik: p.clinic || data.company.klinik, telefon: p.phone || data.company.telefon, eposta: p.email || data.company.eposta,
      adres: p.address || data.company.adres, unvan: p.invoiceName || data.company.unvan,
      vergi: [p.taxOffice, p.taxNo].filter(Boolean).join(" · ") || data.company.vergi,
    };
    const head = h("header", {class: "clg-head"},
      h("div", {}, h("h1", {text: tr("Yasal Metinler")}),
        h("p", {text: tr("Kliniğinizin KVKK aydınlatma, açık rıza ve iletişim izni, gizlilik, çerez ve kullanım koşulları metinleri. Hasta sahibine giden SMS'lerde, hasta sahibi portalında ve web sitenizin alt alanında bu sayfanın bağlantısı kullanılır.")})),
      h("div", {class: "clg-link"},
        h("span", {class: "clg-muted", text: tr("Herkese açık sayfa")}),
        h("code", {text: location.origin + data.url.replace(/^https?:\/\/[^/]+/, "")}),
        h("div", {class: "clg-row"},
          h("button", {type: "button", class: "clg-btn ghost", text: tr("Bağlantıyı kopyala"), onclick: async () => {
            const url = location.origin + data.url.replace(/^https?:\/\/[^/]+/, "");
            try { await navigator.clipboard.writeText(url); toast(tr("Bağlantı kopyalandı.")); } catch { toast(url); }
          }}),
          h("button", {type: "button", class: "clg-btn ghost", text: tr("Önizle"), onclick: () => preview(data.docs[0])}))));
    const warn = !data.filled ? h("p", {class: "clg-warn", text: data.canEdit
      ? tr("Şirket bilgilerinizi kaydedin: klinik adı, adres, telefon ve e-posta metinlerin gerekli yerlerine otomatik yerleşir. Kaydedilene kadar metinlerde klinik adı ve girilmiş bilgiler kullanılır.")
      : tr("Şirket bilgileri henüz bayi yöneticisi tarafından girilmedi.")}) : null;

    // ── Şirket bilgileri
    const form = h("form", {class: "clg-card clg-company"});
    form.append(h("h2", {text: tr("Şirket bilgileri")}), h("p", {class: "clg-muted", text: data.updatedAt ? tr("Son değişiklik: ") + stamp(data.updatedAt) + (data.updatedBy ? " · " + data.updatedBy : "") : tr("Henüz kaydedilmedi.")}));
    const grid = h("div", {class: "clg-grid"});
    for (const f of data.fields) {
      const input = h("input", {name: f.key, maxlength: String(f.max), value: suggest[f.key] || "", disabled: !data.canEdit, required: ["klinik", "adres", "telefon"].includes(f.key),
        type: /eposta|kep/.test(f.key) ? "email" : f.key === "telefon" ? "tel" : "text", autocomplete: "off"});
      grid.append(h("label", {class: f.key === "adres" ? "wide" : ""}, h("span", {text: tr(f.label) + (["klinik", "adres", "telefon"].includes(f.key) ? " *" : "")}), input));
    }
    let logo = undefined;
    const logoImg = h("img", {class: "clg-logo", alt: tr("Logo önizlemesi"), src: data.logo || "", hidden: !data.logo});
    const logoInput = h("input", {type: "file", accept: "image/png,image/jpeg,image/webp", disabled: !data.canEdit, hidden: true});
    logoInput.addEventListener("change", () => {
      const file = logoInput.files[0]; logoInput.value = "";
      if (!file) return;
      if (file.size > 400000) { toast(tr("Logo en fazla 400 KB olabilir.")); return; }
      const reader = new FileReader();
      reader.onload = () => { logo = String(reader.result); logoImg.src = logo; logoImg.hidden = false; };
      reader.readAsDataURL(file);
    });
    const logoBox = h("div", {class: "clg-logo-box wide"}, h("span", {text: tr("Logo (PNG, JPG veya WebP · en fazla 400 KB)")}), logoImg,
      data.canEdit ? h("div", {class: "clg-row"},
        h("button", {type: "button", class: "clg-btn ghost", text: data.logo ? tr("Logoyu değiştir") : tr("Logo yükle"), onclick: () => logoInput.click()}),
        h("button", {type: "button", class: "clg-btn ghost", text: tr("Logoyu kaldır"), hidden: !data.logo, onclick: () => { logo = false; logoImg.hidden = true; }}), logoInput) : null);
    grid.append(logoBox);
    form.append(grid);
    if (data.canEdit) {
      form.append(h("p", {class: "clg-muted", text: tr("Boş bırakılan alanları içeren satırlar metinlerde gösterilmez. Kaydettiğinizde tüm metinlerin \"Son değişiklik\" tarihi güncellenir.")}),
        h("div", {class: "clg-actions"}, h("button", {type: "submit", class: "clg-btn", text: tr("Şirket bilgilerini kaydet")})));
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
        try {
          const company = Object.fromEntries([...new FormData(form)].filter(([k]) => data.fields.some(f => f.key === k)));
          data = await call({action: "profile", company, ...(logo !== undefined ? {logo} : {})});
          toast(tr("Şirket bilgileri kaydedildi; tüm yasal metinler güncellendi."));
          draw();
        } catch (err) { toast(err.message); } finally { btn.disabled = false; }
      });
    } else {
      form.append(h("p", {class: "clg-muted", text: tr("Bu bilgileri yalnız bayi yöneticisi (satın alan hesap) değiştirebilir.")}));
    }

    // ── Metinler
    const docs = h("section", {class: "clg-card"}, h("h2", {text: tr("Metinler")}));
    const list = h("div", {class: "clg-docs"});
    for (const d of data.docs) {
      list.append(h("article", {class: "clg-doc"},
        h("div", {}, h("strong", {text: d.title}), h("small", {text: tr("Son değişiklik: ") + stamp(d.changedAt)}),
          h("span", {class: "clg-badge" + (d.custom ? " own" : ""), text: d.custom ? tr("Kliniğe özel metin") : tr("Ortak şablon")})),
        h("div", {class: "clg-row"},
          h("button", {type: "button", class: "clg-btn ghost", text: tr("Önizle"), onclick: () => preview(d)}),
          data.canEdit ? h("button", {type: "button", class: "clg-btn", text: tr("Düzenle"), onclick: () => edit(d)}) : null)));
    }
    docs.append(list, h("p", {class: "clg-muted", text: tr("Ortak şablonlar VetZimo tarafından güncel tutulur. Bir metni düzenlerseniz o metin kliniğinize özel olur ve ortak şablon güncellemeleri ona yansımaz; dilediğiniz zaman ortak şablona dönebilirsiniz. Metinlerin içeriğinden ve uygulanmasından kliniğiniz sorumludur; gerekirse hukuk danışmanınıza gözden geçirtin.")}));
    const view = h("div", {class: "clg-view"});
    root.replaceChildren(h("div", {class: "clg"}, head, warn, form, docs, view));

    function preview(d) {
      const url = data.url.replace(/^https?:\/\/[^/]+/, "") + "/" + d.slug + "?panel=1";
      view.replaceChildren(h("div", {class: "clg-card"}, h("div", {class: "clg-row clg-between"}, h("h2", {text: tr("Önizleme · ") + d.title}),
        h("button", {type: "button", class: "clg-btn ghost", text: tr("Kapat"), onclick: () => view.replaceChildren()})),
        h("iframe", {class: "clg-frame", src: url, title: d.title, loading: "lazy"})));
      view.scrollIntoView({behavior: "smooth", block: "start"});
    }
    function edit(d) {
      const title = h("input", {value: d.title, maxlength: "160"});
      const body = h("textarea", {class: "clg-body", rows: "22", spellcheck: "true"}); body.value = d.body;
      const pv = h("div", {class: "clg-preview"});
      const company = Object.fromEntries(data.fields.map(f => [f.key, form.elements[f.key]?.value ?? ""]));
      const refresh = () => { pv.innerHTML = `<h1>${title.value.replace(/[<>&]/g, "")}</h1>${renderLegal(body.value, company)}`; };
      title.addEventListener("input", refresh); body.addEventListener("input", refresh);
      const save = h("button", {type: "button", class: "clg-btn", text: tr("Kaydet ve yayınla")});
      save.addEventListener("click", async () => {
        save.disabled = true;
        try { data = await call({action: "doc", slug: d.slug, title: title.value, body: body.value}); toast(tr("Metin yayınlandı; son değişiklik tarihi güncellendi.")); draw(); }
        catch (e) { toast(e.message); } finally { save.disabled = false; }
      });
      const reset = h("button", {type: "button", class: "clg-btn ghost", text: tr("Ortak şablona dön"), disabled: !d.custom});
      reset.addEventListener("click", async () => {
        try { data = await call({action: "doc", slug: d.slug, reset: true}); toast(tr("Ortak şablona dönüldü.")); draw(); } catch (e) { toast(e.message); }
      });
      view.replaceChildren(h("div", {class: "clg-card"},
        h("div", {class: "clg-row clg-between"}, h("h2", {text: tr("Düzenle · ") + d.title}), h("button", {type: "button", class: "clg-btn ghost", text: tr("Kapat"), onclick: () => view.replaceChildren()})),
        h("p", {class: "clg-muted", text: tr("Biçim: \"## \" bölüm başlığı, \"- \" madde, \"> \" vurgulu not, **kalın**. {klinik}, {unvan}, {adres}, {telefon}, {eposta}, {kvkk_eposta}, {vergi}, {mersis}, {kep}, {web} alanları şirket bilgileriyle otomatik doldurulur.")}),
        h("div", {class: "clg-editor"},
          h("div", {}, h("label", {}, h("span", {text: tr("Başlık")}), title), body, h("div", {class: "clg-actions"}, save, reset)),
          h("div", {}, h("span", {class: "clg-muted", text: tr("Canlı önizleme")}), pv))));
      refresh();
      view.scrollIntoView({behavior: "smooth", block: "start"});
    }
  };
  draw();
}
