// e-Belgeler: satıştan e-Arşiv / e-Fatura, e-SMM (serbest meslek makbuzu). API veya entegratör sözleşmesi gerekmez:
// klinik bilgisayarındaki VetZimo ajanı, kliniğin kendi portal oturumunda (GİB, Uyumsoft, Ödeal, İşNet...) bir kez öğretilen ekranı doldurur.
const h=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k==="html")n.innerHTML=v;else if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else if(v===true)n.setAttribute(k,"");else n.setAttribute(k,v)}for(const c of kids.flat())c!=null&&c!==false&&n.append(c);return n};
const fill=(el,...kids)=>el.replaceChildren(...kids.flat().filter(k=>k!=null&&k!==false));
const css="/edoc-ui.css?v=1";
const ensure=()=>{if(!document.querySelector(`link[href="${css}"]`))document.head.append(h("link",{rel:"stylesheet",href:css}))};
const KIND={earsiv:"e-Arşiv fatura",efatura:"e-Fatura",esmm:"e-SMM makbuzu"};
const STATUS={queued:"Sırada",claimed:"Ajan düzenliyor",done:"Düzenlendi",error:"Hata",uncertain:"Kontrol gerekli",cancelled:"İptal"};
const money=v=>Number(v||0).toLocaleString("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2})+" ₺";
const when=ts=>ts?new Date(ts*1000).toLocaleString("tr-TR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"-";

function io(api){
 const get=async()=>{const r=await api.fetch("/api/bridge");const d=await r.json();if(!r.ok)throw Error(d.error||api.tr("İşlem tamamlanamadı."));return d};
 const post=async b=>{const r=await api.fetch("/api/bridge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw Error(d.error||api.tr("İşlem tamamlanamadı."));return d};
 return{get,post};
}
const docJobs=d=>d.jobs.filter(j=>KIND[j.kind]);


export async function openDocDialog(saleId,api){
 ensure();const tr=api.tr||(s=>s),x=io(api),sale=api.sale(saleId),client=sale?.client?api.client(sale.client):null;
 {const m=await import("./agent-access.js?v=1");if(!(await m.agentAccess()).paid){api.toast?.(tr("Ücretli versiyona entegre edilmiştir."));return}}
 if(!sale){api.toast?.(tr("Satış bulunamadı."));return}
 let data;try{data=await x.get()}catch(e){api.toast?.(e.message);return}
 const dlg=h("dialog",{class:"ed-dialog","aria-labelledby":"edTitle"}),body=h("div",{class:"ed-body"});let timer=0;
 const close=()=>{clearTimeout(timer);dlg.close();dlg.remove()};dlg.addEventListener("cancel",close);
 const existing=()=>docJobs(data).filter(j=>j.records[0]===saleId);
 const agentLine=()=>data.agent?h("p",{class:"ed-agent "+(data.agent.online?"on":"off")},data.agent.online?tr("Ajan çevrimiçi"):tr("Ajan çevrimdışı · kuyruğa alınır, bilgisayar açılınca düzenlenir")):h("p",{class:"ed-agent off"},tr("Ajan kurulmamış. Önce e-Belgeler sayfasındaki kurulum adımlarını tamamlayın."),h("a",{href:"#e-belgeler",text:" "+tr("Kurulum rehberi"),onclick:close}));
 const watch=()=>{timer=setTimeout(async()=>{try{data=await x.get();draw()}catch{}if(existing().some(j=>["queued","claimed"].includes(j.status)))watch()},5000)};
 const draw=(kind)=>{
  const list=existing();
  const rows=list.map(j=>h("div",{class:"ed-job "+j.status},h("b",{text:tr(KIND[j.kind])}),h("span",{class:"ed-st",text:tr(STATUS[j.status])}),j.documentNo?h("code",{text:j.documentNo}):null,j.error?h("small",{text:j.error}):null));
  const hasInvoice=list.some(j=>["earsiv","efatura"].includes(j.kind)&&j.status!=="cancelled"&&j.status!=="error"),hasSmm=list.some(j=>j.kind==="esmm"&&!["cancelled","error"].includes(j.status));
  const pick=h("div",{class:"ed-kinds"},
   h("button",{type:"button",class:"ed-kind"+(kind==="earsiv"?" on":""),disabled:hasInvoice,onclick:()=>draw("earsiv")},h("b",{text:tr("e-Arşiv fatura")}),h("small",{text:tr("Bireysel müşteri veya e-Fatura mükellefi olmayan firma")})),
   h("button",{type:"button",class:"ed-kind"+(kind==="efatura"?" on":""),disabled:hasInvoice,onclick:()=>draw("efatura")},h("b",{text:tr("e-Fatura")}),h("small",{text:tr("Alıcı e-Fatura mükellefi bir firma (VKN gerekli)")})),
   h("button",{type:"button",class:"ed-kind"+(kind==="esmm"?" on":""),disabled:hasSmm,onclick:()=>draw("esmm")},h("b",{text:tr("e-SMM makbuzu")}),h("small",{text:tr("Serbest meslek makbuzu (hekim/serbest meslek kazancı)")})));
  let form=null;
  if(kind){
   const f={taxId:h("input",{inputmode:"numeric",maxlength:"11",value:client?.nationalId||"",placeholder:kind==="efatura"?"VKN (10) / TCKN (11)":tr("Boşsa 11111111111 (nihai tüketici)")}),
    buyerName:h("input",{maxlength:"160",value:client?.name||""}),taxOffice:h("input",{maxlength:"80"}),address:h("input",{maxlength:"300",value:client?.address||""}),
    note:h("input",{maxlength:"300"}),vatRate:h("input",{type:"number",min:"0",max:"100",value:"20"}),withholding:h("input",{type:"checkbox"}),description:h("input",{maxlength:"300",value:sale.detail||""})};
   const field=(l,i,hint)=>h("label",{class:"ed-field"},h("span",{text:tr(l)}),i,hint?h("small",{text:tr(hint)}):null);
   form=h("form",{class:"ed-form",onsubmit:async e=>{e.preventDefault();const btn=form.querySelector("button[type=submit]");btn.disabled=!0;
    try{await x.post({action:"enqueue",kind,sale:saleId,taxId:f.taxId.value.trim(),buyerName:f.buyerName.value.trim(),taxOffice:f.taxOffice.value.trim(),address:f.address.value.trim(),note:f.note.value.trim(),
      vatRate:f.vatRate.value,withholding:f.withholding.checked,description:f.description.value.trim()});data=await x.get();api.toast?.(tr("Belge kuyruğa alındı. Ajan kliniğin portal oturumunda düzenleyecek."));draw();watch()}
    catch(err){api.toast?.(err.message)}finally{btn.disabled=!1}}},
    field(kind==="efatura"?"Alıcı VKN / TCKN":"Alıcı T.C. kimlik / VKN",f.taxId,kind==="efatura"?null:"Kimlik bilinmiyorsa boş bırakın; GİB kuralına göre 11111111111 yazılır."),
    field(kind==="efatura"?"Alıcı unvanı":"Alıcı adı soyadı",f.buyerName),
    kind!=="earsiv"?field("Vergi dairesi",f.taxOffice):null,
    field("Adres",f.address),
    kind==="esmm"?[field("Makbuz açıklaması",f.description),field("KDV oranı (%)",f.vatRate),h("label",{class:"ed-check"},f.withholding,h("span",{text:tr("Alıcı firma: %20 gelir vergisi stopajı uygula")}))]:field("Fatura notu (isteğe bağlı)",f.note),
    h("p",{class:"ed-muted",text:tr("Kalemler, KDV ve toplamlar satıştan alınır. Belge, ajan portalda 'Onayla' adımını tamamlayınca düzenlenmiş olur; numarası burada ve e-Belgeler sayfasında görünür. Satış kaydı mali kayıt olduğu için değiştirilmez.")}),
    h("div",{class:"ed-actions"},h("button",{type:"submit",class:"ed-btn dark",text:tr("Kuyruğa al ve düzenlet")})));
  }
  fill(body,h("div",{class:"ed-sale"},h("strong",{text:(client?.name||tr("Müşteri seçilmemiş"))}),h("span",{text:(sale.date||"")+" · "+money(sale.amount)+(sale.invoice?" · "+tr("Fatura no")+": "+sale.invoice:"")})),agentLine(),rows.length?h("div",{class:"ed-jobs"},rows):null,pick,form,
   h("div",{class:"ed-actions"},h("a",{class:"ed-btn",href:"#e-belgeler",text:tr("e-Belgeler ve rehber"),onclick:close}),h("button",{type:"button",class:"ed-btn ghost",text:tr("Kapat"),onclick:close})));
 };
 fill(dlg,h("header",{class:"ed-head"},h("h2",{id:"edTitle",text:tr("e-Fatura / e-Arşiv / e-SMM")}),h("button",{type:"button",class:"ed-x","aria-label":tr("Kapat"),text:"×",onclick:close})),body);
 document.body.append(dlg);draw();dlg.showModal();if(existing().some(j=>["queued","claimed"].includes(j.status)))watch();
}

// Kurulum rehberi görselleri: gerçek portal ekran görüntüsü değil, adımları anlatan şemalar.
const ART={
 agent:`<svg viewBox="0 0 240 140" aria-hidden="true"><rect x="20" y="18" width="200" height="104" rx="10" class="a1"/><rect x="34" y="32" width="172" height="62" rx="6" class="a2"/><path d="M110 100h20v14h-20z" class="a1"/><rect x="88" y="114" width="64" height="8" rx="4" class="a1"/><circle cx="120" cy="63" r="18" class="a3"/><path d="M112 63l6 6 11-12" class="a4"/></svg>`,
 pair:`<svg viewBox="0 0 240 140" aria-hidden="true"><rect x="18" y="30" width="90" height="80" rx="10" class="a2"/><rect x="132" y="30" width="90" height="80" rx="10" class="a2"/><text x="63" y="76" class="t">ABCDE-</text><text x="177" y="76" class="t">FGHJK</text><path d="M108 70h24" class="a5"/><circle cx="120" cy="70" r="6" class="a3"/></svg>`,
 portal:`<svg viewBox="0 0 240 140" aria-hidden="true"><rect x="20" y="16" width="200" height="108" rx="10" class="a2"/><rect x="20" y="16" width="200" height="20" rx="10" class="a1"/><rect x="60" y="52" width="120" height="14" rx="4" class="a6"/><rect x="60" y="74" width="120" height="14" rx="4" class="a6"/><rect x="90" y="98" width="60" height="16" rx="8" class="a3"/><path d="M48 59h4M48 81h4" class="a5"/></svg>`,
 teach:`<svg viewBox="0 0 240 140" aria-hidden="true"><rect x="20" y="16" width="200" height="108" rx="10" class="a2"/><rect x="36" y="34" width="80" height="12" rx="3" class="a6"/><rect x="36" y="54" width="168" height="12" rx="3" class="a6"/><rect x="36" y="74" width="168" height="12" rx="3" class="a6"/><rect x="140" y="98" width="64" height="16" rx="8" class="a3"/><circle cx="196" cy="104" r="13" class="a7"/><path d="M188 92l20 24" class="a5"/></svg>`,
 send:`<svg viewBox="0 0 240 140" aria-hidden="true"><rect x="16" y="34" width="80" height="72" rx="8" class="a2"/><path d="M28 54h56M28 66h40M28 78h48" class="a5"/><path d="M104 70h34" class="a5"/><path d="M130 62l10 8-10 8" class="a5"/><rect x="146" y="30" width="78" height="80" rx="8" class="a2"/><text x="185" y="66" class="t">GIB2026</text><text x="185" y="82" class="t">000123</text></svg>`,
};

/** e-Belgeler sayfası: durum, rehber (görselli adımlar) ve tüm fatura/makbuz işleri. */
export async function mountDocPage(root,api){
 ensure();const tr=api.tr||(s=>s),x=io(api);let filter="all";root.classList.add("ed-page");
 const steps=[["agent","1. Ajanı kurun","Bakanlık Köprüsü sayfasından VetZimo ajanını indirip klinik bilgisayarına kurun (kur.cmd). Reçete için kurduysanız aynı ajan kullanılır; yeniden kurmanız gerekmez."],
  ["pair","2. Ajanı eşleştirin","Bakanlık Köprüsü › Kurulum sekmesinde 'Eşleştirme kodu al'a basın, kodu ajan paneline (http://127.0.0.1:5199) yazın."],
  ["portal","3. Portal adreslerini girin ve giriş yapın","Ajan panelinde 'e-Arşiv · e-Fatura · e-SMM portalları' bölümüne GİB e-Arşiv Portalı (hazır gelir), e-Fatura için Uyumsoft/Ödeal/entegratör adresinizi ve e-SMM portalınızı yazın. 'Giriş yap' ile açılan pencerede kendi kullanıcı kodu ve şifrenizle girin. Şifreniz ajana kaydedilmez."],
  ["teach","4. Bir kez öğretin (belge oluşmadan)","'e-Arşiv faturasını öğret' deyin. Açılan portal ekranında alıcı bilgilerini ve bir hizmet satırını her zamanki gibi doldurun. 'Onayla/Oluştur' düğmesine BASMAYIN; panelde 'Kaydet düğmesini işaretle' deyip düğmeye tıklayın. Alanları açılır listeden eşleyin (Alıcı VKN, Mal/hizmet adı, Birim fiyat…), kalem satırını 'Kalem satırı' olarak işaretleyip 'Tarifi kaydet'e basın. e-Fatura ve e-SMM için aynısını yapın."],
  ["send","5. Satıştan düzenleyin","Satış listesinde 'e-Fatura / e-Arşiv / e-SMM' düğmesine basın, belge türünü seçip 'Kuyruğa al'. Ajan portalda belgeyi düzenler; fatura/makbuz numarası e-Belgeler listesinde satışın yanında görünür. Portal oturumu kapanmışsa belge sırada bekler; ajan panelinden giriş yapmanız yeterli."]];
 const draw=async()=>{
  {const m=await import("./agent-access.js?v=1");if(!(await m.agentAccess()).paid){fill(root,h("h1",{text:api.tr?api.tr("e-Fatura / e-Arşiv / e-SMM"):"e-Fatura / e-Arşiv / e-SMM"}),m.paidNotice(api.tr||(s=>s)));return}}
  let d;try{d=await x.get()}catch(e){fill(root,h("p",{class:"ed-error",text:e.message}));return}
  const jobs=docJobs(d).filter(j=>filter==="all"||(filter==="open"?["queued","claimed","uncertain","error"].includes(j.status):j.kind===filter));
  const recipes=new Set((d.recipes||[]).map(r=>r.kind));
  fill(root,
   h("header",{class:"ed-page-head"},h("div",{},h("h2",{text:tr("e-Belgeler")}),h("p",{class:"ed-muted",text:tr("e-Arşiv, e-Fatura ve e-SMM belgeleri satışlardan, kliniğin kendi portal hesabıyla düzenlenir. Entegratör API sözleşmesi veya ek ücret gerekmez.")}))),
   h("div",{class:"ed-status"},
    h("span",{class:"ed-pill "+(d.agent?.online?"ok":"bad"),text:d.agent?(d.agent.online?tr("Ajan çevrimiçi"):tr("Ajan çevrimdışı")):tr("Ajan kurulmadı")}),
    ...["earsiv","efatura","esmm"].map(k=>h("span",{class:"ed-pill "+(recipes.has(k)?"ok":"warn"),text:tr(KIND[k])+": "+(recipes.has(k)?tr("öğretildi"):tr("öğretilmedi"))})),
    d.agent?h("span",{class:"ed-login"},tr("Portala giriş")+": ",...[["gib","GİB e-Arşiv"],["efatura","e-Fatura"],["esmm","e-SMM"]].map(([p,l])=>h("button",{type:"button",class:"ed-link",text:l,onclick:async()=>{try{await x.post({action:"login",portal:p});api.toast?.(tr("Ajan bilgisayarında giriş penceresi açılıyor."))}catch(e){api.toast?.(e.message)}}}))):null),
   h("details",{class:"ed-guide",open:!d.agent||!recipes.size},h("summary",{text:tr("Kurulum rehberi · 5 adım (bayi için)")}),
    h("ol",{class:"ed-steps"},...steps.map(([art,t,txt])=>h("li",{},h("div",{class:"ed-art",html:ART[art]}),h("div",{},h("b",{text:tr(t)}),h("p",{text:tr(txt)}))))),
    h("div",{class:"ed-notes"},
     h("p",{},h("b",{text:tr("Hangi belgeyi seçmeliyim?")}),h("br"),tr("Alıcı e-Fatura mükellefi bir firmaysa e-Fatura; bireysel müşteri veya e-Fatura mükellefi olmayan firmaya e-Arşiv fatura. Hekimin serbest meslek kazancı için e-SMM makbuzu.")),
     h("p",{},h("b",{text:tr("Belirsiz (Kontrol gerekli) ne demek?")}),h("br"),tr("Ajan 'Onayla'ya bastıktan sonra bağlantı koptuysa belgenin oluşup oluşmadığı bilinemez. Çift fatura olmaması için otomatik tekrar denenmez: portaldan kontrol edip numarayı girin ya da oluşmadıysa yeniden gönderin.")),
     h("p",{},h("b",{text:tr("Güvenlik")}),h("br"),tr("Portal şifreleri VetZimo'ya ve ajana kaydedilmez. Ajan yalnız kamu (gov.tr) ve tanınan e-belge entegratörü adreslerinde çalışır.")))),
   h("div",{class:"ed-filter"},...[["all","Tümü"],["open","Bekleyen / sorunlu"],["earsiv","e-Arşiv"],["efatura","e-Fatura"],["esmm","e-SMM"]].map(([k,l])=>h("button",{type:"button",class:filter===k?"on":"",onclick:()=>{filter=k;draw()},text:tr(l)}))),
   jobs.length?h("div",{class:"ed-table-wrap"},h("table",{class:"ed-table"},h("thead",{},h("tr",{},...["Belge","Alıcı / tutar","Durum","Numara","Tarih",""].map(t=>h("th",{text:tr(t)})))),
    h("tbody",{},...jobs.map(j=>h("tr",{},h("td",{text:tr(KIND[j.kind])}),h("td",{text:j.summary.replace(/^[^:]+:\s*/,"")}),h("td",{},h("span",{class:"ed-st "+j.status,text:tr(STATUS[j.status])}),j.error?h("small",{text:j.error}):null),
     h("td",{},j.documentNo?h("code",{text:j.documentNo}):"-"),h("td",{text:when(j.updatedAt)}),
     h("td",{class:"ed-row-actions"},j.status==="uncertain"?resolve(j):null,["queued","error"].includes(j.status)?h("button",{type:"button",class:"ed-link",text:tr("İptal"),onclick:()=>act({action:"cancel",id:j.id})}):null))))))
   :h("p",{class:"ed-muted ed-empty",text:tr("Henüz belge yok. Satış listesinde 'e-Fatura / e-Arşiv / e-SMM' düğmesini kullanın.")}));
 };
 const act=async b=>{try{await x.post(b);draw()}catch(e){api.toast?.(e.message)}};
 const resolve=j=>{const no=h("input",{placeholder:tr("Portaldaki belge no"),maxlength:"64"}),chk=h("input",{type:"checkbox"});
  return h("div",{class:"ed-resolve"},no,h("button",{type:"button",class:"ed-link",text:tr("Numarayı kaydet"),onclick:()=>act({action:"link",id:j.id,documentNo:no.value.trim()})}),
   h("label",{class:"ed-check"},chk,h("span",{text:tr("Portalda oluşmadığını kontrol ettim")})),h("button",{type:"button",class:"ed-link",text:tr("Yeniden gönder"),onclick:()=>act({action:"resend",id:j.id,checked:chk.checked})}))};
 draw();
}
