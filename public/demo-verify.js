// Satış sitesi · otomatik demo: başvurudan sonra telefona gelen kod + VetZimo Kullanım Sözleşmesi imzası (telefonda parmakla)
// → bayi hesabı ve demo dönemi kendiliğinden açılır, şifre belirleme sayfasına geçilir.
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ""); else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
};
const post = async (url, body) => {
  const r = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "İşlem tamamlanamadı.");
  return d;
};

export async function mountDemoVerify(form, {reference, phone}) {
  if (!document.querySelector('link[href="/demo-verify.css?v=2"]')) document.head.append(h("link", {rel: "stylesheet", href: "/demo-verify.css?v=2"}));
  const box = h("section", {class: "demo-verify card", "aria-live": "polite"});
  const status = h("p", {class: "dv-status"});
  const code = h("input", {name: "code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}", maxlength: "6", required: true, placeholder: "••••••", "aria-label": "Doğrulama kodu"});
  const resend = h("button", {type: "button", class: "button outline small", text: "Kodu yeniden gönder"});
  const submit = h("button", {type: "submit", class: "button primary", text: "Doğrula, imzala ve demoyu başlat"});
  const agreementSlot = h("div", {class: "dv-agreement"}, h("p", {text: "Sözleşme yükleniyor…"}));
  const step = h("form", {class: "dv-form", novalidate: true},
    h("span", {class: "eyebrow", text: "Son adım"}),
    h("h2", {text: "Telefonunuzu doğrulayın ve sözleşmeyi imzalayın"}),
    h("p", {text: "Başvurunuzdaki cep telefonuna 6 haneli bir kod gönderdik. Kodu girin, VetZimo Kullanım Sözleşmesini okuyup parmağınızla imzalayın; demo hesabınız hemen açılır."}),
    h("p", {class: "dv-phone"}, h("span", {text: "Kod gönderilen numara: "}), h("b", {text: phone || ""})),
    h("label", {class: "dv-code"}, h("span", {text: "Doğrulama kodu"}), code),
    resend, agreementSlot, status, submit);
  box.append(step);
  form.replaceWith(box);
  box.scrollIntoView({behavior: "smooth", block: "start"});
  let panel = null;
  try {
    const [agreement, {agreementPanel}] = await Promise.all([fetch("/api/saas/demo-agreement").then(r => r.json()), import("./agreement-ui.js?v=3")]);
    panel = agreementPanel({agreement, acceptButton: submit, acceptLabel: "“Doğrula, imzala ve demoyu başlat” dediğinizde sözleşme imzalanır ve demo hesabınız açılır.",
      onReject: () => { box.replaceChildren(h("h2", {text: "Demo açılmadı"}), h("p", {text: "Sözleşme onaylanmadığı için demo hesabı açılmadı. Başvurunuz kayıtlı; ekibimiz sizinle iletişime geçebilir."})); }});
    agreementSlot.replaceChildren(panel.node);
  } catch { agreementSlot.replaceChildren(h("p", {class: "dv-error", text: "Sözleşme yüklenemedi. Sayfayı yenileyin."})); }
  resend.addEventListener("click", async () => {
    resend.disabled = true;
    try { const r = await post("/api/saas/demo-resend", {reference}); status.textContent = r.verify ? "Yeni kod gönderildi." : "Kod gönderilemedi; başvurunuz ekibimize iletildi."; }
    catch (e) { status.textContent = e.message; }
    setTimeout(() => { resend.disabled = false; }, 60000);
  });
  step.addEventListener("submit", async e => {
    e.preventDefault();
    if (submit.disabled) return;
    if (!/^\d{6}$/.test(code.value.trim())) { status.textContent = "6 haneli doğrulama kodunu girin."; code.focus(); return; }
    let agreement;
    try { agreement = panel?.value(); if (!agreement) throw Error("Sözleşmeyi okuyup imzalayın."); }
    catch (er) { status.textContent = er.message; return; }
    submit.disabled = true; status.textContent = "Demo hesabınız açılıyor…";
    try {
      const r = await post("/api/saas/demo-verify", {reference, code: code.value.trim(), agreement});
      box.replaceChildren(h("span", {class: "eyebrow", text: "Hazır"}), h("h2", {text: "Demonuz açıldı"}),
        h("p", {text: r.days + " günlük demo hesabınız açıldı. Şimdi giriş şifrenizi belirleyin; kullanıcı adınız cep telefonu numaranızdır."}),
        h("a", {class: "button primary", href: r.activation, text: "Şifremi belirle ve giriş yap"}));
      setTimeout(() => location.assign(r.activation), 2500);
    } catch (er) { status.textContent = er.message; submit.disabled = false; }
  });
}
