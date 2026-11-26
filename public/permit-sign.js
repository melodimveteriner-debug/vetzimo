// Müşteri onay formu: el imzası (dokunmatik/kalem/fare), okundu onayı, izin seçimleri ve tek kullanımlık gönderim.
document.querySelector("[data-print]")?.addEventListener("click", () => print());
const form = document.getElementById("pmForm");
if (form) {
  const pad = document.getElementById("pmPad"), ctx = pad.getContext("2d"), error = document.getElementById("pmError");
  let drawing = false, strokes = 0, last = null;
  const fit = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1), w = pad.clientWidth;
    const keep = strokes ? pad.toDataURL() : null;
    pad.width = Math.round(w * ratio); pad.height = Math.round(w * ratio / 3);
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827";
    if (keep) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, w, w / 3); img.src = keep; }
  };
  fit(); addEventListener("resize", fit);
  const point = e => { const r = pad.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
  pad.addEventListener("pointerdown", e => { drawing = true; last = point(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
  pad.addEventListener("pointermove", e => { if (!drawing) return; const p = point(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; strokes++; e.preventDefault(); });
  const stop = () => { drawing = false; };
  pad.addEventListener("pointerup", stop); pad.addEventListener("pointercancel", stop);
  document.getElementById("pmClear").addEventListener("click", () => { ctx.clearRect(0, 0, pad.width, pad.height); strokes = 0; });
  // İmza için beyaz zeminli küçük PNG (sunucu en çok 2400×1200 kabul eder).
  const signature = () => {
    const out = document.createElement("canvas"); out.width = 900; out.height = 300;
    const c = out.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, 900, 300); c.drawImage(pad, 0, 0, 900, 300);
    return out.toDataURL("image/png");
  };
  const send = async decision => {
    error.textContent = "";
    const name = form.elements.signerName.value.trim();
    if (name.length < 3) { error.textContent = "Adınızı ve soyadınızı yazın."; form.elements.signerName.focus(); return; }
    const body = {decision, signerName: name, hash: form.dataset.hash};
    if (decision === "sign") {
      if (!form.elements.read.checked) { error.textContent = form.dataset.kind === "consent" ? "Formu okuduğunuzu işaretleyin." : "Aydınlatma metnini okuduğunuzu işaretleyin."; return; }
      if (strokes < 8) { error.textContent = "Lütfen imza alanına imzanızı atın."; return; }
      body.read = true; body.signature = signature();
      body.choices = Object.fromEntries(["sms", "whatsapp", "email", "marketing"].map(k => [k, !!form.elements[k]?.checked]));
    }
    form.querySelectorAll("button").forEach(b => b.disabled = true);
    try {
      const r = await fetch(location.pathname, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gönderilemedi.");
      if (form.dataset.onboard === "1") { onboard(d); return; }
      form.hidden = true;
      const done = document.getElementById("pmDone"); done.hidden = false;
      const given = Object.entries(d.choices || {}).filter(([, v]) => v).length;
      document.getElementById("pmDoneText").textContent = form.dataset.kind === "consent"
        ? (d.status === "signed" ? "Onayınız ve imzanız kliniğe iletildi. Bu sayfayı kapatabilirsiniz." : "Onay vermediğiniz kliniğe iletildi. Bu sayfayı kapatabilirsiniz.")
        : d.status === "signed"
        ? "Onayınız ve imzanız kaydedildi" + (given ? "." : "; iletişim izni vermediniz.") + " Bu sayfayı kapatabilirsiniz."
        : "Tercihiniz kaydedildi. Size hatırlatma ve tanıtım mesajı gönderilmeyecek. Bu sayfayı kapatabilirsiniz.";
      done.scrollIntoView({behavior: "smooth"});
    } catch (e) {
      error.textContent = e.message;
      form.querySelectorAll("button").forEach(b => b.disabled = false);
    }
  };
  form.addEventListener("submit", e => { e.preventDefault(); send("sign"); });
  document.getElementById("pmDecline").addEventListener("click", () => send("decline"));
}

// Hoş geldin akışı (aynı sayfada): onay → mutlu kedi-köpek + şifre oluşturma → /app; ret → üzgün kedi-köpek.
function onboard(d) {
  const flow = document.getElementById("pmFlow");
  const show = el => { flow.hidden = true; el.hidden = false; scrollTo({top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); };
  if (d.status !== "signed") { show(document.getElementById("pmSad")); return; }
  const happy = document.getElementById("pmHappy");
  const pass = document.getElementById("pmPass");
  show(happy);
  if (!d.setup) {
    pass.hidden = true;
    const p = document.getElementById("pmPassDone");
    p.textContent = "Onayınız kaydedildi. Hesabınız zaten açık; giriş sayfasından telefon numaranız ve şifrenizle girebilirsiniz.";
    p.hidden = false;
    setTimeout(() => location.assign("/app"), 3500);
    return;
  }
  const err = document.getElementById("pmPassError");
  const rules = {len: v => v.length >= 8, mix: v => /\p{L}/u.test(v) && /\d/.test(v)};
  const check = () => {
    const v = pass.elements.password.value, w = pass.elements.password2.value;
    for (const li of pass.querySelectorAll("[data-rule]")) li.classList.toggle("ok", li.dataset.rule === "same" ? v !== "" && v === w : rules[li.dataset.rule](v));
  };
  pass.addEventListener("input", check);
  document.getElementById("pmShow").addEventListener("change", e => { for (const n of ["password", "password2"]) pass.elements[n].type = e.target.checked ? "text" : "password"; });
  pass.elements.password.focus({preventScroll: true});
  pass.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const password = pass.elements.password.value, password2 = pass.elements.password2.value;
    if (!rules.len(password)) { err.textContent = "Şifreniz en az 8 karakter olmalı."; return; }
    if (!rules.mix(password)) { err.textContent = "Şifrenizde en az bir harf ve bir rakam bulunmalı."; return; }
    if (password !== password2) { err.textContent = "Şifreler birbirini tutmuyor."; return; }
    const btn = pass.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const r = await fetch("/api/permit-setup", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({setup: d.setup, password, password2})});
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Şifre oluşturulamadı.");
      pass.hidden = true; document.getElementById("pmPassDone").hidden = false;
      setTimeout(() => location.assign(out.login || "/app"), 1500);
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  });
}
