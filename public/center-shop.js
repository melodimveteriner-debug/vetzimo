import {opsFetch} from "./center-ops.js";
import {paginate} from "./paged.js";
import {saasTerms,termValue} from "./saas-market.js";
import {termDate,termStatus} from "./saas-subscription.js";

const money=value=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
const quantity=value=>new Intl.NumberFormat("tr-TR").format(value);
const labels={pending:"Ödeme bekleniyor",review:"Havale kontrolünde",paid:"Ödendi · abonelik açıldı",failed:"Ödeme tamamlanmadı",rejected:"Reddedildi"};
const categories={abonelik:{title:"Abonelik paketleri",short:"Abonelik"}};
const periodLabel={monthly:"Aylık",yearly:"Yıllık"};
const artwork=type=>{
  const center=type==="abonelik"?'<rect x="94" y="31" width="81" height="80" rx="12"/><path d="M111 50h45m-45 12h31m-31 13h15m13 0h17m-45 15h45"/><circle cx="168" cy="104" r="21"/><path d="m157 104 7 7 15-17"/>':
    type==="whatsapp"?'<path d="M178 67a43 43 0 0 1-63 38l-22 9 6-23a43 43 0 1 1 79-24Z"/><path d="M119 47c-8 13 13 35 25 30l7-6-10-7-5 6c-5-2-9-7-11-12l5-4-6-10Z"/>':
      '<rect x="97" y="29" width="77" height="88" rx="11"/><path d="M107 42h58m-51 56h42"/><rect x="71" y="51" width="86" height="40" rx="9"/><path d="m82 59 33 18 32-18"/>';
  return '<svg class="store-art" viewBox="0 0 260 145" aria-hidden="true"><circle class="store-art-halo" cx="132" cy="73" r="61"/><circle class="store-art-orbit" cx="132" cy="73" r="69"/><g class="store-art-drawing">'+center+'</g><circle class="store-art-spark" cx="62" cy="36" r="5"/><circle class="store-art-spark" cx="203" cy="108" r="7"/><path class="store-art-drawing" d="M193 32v13m-6-6h13M57 105v11m-5-6h11"/></svg>';
};

// Abonelik mağazası: demo/denemeden pakete geçiş ve yenileme. Kredi kartı (PayTR, 3D Secure) ya da EFT/havale.
// SMS ve WhatsApp kredisi satılmaz: mesajlar kliniğin kendi telefon hattından gider, aylık sınırı paket belirler.
export async function mountCreditShop(ui,{section=""}={}) {
  const {view,heading,el,field,selectField,makeForm,link,status}=ui;
  const data=await opsFetch("/api/saas/store");
  if (!view.isConnected) return;
  const click=(label,action,primary=false)=>{const b=el("button",label,{type:"button",className:"button "+(primary?"primary":"")});b.addEventListener("click",action);return b;};
  const state=data.subscription;
  const current=state.current||state.terms.find(t=>t.status==="scheduled")||state.terms[0];
  const trial=state.current?.kind==="trial";
  const daysLeft=current?Math.max(0,Math.ceil((new Date(current.ends_on+"T23:59:59+03:00")-Date.now())/864e5)):0;
  heading("Abonelik mağazası","Paketinizi seçin, kartla anında ya da havaleyle ödeyin.");
  if (section==="odeme-tamam") view.append(el("p","Ödemeniz alındı. Banka onayı birkaç saniye içinde gelir; aboneliğiniz otomatik açılır ve aşağıdaki siparişlerde “Ödendi” olarak görünür.",{className:"store-preview store-ok",role:"status"}));
  if (section==="odeme-hata") view.append(el("p","Ödeme tamamlanmadı. Kartınızdan para çekilmedi; tekrar deneyebilir veya havale seçebilirsiniz.",{className:"store-preview store-bad",role:"alert"}));
  const hero=el("section","",{className:"store-hero"});
  const intro=el("div");
  intro.append(el("span",trial?"DENEME SÜRESİ":"VETZİMO ABONELİĞİ",{className:"eyebrow"}),el("h2",trial?"Deneme sürenizde girdiğiniz tüm kayıtlar korunur; pakete geçince kaldığınız yerden devam edersiniz.":"Kliniğinizin tüm modülleri tek abonelikte."));
  const dates=el("div","",{className:"store-expiry"});
  dates.append(el("span",current?.plan_name||"Abonelik",{className:"suite-pill"}));
  if (current) dates.append(el("strong",state.status==="expired"?"Abonelik süreniz "+termDate(current.ends_on)+" tarihinde sona erdi.":(trial?"Deneme süreniz ":"Abonelik süreniz ")+termDate(current.ends_on)+" tarihinde bitiyor · "+daysLeft+" gün kaldı."));
  else dates.append(el("strong","Abonelik dönemi henüz tanımlanmadı."));
  dates.append(el("small",termStatus[state.status]||"",{className:"suite-muted"}));
  hero.append(intro,dates);view.append(hero);
  if (!data.card&&!data.bank) view.append(el("p","Çevrim içi ödeme henüz açılmadı. Paket için destek talebi oluşturabilirsiniz.",{className:"store-preview"}));

  let period="yearly";
  const toggle=el("div","",{className:"store-period",role:"group",ariaLabel:"Ödeme dönemi"});
  const catalog=el("section","",{className:"store-catalog"});
  const detail=el("section","",{className:"panel suite-panel store-checkout",hidden:true,tabIndex:-1});
  const drawToggle=()=>{toggle.replaceChildren(...["monthly","yearly"].map(k=>{const b=click(periodLabel[k],()=>{period=k;drawToggle();drawCatalog();});b.setAttribute("aria-pressed",String(period===k));return b;}));};
  const methodsFor=()=>[...(data.card?[["card","Kredi / banka kartı (3D Secure)"]]:[]),...(data.bank?[["bank","EFT / Havale"]]:[])];
  function drawCatalog(){
    const grid=el("div","",{className:"store-packages"});
    for (const row of data.plans) {
      const card=el("article","",{className:"store-package store-abonelik"+(current?.plan_name===row.name?" is-current":"")});
      const mark=el("div","",{className:"store-package-mark"});mark.innerHTML=artwork("abonelik");
      card.append(mark,el("span",current?.plan_name===row.name&&!trial?"Mevcut paketiniz":"Abonelik",{className:"suite-pill"}),el("h3",row.name),el("p",row.description,{className:"suite-muted"}));
      const features=el("ul","",{className:"store-features"});
      for (const key of ["users","branches","patients","storage","sms","whatsapp","support"]) if (Object.hasOwn(row.terms||{},key)) features.append(el("li",(saasTerms.find(([id])=>id===key)?.[1]||key)+" · "+termValue(row.terms[key])));
      for (const f of (row.features||[]).slice(0,6)) features.append(el("li",f));
      card.append(features);
      const amount=row.amounts?.[period];
      const price=el("div","",{className:"store-price"});
      price.append(el("strong",amount!=null?money(amount):"Teklif alın"),el("small",amount!=null?periodLabel[period]+" · KDV dahil":"Fiyat için görüşün"));
      card.append(price);
      if (row.purchasable&&amount!=null&&methodsFor().length) card.append(click(trial?"Bu pakete geç":"Satın al / yenile",()=>checkout(row),true),el("small",methodsFor().map(([,t])=>t).join(" · "),{className:"store-methods"}));
      else card.append(link("Paket için destek isteyin","#bayi-destek/new","button"));
      grid.append(card);
    }
    if (!data.plans.length) grid.append(el("p","Şu anda satışta paket bulunmuyor.",{className:"suite-muted"}));
    catalog.replaceChildren(el("h2","Paketler"),toggle,grid);
  }
  function checkout(row){
    const amount=row.amounts?.[period];
    const method=selectField("method","Ödeme yöntemi",methodsFor());
    const top=el("header","",{className:"suite-toolbar"});
    top.append(el("h2",row.name+" · "+periodLabel[period]),click("Paketlere dön",()=>{detail.hidden=true;catalog.hidden=false;}));
    const total=el("div","",{className:"store-checkout-total"});
    total.append(el("span","Ödenecek toplam"),el("strong",money(amount)),el("small",periodLabel[period]+" · KDV dahil"));
    const requestId=crypto.randomUUID();
    const form=makeForm([method,total],"Ödemeye geç",async values=>{
      const r=await opsFetch("/api/saas/store/order",{requestId,planId:row.id,period,method:values.method},data.scopeId);
      if (r.method==="card"&&r.iframe) {
        const frame=el("iframe","",{src:r.iframe,className:"store-pay-frame",title:"PayTR güvenli ödeme",allow:"payment"});
        frame.setAttribute("scrolling","yes");
        detail.replaceChildren(top,el("p","Kart bilgileriniz VetZimo'ya gelmez; ödeme PayTR'nin güvenli sayfasında 3D Secure ile yapılır.",{className:"suite-muted"}),frame);
        return;
      }
      await mountCreditShop(ui,{section:""});status.textContent="Siparişiniz oluşturuldu. Havale talimatı aşağıdaki siparişlerinizde.";
    });
    detail.replaceChildren(top,form,el("p",trial?"Ödeme onaylanınca deneme süreniz bugün sona erer ve yeni paketiniz bugünden başlar; tüm kayıtlarınız korunur.":"Mevcut ücretli döneminiz varsa yeni dönem onun bitiminden sonra başlar.",{className:"suite-muted"}));
    detail.hidden=false;catalog.hidden=true;detail.scrollIntoView({block:"start"});detail.focus({preventScroll:true});
  }
  drawToggle();drawCatalog();
  view.append(catalog,detail);

  const orders=el("section","",{className:"panel suite-panel store-orders"});
  orders.append(el("h2","Siparişlerim"));
  if (!data.orders.length) orders.append(el("p","Siparişleriniz bu alanda görünecek.",{className:"suite-muted"}));
  else orders.append(paginate(data.orders,visible=>{
    const list=el("div","",{className:"store-order-list"});
    for (const row of visible) {
      const item=el("article","",{className:"shop-item store-order",tabIndex:-1});item.dataset.orderId=row.id;
      const top=el("header","",{className:"suite-toolbar"});
      top.append(el("strong",row.plan_name+" · "+periodLabel[row.period]+" · "+money(row.amount)),el("span",labels[row.status]||row.status,{className:"suite-pill"}));
      item.append(top,el("small",(row.method==="bank"?"EFT / Havale":"Kredi kartı")+" · "+new Date(row.created_at*1000).toLocaleDateString("tr-TR")+" · Sipariş "+row.id.slice(0,10).toUpperCase()));
      if (row.status==="paid"&&row.starts_on) item.append(el("p",termDate(row.starts_on)+" — "+termDate(row.ends_on)));
      if (row.method==="bank"&&row.status==="pending") {
        const pay=el("div","",{className:"store-instructions"});
        pay.append(el("p",row.instruction));
        pay.append(makeForm([field("reference","Banka işlem referansı / dekont no",{maxLength:100})],"Ödeme bildirimi gönder",async values=>{
          await opsFetch("/api/saas/store/reference",{id:row.id,reference:values.reference},data.scopeId);
          await mountCreditShop(ui,{section:""});status.textContent="Ödeme bildiriminiz alındı. Yönetici kontrolünden sonra aboneliğiniz açılır.";
        }));
        item.append(pay);
      }
      list.append(item);
    }
    return list;
  },10));
  view.append(orders,link("Klinik paneline dön","#overview","button"));
  if (section==="odeme-tamam"&&data.orders.some(o=>o.method==="card"&&o.status==="pending")) setTimeout(()=>{view.isConnected&&location.hash.includes("odeme-tamam")&&mountCreditShop(ui,{section})},5000);
}
