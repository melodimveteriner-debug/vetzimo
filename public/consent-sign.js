// Ortak dijital onam bileşeni: el imzası paneli, okuma/imzalama penceresi ve yazdırma görünümü.
// Klinik uygulaması ve hasta sahibi portalı aynı bileşeni kullanır. Metinler textContent ile basılır.

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  Object.assign(node, props);
  return node;
}

function ensureStyle() {
  if (document.getElementById("vz-consent-style")) return;
  const style = el("style", "", {id: "vz-consent-style"});
  style.textContent = `
.vzc-dialog{width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid var(--line,#d0d5dd);border-radius:18px;background:var(--paper,Canvas);color:var(--ink,CanvasText);box-shadow:0 24px 60px rgba(0,0,0,.35)}
.vzc-dialog::backdrop{background:rgba(15,23,42,.55);backdrop-filter:blur(2px)}
.vzc-dialog form{display:grid;grid-template-rows:auto minmax(0,1fr) auto;max-height:calc(100dvh - 26px)}
.vzc-head{padding:16px 20px 10px;border-bottom:1px solid var(--line,#d0d5dd)}.vzc-head h2{margin:0;font-size:1.2rem}.vzc-head p{margin:.3rem 0 0;opacity:.75;font-size:.88rem}
.vzc-body{overflow:auto;padding:14px 20px;display:grid;gap:14px;align-content:start}
.vzc-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;padding:14px 16px;border:1px solid var(--line,#d0d5dd);border-radius:12px;max-height:38vh;overflow:auto;background:color-mix(in srgb,var(--ink,CanvasText) 3%,var(--paper,Canvas))}
.vzc-check{display:flex;gap:10px;align-items:flex-start;font-weight:600}.vzc-check input{width:20px;height:20px;margin-top:2px;flex:none}
.vzc-field{display:grid;gap:4px;font-size:.88rem}.vzc-field input,.vzc-field textarea{font:inherit;padding:9px 10px;border:1px solid var(--line,#d0d5dd);border-radius:10px;background:var(--paper,Canvas);color:inherit;min-width:0}
.vzc-pad{display:grid;gap:6px}.vzc-pad-box{position:relative;border:2px dashed var(--line,#98a2b3);border-radius:14px;background:#fff;touch-action:none;overflow:hidden}
.vzc-pad canvas{display:block;width:100%;height:190px;cursor:crosshair}
.vzc-pad-hint{position:absolute;inset:auto 0 52% 0;text-align:center;color:#98a2b3;pointer-events:none;font-size:.95rem}
.vzc-pad-line{position:absolute;left:8%;right:8%;bottom:34px;border-bottom:1px solid #cbd5e1;pointer-events:none}
.vzc-pad-tools{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.8rem;opacity:.8}
.vzc-foot{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 20px 16px;border-top:1px solid var(--line,#d0d5dd)}
.vzc-pair{flex:1 1 100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:8px}.vzc-pair .vzc-btn{width:100%;min-height:46px}.vzc-foot>.vzc-btn{margin-inline-start:auto}
.vzc-foot .vzc-left{margin-inline-end:auto}
.vzc-error{margin:0;color:#dc2626;font-weight:600}.vzc-error:empty{display:none}
.vzc-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;font-size:.84rem}
.vzc-meta div{display:grid;gap:2px;padding:8px 10px;border:1px solid var(--line,#d0d5dd);border-radius:10px;min-width:0;overflow-wrap:anywhere}.vzc-meta span{opacity:.7}
.vzc-signed{display:grid;gap:6px;justify-items:start}.vzc-signed img{max-width:320px;width:100%;background:#fff;border:1px solid var(--line,#d0d5dd);border-radius:10px}
.vzc-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-weight:700;font-size:.82rem}
.vzc-badge[data-tone=ok]{background:color-mix(in srgb,#059669 16%,var(--paper,Canvas));color:color-mix(in srgb,#059669 70%,var(--ink,CanvasText))}.vzc-badge[data-tone=bad]{background:color-mix(in srgb,#dc2626 16%,var(--paper,Canvas));color:color-mix(in srgb,#dc2626 70%,var(--ink,CanvasText))}
.vzc-btn{font:inherit;font-weight:700;padding:9px 16px;border-radius:10px;border:1px solid var(--line,#d0d5dd);background:var(--paper,Canvas);color:inherit;cursor:pointer}
.vzc-btn.primary{background:#059669;border-color:#059669;color:#fff}.vzc-btn.danger{background:#dc2626;color:#fff;border-color:#dc2626}
.vzc-btn:disabled{opacity:.55;cursor:not-allowed}
.vzc-dialog button.vzc-btn{background:var(--paper,Canvas)!important;color:var(--ink,CanvasText)!important;border:1px solid var(--line,#d0d5dd)!important;box-shadow:none!important;min-height:44px}
.vzc-dialog button.vzc-btn.primary{background:#059669!important;border-color:#059669!important;color:#fff!important}
.vzc-dialog button.vzc-btn.danger{background:#dc2626!important;color:#fff!important;border-color:#dc2626!important}
@media (max-width:560px){.vzc-dialog{border-radius:14px}.vzc-head,.vzc-body,.vzc-foot{padding-inline:14px}.vzc-pad canvas{height:170px}.vzc-foot .vzc-btn{flex:1}}
`;
  document.head.append(style);
}

/** El imzası paneli. Yüksek çözünürlüklü ekranlarda net çizer, beyaz zeminli PNG üretir. */
export function signaturePad(tr) {
  const wrap = el("div", "", {className: "vzc-pad"});
  const box = el("div", "", {className: "vzc-pad-box"});
  const canvas = el("canvas");
  canvas.setAttribute("aria-label", tr("İmza alanı"));
  canvas.setAttribute("role", "img");
  const hint = el("div", tr("Parmağınızla veya farenizle buraya imzalayın"), {className: "vzc-pad-hint"});
  box.append(canvas, el("div", "", {className: "vzc-pad-line"}), hint);
  const tools = el("div", "", {className: "vzc-pad-tools"});
  const clear = el("button", tr("Temizle"), {type: "button", className: "vzc-btn"});
  tools.append(el("span", tr("İmza")), clear);
  wrap.append(box, tools);
  const ctx = canvas.getContext("2d");
  let strokes = [], current = null, ratio = 1;
  function size() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    ratio = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    draw();
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = "#0f172a";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0].x, s[0].y, 1.4, 0, 7); ctx.fillStyle = "#0f172a"; ctx.fill(); continue; }
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i];
        ctx.lineWidth = Math.max(1.2, Math.min(3.2, 2.6 * (b.p || .5) + .6));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    hint.hidden = strokes.length > 0;
  }
  const point = e => { const r = canvas.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || .5}; };
  canvas.addEventListener("pointerdown", e => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); current = [point(e)]; strokes.push(current); draw(); });
  canvas.addEventListener("pointermove", e => { if (!current) return; e.preventDefault(); for (const c of e.getCoalescedEvents?.() || [e]) current.push(point(c)); draw(); });
  const end = () => { current = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  clear.addEventListener("click", () => { strokes = []; draw(); });
  new ResizeObserver(size).observe(canvas);
  return {
    element: wrap,
    isEmpty: () => strokes.reduce((n, s) => n + s.length, 0) < 6,
    toDataURL() {
      // Sunucu sınırı: en çok 2400×1200 piksel.
      const scale = Math.min(1, 1200 / canvas.width);
      const out = document.createElement("canvas");
      out.width = Math.max(100, Math.round(canvas.width * scale));
      out.height = Math.max(40, Math.round(canvas.height * scale));
      const o = out.getContext("2d");
      o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
      o.drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    },
  };
}

function formatTime(value, lang) {
  if (!value) return "";
  return new Intl.DateTimeFormat(lang || document.documentElement.lang || "tr", {dateStyle: "long", timeStyle: "short"}).format(new Date(value * 1000));
}

/**
 * Onam formunu okuma ve imzalama penceresi.
 * options: {consent (gövde + hash dahil), tr, defaultName, subtitle, submit(payload) => Promise<consent>}
 * Dönüş: Promise<güncel onam | null>
 */
export function openSignDialog({consent, tr, defaultName = "", subtitle = "", submit, verifyLabel = ""}) {
  ensureStyle();
  return new Promise(resolve => {
    const dialog = el("dialog", "", {className: "vzc-dialog"});
    const form = el("form", "", {method: "dialog"});
    const head = el("header", "", {className: "vzc-head"});
    const title = el("h2", consent.title);
    title.setAttribute("data-ui-preserve", "");
    head.append(title);
    if (subtitle) head.append(el("p", subtitle));
    const body = el("div", "", {className: "vzc-body"});
    const text = el("div", consent.body, {className: "vzc-text", tabIndex: 0});
    text.setAttribute("data-ui-preserve", "");
    text.dir = "auto";
    const agreeLabel = el("label", "", {className: "vzc-check"});
    const agree = el("input", "", {type: "checkbox"});
    agreeLabel.append(agree, el("span", tr("Formu okudum, anladım. Bilgilendirildiğimi ve onay verdiğimi beyan ederim.")));
    const nameLabel = el("label", "", {className: "vzc-field"});
    const name = el("input", "", {type: "text", value: defaultName, maxLength: 120, autocomplete: "name", required: true});
    nameLabel.append(el("span", tr("Ad soyad")), name);
    const pad = signaturePad(tr);
    const reasonLabel = el("label", "", {className: "vzc-field", hidden: true});
    const reason = el("textarea", "", {rows: 3, maxLength: 500});
    reasonLabel.append(el("span", tr("Reddetme nedeni (isteğe bağlı)")), reason);
    const error = el("p", "", {className: "vzc-error", role: "alert"});
    // Yüz yüze imza: personel kişinin kimliğini gördüğünü onaylar (kayda doğrulayan personel yazılır).
    const verifyBox = el("label", "", {className: "vzc-check", hidden: !verifyLabel});
    const verify = el("input", "", {type: "checkbox"});
    verifyBox.append(verify, el("span", verifyLabel));
    body.append(text, agreeLabel, verifyBox, nameLabel, pad.element, reasonLabel, error);
    const foot = el("footer", "", {className: "vzc-foot"});
    const decline = el("button", tr("Onaylamıyorum"), {type: "button", className: "vzc-btn danger"});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "vzc-btn"});
    const sign = el("button", tr("İmzala ve onaylıyorum"), {type: "submit", className: "vzc-btn primary"});
    // Önce onay, yanında kırmızı ret; sığmayan ekranda ret alta iner. "Vazgeç" en altta ayrı durur.
    const pair = el("div", "", {className: "vzc-pair"}); pair.append(sign, decline);
    foot.append(pair, cancel);
    form.append(head, body, foot);
    dialog.append(form);
    document.body.append(dialog);
    let declining = false, result = null;
    const close = () => { dialog.close(); };
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); });
    cancel.addEventListener("click", () => {
      if (declining) { declining = false; reasonLabel.hidden = true; pad.element.hidden = false; agreeLabel.hidden = false; sign.textContent = tr("İmzala ve onaylıyorum"); sign.className = "vzc-btn primary"; decline.hidden = false; return; }
      close();
    });
    decline.addEventListener("click", () => {
      declining = true; reasonLabel.hidden = false; pad.element.hidden = true; agreeLabel.hidden = true; decline.hidden = true;
      sign.textContent = tr("Reddetmeyi onayla"); sign.className = "vzc-btn danger"; reason.focus();
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      error.textContent = "";
      const signer = name.value.trim();
      if (signer.length < 3) { error.textContent = tr("Adınızı ve soyadınızı yazın."); name.focus(); return; }
      let payload;
      if (declining) payload = {decision: "decline", signerName: signer, reason: reason.value.trim()};
      else {
        if (!agree.checked) { error.textContent = tr("Metni okuduğunuzu onaylayın."); agree.focus(); return; }
        if (pad.isEmpty()) { error.textContent = tr("Lütfen imza alanına imzanızı atın."); return; }
        if (verifyLabel && !verify.checked) { error.textContent = tr("Kimliği yüz yüze doğruladığınızı işaretleyin."); verify.focus(); return; }
        payload = {decision: "sign", signerName: signer, agree: true, signature: pad.toDataURL(), hash: consent.hash};
        if (verifyLabel) Object.assign(payload, {inPerson: true, verifiedInPerson: true});
      }
      sign.disabled = decline.disabled = cancel.disabled = true;
      try {
        result = await submit(payload);
        close();
      } catch (e) {
        error.textContent = e.message;
        sign.disabled = decline.disabled = cancel.disabled = false;
      }
    });
    dialog.showModal();
    text.focus();
  });
}

const CHANNELS = {portal: "Hasta sahibi portalı", clinic: "Klinikte, aynı cihazda", "in-person": "Yüz yüze, kimlik doğrulandı", sms: "SMS bağlantısıyla", whatsapp: "WhatsApp bağlantısıyla", email: "E-posta bağlantısıyla"};
const STATUS = {pending: "İmza bekliyor", signed: "İmzalandı", declined: "Reddedildi", cancelled: "İptal edildi"};
export const consentStatus = STATUS;

/** İmzalı/bekleyen formu salt okunur gösterir; Yazdır düğmesi içerir. */
export function openConsentViewer({consent, tr, meta = {}, actions = []}) {
  ensureStyle();
  const dialog = el("dialog", "", {className: "vzc-dialog"});
  const form = el("form", "", {method: "dialog"});
  const head = el("header", "", {className: "vzc-head"});
  const title = el("h2", consent.title);
  title.setAttribute("data-ui-preserve", "");
  head.append(title, el("p", [meta.patient, meta.owner].filter(Boolean).join(" · ")));
  const body = el("div", "", {className: "vzc-body"});
  const badge = el("span", consent.intact ? "✓ " + tr("Belge bütünlüğü doğrulandı") : "✕ " + tr("Belge metni imzadan sonra değişmiş"), {className: "vzc-badge"});
  badge.dataset.tone = consent.intact ? "ok" : "bad";
  const text = el("div", consent.body, {className: "vzc-text"});
  text.setAttribute("data-ui-preserve", "");
  text.dir = "auto";
  const info = el("div", "", {className: "vzc-meta"});
  const cell = (label, value) => { if (!value) return; const d = el("div"); d.append(el("span", label), el("strong", value)); info.append(d); };
  cell(tr("Durum"), tr(STATUS[consent.status] || consent.status));
  cell(tr("Hazırlayan"), [consent.createdBy, formatTime(consent.createdAt)].filter(Boolean).join(" · "));
  if (consent.decidedAt) cell(consent.status === "declined" ? tr("Reddeden") : consent.status === "cancelled" ? tr("İptal") : tr("İmzalayan"), [consent.signerName, formatTime(consent.decidedAt)].filter(Boolean).join(" · "));
  if (consent.channel) cell(tr("İmza yeri"), tr(CHANNELS[consent.channel] || "Klinikte, aynı cihazda"));
  if (consent.note) cell(tr("Not"), consent.note);
  cell(tr("Belge özeti (SHA-256)"), consent.hash.slice(0, 16) + "…" + consent.hash.slice(-8));
  body.append(badge, text, info);
  if (consent.signature) {
    const signed = el("div", "", {className: "vzc-signed"});
    signed.append(el("span", tr("İmza")), el("img", "", {src: consent.signature, alt: tr("İmza")}));
    body.append(signed);
  }
  const foot = el("footer", "", {className: "vzc-foot"});
  const print = el("button", tr("Yazdır"), {type: "button", className: "vzc-btn"});
  print.addEventListener("click", () => printConsent({consent, tr, meta}));
  for (const action of actions) {
    const b = el("button", action.label, {type: "button", className: "vzc-btn " + (action.tone || "")});
    b.addEventListener("click", () => { dialog.close(); action.run(); });
    foot.append(b);
  }
  foot.append(print, el("button", tr("Kapat"), {type: "submit", className: "vzc-btn primary"}));
  form.append(head, body, foot);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

/** Gizli bir çerçevede A4 yazdırma görünümü oluşturur. */
export function printConsent({consent, tr, meta = {}}) {
  const frame = el("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write("<!doctype html><html><head><meta charset='utf-8'><title></title></head><body></body></html>");
  doc.close();
  doc.documentElement.lang = document.documentElement.lang || "tr";
  doc.title = consent.title;
  const style = doc.createElement("style");
  style.textContent = `@page{size:A4;margin:18mm 16mm}body{font:11pt/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}
header b{font-size:14pt}h1{font-size:16pt;margin:0 0 10px}.info{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;margin-bottom:14px;font-size:10pt}
.info span{color:#555}.text{white-space:pre-wrap;border:1px solid #bbb;padding:12px 14px;border-radius:6px}
.sign{display:flex;justify-content:space-between;gap:20px;margin-top:22px;align-items:flex-end;break-inside:avoid}
.sign img{width:240px;border-bottom:1px solid #111}.foot{margin-top:24px;font-size:8.5pt;color:#555;border-top:1px solid #ccc;padding-top:6px;word-break:break-all}`;
  doc.head.append(style);
  const node = (tag, text, cls) => { const n = doc.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const header = node("header");
  header.append(node("b", meta.clinic || ""), node("span", formatTime(consent.createdAt)));
  const info = node("div", "", "info");
  const pair = (label, value) => { if (!value) return; const d = node("div"); d.append(node("span", label + ": "), node("strong", value)); info.append(d); };
  pair(tr("Hasta"), meta.patient); pair(tr("Hasta sahibi"), meta.owner); pair(tr("Hazırlayan"), consent.createdBy); pair(tr("Durum"), tr(STATUS[consent.status] || consent.status));
  const sign = node("div", "", "sign");
  const left = node("div");
  left.append(node("div", tr("İmzalayan") + ": " + (consent.signerName || "—")), node("div", consent.decidedAt ? formatTime(consent.decidedAt) : ""));
  const right = node("div");
  if (consent.signature) { const img = node("img"); img.src = consent.signature; img.alt = tr("İmza"); right.append(img); }
  else right.append(node("div", "______________________________"), node("small", tr("İmza")));
  sign.append(left, right);
  const foot = node("div", tr("Bu belge elektronik ortamda hazırlanmış ve imzalanmıştır.") + " SHA-256: " + consent.hash + (consent.channel ? " · " + (tr(CHANNELS[consent.channel] || "Klinikte, aynı cihazda")) : ""), "foot");
  doc.body.append(header, node("h1", consent.title), info, node("div", consent.body, "text"), sign, foot);
  const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  const img = doc.querySelector("img");
  if (img && !img.complete) img.addEventListener("load", go, {once: true}); else setTimeout(go, 50);
}
