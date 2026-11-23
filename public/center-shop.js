import {opsFetch} from "./center-ops.js";
import {paginate} from "./paged.js";
import {saasTerms,termValue} from "./saas-market.js";
import {termDate,termStatus} from "./saas-subscription.js";

const money=value=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
const quantity=value=>new Intl.NumberFormat("tr-TR").format(value);
const labels={pending:"Ödeme bekleniyor",review:"Yönetici kontrolünde",approved:"Onaylandı",rejected:"Reddedildi"};
const categories={
  sms:{title:"SMS paketleri",short:"SMS",subtitle:"Hatırlatmalarınız zamanında ulaşsın.",body:"Aşı, randevu ve klinik bildirimleriniz için ihtiyacınıza uygun kredi seçin."},
  whatsapp:{title:"WhatsApp paketleri",short:"WhatsApp",subtitle:"Kliniğinizden doğrudan iletişim.",body:"Onaylı mesaj şablonlarıyla hasta sahiplerinize ulaşmak için mesaj kredinizi tamamlayın."},
  abonelik:{title:"Abonelik paketleri",short:"Abonelik",subtitle:"Kliniğinizin büyümesine yer açın.",body:"Ekibinize ve şubelerinize uygun kapsamı seçin, aboneliğinizi tek ekrandan yönetin."},
};
const artwork=type=>{
  const center=type==="abonelik"?'<rect x="94" y="31" width="81" height="80" rx="12"/><path d="M111 50h45m-45 12h31m-31 13h15m13 0h17m-45 15h45"/><circle cx="168" cy="104" r="21"/><path d="m157 104 7 7 15-17"/>':
    type==="whatsapp"?'<path d="M178 67a43 43 0 0 1-63 38l-22 9 6-23a43 43 0 1 1 79-24Z"/><path d="M119 47c-8 13 13 35 25 30l7-6-10-7-5 6c-5-2-9-7-11-12l5-4-6-10Z"/>':
      '<rect x="97" y="29" width="77" height="88" rx="11"/><path d="M107 42h58m-51 56h42"/><rect x="71" y="51" width="86" height="40" rx="9"/><path d="m82 59 33 18 32-18"/>';
  return '<svg class="store-art" viewBox="0 0 260 145" aria-hidden="true"><circle class="store-art-halo" cx="132" cy="73" r="61"/><circle class="store-art-orbit" cx="132" cy="73" r="69"/><g class="store-art-drawing">'+center+'</g><circle class="store-art-spark" cx="62" cy="36" r="5"/><circle class="store-art-spark" cx="203" cy="108" r="7"/><path class="store-art-drawing" d="M193 32v13m-6-6h13M57 105v11m-5-6h11"/></svg>';
};

export async function mountCreditShop(ui,{section=""}={}) {
  const {view,heading,el,field,selectField,makeForm,link,status}=ui;
  const [data,subscriptions]=await Promise.all([opsFetch("/api/ops/shop"),opsFetch("/api/saas/store")]);
  if (!view.isConnected) return;
  const selected=Object.hasOwn(categories,section)?section:"";
  const click=(label,action,primary=false)=>{
    const button=el("button",label,{type:"button",className:"button "+(primary?"primary":"")});
    button.addEventListener("click",action);return button;
  };
  const state=subscriptions.subscription;
  const current=state.current||state.terms.find(term=>term.status==="scheduled")||state.terms[0];
  heading("VetZimo Mağaza","SMS, WhatsApp ve abonelik paketlerinizi tek yerden yönetin.");
  const hero=el("section","",{className:"store-hero"});
  const intro=el("div");
  intro.append(el("span","KLİNİĞİNİZİN BÜYÜMESİNE EŞLİK EDİYORUZ",{className:"eyebrow"}),el("h2","İletişiminiz güçlü, çalışma alanınız hazır."));
  const dates=el("div","",{className:"store-expiry"});
  dates.append(el("span",current?.plan_name||"VetZimo aboneliğiniz",{className:"suite-pill"}));
  if (current) dates.append(el("strong",state.status==="expired"?"VetZimo abonelik süreniz "+termDate(current.ends_on)+" tarihinde sona erdi.":
    "VetZimo abonelik süreniz "+termDate(current.ends_on)+" tarihinde sona erecektir."));
  else dates.append(el("strong","Abonelik dönemi henüz tanımlanmadı."));
  dates.append(link("Paketleri incele","#kredi-magazasi/abonelik","button"),el("small",termStatus[state.status],{className:"suite-muted"}));
  hero.append(intro,dates);view.append(hero);
  if (data.preview) view.append(el("p","Test mağazası · Siparişler örnek kayıtlarla işlenir.",{className:"store-preview"}));
  const balance=el("div","",{className:"store-balances"});
  for (const channel of ["sms","whatsapp"]) {
    const row=data.limits.find(item=>item.channel===channel);
    const card=el("a","",{href:"#kredi-magazasi/"+channel,className:"store-balance"});
    card.append(el("span",categories[channel].title),el("strong",quantity(row?.balance||0)),el("small","Kullanılabilir kredi · Paket ekle →"));
    balance.append(card);
  }
  const license=el("a","",{href:"#kredi-magazasi/abonelik",className:"store-balance"});
  license.append(el("span","Abonelik"),el("strong",current?.plan_name||"Paket seçin"),el("small",current?termDate(current.ends_on):"Paketleri inceleyin"));
  balance.append(license);view.append(balance);

  const navigation=el("nav","",{className:"store-categories",ariaLabel:"Mağaza kategorileri"});
  for (const [key,category] of Object.entries(categories)) {
    const card=link("","#kredi-magazasi/"+key,"store-category store-"+key);
    if (key===selected) card.setAttribute("aria-current","page");
    card.innerHTML=artwork(key);
    const text=el("div");
    text.append(el("h3",category.title),el("p",category.subtitle),el("span","Paketleri keşfet →"));
    card.append(text);navigation.append(card);
  }
  view.append(navigation);
  const detail=el("section","",{className:"panel suite-panel store-checkout",hidden:true,tabIndex:-1});
  const catalog=el("section","",{className:"store-catalog"});
  view.append(catalog,detail);
  const paymentMethods=(row,isSubscription)=>[
    ...(row.card?[["card","Kredi kartı · iyzico"]]:[]),
    ...((isSubscription?subscriptions.bank:data.bank)?[["bank","EFT / Havale"]]:[]),
  ];
  const selection=(name,label,options)=>selectField(name,label,options);
  async function reload(message,orderId="") {
    await mountCreditShop(ui,{section:selected});
    status.textContent=message;
    const target=orderId?view.querySelector('[data-order-id="'+CSS.escape(orderId)+'"]'):null;
    if (target) {target.scrollIntoView({block:"start"});target.focus({preventScroll:true});}
  }
  function checkout(row,isSubscription) {
    const category=isSubscription?"abonelik":row.channel, config=categories[category];
    const methods=paymentMethods(row,isSubscription);
    const method=selection("method","Ödeme yöntemi",methods);
    const top=el("header","",{className:"suite-toolbar"});
    top.append(el("h2",row.name),click("Paketlere dön",()=>{detail.hidden=true;catalog.hidden=false;catalog.scrollIntoView({block:"start"});}));
    const summary=el("div","",{className:"store-checkout-total"});
    const controls=[el("p",isSubscription?"Paket kapsamını ve abonelik süresini inceleyin.":"Seçtiğiniz paket · "+quantity(row.units)+" "+config.short+" kredisi",{className:"suite-muted"})];
    const duration=isSubscription?selection("years","Abonelik süresi",Array.from({length:10},(_,i)=>[String(i+1),(i+1)+" yıl"])):null;
    if (duration) controls.push(duration);
    controls.push(method,summary);
    const requestId=crypto.randomUUID();
    const update=()=>{
      const years=duration?Number(duration.querySelector("select").value):1;
      const options=paymentMethods(row,isSubscription).filter(([key])=>key!=="card"||years===1);
      const select=method.querySelector("select"), previous=select.value;
      select.replaceChildren(...options.map(([value,title])=>el("option",title,{value})));
      if (options.some(([value])=>value===previous)) select.value=previous;
      summary.replaceChildren(el("span","Ödenecek toplam"),el("strong",money(isSubscription?row.yearly*years:row.price)),
        el("small",isSubscription?years+" yıl · KDV dahil":"Paket toplamı"));
      submit.disabled=!options.length;
    };
    const form=makeForm(controls,"Ödemeye geç",async values=>{
      const response=isSubscription?await opsFetch("/api/saas/store/order",{
        requestId,planId:row.id,version:row.version,years:Number(values.years),method:values.method,
      },subscriptions.scopeId):await opsFetch("/api/ops/shop/order",{requestId,packageId:row.id,method:values.method},data.scopeId);
      await reload("Siparişiniz hazır. Ödeme bilgilerini aşağıda inceleyebilirsiniz.",response.id);
    });
    const submit=form.querySelector('[type="submit"]');
    duration?.addEventListener("change",update);
    update();
    const note=el("p",isSubscription?"Ödeme doğrulandığında aboneliğiniz etkinleşir. Mevcut ücretli döneminiz varsa yeni dönem onun bitiminde başlar.":
      "Ödeme doğrulandığında satın aldığınız krediler bayi bakiyenize eklenir.",{className:"suite-muted"});
    detail.replaceChildren(top,form,note);
    detail.hidden=false;catalog.hidden=true;detail.scrollIntoView({block:"start"});detail.focus({preventScroll:true});
  }
  function packageCard(row,isSubscription) {
    const type=isSubscription?"abonelik":row.channel;
    const card=el("article","",{className:"store-package store-"+type});
    const mark=el("div","",{className:"store-package-mark"});mark.innerHTML=artwork(type);
    card.append(mark,el("span",categories[type].short,{className:"suite-pill"}),el("h3",row.name));
    if (isSubscription) {
      card.append(el("p",row.description,{className:"suite-muted"}));
      const features=el("ul","",{className:"store-features"});
      for (const key of ["users","branches","patients","storage","support"]) {
        if (!Object.hasOwn(row.terms,key)) continue;
        features.append(el("li",saasTerms.find(([id])=>id===key)[1]+" · "+termValue(row.terms[key])));
      }
      card.append(features);
    } else card.append(el("strong",quantity(row.units)+" kredi",{className:"store-units"}),
      el("p",type==="sms"?"Aşı ve randevu hatırlatmalarınızı sürdürün.":"Hasta sahiplerinize onaylı mesajlarınızla ulaşın.",{className:"suite-muted"}));
    const price=el("div","",{className:"store-price"});
    price.append(el("strong",isSubscription?row.yearly!==null?money(row.yearly):"Teklif alın":money(row.price)),
      el("small",isSubscription?"Yıllık · "+(row.vat==="included"?"KDV dahil":row.vat==="excluded"?"KDV hariç":"Fiyat bilgisi için görüşün"):"Paket toplamı"));
    card.append(price);
    const methods=paymentMethods(row,isSubscription);
    if ((!isSubscription||row.purchasable)&&methods.length) {
      card.append(click("Paketi seç",()=>checkout(row,isSubscription),true),
        el("small",methods.map(([,title])=>title).join(" · "),{className:"store-methods"}));
    } else card.append(link("Paket için destek isteyin","#bayi-destek/new","button"));
    return card;
  }
  for (const [key,category] of Object.entries(categories)) {
    if (selected&&key!==selected) continue;
    const group=el("section","",{className:"store-group"});
    group.append(el("h2",category.title),el("p",category.body,{className:"suite-muted"}));
    const grid=el("div","",{className:"store-packages"});
    const rows=key==="abonelik"?subscriptions.plans:data.packages.filter(row=>row.channel===key);
    if (!rows.length) grid.append(el("p","Bu kategoride henüz satışta paket bulunmuyor.",{className:"suite-muted"}));
    else for (const row of rows) grid.append(packageCard(row,key==="abonelik"));
    group.append(grid);catalog.append(group);
  }
  const orders=el("section","",{className:"panel suite-panel store-orders"});
  orders.append(el("h2","Siparişlerim"));
  const combined=[...data.orders.map(row=>({...row,subscription:false})),...subscriptions.orders.map(row=>({...row,subscription:true,name:row.plan_name+" · "+row.years+" yıl",price:row.amount}))]
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  if (!combined.length) orders.append(el("p","Siparişleriniz bu alanda görünecek.",{className:"suite-muted"}));
  else orders.append(paginate(combined,visible=>{
    const list=el("div","",{className:"store-order-list"});
    for (const row of visible) {
      const item=el("article","",{className:"shop-item store-order",tabIndex:-1});
      item.dataset.orderId=row.id;
      const top=el("header","",{className:"suite-toolbar"});
      top.append(el("strong",row.name+" · "+money(row.price)),el("span",labels[row.status],{className:"suite-pill"}));
      item.append(top,el("small",(row.subscription?"Abonelik":categories[row.channel]?.short||"Kredi")+" · "+(row.method==="bank"?"EFT / Havale":"Kredi kartı")));
      if (row.decision_note) item.append(el("p",row.decision_note,{className:"suite-muted"}));
      if (row.subscription&&row.starts_on&&row.ends_on&&row.status==="approved") item.append(el("p",termDate(row.starts_on)+" — "+termDate(row.ends_on)));
      if (row.status==="pending") {
        const payment=el("div","",{className:"store-instructions"});
        payment.append(el("small","Sipariş referansı · "+row.id));
        if (data.preview) payment.append(el("p","Test siparişi · Gerçek ödeme yapılmaz."));
        else if (row.method==="card") payment.append(link("iyzico ile güvenli ödemeye geç",row.instruction,"button primary"));
        else payment.append(el("p",row.instruction));
        const refForm=makeForm([field("reference","Banka / sağlayıcı işlem referansı",{maxLength:100})],"Ödeme bildirimi gönder",async values=>{
          await opsFetch(row.subscription?"/api/saas/store/reference":"/api/ops/shop/reference",{id:row.id,reference:values.reference},data.scopeId);
          await reload("Ödeme bildiriminiz alındı. Yönetici kontrolünden sonra etkinleşecektir.",row.id);
        });
        payment.append(refForm);item.append(payment);
      }
      list.append(item);
    }
    return list;
  },10));
  view.append(orders,link("Klinik paneline dön","#overview","button"));
}
