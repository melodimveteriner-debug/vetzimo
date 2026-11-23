import {clinicFetch} from "./access.js";

export const termStatus={active:"Etkin",scheduled:"Başlangıç bekliyor",expired:"Süresi doldu",unmanaged:"Dönem tanımlanmamış"};
export const termKind={trial:"Deneme",paid:"Ücretli abonelik",assigned:"Yönetici paket ataması"};
export const termDate=value=>new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeZone:"Europe/Istanbul"}).format(new Date(value+"T12:00:00Z"));

export async function mountMySubscription(root,{esc}) {
  try {
    const response=await clinicFetch("/api/saas/my-subscription");
    const data=await response.json();
    if (!response.ok) throw Error(data.error||"Abonelik bilgileri yüklenemedi.");
    if (!root.isConnected) return;
    const current=data.current||data.terms[0];
    const daysLeft=current?Math.max(0,Math.round((Date.parse(current.ends_on)-Date.parse(data.day))/86400000)):0;
    const span=current?Math.max(1,Math.round((Date.parse(current.ends_on)-Date.parse(current.starts_on))/86400000)):1;
    const value=Math.max(0,Math.min(span,span-daysLeft));
    root.innerHTML=`<section class="panel subscription-panel"><div class="subscription-hero">
      <div><p class="subscription-eyebrow">VETZIMO · BAYİ HESABI</p><h2>${esc(current?.plan_name||"Klinik aboneliği")}</h2><p>${esc(termStatus[data.status])}</p></div>
      <div class="subscription-dates">${current?`<strong>${esc(termKind[current.kind])}</strong><span>${esc(termDate(current.starts_on))} — ${esc(termDate(current.ends_on))}</span>`:"<span>Bu klinik için abonelik dönemi henüz tanımlanmadı.</span>"}</div>
      </div>
      ${data.current?`<div class="subscription-progress"><label for="term-progress">${daysLeft} gün kaldı</label><progress id="term-progress" max="${span}" value="${value}"></progress></div>`:""}
      ${data.status==="expired"?'<p class="callout warning">Klinik kayıtlarını görüntüleyebilirsiniz. Döneminizi yenilemek için destek talebi açın.</p>':""}
      <div class="subscription-actions"><a href="#bayi-destek/new">Abonelik için destek isteyin</a><a href="/platform/paketler">Paketleri inceleyin</a></div></section>
      <section class="panel subscription-panel"><h2>Dönem geçmişi</h2>
      ${data.terms.length?`<ul class="subscription-timeline">${data.terms.map(row=>`<li><div><strong>${esc(row.plan_name)}</strong><small>${esc(termKind[row.kind])} · ${esc(termStatus[row.status])}</small></div>
        <span>${esc(termDate(row.starts_on))} — ${esc(termDate(row.ends_on))}</span></li>`).join("")}</ul>`:"<p>Kayıtlı dönem yok.</p>"}</section>`;
  } catch(error) {
    if (root.isConnected) root.textContent=error.message;
  }
}

export async function mountDemoCheckout(root,{esc}) {
  const money=value=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
  async function load() {
    const response=await clinicFetch("/api/saas/demo-checkout");
    const data=await response.json();
    if (!response.ok) throw Error(data.error||"Ödeme ekranı açılmadı.");
    if (!root.isConnected) return;
    const status={pending:"İnceleme bekliyor",approved:"Onaylandı",rejected:"Reddedildi"};
    root.innerHTML=`<section class="panel subscription-panel demo-checkout">
      <h2>Ücretli bayi paketine geçiş</h2><p>Mevcut klinik hesabınız ve kayıtlarınız aynı hesapta kullanılır. Banka hareketi doğrulandıktan sonra ücretli dönem açılır.</p>
      ${data.order?`<p class="callout"><strong>${esc(status[data.order.state])}</strong> · ${esc(data.order.plan_name)} · ${esc(money(data.order.amount))}</p>`:""}
      ${data.bank&&data.plans.length&&data.order?.state!=="pending"?`<div class="demo-bank">
        <p><strong>Ödeme yöntemi</strong> Havale / EFT</p><p><strong>Alıcı</strong> ${esc(data.bank.beneficiary)}</p><p><strong>IBAN</strong> <code>${esc(data.bank.iban)}</code></p>
        </div><form class="demo-checkout-form">
          <label>Paket <select name="plan" required>${data.plans.map(row=>`<option value="${esc(row.id)}">${esc(row.name)} · ${esc(money(row.yearly))} / yıl</option>`).join("")}</select></label>
          <label>Banka işlem referansı <input name="reference" required maxlength="100" autocomplete="off"></label>
          <label class="demo-confirm"><input name="confirm" type="checkbox" required> Ödemeyi yaptım ve banka işlem referansını kontrol ettim.</label>
          <button type="submit" class="button primary">Ödeme bildirimi gönder</button><p role="status"></p>
        </form>`:data.order?.state==="pending"?"<p>Bildiriminiz yetkili incelemesinde.</p>":"<p>Havale bilgisi veya KDV dahil yıllık paket henüz tanımlanmadı.</p>"}
      <div class="subscription-actions"><a href="#abonelik">Aboneliğime dön</a><a href="#bayi-destek/new">Ödeme hakkında destek isteyin</a></div>
    </section>`;
    const form=root.querySelector("form");
    form?.addEventListener("submit",async event=>{
      event.preventDefault();
      const values=new FormData(form), feedback=form.querySelector("[role=status]"), button=form.querySelector("button");
      const plan=data.plans.find(row=>row.id===values.get("plan"));
      if (!plan||button.disabled) return;
      button.disabled=true;
      try {
        const response=await clinicFetch("/api/saas/demo-checkout",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({plan:plan.id,version:plan.version,reference:values.get("reference"),confirm:values.get("confirm")==="on"})});
        const result=await response.json();
        if (!response.ok) throw Error(result.error||"Ödeme bildirimi gönderilemedi.");
        await load();
      } catch(error) {feedback.textContent=error.message;}
      finally {button.disabled=false;}
    });
  }
  try {await load();} catch(error) {if(root.isConnected)root.textContent=error.message;}
}
