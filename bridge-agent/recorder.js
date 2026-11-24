// Öğretme modunda Bakanlık sayfalarına eklenen kaydedici: tıklama, yazma ve seçimleri adım olarak ajana bildirir.
// Hiçbir veriyi dışarı göndermez; yalnızca yerel ajanın açtığı tarayıcıda çalışır.
(() => {
  if (window.__vzRecorder) return;
  window.__vzRecorder = true;
  const css = v => (window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));
  const stable = id => id && !/\d{4,}|^[0-9]|[:.]\d|ember|react|jsf_/i.test(id);
  function label(el) {
    if (el.id) { const l = document.querySelector('label[for="' + css(el.id) + '"]'); if (l) return l.innerText.trim().slice(0, 60); }
    const wrap = el.closest("label"); if (wrap) return wrap.innerText.trim().slice(0, 60);
    return (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "").trim().slice(0, 60);
  }
  function selectors(el) {
    const out = [], tag = el.tagName.toLowerCase();
    if (stable(el.id)) out.push("#" + css(el.id));
    const name = el.getAttribute("name");
    if (name) out.push(tag + '[name="' + name.replace(/"/g, '\\"') + '"]' + (el.type === "radio" ? '[value="' + (el.value || "").replace(/"/g, '\\"') + '"]' : ""));
    const aria = el.getAttribute("aria-label");
    if (aria) out.push(tag + '[aria-label="' + aria.replace(/"/g, '\\"') + '"]');
    const ph = el.getAttribute("placeholder");
    if (ph) out.push(tag + '[placeholder="' + ph.replace(/"/g, '\\"') + '"]');
    const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ");
    if (/^(button|a)$/.test(tag) || el.getAttribute("role") === "button" || el.type === "submit") {
      if (text && text.length <= 40) out.push(tag + ':has-text("' + text.replace(/"/g, '\\"') + '")');
    }
    const lbl = label(el);
    if (lbl && /^(input|select|textarea)$/.test(tag)) out.push("label=" + lbl);
    // Son çare: yapısal yol.
    const path = [];
    for (let n = el; n && n.nodeType === 1 && path.length < 6; n = n.parentElement) {
      let part = n.tagName.toLowerCase();
      if (stable(n.id)) { path.unshift("#" + css(n.id)); break; }
      const sib = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (sib.length > 1) part += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
      path.unshift(part);
    }
    out.push(path.join(" > "));
    return [...new Set(out)];
  }
  const send = step => window.__vzRecord && window.__vzRecord({...step, url: location.href, at: Date.now()});
  document.addEventListener("change", e => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") send({action: "select", selectors: selectors(el), value: el.options[el.selectedIndex]?.text || el.value, label: label(el)});
    else if (el.type === "checkbox" || el.type === "radio") send({action: "check", selectors: selectors(el), value: el.checked ? "1" : "0", label: label(el)});
    else if (/^(input|textarea)$/.test(tag) && el.type !== "password" && el.type !== "file") send({action: "fill", selectors: selectors(el), value: el.value, label: label(el)});
  }, true);
  document.addEventListener("click", e => {
    const el = e.target.closest?.('button,a,[role="button"],[role="option"],li,input[type=submit],input[type=button],td,span');
    if (!el || el.type === "checkbox" || el.type === "radio") return;
    if (window.__vzMarkMode) {
      // İşaretleme: tıklama sayfaya iletilmez. "submit" Kaydet düğmesini öğretir (öğretirken kayıt oluşmaz).
      e.preventDefault(); e.stopPropagation();
      send({action: window.__vzMarkMode, selectors: selectors(el), value: (el.innerText || el.value || "").trim().slice(0, 120)});
      window.__vzMarkMode = false;
      document.documentElement.style.cursor = "";
      return;
    }
    send({action: "click", selectors: selectors(el), value: (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60), label: label(el)});
  }, true);
})();
