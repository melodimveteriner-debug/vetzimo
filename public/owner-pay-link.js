// Hasta sahibinin hesapsız ödeme sayfası (/p/…): toplam borç, kartla öde (kliniğin PayTR'si) veya havale/EFT (IBAN + ödeme kodu).
const root = document.getElementById("payRoot");
const token = root.dataset.token;
const api = (body) => fetch("/api/pay-link/" + token, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {})
  .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || "İşlem tamamlanamadı."); return d; });
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const tl = c => (c / 100).toLocaleString("tr-TR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " TL";
const copyRow = (label, value) => {
  const row = el("div", "pl-copy"), b = el("button", "pm-link", "Kopyala");
  b.type = "button";
  b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(value); b.textContent = "Kopyalandı"; } catch { b.textContent = value; } });
  row.append(el("span", "", label), el("strong", "", value), b);
  return row;
};
async function draw(note = "") {
  let d;
  try { d = await api(); } catch (e) { root.replaceChildren(card("Bağlantı geçersiz", e.message)); return; }
  const head = el("header", "pm-head");
  head.append(el("span", "pm-badge", d.clinic), el("h1", "", "Güvenli ödeme"), el("p", "", "Sayın " + (d.name || "hasta sahibimiz") + ","));
  const sum = el("section", "pm-card pl-sum");
  sum.append(el("small", "", "Toplam ödenecek tutar"), el("strong", "pl-amount", tl(d.debt || 0)));
  if (d.phone) { const a = el("a", "pm-link", "Bilgi: " + d.phone); a.href = "tel:" + d.phone.replace(/[^+\d]/g, ""); sum.append(a); }
  const parts = [head];
  if (note) parts.push(card("", note));
  parts.push(sum);
  if (!(d.debt > 0)) { parts.push(card("Teşekkürler", "Ödenecek borcunuz bulunmuyor.")); root.replaceChildren(...parts); return; }
  const amount = el("input", "pl-input"); amount.type = "number"; amount.min = "1"; amount.step = "0.01"; amount.max = (d.debt / 100).toFixed(2); amount.value = (d.debt / 100).toFixed(2);
  const amountL = el("label", "pm-field", "Ödenecek tutar (TL)"); amountL.append(amount);
  const err = el("p", "pm-error"); err.setAttribute("role", "alert");
  const cents = () => Math.round(parseFloat(String(amount.value).replace(",", ".")) * 100);
  const box = el("section", "pm-card");
  box.append(amountL);
  if (d.card) {
    const b = el("button", "pm-primary", "Kartla öde (3D Secure)"); b.type = "button";
    b.addEventListener("click", async () => {
      err.textContent = ""; b.disabled = true;
      try { const r = await api({method: "card", amount: cents()}); location.href = r.url; } catch (e) { err.textContent = e.message; b.disabled = false; }
    });
    box.append(b, el("p", "pm-muted", "Kart bilgileriniz kliniğe gelmez; ödeme PayTR'nin güvenli sayfasında yapılır."));
  }
  if (d.bank) {
    const b = el("button", d.card ? "pm-secondary" : "pm-primary", "Havale / EFT ile öde"); b.type = "button";
    b.addEventListener("click", async () => {
      err.textContent = ""; b.disabled = true;
      try {
        const r = await api({method: "bank", amount: cents()});
        const info = el("section", "pm-card");
        info.append(el("h2", "", "Havale / EFT bilgileri"), el("p", "pm-muted", "Açıklamaya ödeme kodunu yazın. Klinik hesabında görünce ödemeniz onaylanır."));
        for (const bk of (d.banks && d.banks.length ? d.banks : [r.bank])) {
          const acc = el("div", "pl-bank");
          if (bk.bankName) acc.append(el("b", "", bk.bankName));
          acc.append(copyRow("Alıcı", bk.beneficiary), copyRow("IBAN", bk.iban));
          info.append(acc);
        }
        info.append(copyRow("Tutar", tl(r.amount)), copyRow("Açıklama (ödeme kodu)", r.code));
        const ref = el("input", "pl-input"); ref.maxLength = 100; ref.placeholder = "Banka işlem no (isteğe bağlı)";
        const done = el("button", "pm-primary", "Havaleyi yaptım"); done.type = "button";
        done.addEventListener("click", async () => {
          done.disabled = true;
          try { await api({op: "notify", id: r.id, reference: ref.value.trim()}); draw("Bildiriminiz kliniğe iletildi. Tutar hesaba geçince ödemeniz onaylanır."); }
          catch (e) { err.textContent = e.message; done.disabled = false; }
        });
        info.append(ref, done);
        box.after(info); b.remove(); info.scrollIntoView({behavior: "smooth"});
      } catch (e) { err.textContent = e.message; b.disabled = false; }
    });
    box.append(b);
  }
  box.append(err);
  parts.push(box);
  root.replaceChildren(...parts);
}
function card(title, text) { const c = el("section", "pm-card"); if (title) c.append(el("h2", "", title)); c.append(el("p", "", text)); return c; }
const result = new URLSearchParams(location.search).get("sonuc");
draw(result === "tamam" ? "Ödemeniz alındı. Banka onayı birkaç saniye içinde gelir; borcunuz otomatik güncellenir." : result === "hata" ? "Ödeme tamamlanmadı. Kartınızdan para çekilmedi; tekrar deneyebilirsiniz." : "");
