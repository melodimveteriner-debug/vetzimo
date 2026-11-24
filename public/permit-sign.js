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
      if (!form.elements.read.checked) { error.textContent = "Aydınlatma metnini okuduğunuzu işaretleyin."; return; }
      if (strokes < 8) { error.textContent = "Lütfen imza alanına imzanızı atın."; return; }
      body.read = true; body.signature = signature();
      body.choices = Object.fromEntries(["sms", "whatsapp", "email", "marketing"].map(k => [k, !!form.elements[k]?.checked]));
    }
    form.querySelectorAll("button").forEach(b => b.disabled = true);
    try {
      const r = await fetch(location.pathname, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gönderilemedi.");
      form.hidden = true;
      const done = document.getElementById("pmDone"); done.hidden = false;
      const given = Object.entries(d.choices || {}).filter(([, v]) => v).length;
      document.getElementById("pmDoneText").textContent = d.status === "signed"
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
