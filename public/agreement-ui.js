// VetZimo Kullanım Sözleşmesi onay ve imza paneli (aktivasyon sayfası ve mevcut bayilerin ilk girişi).
// Sözleşme okunur, ad soyad yazılır, imza atılır ve onay kutusu işaretlenir; "Kabul etmiyorum" seçilirse hesap açılmaz.
const css = "/agreement-ui.css?v=3";
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ""); else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
};

/** {agreement, tr, acceptLabel, onReject, acceptButton} → {node, value(): {accepted,name,title,signature,hash} | throws}
 *  acceptButton: sayfanın onay düğmesi; "Kabul ediyorum" önce, kırmızı "Kabul etmiyorum" yanında (dar ekranda altında) durur. */
export function agreementPanel({agreement, tr = s => s, acceptLabel = "", onReject, acceptButton = null}) {
  if (!document.querySelector(`link[href="${css}"]`)) document.head.append(h("link", {rel: "stylesheet", href: css}));
  const date = agreement.effective_on ? new Date(agreement.effective_on + "T12:00:00").toLocaleDateString(document.documentElement.lang || "tr", {day: "numeric", month: "long", year: "numeric"}) : "";
  const doc = h("div", {class: "ag-doc", tabindex: "0", role: "document", "aria-label": agreement.title, html: agreement.html});
  const read = h("p", {class: "ag-read", text: tr("Metnin sonuna kadar kaydırın.")});
  let reachedEnd = false;
  const checkEnd = () => { if (doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 24) { reachedEnd = true; read.textContent = tr("Metnin tamamı görüntülendi."); read.classList.add("ok"); } };
  doc.addEventListener("scroll", checkEnd, {passive: true});
  requestAnimationFrame(checkEnd);
  const name = h("input", {name: "agreementName", autocomplete: "name", maxlength: "120", required: true});
  const title = h("input", {name: "agreementTitle", maxlength: "120", placeholder: tr("Ör. Klinik sahibi, şirket yetkilisi")});
  const canvas = h("canvas", {class: "ag-pad", width: "600", height: "180", "aria-label": tr("İmza alanı")});
  const ctx = canvas.getContext("2d");
  let drawn = false, last = null;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); last = pos(e); e.preventDefault(); });
  canvas.addEventListener("pointermove", e => {
    if (!last) return;
    const p = pos(e);
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.strokeStyle = "#111827";
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p; drawn = true;
  });
  const end = () => { last = null; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  const clear = h("button", {type: "button", class: "button small", text: tr("İmzayı temizle"), onclick: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; }});
  const consent = h("input", {type: "checkbox", name: "agreementAccept"});
  const reject = h("button", {type: "button", class: "button ag-reject", text: tr("Kabul etmiyorum"), onclick: () => onReject?.()});
  const node = h("section", {class: "ag-panel", "aria-labelledby": "agTitle"},
    h("header", {class: "ag-head"}, h("h2", {id: "agTitle", text: agreement.title}),
      h("p", {class: "ag-meta", text: [date && tr("Düzenleme tarihi") + ": " + date, tr("Sürüm") + " " + agreement.version].filter(Boolean).join(" · ")})),
    agreement.summary ? h("p", {class: "ag-summary", text: agreement.summary}) : null,
    doc, read,
    h("div", {class: "ag-warning", role: "alert"},
      h("strong", {text: tr("ÖNEMLİ · Onaylamadan hesap açılmaz")}),
      h("p", {text: tr("VetZimo Kullanım Sözleşmesini okuyup imzalamadan bayi hesabınız, deneme (demo) dahil, açılmaz ve VetZimo kullanılamaz. Sözleşme; yazılımın kopyalanmaması ve güvenliğinin ihlal edilmemesi, hasta sahiplerine gönderilen SMS, WhatsApp ve e-posta iletilerinin, yapay zekâ araçlarının, uygulamaların ve ajanların kullanımından doğan sorumlulukları içerir.")})),
    h("div", {class: "ag-fields"},
      h("label", {}, h("span", {text: tr("İmzalayan adı soyadı")}), name),
      h("label", {}, h("span", {text: tr("Unvanı (isteğe bağlı)")}), title)),
    h("div", {class: "ag-sign"}, h("span", {text: tr("İmza")}), canvas, h("div", {class: "ag-sign-tools"}, h("small", {text: tr("Parmağınızla, kalemle veya fareyle imzalayın.")}), clear)),
    h("label", {class: "ag-accept"}, consent, h("span", {text: tr("Sözleşmenin tamamını okudum, anladım; işletmeyi temsile yetkili olduğumu ve sözleşmeyi elektronik imzamla kabul ettiğimi beyan ederim.")})),
    acceptLabel ? h("p", {class: "ag-accept-hint", text: tr(acceptLabel)}) : null,
    h("div", {class: "ag-actions"}, acceptButton, reject));
  const value = () => {
    if (!reachedEnd) { doc.focus(); throw Error(tr("Lütfen sözleşmeyi sonuna kadar okuyun.")); }
    if (name.value.trim().split(/\s+/).length < 2) { name.focus(); throw Error(tr("İmzalayan kişinin adını ve soyadını yazın.")); }
    if (!drawn) { canvas.scrollIntoView({block: "center"}); throw Error(tr("Sözleşmeyi imza alanına imzalayın.")); }
    if (!consent.checked) { consent.focus(); throw Error(tr("Onay kutusunu işaretleyin.")); }
    return {accepted: true, name: name.value.trim(), title: title.value.trim(), signature: canvas.toDataURL("image/png"), hash: agreement.hash};
  };
  return {node, value};
}

/** Mevcut bayiler için engelleyici pencere: yönetici imzalar, diğer kullanıcılar bekler. */
export function agreementGate({fetch: api, scope, tr = s => s, canSign, onSigned, logout}) {
  if (!document.querySelector(`link[href="${css}"]`)) document.head.append(h("link", {rel: "stylesheet", href: css}));
  const box = h("div", {class: "ag-gate", role: "dialog", "aria-modal": "true"});
  const card = h("div", {class: "ag-gate-card"});
  box.append(card);
  document.body.append(box);
  const out = h("button", {type: "button", class: "button", text: tr("Çıkış yap"), onclick: () => logout?.()});
  if (!canSign) {
    card.append(h("h2", {text: tr("VetZimo Kullanım Sözleşmesi bekleniyor")}),
      h("p", {text: tr("Kliniğinizin bayi yöneticisi VetZimo Kullanım Sözleşmesini imzalayana kadar çalışma alanı açılamaz. Lütfen bayi yöneticinizle iletişime geçin.")}), out);
    return;
  }
  card.append(h("p", {text: tr("Yükleniyor…")}));
  api("/api/agreement").then(r => r.json()).then(data => {
    card.replaceChildren();
    const msg = h("p", {class: "ag-error", role: "status"});
    const panel = agreementPanel({agreement: data.agreement, tr, onReject: () => {
      card.replaceChildren(h("h2", {text: tr("Sözleşme onaylanmadı")}), h("p", {text: tr("VetZimo Kullanım Sözleşmesi onaylanmadan çalışma alanı kullanılamaz. Dilediğiniz zaman yeniden giriş yaparak onaylayabilirsiniz.")}), out);
    }});
    const accept = h("button", {type: "button", class: "button primary", text: tr("Kabul ediyorum ve imzalıyorum"), onclick: async () => {
      msg.textContent = "";
      try {
        const body = panel.value();
        accept.disabled = true;
        const r = await api("/api/agreement", {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)});
        const d = await r.json();
        if (!r.ok) throw Error(d.error || tr("İşlem tamamlanamadı."));
        box.remove(); onSigned?.();
      } catch (e) { msg.textContent = e.message; accept.disabled = false; }
    }});
    panel.node.querySelector(".ag-actions").prepend(accept);
    card.append(panel.node, msg);
  }).catch(e => { card.replaceChildren(h("p", {text: e.message}), out); });
}
