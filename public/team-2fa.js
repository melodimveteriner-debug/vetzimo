// Ekip hesabı iki adımlı doğrulama (TOTP) ayarı: QR ile kurulum, kodla onay, kurtarma kodları ve kapatma.
import {qrSvg} from "./qr.js?v=1";

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  Object.assign(node, props);
  return node;
}

export function mountTeam2fa(root, {fetch, tr, toast}) {
  async function call(body) {
    const response = await fetch("/api/team-2fa", body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || tr("Sunucu isteği tamamlayamadı."));
    return data;
  }
  const head = () => {
    const h = el("div", "", {className: "tfa-head"});
    h.append(el("h1", tr("İki Adımlı Doğrulama")), el("p", tr("Şifrenize ek olarak telefonunuzdaki doğrulama uygulamasının ürettiği 6 haneli kod istenir. Şifreniz ele geçirilse bile hesabınız korunur.")));
    return h;
  };
  const card = (...children) => { const c = el("section", "", {className: "tfa-card"}); c.append(...children); return c; };
  const codeInput = () => el("input", "", {name: "code", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 9, required: true, placeholder: "123456"});

  function showRecovery(codes) {
    const list = el("ol", "", {className: "tfa-codes"});
    for (const c of codes) list.append(el("li", c));
    const copy = el("button", tr("Kodları kopyala"), {type: "button", className: "button"});
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(codes.join("\n")); toast(tr("Kopyalandı")); } catch { toast(codes.join("  ")); } });
    const done = el("button", tr("Kodları güvenli bir yere kaydettim"), {type: "button", className: "button primary"});
    done.addEventListener("click", () => load());
    const warn = el("p", tr("Telefonunuza erişemezseniz bu kodlardan biriyle giriş yapabilirsiniz. Her kod yalnızca bir kez kullanılır ve bir daha gösterilmez."), {className: "tfa-warn"});
    root.replaceChildren(head(), card(el("h2", "✓ " + tr("İki adımlı doğrulama açıldı")), warn, list, el("div", "", {className: "tfa-actions"})));
    root.querySelector(".tfa-actions").append(copy, done);
  }

  async function setup() {
    let data;
    try { data = await call({action: "start"}); } catch (e) { toast(e.message); return; }
    const steps = el("ol", "", {className: "tfa-steps"});
    steps.append(el("li", tr("Telefonunuza Google Authenticator, Microsoft Authenticator veya benzeri bir doğrulama uygulaması yükleyin.")),
      el("li", tr("Uygulamada yeni hesap ekleyip bu QR kodu okutun.")), el("li", tr("Uygulamanın gösterdiği 6 haneli kodu aşağıya yazın.")));
    const qr = el("div", "", {className: "tfa-qr"});
    qr.innerHTML = qrSvg(data.uri, {size: 220, label: tr("Doğrulama uygulaması için QR kod")});
    const secret = el("code", data.secret.replace(/(.{4})/g, "$1 ").trim(), {className: "tfa-secret"});
    const manual = el("details");
    const open = el("a", tr("Bu cihazdaki uygulamada aç"), {href: data.uri, className: "button small"});
    manual.append(el("summary", tr("QR okutamıyorum")), el("p", tr("Uygulamada 'anahtarı elle gir' seçeneğini kullanın:")), secret, open);
    const form = el("form", "", {className: "tfa-form"});
    const label = el("label", tr("Doğrulama kodu"));
    const input = codeInput();
    label.append(input);
    const error = el("p", "", {className: "form-error", role: "alert"});
    const submit = el("button", tr("Doğrula ve aç"), {type: "submit", className: "button primary"});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
    cancel.addEventListener("click", () => load());
    const actions = el("div", "", {className: "tfa-actions"});
    actions.append(submit, cancel);
    form.append(label, error, actions);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      submit.disabled = true; error.textContent = "";
      try { showRecovery((await call({action: "confirm", code: input.value.trim()})).recoveryCodes); }
      catch (x) { error.textContent = x.message; input.select(); }
      finally { submit.disabled = false; }
    });
    const grid = el("div", "", {className: "tfa-setup"});
    const left = el("div");
    left.append(steps, manual, form);
    grid.append(qr, left);
    root.replaceChildren(head(), card(el("h2", tr("Kurulum")), grid));
    input.focus();
  }

  function enabled(status) {
    const since = status.enabledAt ? new Intl.DateTimeFormat(document.documentElement.lang || "tr", {dateStyle: "long"}).format(new Date(status.enabledAt * 1000)) : "";
    const badge = el("p", "", {className: "tfa-status on"});
    badge.append(el("strong", "✓ " + tr("Açık")), el("span", [since, tr("Kalan kurtarma kodu") + ": " + status.recoveryLeft].filter(Boolean).join(" · ")));
    const form = el("form", "", {className: "tfa-form"});
    const pass = el("label", tr("Şifreniz"));
    const password = el("input", "", {type: "password", autocomplete: "current-password", required: true, maxLength: 512});
    pass.append(password);
    const codeLabel = el("label", tr("Doğrulama kodu veya kurtarma kodu"));
    const code = codeInput();
    codeLabel.append(code);
    const error = el("p", "", {className: "form-error", role: "alert"});
    const submit = el("button", tr("İki adımlı doğrulamayı kapat"), {type: "submit", className: "button danger"});
    form.append(pass, codeLabel, error, submit);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      submit.disabled = true; error.textContent = "";
      try { await call({action: "disable", password: password.value, code: code.value.trim()}); toast(tr("İki adımlı doğrulama kapatıldı.")); load(); }
      catch (x) { error.textContent = x.message; }
      finally { submit.disabled = false; }
    });
    const tip = el("p", tr("Kurtarma kodlarınız azaldıysa doğrulamayı kapatıp yeniden açarak yeni kodlar alabilirsiniz."), {className: "tfa-muted"});
    const details = el("details");
    details.append(el("summary", tr("Doğrulamayı kapat")), form);
    root.replaceChildren(head(), card(badge, tip, details));
  }

  function disabled() {
    const badge = el("p", "", {className: "tfa-status off"});
    badge.append(el("strong", tr("Kapalı")), el("span", tr("Hesabınız yalnızca şifreyle korunuyor.")));
    const start = el("button", tr("Kurulumu başlat"), {type: "button", className: "button primary"});
    start.addEventListener("click", setup);
    root.replaceChildren(head(), card(badge, start));
  }

  async function load() {
    root.replaceChildren(head(), el("p", tr("Yükleniyor…")));
    try { const status = await call(); (status.enabled ? enabled : disabled)(status); }
    catch (e) { root.replaceChildren(head(), el("p", e.message, {className: "form-error"})); }
  }
  load();
}
