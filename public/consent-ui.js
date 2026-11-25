// Klinik: Onam Formları sayfası. Şablondan onam hazırlar, hasta sahibine gönderir veya klinikte imzalatır,
// imzalı formları görüntüler ve yazdırır. Veriler /api/consents üzerinden okunur ve yazılır.
import {openSignDialog, openConsentViewer, consentStatus} from "./consent-sign.js?v=2";

const METHODS = [["sms", "SMS ile imza bağlantısı gönder (kliniğin hattından)"], ["whatsapp", "WhatsApp ile imza bağlantısı gönder"], ["email", "E-posta ile imza bağlantısı gönder"], ["clinic", "Klinikte bu cihazda imzalat"], ["in-person", "Yüz yüze imza (kimliği doğrulayarak)"], ["portal", "Hasta sahibi portalına gönder"]];

export const CONSENT_TEMPLATES = [
  {key: "surgery", type: "surgery", title: "Ameliyat ve anestezi onam formu", body:
`{klinik} bünyesinde, sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanıma {tarih} tarihinde "{islem}" işleminin uygulanmasına onay veriyorum.

1. Hekim tarafından hayvanımın mevcut durumu, planlanan işlem, beklenen faydaları ve alternatif tedavi seçenekleri bana anlaşılır şekilde açıklandı.
2. Genel anestezi ve sedasyonun, önceden yapılan muayene ve tetkikler normal olsa bile, nadir de olsa kalp-solunum durması dahil ciddi komplikasyonlara ve ölüme yol açabileceği konusunda bilgilendirildim.
3. Ameliyat sırasında beklenmedik bir durumla karşılaşılması hâlinde, hayvanımın sağlığı için zorunlu ek girişimlerin yapılmasına; mümkünse önce bana telefonla ulaşılmasına onay veriyorum. Telefon: {telefon}
4. Ameliyat öncesi aç bırakma talimatlarına uyduğumu, bilinen hastalık, alerji ve kullandığı ilaçları eksiksiz bildirdiğimi beyan ederim.
5. Ameliyat sonrası kanama, enfeksiyon, dikiş açılması, ağrı ve iyileşmenin gecikmesi gibi olası komplikasyonlar ve bakım talimatları bana anlatıldı. Kontrol randevularına uyacağımı kabul ederim.
6. Tahmini ücret konusunda bilgilendirildim; ek girişim veya yatış gerekirse ücretin değişebileceğini kabul ederim.

Sorumlu hekim: {hekim}`},
  {key: "anesthesia", type: "general", title: "Sedasyon / anestezi onam formu", body:
`Sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanıma {tarih} tarihinde "{islem}" için sedasyon veya genel anestezi uygulanmasına onay veriyorum.

- Anestezi öncesi muayene ve gerekli görülen tetkikler hakkında bilgilendirildim.
- Sağlıklı görünen hayvanlarda bile anestezinin nadir de olsa ciddi ve hayatı tehdit eden yan etkileri olabileceğini anladım.
- Hayvanımın son 8-12 saattir yemek yemediğini (su hariç) ve bildiğim tüm sağlık sorunlarını, ilaçlarını hekime bildirdiğimi beyan ederim.
- İşlem sonrası uyanma sürecinde hayvanımın gözetim altında tutulacağı ve taburculukta verilecek talimatlara uyacağım konusunda bilgilendirildim.

Sorumlu hekim: {hekim}`},
  {key: "stay", type: "stay", title: "Yatarak tedavi (hospitalizasyon) onam formu", body:
`Sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanımın {tarih} tarihinden itibaren {klinik} bünyesinde yatarak tedavi görmesine onay veriyorum.

1. Hayvanımın tanısı, planlanan tedavi, tahmini yatış süresi ve tahmini maliyeti hakkında bilgilendirildim.
2. Yatış süresince hekimin gerekli gördüğü ilaç, sıvı tedavisi, tetkik ve tıbbi girişimlerin uygulanmasına onay veriyorum; büyük girişimler için ayrıca bilgilendirileceğim.
3. Tüm özene rağmen tedavi sürecinde hayvanımın durumunun kötüleşebileceğini veya kaybedilebileceğini anladım.
4. Durumdaki önemli değişikliklerde {telefon} numaralı telefondan bana ulaşılmasını kabul ediyorum.
5. Ziyaret saatlerine ve klinik kurallarına uyacağımı, yatış ücretlerini taburculukta ödeyeceğimi kabul ederim.

Sorumlu hekim: {hekim}`},
  {key: "transfusion", type: "general", title: "Kan transfüzyonu onam formu", body:
`Sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanıma, hekimin gerekli gördüğü durumda kan veya kan ürünü transfüzyonu yapılmasına onay veriyorum.

- Transfüzyon öncesi kan grubu / çapraz uyum testlerinin yapılacağı konusunda bilgilendirildim.
- Testlere rağmen ateş, alerjik reaksiyon, hemoliz ve nadiren hayatı tehdit eden reaksiyonlar görülebileceğini anladım.
- Transfüzyon süresince ve sonrasında hayvanımın yakından izleneceğini biliyorum.

Sorumlu hekim: {hekim}`},
  {key: "euthanasia", type: "general", title: "Ötanazi onam formu", body:
`Sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanımın, hekimin değerlendirmesi ve bilgilendirmesi sonucunda, acısını sonlandırmak amacıyla ötanazi ile uyutulmasına kendi özgür irademle onay veriyorum.

- Hayvanımın son 14 gün içinde kimseyi ısırmadığını ve bildiğim kadarıyla kuduz şüphesi taşımadığını beyan ederim.
- Bu hayvanın yasal sahibi olduğumu ya da sahibi adına karar vermeye yetkili olduğumu beyan ederim.
- İşlemin geri dönüşü olmadığını anladım.
- Cenaze / kremasyon tercihim hekim ile görüşülmüştür.

Sorumlu hekim: {hekim}`},
  {key: "boarding", type: "stay", title: "Pansiyon (konaklama) sözleşmesi", body:
`Sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanımı {tarih} tarihinden itibaren {klinik} pansiyonunda konaklaması için teslim ediyorum.

- Hayvanımın aşılarının güncel olduğunu ve parazit uygulamalarının yapıldığını beyan ederim.
- Konaklama süresince hastalık belirtisi görülürse, hekimin muayene ve gerekli tedaviyi yapmasına onay veriyorum; ücreti tarafıma aittir.
- Beslenme, ilaç ve özel bakım talimatlarımı eksiksiz bildirdim. Teslim ettiğim eşyalar kayıt altına alındı.
- Belirtilen tarihte hayvanımı teslim almazsam {telefon} numarasından bana ulaşılacağını, ek günlerin ücretlendirileceğini kabul ederim.`},
  {key: "treatment", type: "general", title: "Tedavi ve masraf onam formu", body:
`Sahibi olduğum {hasta} ({tur}{irk}) isimli hayvanıma {tarih} tarihinde önerilen "{islem}" tedavisinin uygulanmasına onay veriyorum.

- Tanı, tedavi seçenekleri, olası yan etkiler ve beklenen sonuçlar hakkında bilgilendirildim.
- Tahmini maliyet bana bildirildi; tedavi sürecinde değişiklik gerekirse önceden bilgilendirileceğim.
- Hekim tarafından verilen ilaç ve bakım talimatlarına uyacağımı kabul ederim.

Sorumlu hekim: {hekim}`},
];

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  Object.assign(node, props);
  return node;
}
function preserve(node) { node.setAttribute("data-ui-preserve", ""); node.dir = "auto"; return node; }

export function fillTemplate(template, data) {
  return template.replace(/\{(\w+)\}/g, (_, key) => data[key] ?? "");
}

export function mountConsents(root, api) {
  const {tr} = api;
  const ui = {filter: "pending", items: [], loading: true, draft: null, error: ""};
  const patientId = api.patientId || "";
  const fmt = t => t ? new Intl.DateTimeFormat(document.documentElement.lang || "tr", {dateStyle: "medium", timeStyle: "short"}).format(new Date(t * 1000)) : "";

  async function request(url, body) {
    const response = await api.fetch(url, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || tr("Sunucu isteği tamamlayamadı.")), {status: response.status});
    return data;
  }
  async function load() {
    ui.loading = true; render();
    try {
      const q = new URLSearchParams();
      if (patientId) q.set("patient", patientId);
      ui.items = (await request("/api/consents?" + q)).items || [];
      ui.error = "";
    } catch (e) { ui.error = e.message; }
    ui.loading = false; render();
  }
  function meta(item) {
    const p = api.patient(item.patient);
    return {patient: p ? [p.name, p.species].filter(Boolean).join(" · ") : item.patient, owner: p?.ownerName || "", clinic: api.clinicName()};
  }

  function draftForm() {
    const p = api.patient(ui.draft.patient);
    const form = el("form", "", {className: "consent-new"});
    form.dataset.patient = String(ui.draft.patient && p ? ui.draft.patient : "");
    form.append(el("h2", tr("Yeni onam formu")));
    if (!p) {
      const label = el("label", "", {className: "consent-field"});
      const input = el("input", "", {type: "search", placeholder: tr("Hasta adı, sahibi veya telefon"), autocomplete: "off"});
      const list = el("div", "", {className: "consent-search"});
      label.append(el("span", tr("Hasta")), input);
      let timer;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          list.replaceChildren(...api.search(input.value).map(row => {
            const b = el("button", "", {type: "button"});
            b.append(preserve(el("strong", row.name)), preserve(el("small", [row.species, row.ownerName].filter(Boolean).join(" · "))));
            b.addEventListener("click", () => { ui.draft.patient = row.id; render(); });
            return b;
          }));
        }, 180);
      });
      form.append(label, list);
      return form;
    }
    const head = el("div", "", {className: "consent-patient"});
    head.append(preserve(el("strong", p.name)), preserve(el("span", [p.species, p.breed, p.ownerName, p.ownerPhone].filter(Boolean).join(" · "))));
    if (!api.patientId) { const change = el("button", tr("Değiştir"), {type: "button", className: "button small"}); change.addEventListener("click", () => { ui.draft.patient = ""; render(); }); head.append(change); }
    if (!p.owner) head.append(el("p", tr("Bu hastanın sahibi kayıtlı değil; onam için önce sahip ekleyin."), {className: "form-error"}));
    const templateLabel = el("label", "", {className: "consent-field"});
    const select = el("select");
    for (const t of CONSENT_TEMPLATES) select.append(el("option", tr(t.title), {value: t.key, selected: t.key === ui.draft.template}));
    select.append(el("option", tr("Boş form"), {value: "", selected: ui.draft.template === ""}));
    templateLabel.append(el("span", tr("Şablon")), select);
    const records = api.records(p.id);
    const recordLabel = el("label", "", {className: "consent-field"});
    const record = el("select");
    record.append(el("option", tr("Bağlı kayıt yok"), {value: ""}));
    for (const r of records) record.append(el("option", r.label, {value: r.type + ":" + r.id, selected: ui.draft.record === r.type + ":" + r.id}));
    recordLabel.append(el("span", tr("İlgili kayıt")), record);
    const titleLabel = el("label", "", {className: "consent-field wide"});
    const title = el("input", "", {maxLength: 200, required: true, value: ui.draft.title});
    titleLabel.append(el("span", tr("Başlık")), title);
    const bodyLabel = el("label", "", {className: "consent-field wide"});
    const body = el("textarea", "", {rows: 14, maxLength: 20000, required: true, value: ui.draft.body});
    bodyLabel.append(el("span", tr("Onam metni")), body);
    const fill = () => {
      const t = CONSENT_TEMPLATES.find(x => x.key === select.value);
      const [type, id] = (record.value || ":").split(":");
      const r = records.find(x => x.type === type && x.id === id);
      const data = api.fillData(p, r);
      ui.draft.template = select.value;
      ui.draft.record = record.value;
      if (t) { ui.draft.title = title.value = tr(t.title); ui.draft.body = body.value = fillTemplate(t.body, data); }
    };
    select.addEventListener("change", fill);
    record.addEventListener("change", () => {
      ui.draft.record = record.value;
      const [type] = record.value.split(":");
      const match = CONSENT_TEMPLATES.find(t => t.type === type);
      if (match && select.value !== match.key && (type === "surgery" || !select.value)) select.value = match.key;
      fill();
    });
    title.addEventListener("input", () => { ui.draft.title = title.value; });
    body.addEventListener("input", () => { ui.draft.body = body.value; });
    if (!ui.draft.body && ui.draft.template) fill();
    const grid = el("div", "", {className: "consent-grid"});
    grid.append(templateLabel, recordLabel, titleLabel, bodyLabel);
    const hint = el("p", tr("Metni gönderebilmeden önce düzenleyebilirsiniz. Gönderildikten sonra metin mühürlenir ve değiştirilemez."), {className: "consent-hint"});
    const error = el("p", "", {className: "form-error", role: "alert"});
    // İmza yöntemi: SMS / WhatsApp / e-posta bağlantısı (hesapsız), klinikte bu cihazda, yüz yüze (kimlik doğrulanarak) veya hasta sahibi portalı.
    const methodLabel = el("label", "", {className: "consent-method"});
    const methodSelect = el("select", "", {name: "method"});
    for (const [value, label] of METHODS) methodSelect.append(el("option", tr(label), {value}));
    methodSelect.value = ui.draft.method || "sms";
    methodLabel.append(el("span", tr("İmza nasıl alınacak?")), methodSelect);
    const emailLabel = el("label", "", {className: "consent-method"});
    const emailInput = el("input", "", {type: "email", maxLength: 160, value: ui.draft.email || p.ownerEmail || "", autocomplete: "off"});
    emailLabel.append(el("span", tr("Hasta sahibinin e-postası")), emailInput);
    const actions = el("div", "", {className: "consent-actions"});
    const send = el("button", "", {type: "submit", className: "button primary"});
    const here = el("button", "", {type: "button", className: "button", hidden: true});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button ghost"});
    const syncMethod = () => {
      ui.draft.method = methodSelect.value;
      emailLabel.hidden = methodSelect.value !== "email";
      send.textContent = tr({sms: "Oluştur ve SMS gönder", whatsapp: "Oluştur ve WhatsApp ile gönder", email: "Oluştur ve e-posta gönder", clinic: "Oluştur ve bu cihazda imzalat", "in-person": "Oluştur ve yüz yüze imzalat", portal: "Hasta sahibi portalına gönder"}[methodSelect.value]);
    };
    methodSelect.addEventListener("change", syncMethod);
    emailInput.addEventListener("input", () => { ui.draft.email = emailInput.value; });
    syncMethod();
    actions.append(send, here, cancel);
    cancel.addEventListener("click", () => { ui.draft = null; render(); });
    const create = async () => {
      error.textContent = "";
      if (!p.owner) { error.textContent = tr("Bu hastanın sahibi kayıtlı değil; onam için önce sahip ekleyin."); return null; }
      if (!title.value.trim() || !body.value.trim()) { error.textContent = tr("Başlık ve onam metni gerekli."); return null; }
      const [type, id] = (record.value || ":").split(":");
      send.disabled = here.disabled = true;
      try {
        return await request("/api/consents", {action: "create", patient: p.id, recordType: type || "general", recordId: id || "", title: title.value.trim(), body: body.value.trim(), method: methodSelect.value, email: emailInput.value.trim()});
      } catch (e) { error.textContent = e.message; return null; }
      finally { send.disabled = here.disabled = false; }
    };
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (methodSelect.value === "email" && !emailInput.value.trim()) { error.textContent = tr("Hasta sahibinin e-posta adresini yazın."); emailInput.focus(); return; }
      const created = await create();
      if (!created) return;
      const method = methodSelect.value;
      ui.draft = null; ui.filter = "pending";
      if (method === "clinic" || method === "in-person") { await signHere(created, method === "in-person"); await load(); return; }
      if (created.delivery) deliveryNotice(created.delivery);
      else api.toast(tr("Onam formu hasta sahibinin portalına gönderildi."));
      await load();
    });
    here.addEventListener("click", async () => {
      const created = await create();
      if (!created) return;
      ui.draft = null;
      await signHere(created);
      await load();
    });
    form.append(head, grid, methodLabel, emailLabel, hint, error, actions);
    return form;
  }

  // Gönderim sonucu: kuyruğa alındıysa bilgi; hat yoksa bağlantı + WhatsApp ile paylaşma/kopyalama.
  function deliveryNotice(d) {
    const ok = {queued: "İmza bağlantısı kliniğin telefon hattından gönderiliyor (72 saat geçerli).", assist: "WhatsApp mesajı telefonda gönderime hazır; telefondaki bildirime dokunun.", email_sent: "İmza bağlantısı e-postayla gönderildi (72 saat geçerli)."}[d.status];
    if (ok) { api.toast(tr(ok)); return; }
    ui.delivery = d; render();
  }

  async function sendLink(item, method) {
    try {
      const body = {action: "send", id: item.id, method};
      if (method === "email") {
        const email = (ui.sendEmail || "").trim();
        if (!email && !api.patient(item.patient)?.ownerEmail) { ui.askEmail = item.id; render(); return; }
        if (email) body.email = email;
      }
      ui.askEmail = null;
      deliveryNotice(await request("/api/consents", body));
    } catch (e) { api.toast(e.message); }
  }

  async function signHere(item, inPerson = false) {
    const full = item.body ? item : await request("/api/consents?id=" + encodeURIComponent(item.id));
    const p = api.patient(full.patient);
    const done = await openSignDialog({consent: full, tr, defaultName: p?.ownerName || "", verifyLabel: inPerson ? tr("Hasta sahibinin kimliğini yüz yüze gördüm ve doğruladım.") : "",
      subtitle: [p?.name, p?.ownerName].filter(Boolean).join(" · ") + " — " + tr(inPerson ? "Kimliği kontrol edin, cihazı hasta sahibine verin." : "Cihazı hasta sahibine verin."),
      submit: payload => request("/api/consents", {action: "decide", id: full.id, ...payload})});
    if (done) { ui.filter = done.status; api.toast(tr(done.status === "signed" ? "Onam formu imzalandı." : "Onam formu reddedildi.")); }
  }

  async function view(item) {
    try {
      const full = await request("/api/consents?id=" + encodeURIComponent(item.id));
      const actions = [];
      if (full.status === "pending" && api.canWrite) {
        actions.push({label: tr("Klinikte imzalat"), run: async () => { await signHere(full); await load(); }});
        actions.push({label: tr("İptal et"), tone: "danger", run: () => cancelItem(full)});
      }
      openConsentViewer({consent: full, tr, meta: meta(full), actions});
    } catch (e) { api.toast(e.message); }
  }

  let confirmCancel = null;
  async function cancelItem(item) {
    if (confirmCancel !== item.id) { confirmCancel = item.id; api.toast(tr("İptal etmek için tekrar 'İptal et' seçin.")); render(); setTimeout(() => { confirmCancel = null; render(); }, 5000); return; }
    confirmCancel = null;
    try { await request("/api/consents", {action: "cancel", id: item.id}); api.toast(tr("Onam formu iptal edildi.")); await load(); }
    catch (e) { api.toast(e.message); }
  }

  function card(item) {
    const p = api.patient(item.patient);
    const li = el("li", "", {className: "consent-item"});
    li.dataset.status = item.status;
    const main = el("div", "", {className: "consent-main"});
    main.append(preserve(el("strong", item.title)), preserve(el("span", [p?.name || item.patient, p?.ownerName].filter(Boolean).join(" · "))));
    const info = el("small", [tr(consentStatus[item.status] || item.status), item.decidedAt ? (item.signerName + " · " + fmt(item.decidedAt)) : (item.createdBy + " · " + fmt(item.createdAt))].filter(Boolean).join(" · "));
    main.append(info);
    const badge = el("span", tr(consentStatus[item.status] || item.status), {className: "consent-badge"});
    badge.dataset.status = item.status;
    const actions = el("div", "", {className: "consent-row-actions"});
    const open = el("button", tr("Görüntüle"), {type: "button", className: "button small"});
    open.addEventListener("click", () => view(item));
    actions.append(open);
    if (item.status === "pending" && api.canWrite) {
      const sign = el("button", tr("Klinikte imzalat"), {type: "button", className: "button small primary"});
      sign.addEventListener("click", async () => { await signHere(item); await load(); });
      const face = el("button", tr("Yüz yüze imzalat"), {type: "button", className: "button small"});
      face.addEventListener("click", async () => { await signHere(item, true); await load(); });
      const sendBtns = [["sms", "SMS gönder"], ["whatsapp", "WhatsApp"], ["email", "E-posta"]].map(([m, label]) => {
        const b = el("button", tr(label), {type: "button", className: "button small ghost"});
        b.addEventListener("click", () => sendLink(item, m));
        return b;
      });
      const cancel = el("button", tr(confirmCancel === item.id ? "İptali onayla" : "İptal et"), {type: "button", className: "button small " + (confirmCancel === item.id ? "danger" : "ghost")});
      cancel.addEventListener("click", () => cancelItem(item));
      actions.append(sign, face, ...sendBtns, cancel);
      if (ui.askEmail === item.id) {
        const box = el("form", "", {className: "consent-email-ask"});
        const input = el("input", "", {type: "email", required: true, maxLength: 160, placeholder: tr("ornek@eposta.com")});
        box.append(input, el("button", tr("Gönder"), {type: "submit", className: "button small primary"}));
        box.addEventListener("submit", e => { e.preventDefault(); ui.sendEmail = input.value; sendLink(item, "email"); });
        actions.append(box);
        setTimeout(() => input.focus(), 0);
      }
    }
    li.append(badge, main, actions);
    return li;
  }

  function render() {
    if (!root.isConnected) return;
    const p = patientId ? api.patient(patientId) : null;
    const head = el("div", "", {className: "consent-head"});
    const titles = el("div");
    titles.append(el("h1", tr("Onam Formları")), el("p", p ? "" : tr("Ameliyat, anestezi, yatış ve diğer işlemler için dijital onam ve e-imza.")));
    if (p) titles.lastChild.append(preserve(el("span", [p.name, p.ownerName].filter(Boolean).join(" · "))));
    const tools = el("div", "", {className: "consent-tools"});
    if (p) tools.append(el("a", tr("Hasta dosyası"), {href: "#patient/" + encodeURIComponent(p.id), className: "button small"}));
    if (api.canWrite && !ui.draft) {
      const add = el("button", tr("Yeni onam"), {type: "button", className: "button primary"});
      add.addEventListener("click", () => { ui.draft = {patient: patientId, template: api.preset?.template || "surgery", record: api.preset?.record || "", title: "", body: ""}; render(); });
      tools.append(add);
    }
    head.append(titles, tools);
    const counts = {pending: 0, signed: 0, declined: 0, cancelled: 0};
    for (const item of ui.items) counts[item.status] = (counts[item.status] || 0) + 1;
    const filters = el("div", "", {className: "consent-filters", role: "group"});
    for (const [key, label] of [["pending", "İmza bekliyor"], ["signed", "İmzalandı"], ["declined", "Reddedildi"], ["all", "Tümü"]]) {
      const b = el("button", tr(label) + " (" + (key === "all" ? ui.items.length : counts[key] || 0) + ")", {type: "button"});
      b.setAttribute("aria-pressed", String(ui.filter === key));
      b.addEventListener("click", () => { ui.filter = key; render(); });
      filters.append(b);
    }
    const shown = ui.items.filter(i => ui.filter === "all" || i.status === ui.filter);
    const list = el("ul", "", {className: "consent-list"});
    list.append(...shown.map(card));
    const children = [head];
    if (ui.delivery) {
      // Hat kapalı / e-posta gitmedi: bağlantıyı elle iletme seçenekleri.
      const d = ui.delivery, box = el("div", "", {className: "consent-delivery", role: "status"});
      box.append(el("p", tr(d.status === "email_failed" ? "E-posta gönderilemedi (Bildirim e-postası ayarını kontrol edin). Bağlantıyı elle iletin:" : "Telefon Bağlantısı'nda bu kanal açık olmadığı için mesaj otomatik gönderilemedi. Bağlantıyı WhatsApp ile ya da kopyalayıp iletin:")));
      const row = el("div", "", {className: "consent-actions"});
      if (d.whatsappLink) { const wa = el("a", tr("WhatsApp ile gönder"), {href: d.whatsappLink, target: "_blank", rel: "noopener", className: "button small primary"}); row.append(wa); }
      const copy = el("button", tr("Bağlantıyı kopyala"), {type: "button", className: "button small"});
      copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(d.share || d.url); api.toast(tr("Bağlantı kopyalandı.")); } catch { api.toast(d.url); } });
      const close = el("button", tr("Kapat"), {type: "button", className: "button small ghost"});
      close.addEventListener("click", () => { ui.delivery = null; render(); });
      row.append(copy, close);
      box.append(preserve(el("code", d.url)), row);
      children.push(box);
    }
    if (ui.draft) children.push(draftForm());
    children.push(filters);
    if (ui.error) children.push(el("p", ui.error, {className: "form-error", role: "alert"}));
    children.push(ui.loading ? el("p", tr("Yükleniyor…"), {className: "consent-empty"}) : shown.length ? list : el("p", tr("Bu bölümde onam formu yok."), {className: "consent-empty"}));
    // Form yazılırken (aynı hasta için açık form) yalnız liste yenilenir; hasta seçimi, gönderim veya vazgeçme ekranı yeniden çizer.
    const open = root.querySelector(".consent-new");
    const focused = ui.draft && open && open.dataset.patient === String(ui.draft.patient || "") && document.activeElement && root.contains(document.activeElement) && document.activeElement.closest(".consent-new");
    if (focused) { // Form yazılırken listeyi güncelle, formu bozma.
      root.querySelector(".consent-list, .consent-empty")?.replaceWith(children.at(-1));
      return;
    }
    root.replaceChildren(...children);
  }

  if (api.preset?.open && api.canWrite) ui.draft = {patient: patientId, template: api.preset.template || "surgery", record: api.preset.record || "", title: "", body: ""};
  load();
}
