// Klinik: "Şifremi unuttum" istekleri.
// Hasta sahibi kartında (portal bölümünün altında) ve bayinin Hesaplar sayfasında durum + tek dokunuşla gönderim:
// SMS sırada → SMS gönderildi / bağlantı paylaşıldı (şifre bekleniyor) → Şifre yenilendi. SMS gidemezse kırmızı uyarı.
const CSS = `
.pr-box .pr-body{padding:0 15px 15px;display:grid;gap:10px}
.pr-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--line,#e6e0f5);border-radius:14px;padding:10px 12px;background:var(--paper,#fff)}
.pr-row.is-bad{border-color:#f2b8c6;box-shadow:0 0 0 3px #fdebef}
.pr-row.is-done{border-color:#bfe6d4}
.pr-info{display:grid;gap:3px;min-width:0}
.pr-info strong{overflow-wrap:anywhere}
.pr-info small{opacity:.75;font-size:.78rem}
.pr-pill{justify-self:start;font-size:.74rem;font-weight:800;border-radius:999px;padding:3px 10px;background:#efeaff;color:#4b2fa8}
.pr-pill.done{background:#e3f6ee;color:#0b5c43}.pr-pill.bad{background:#fdebef;color:#8c2240}.pr-pill.wait{background:#fff3d6;color:#8a5a00}
.pr-acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.pr-msg{font-size:.82rem}
@media (max-width:560px){.pr-row{grid-template-columns:1fr}.pr-acts{justify-content:flex-start}}
`;
const css = () => { if (!document.getElementById("pr-clinic-css")) document.head.append(Object.assign(document.createElement("style"), {id: "pr-clinic-css", textContent: CSS})); };
const el = (tag, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (text) n.textContent = text; return n; };
const BAD = ["failed", "nogateway", "stuck"], WAIT = ["sent", "shared", "queued"];
const fmt = t => new Intl.DateTimeFormat(document.documentElement.lang || "tr-TR", {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).format(new Date(t * 1000));

function row(item, {api, tr, onChange}) {
  const r = el("div", "", {className: "pr-row" + (BAD.includes(item.status) ? " is-bad" : item.status === "done" ? " is-done" : "")});
  const info = el("div", "", {className: "pr-info"});
  const cls = item.status === "done" ? "done" : BAD.includes(item.status) ? "bad" : WAIT.includes(item.status) ? "wait" : "";
  info.append(el("strong", (item.name || item.phone) + (item.name ? " · " + item.phone : "")),
    el("span", tr(item.label), {className: "pr-pill " + cls}),
    el("small", tr("İstek") + ": " + fmt(item.createdAt) + (item.doneAt ? " · " + tr("Yenilendi") + ": " + fmt(item.doneAt) : "") + (item.by ? " · " + item.by : "")));
  r.append(info);
  if (item.canSend) {
    const acts = el("div", "", {className: "pr-acts"}), msg = el("small", "", {className: "pr-msg", role: "status"});
    const send = async (channel, button) => {
      button.disabled = true; msg.textContent = "";
      // WhatsApp penceresi tıklama anında açılır (açılır pencere engeline takılmaz); bağlantı sunucudan gelince yönlendirilir.
      const win = channel === "whatsapp" ? window.open("about:blank", "_blank") : null;
      try {
        const res = await api("/api/password-resets/send", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: item.id, channel})});
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(data.error || tr("Gönderilemedi."));
        if (data.link) { if (win) win.location.href = data.link; else location.href = data.link; }
        msg.textContent = channel === "sms" ? tr("SMS sıraya alındı.") : tr("WhatsApp açıldı; mesajı gönderin.");
        setTimeout(onChange, 1200);
      } catch (e) { win?.close(); msg.textContent = e.message; button.disabled = false; }
    };
    const sms = el("button", tr("SMS ile gönder"), {type: "button", className: "button small primary"});
    const wa = el("button", tr("WhatsApp ile gönder"), {type: "button", className: "button small"});
    sms.addEventListener("click", () => send("sms", sms));
    wa.addEventListener("click", () => send("whatsapp", wa));
    acts.append(sms, wa, msg);
    r.append(acts);
  }
  return r;
}

async function load(api, query) {
  try { const r = await api("/api/password-resets" + query); if (r.ok) return (await r.json()).items || []; } catch {}
  return null;
}

/** Hasta sahibi kartı: yalnız istek varsa görünür. */
export function mountResetCard(main, client, {api, tr = s => s}) {
  css();
  const box = el("section", "", {className: "panel pr-box record-section-reset"});
  box.dataset.client = client;
  const anchor = main.querySelector(".record-section-portal") || main.querySelector(".record-section-contact");
  anchor ? anchor.after(box) : main.append(box);
  box.hidden = true;
  const draw = async () => {
    const items = await load(api, "?client=" + encodeURIComponent(client));
    if (!box.isConnected) return;
    if (!items || !items.length) { box.hidden = true; return; }
    const head = el("header", "", {className: "panel-head"}), title = el("div");
    title.append(el("h2", tr("Şifre yenileme istekleri")), el("p", tr("Hasta sahibi “Şifremi unuttum” dedi. SMS gidemezse buradan tek dokunuşla SMS veya WhatsApp ile gönderin; şifresini yenileyince “Şifre yenilendi” görünür.")));
    head.append(title);
    const body = el("div", "", {className: "pr-body"});
    for (const it of items.slice(0, 5)) body.append(row(it, {api, tr, onChange: draw}));
    box.replaceChildren(head, body); box.hidden = false;
  };
  draw();
  return draw;
}

/** Bayi › Hesaplar: tüm istekler (ekip hesapları dahil), son 7 gün. */
export async function mountResetList(container, {api, tr = s => s}) {
  css();
  const box = el("section", "", {className: "panel suite-panel pr-box"});
  container.append(box);
  const draw = async () => {
    const items = await load(api, "");
    if (!items || !items.length) { box.hidden = true; return; }
    const open = items.filter(i => BAD.includes(i.status)).length;
    const title = el("h2", tr("Şifre yenileme istekleri"));
    if (open) title.append(" ", el("span", open + " " + tr("gönderilemedi"), {className: "pr-pill bad"}));
    const body = el("div", "", {className: "pr-body"});
    for (const it of items) body.append(row(it, {api, tr, onChange: draw}));
    box.replaceChildren(title, el("p", tr("Son 7 gündeki “Şifremi unuttum” istekleri ve durumları."), {className: "suite-muted"}), body); box.hidden = false;
  };
  await draw();
}
