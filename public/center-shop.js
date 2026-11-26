import {opsFetch} from "./center-ops.js";
import {paginate} from "./paged.js";
import {saasTerms,termValue} from "./saas-market.js?v=2";
import {termDate,termStatus} from "./saas-subscription.js";

const money=value=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
const quantity=value=>new Intl.NumberFormat("tr-TR").format(value);
const labels={pending:"Ödeme bekleniyor",review:"Havale kontrolünde",paid:"Ödendi",failed:"Ödeme tamamlanmadı",rejected:"Reddedildi"};
const categories={abonelik:{title:"Abonelik paketleri",short:"Abonelik"}};
const periodLabel={monthly:"Aylık",yearly:"Yıllık"};
const artwork=type=>{
  const center=type==="abonelik"?'<rect x="94" y="31" width="81" height="80" rx="12"/><path d="M111 50h45m-45 12h31m-31 13h15m13 0h17m-45 15h45"/><circle cx="168" cy="104" r="21"/><path d="m157 104 7 7 15-17"/>':
    type==="whatsapp"?'<path d="M178 67a43 43 0 0 1-63 38l-22 9 6-23a43 43 0 1 1 79-24Z"/><path d="M119 47c-8 13 13 35 25 30l7-6-10-7-5 6c-5-2-9-7-11-12l5-4-6-10Z"/>':
      '<rect x="97" y="29" width="77" height="88" rx="11"/><path d="M107 42h58m-51 56h42"/><rect x="71" y="51" width="86" height="40" rx="9"/><path d="m82 59 33 18 32-18"/>';
  return '<svg class="store-art" viewBox="0 0 260 145" aria-hidden="true"><circle class="store-art-halo" cx="132" cy="73" r="61"/><circle class="store-art-orbit" cx="132" cy="73" r="69"/><g class="store-art-drawing">'+center+'</g><circle class="store-art-spark" cx="62" cy="36" r="5"/><circle class="store-art-spark" cx="203" cy="108" r="7"/><path class="store-art-drawing" d="M193 32v13m-6-6h13M57 105v11m-5-6h11"/></svg>';
};

// Abonelik mağazası: demo/denemeden pakete geçiş ve yenileme. Kredi kartı (PayTR, 3D Secure) ya da EFT/havale.
// SMS ve WhatsApp mesajları kliniğin kendi telefon hattından gider; aylık hakkı paket belirler, bitince ek paket kredisi kullanılır.
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
    // Ücretsiz paket zaten sistemde: mağazada gösterilmez. Fiyat gösterimi satış sitesiyle aynıdır (+ KDV / KDV dahil).
    for (const row of data.plans.filter(p=>p.id!=="ucretsiz"&&!((p.rank??-1)===0&&p.monthly==null&&p.yearly==null))) {
      const card=el("article","",{className:"store-package store-abonelik"+(current?.plan_name===row.name?" is-current":"")});
      const mark=el("div","",{className:"store-package-mark"});mark.innerHTML=artwork("abonelik");
      card.append(mark,el("span",current?.plan_name===row.name&&!trial?"Mevcut paketiniz":"Abonelik",{className:"suite-pill"}),el("h3",row.name),el("p",row.description,{className:"suite-muted"}));
      const features=el("ul","",{className:"store-features"});
      for (const key of ["users","branches","patients","storage","sms","whatsapp","support"]) if (Object.hasOwn(row.terms||{},key)) features.append(el("li",(saasTerms.find(([id])=>id===key)?.[1]||key)+" · "+termValue(row.terms[key])));
      for (const f of (row.features||[]).slice(0,6)) features.append(el("li",f));
      card.append(features);
      const amount=row.amounts?.[period], base=row[period];
      const price=el("div","",{className:"store-price"});
      price.append(el("strong",base!=null?money(base):"Teklif alın"),el("small",base!=null?periodLabel[period]+" · "+(row.vat==="excluded"?"+ KDV":"KDV dahil"):"Fiyat için görüşün"));
      card.append(price);
      if (amount!=null) {
        card.append(click("Satın Alın",()=>{
          if (row.purchasable&&methodsFor().length) checkout(row);
          else {status.textContent="Çevrim içi ödeme henüz açılmadı. Kart (PayTR) ve havale bilgileri VetZimo yönetimi tarafından tanımlandığında buradan ödeyebilirsiniz.";status.scrollIntoView?.({block:"nearest"});}
        },true));
        if (methodsFor().length) card.append(el("small",methodsFor().map(([,t])=>t).join(" · "),{className:"store-methods"}));
      } else card.append(link("Teklif isteyin","#bayi-destek/new","button"));
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
    const base=row[period];
    total.append(el("span","Ödenecek toplam"),el("strong",money(amount)),el("small",periodLabel[period]+(row.vat==="excluded"&&base!=null?" · "+money(base)+" + %20 KDV":" · KDV dahil")));
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

  // Ek paketler: aylık hak bitince kullanılan SMS / WhatsApp kredisi ve diğer sınırlı haklar için artış paketleri.
  const addons=el("section","",{className:"store-catalog store-addons",id:"ek-paketler"});
  const addonDetail=el("section","",{className:"panel suite-panel store-checkout",hidden:true,tabIndex:-1});
  const kinds=data.addonKinds||{};
  const order=["sms","whatsapp","users","branches","patients","clients","storage","other"];
  function drawAddons(){
    const head=el("div","",{className:"store-addon-head"});
    head.append(el("h2","Ek paketler"),el("p","Aylık SMS veya WhatsApp hakkınız bittiğinde gönderim durur; ek paket aldığınızda kaldığı yerden devam eder. Ek krediler süresizdir ve önce aylık hakkınız kullanılır.",{className:"suite-muted"}));
    const bal=el("div","",{className:"store-addon-balances"});
    for (const k of ["sms","whatsapp"]) bal.append(el("span",(kinds[k]||k)+" ek kredisi: "+quantity(data.addonBalances?.[k]||0),{className:"suite-pill"}));
    for (const k of ["users","branches","patients","clients","storage"]) if (data.addonBalances?.[k]>0) bal.append(el("span",(kinds[k]||k)+" +"+quantity(data.addonBalances[k]),{className:"suite-pill"}));
    head.append(bal);
    const groups=el("div","",{className:"store-addon-groups"});
    for (const kind of order) {
      const rows=(data.addons||[]).filter(r=>r.kind===kind);
      if (!rows.length) continue;
      const group=el("div","",{className:"store-addon-group"});
      group.append(el("h3",kinds[kind]||kind));
      const grid=el("div","",{className:"store-packages"});
      for (const row of rows) {
        const card=el("article","",{className:"store-package store-"+(kind==="whatsapp"?"whatsapp":kind==="sms"?"sms":"abonelik")});
        const mark=el("div","",{className:"store-package-mark"});mark.innerHTML=artwork(kind==="whatsapp"?"whatsapp":kind==="sms"?"sms":"abonelik");
        card.append(mark,el("span","Ek paket · "+(kinds[kind]||kind),{className:"suite-pill"}),el("h3",row.name));
        if (row.description) card.append(el("p",row.description,{className:"suite-muted"}));
        const price=el("div","",{className:"store-price"});
        price.append(el("strong",money(row.price)),el("small",row.vat==="excluded"?"+ KDV":"KDV dahil"));
        card.append(price,click("Satın Alın",()=>{
          if (methodsFor().length) addonCheckout(row);
          else {status.textContent="Çevrim içi ödeme henüz açılmadı. Kart (PayTR) ve havale bilgileri VetZimo yönetimi tarafından tanımlandığında buradan ödeyebilirsiniz.";}
        },true));
        if (methodsFor().length) card.append(el("small",methodsFor().map(([,t])=>t).join(" · "),{className:"store-methods"}));
        grid.append(card);
      }
      group.append(grid);groups.append(group);
    }
    if (!groups.childElementCount) groups.append(el("p","Şu anda satışta ek paket bulunmuyor.",{className:"suite-muted"}));
    addons.replaceChildren(head,groups);
  }
  function addonCheckout(row){
    const method=selectField("method","Ödeme yöntemi",methodsFor());
    const top=el("header","",{className:"suite-toolbar"});
    top.append(el("h2",row.name),click("Ek paketlere dön",()=>{addonDetail.hidden=true;addons.hidden=false;}));
    const total=el("div","",{className:"store-checkout-total"});
    total.append(el("span","Ödenecek toplam"),el("strong",money(row.amount)),el("small",row.vat==="excluded"?money(row.price)+" + %20 KDV":"KDV dahil"));
    const requestId=crypto.randomUUID();
    const form=makeForm([method,total],"Ödemeye geç",async values=>{
      const r=await opsFetch("/api/saas/store/addon",{requestId,packageId:row.id,method:values.method},data.scopeId);
      if (r.method==="card"&&r.iframe) {
        const frame=el("iframe","",{src:r.iframe,className:"store-pay-frame",title:"PayTR güvenli ödeme",allow:"payment"});
        frame.setAttribute("scrolling","yes");
        addonDetail.replaceChildren(top,el("p","Kart bilgileriniz VetZimo'ya gelmez; ödeme PayTR'nin güvenli sayfasında 3D Secure ile yapılır. Ödeme onaylanınca kredi otomatik tanımlanır.",{className:"suite-muted"}),frame);
        return;
      }
      await mountCreditShop(ui,{section:""});status.textContent="Ek paket siparişiniz oluşturuldu. Havale talimatı aşağıdaki siparişlerinizde; ödeme onaylanınca kredi tanımlanır.";
    });
    addonDetail.replaceChildren(top,form,el("p",row.kind==="sms"||row.kind==="whatsapp"?"Kredi, aylık hakkınız bittiğinde kullanılır ve süresizdir.":"Satın aldığınız artış paket sınırınıza eklenir.",{className:"suite-muted"}));
    addonDetail.hidden=false;addons.hidden=true;addonDetail.scrollIntoView({block:"start"});addonDetail.focus({preventScroll:true});
  }
  drawAddons();
  view.append(addons,addonDetail);
  if (section==="ek-paket") setTimeout(()=>addons.scrollIntoView({block:"start"}),50);
  // Satış sitesindeki "Satın Alın" düğmesinden gelindiyse (#kredi-magazasi/paket-<kod>-<dönem>) seçilen paketin ödeme adımı doğrudan açılır.
  const wanted=/^paket-([a-z0-9][a-z0-9-]*?)-(monthly|yearly)$/.exec(section||"");
  if (wanted) {
    const row=data.plans.find(p=>p.id===wanted[1]);
    if (row) {
      if (row.amounts?.[wanted[2]]==null&&row.amounts?.[wanted[2]==="monthly"?"yearly":"monthly"]!=null) period=wanted[2]==="monthly"?"yearly":"monthly"; else period=wanted[2];
      drawToggle();drawCatalog();
      if (row.purchasable&&row.amounts?.[period]!=null&&methodsFor().length) checkout(row);
      else status.textContent=row.name+" paketinin fiyatı henüz tanımlanmadı. Paket için destek talebi oluşturabilirsiniz.";
    }
  }

  const orders=el("section","",{className:"panel suite-panel store-orders"});
  orders.append(el("h2","Siparişlerim"));
  if (!data.orders.length) orders.append(el("p","Siparişleriniz bu alanda görünecek.",{className:"suite-muted"}));
  else orders.append(paginate(data.orders,visible=>{
    const list=el("div","",{className:"store-order-list"});
    for (const row of visible) {
      const item=el("article","",{className:"shop-item store-order",tabIndex:-1});item.dataset.orderId=row.id;
      const top=el("header","",{className:"suite-toolbar"});
      top.append(el("strong",row.plan_name+(row.period==="addon"?"":" · "+periodLabel[row.period])+" · "+money(row.amount)),el("span",labels[row.status]||row.status,{className:"suite-pill"}));
      item.append(top,el("small",(row.method==="bank"?"EFT / Havale":"Kredi kartı")+" · "+new Date(row.created_at*1000).toLocaleDateString("tr-TR")+" · Sipariş "+row.id.slice(0,10).toUpperCase()));
      if (row.status==="paid"&&row.starts_on) item.append(el("p",termDate(row.starts_on)+" — "+termDate(row.ends_on)));
      if (row.method==="bank"&&row.status==="pending") {
        const pay=el("div","",{className:"store-instructions"});
        pay.append(el("p",row.instruction));
        pay.append(makeForm([field("reference","Banka işlem referansı / dekont no",{maxLength:100})],"Ödeme bildirimi gönder",async values=>{
          await opsFetch("/api/saas/store/reference",{id:row.id,reference:values.reference},data.scopeId);
          await mountCreditShop(ui,{section:""});status.textContent=row.period==="addon"?"Ödeme bildiriminiz alındı. Yönetici kontrolünden sonra ek paket krediniz tanımlanır.":"Ödeme bildiriminiz alındı. Yönetici kontrolünden sonra aboneliğiniz açılır.";
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
