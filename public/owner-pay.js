// Hasta sahibi borç ödemesi (hasta sahibi girişi) ve kliniğin ödeme ayarları / havale onayları (Ayarlar › Hasta sahibi ödemeleri).
const STYLE = "/owner-pay.css?v=2";
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const css = () => { if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE})); };
const tl = (c, lang = document.documentElement.lang || "tr") => new Intl.NumberFormat(lang, {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(c / 100) + " ₺";
const when = t => t ? new Date(t * 1000).toLocaleString(document.documentElement.lang || "tr", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "—";
const STATUS = {pending: "Ödeme bekleniyor", review: "Klinik onayı bekliyor", paid: "Ödendi", failed: "Tamamlanmadı", rejected: "Reddedildi"};

/** Hasta sahibi: borç kartı + kartla / havale ile ödeme. */
export async function mountOwnerPay(root, {scope, tr = s => s}) {
  css();
  const call = async (body) => {
    const r = await fetch("/api/owner-pay", body ? {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)} : {credentials: "same-origin"});
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || tr("İşlem tamamlanamadı.")); return d;
  };
  let info;
  try { info = await call(); } catch { return; }
  const draw = () => {
    const box = h("section", "op-card");
    box.append(h("h2", "", tr("Borç ödeme")));
    if (info.debt <= 0) { box.append(h("p", "op-muted", tr("Ödenecek borcunuz bulunmuyor."))); }
    else if (!info.card && !info.bank) { box.append(h("p", "", tr("Borcunuz")), h("strong", "op-amount", tl(info.debt)), h("p", "op-muted", tr("Ödeme için kliniğinizle iletişime geçin."))); }
    else {
      const amount = h("input", "op-input", null, {type: "number", min: "1", max: String(info.debt / 100), step: "0.01", value: (info.debt / 100).toFixed(2), inputMode: "decimal"});
      const lab = h("label", "op-label"); lab.append(h("span", "", tr("Ödenecek tutar (₺)")), amount);
      const msg = h("p", "op-msg", "", {role: "status"});
      const actions = h("div", "op-actions");
      const go = async method => {
        const cents = Math.round(Number(amount.value) * 100);
        if (!(cents >= 100 && cents <= info.debt)) { msg.textContent = tr("Tutar 1,00 TL ile borcunuz arasında olmalı."); return; }
        actions.querySelectorAll("button").forEach(b => { b.disabled = true; }); msg.textContent = tr("Hazırlanıyor…");
        try {
          const r = await call({op: "start", method, amount: cents});
          if (r.method === "card") { location.assign(r.url); return; }
          bank(r);
        } catch (e) { msg.textContent = e.message; actions.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
      };
      if (info.card) { const b = h("button", "button primary", tr("Kartla öde"), {type: "button"}); b.addEventListener("click", () => go("card")); actions.append(b); }
      if (info.bank) { const b = h("button", "button secondary", tr("Havale / EFT ile öde"), {type: "button"}); b.addEventListener("click", () => go("bank")); actions.append(b); }
      box.append(h("p", "", tr("Borcunuz")), h("strong", "op-amount", tl(info.debt)), lab, actions, msg);
      if (info.card) box.append(h("p", "op-muted", tr("Kart ödemeleri kliniğinizin güvenli PayTR ödeme sayfasında yapılır; ödeme kasaya kendiliğinden işlenir.")));
    }
    if (info.payments?.length) {
      const ul = h("ul", "op-list");
      for (const p of info.payments) { const li = h("li"); li.append(h("span", "", when(p.created_at)), h("b", "", tl(p.amount)), h("small", "op-st " + p.status, tr(STATUS[p.status] || p.status))); ul.append(li); }
      box.append(h("h3", "", tr("Son ödemelerim")), ul);
    }
    root.replaceChildren(box);
  };
  const bank = r => {
    const box = h("section", "op-card");
    const copy = (label, value) => { const row = h("div", "op-copy"); const b = h("button", "button secondary small", tr("Kopyala"), {type: "button"}); b.addEventListener("click", () => navigator.clipboard?.writeText(value).then(() => { b.textContent = tr("Kopyalandı"); }, () => {})); row.append(h("span", "", tr(label)), h("b", "", value), b); return row; };
    const ref = h("input", "op-input", null, {maxLength: 100, placeholder: tr("Banka işlem referansı (isteğe bağlı)")});
    const done = h("button", "button primary", tr("Havaleyi yaptım"), {type: "button"});
    const msg = h("p", "op-msg", "", {role: "status"});
    done.addEventListener("click", async () => { done.disabled = true; try { info = await call({op: "notify", id: r.id, reference: ref.value}); draw(); } catch (e) { msg.textContent = e.message; done.disabled = false; } });
    box.append(h("h2", "", tr("Havale / EFT bilgileri")),
      h("p", "", tr("Aşağıdaki hesaba havale yapın ve açıklamaya ödeme kodunu yazın. Klinik ödemeyi gördüğünde borcunuzdan düşülür.")),
      copy("Alıcı", r.bank.beneficiary), copy("IBAN", r.bank.iban), ...(r.bank.bankName ? [copy("Banka", r.bank.bankName)] : []), copy("Tutar", tl(r.amount)), copy("Açıklama (ödeme kodu)", r.code),
      ref, done, msg);
    root.replaceChildren(box);
  };
  draw();
}

/** Klinik: PayTR ve havale ayarları (bayi yöneticisi), onay bekleyen havaleler ve son ödemeler. */
export async function mountOwnerPayAdmin(root, {api, scope, tr = s => s}) {
  css();
  const call = async body => {
    const r = await api("/api/clinic/owner-payments", body ? {method: "POST", headers: {"Content-Type": "application/json", "X-VeTNet-Scope": scope}, body: JSON.stringify(body)} : {});
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || tr("İşlem tamamlanamadı.")); return d;
  };
  const draw = data => {
    const wrap = h("div", "op-admin");
    const s = data.settings;
    if (s) {
      const f = h("form", "op-card", null, {noValidate: true});
      const chk = (label, on) => { const l = h("label", "op-check"); const c = h("input", "", null, {type: "checkbox", checked: on}); l.append(c, h("span", "", tr(label))); return [l, c]; };
      const inp = (label, value, props = {}) => { const l = h("label", "op-label"); const i = h("input", "op-input", null, {value: value || "", ...props}); l.append(h("span", "", tr(label)), i); return [l, i]; };
      const [cardL, card] = chk("Kartla ödemeyi aç (kendi PayTR mağazanız)", s.card), [testL, test] = chk("Test modu (gerçek para çekilmez)", s.test);
      const [midL, mid] = inp("PayTR Mağaza No", s.merchantId, {inputMode: "numeric", maxLength: 12});
      const [keyL, key] = inp(s.hasKey ? "Mağaza Parola · kayıtlı, değiştirmek için yazın" : "Mağaza Parola (merchant_key)", "", {type: "password", autocomplete: "off", maxLength: 64});
      const [saltL, salt] = inp(s.hasSalt ? "Mağaza Gizli Anahtar · kayıtlı, değiştirmek için yazın" : "Mağaza Gizli Anahtar (merchant_salt)", "", {type: "password", autocomplete: "off", maxLength: 64});
      const [bankL, bank] = chk("Havale / EFT ile ödemeyi aç", s.bank);
      const [ibanL, iban] = inp("IBAN", s.iban, {maxLength: 34, placeholder: "TR.."});
      const [benL, ben] = inp("Alıcı adı", s.beneficiary, {maxLength: 120});
      const [bnL, bn] = inp("Banka (isteğe bağlı)", s.bankName, {maxLength: 80});
      // Farklı bankalar için ek hesaplar (en çok 4): hasta sahibine ödeme sayfasında hepsi gösterilir.
      const extra = h("div", "op-banks");
      const bankRows = [];
      const addBank = (x = {}) => {
        if (bankRows.length >= 4) return;
        const row = h("div", "op-bank-row");
        const [nL, n] = inp("Banka", x.bankName, {maxLength: 80}), [iL, i] = inp("IBAN", x.iban, {maxLength: 34, placeholder: "TR.."}), [bL, bb] = inp("Alıcı adı", x.beneficiary, {maxLength: 120});
        const del = h("button", "button secondary small", tr("Kaldır"), {type: "button"});
        del.addEventListener("click", () => { row.remove(); bankRows.splice(bankRows.indexOf(item), 1); more.hidden = bankRows.length >= 4; });
        const item = {n, i, bb};
        row.append(nL, iL, bL, del); extra.append(row); bankRows.push(item);
        more.hidden = bankRows.length >= 4;
      };
      const more = h("button", "button secondary small", tr("+ Başka banka hesabı ekle"), {type: "button"});
      more.addEventListener("click", () => addBank());
      for (const x of s.banks || []) addBank(x);
      const msg = h("p", "op-msg", "", {role: "status"});
      const save = h("button", "button primary", tr("Kaydet"), {type: "submit"});
      const cb = h("p", "op-muted"); cb.append(h("span", "", tr("PayTR panelinde Bildirim URL alanına yazın: ")), h("code", "", data.callback));
      f.append(h("h3", "", tr("Hasta sahibi ödeme ayarları")), h("p", "op-muted", tr("Borcu olan hasta sahipleri, hasta sahibi girişinden veya gönderdiğiniz ödeme bağlantısından kartla ya da havale ile öder. Ödemeler kendi hesabınıza gelir.")),
        cardL, testL, midL, keyL, saltL, cb, bankL, ibanL, benL, bnL, extra, more,
        h("p", "op-muted", tr("Borcu olan hasta sahiplerine Muhasebe › Borç Hatırlatma ekranından “Ödeme talebi” gönderebilirsiniz: toplam borç, ödeme bağlantısı, klinik adı ve telefonu SMS ile gider; uygulama hesabı olana bildirim de düşer.")), msg, save);
      f.addEventListener("submit", async e => {
        e.preventDefault(); save.disabled = true; msg.textContent = tr("Kaydediliyor…");
        try { draw(await call({op: "settings", card: card.checked, test: test.checked, merchantId: mid.value, key: key.value, salt: salt.value, bank: bank.checked, iban: iban.value, beneficiary: ben.value, bankName: bn.value, banks: bankRows.map(x => ({bankName: x.n.value, iban: x.i.value, beneficiary: x.bb.value}))})); }
        catch (er) { msg.textContent = er.message; save.disabled = false; }
      });
      wrap.append(f);
    }
    const list = h("section", "op-card");
    list.append(h("h3", "", tr("Hasta sahibi ödemeleri")));
    const waiting = data.payments.filter(p => p.method === "bank" && ["pending", "review"].includes(p.status));
    if (waiting.length) list.append(h("p", "op-muted", tr("Havaleyi banka hesabınızda gördükten sonra onaylayın; tutar borçlu satışlara tahsilat olarak işlenir.")));
    if (!data.payments.length) list.append(h("p", "op-muted", tr("Henüz online ödeme yok.")));
    for (const p of data.payments) {
      const row = h("div", "op-row");
      const left = h("div"); left.append(h("b", "", p.customer_name || "—"), h("small", "", `${when(p.created_at)} · ${p.method === "card" ? tr("Kart") : tr("Havale")} · ${tr("Kod")} ${p.code}${p.reference ? " · " + tr("Ref") + " " + p.reference : ""}`));
      row.append(left, h("strong", "", tl(p.amount)), h("span", "op-st " + p.status, tr(STATUS[p.status] || p.status)));
      if (p.method === "bank" && ["pending", "review"].includes(p.status)) {
        const ok = h("button", "button primary small", tr("Hesaba geçti · onayla"), {type: "button"});
        const no = h("button", "button secondary small", tr("Reddet"), {type: "button"});
        ok.addEventListener("click", async () => { ok.disabled = true; try { draw(await call({op: "decide", id: p.id, action: "approve", verified: true})); } catch (e) { alert(e.message); ok.disabled = false; } });
        no.addEventListener("click", async () => { no.disabled = true; try { draw(await call({op: "decide", id: p.id, action: "reject"})); } catch (e) { alert(e.message); no.disabled = false; } });
        const act = h("div", "op-actions"); act.append(ok, no); row.append(act);
      }
      list.append(row);
    }
    wrap.append(list);
    root.replaceChildren(wrap);
  };
  try { draw(await call()); } catch (e) { root.replaceChildren(h("p", "op-msg", e.message)); }
}
