// Müşteri onay formu (KVKK aydınlatma + iletişim izinleri): kayıt sonrası pencere, müşteri kartı şeridi ve "Müşteri Onayları" listesi.
const h=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else if(v===true)n.setAttribute(k,"");else n.setAttribute(k,v)}for(const c of kids.flat())c!=null&&c!==false&&n.append(c);return n};
const fill=(el,...kids)=>el.replaceChildren(...kids.flat().filter(k=>k!=null&&k!==false));
const css="/permit-ui.css?v=1";
const ensure=()=>{if(!document.querySelector(`link[href="${css}"]`))document.head.append(h("link",{rel:"stylesheet",href:css}))};
const when=ts=>ts?new Date(ts*1000).toLocaleString("tr-TR",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"-";
const STATUS={pending:"İmza bekleniyor",signed:"İmzalandı",declined:"Onay vermedi",expired:"Süresi doldu",cancelled:"İptal edildi"};
const CH=[["sms","SMS"],["whatsapp","WhatsApp"],["email","E-posta"],["marketing","Kampanya"]];

function client(api){
 const get=async q=>{const r=await api.fetch("/api/permit?"+new URLSearchParams(q));const d=await r.json();if(!r.ok)throw Error(d.error||api.tr("İşlem tamamlanamadı."));return d};
 const post=async b=>{const r=await api.fetch("/api/permit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw Error(d.error||api.tr("İşlem tamamlanamadı."));return d};
 return {get,post};
}
const chips=(p,tr)=>p?.choices?h("span",{class:"pu-chips"},...CH.map(([k,l])=>h("span",{class:"pu-chip "+(p.choices[k]?"on":"off"),text:(p.choices[k]?"✓ ":"✕ ")+tr(l)}))):null;

/** İmzalı formdaki izinleri müşteri kartına işler (bir kez). */
async function apply(api,io,p){
 if(!p||!["signed","declined"].includes(p.status)||p.applied||!api.applyClient)return;
 try{if(await api.applyClient(p.client,p.choices||{}))await io.post({action:"applied",id:p.id})}catch{}
}

/** Müşteri kaydından sonra açılan pencere: bağlantı gönder ya da bu cihazda imzalat. */
export async function openPermitDialog(clientId,api){
 ensure();const tr=api.tr||(s=>s),io=client(api);
 let state;try{state=await io.get({client:clientId})}catch(e){api.toast?.(e.message);return}
 const dlg=h("dialog",{class:"pu-dialog","aria-labelledby":"puTitle"});
 const body=h("div",{class:"pu-body"});
 let timer=0;
 const close=()=>{clearTimeout(timer);dlg.close();dlg.remove()};
 dlg.addEventListener("cancel",close);
 const watch=async id=>{try{const d=await io.get({client:clientId});const p=d.permits.find(x=>x.id===id);if(p&&p.status!=="pending"){await apply(api,io,p);done(p);return}}catch{}timer=setTimeout(()=>watch(id),4000)};
 const done=p=>fill(body,h("div",{class:"pu-result "+p.status},h("strong",{text:tr(STATUS[p.status])}),h("p",{text:(p.signer?p.signer+" · ":"")+when(p.decidedAt)}),chips(p,tr),
  h("p",{class:"pu-muted",text:tr("İzinler müşteri kartına işlendi; hatırlatma ve toplu mesajlarda bu onay esas alınır.")})),h("div",{class:"pu-actions"},h("button",{type:"button",class:"pu-btn dark",text:tr("Kapat"),onclick:close})));
 const start=async method=>{
  fill(body,h("p",{class:"pu-muted",text:tr("Hazırlanıyor…")}));
  try{
   const r=await io.post({action:"create",client:clientId,method});
   const copy=h("button",{type:"button",class:"pu-btn",text:tr("Bağlantıyı kopyala"),onclick:async e=>{try{await navigator.clipboard.writeText(r.url);e.target.textContent=tr("Kopyalandı")}catch{}}});
   const msg=method==="clinic"?tr("Form bu cihazda yeni sekmede açıldı. Cihazı müşteriye verin; imzaladığında bu pencere kendiliğinden güncellenir.")
    :r.sent==="queued"?tr("Bağlantı müşterinin telefonuna kliniğin hattından gönderiliyor. İmzalandığında bu pencere güncellenir.")
    :r.sent==="assist"?tr("WhatsApp mesajı hazır. Aç ve gönder düğmesiyle gönderin.")
    :r.sent==="manual"?tr("Telefon Bağlantısı kapalı olduğu için otomatik gönderilemedi. Bağlantıyı kopyalayıp iletin veya WhatsApp ile açın."):tr("Bağlantı hazır.");
   if(method==="clinic")window.open(r.url,"_blank","noopener");
   fill(body,h("div",{class:"pu-wait"},h("span",{class:"pu-spin","aria-hidden":"true"}),h("div",{},h("strong",{text:tr("İmza bekleniyor")}),h("p",{text:msg}))),
    h("div",{class:"pu-link"},h("code",{text:r.url}),copy),
    h("div",{class:"pu-actions"},r.whatsappLink&&method!=="clinic"&&r.sent!=="queued"?h("a",{class:"pu-btn",href:r.whatsappLink,target:"_blank",rel:"noopener",text:tr("WhatsApp ile aç ve gönder")}):null,
     method==="clinic"?h("button",{type:"button",class:"pu-btn",text:tr("Formu yeniden aç"),onclick:()=>window.open(r.url,"_blank","noopener")}):null,
     h("button",{type:"button",class:"pu-btn ghost",text:tr("Kapat (imza arka planda beklenir)"),onclick:close})));
   watch(r.permit.id);
  }catch(e){fill(body,h("p",{class:"pu-error",text:e.message}),h("div",{class:"pu-actions"},h("button",{type:"button",class:"pu-btn",text:tr("Geri"),onclick:menu})))}
 };
 const menu=()=>{
  const eff=state.effective,ch=state.channels||{};
  fill(body,
   eff?h("div",{class:"pu-current"},h("strong",{text:tr("Mevcut onay")+": "+tr(STATUS[eff.status])+" · "+when(eff.decidedAt)}),chips(eff,tr)):null,
   h("p",{class:"pu-muted",text:tr("Müşteriden KVKK aydınlatma metnini okuduğunu ve SMS, WhatsApp, e-posta ve kampanya iletileri için onayını imzayla alın. Form imzalanınca kayıt altına alınır ve izinler kartına işlenir.")}),
   h("div",{class:"pu-options"},
    h("button",{type:"button",class:"pu-opt",onclick:()=>start("clinic")},h("b",{text:"✍️ "+tr("Bu cihazda imzalat")}),h("small",{text:tr("Tablet veya telefonda hemen imza")})),
    h("button",{type:"button",class:"pu-opt",onclick:()=>start("sms")},h("b",{text:"💬 "+tr("SMS ile bağlantı gönder")}),h("small",{text:ch.sms?tr("Kliniğin hattından, tek kullanımlık, 72 saat geçerli"):tr("Telefon Bağlantısı'nda SMS kapalı; bağlantı kopyalanabilir")})),
    h("button",{type:"button",class:"pu-opt",onclick:()=>start("whatsapp")},h("b",{text:"🟢 "+tr("WhatsApp ile bağlantı gönder")}),h("small",{text:ch.whatsapp==="auto"?tr("Kliniğin numarasından otomatik"):tr("WhatsApp hazır metinle açılır")})),
    h("button",{type:"button",class:"pu-opt",onclick:()=>start("link")},h("b",{text:"🔗 "+tr("Yalnızca bağlantı oluştur")}),h("small",{text:tr("Kopyalayıp istediğiniz yoldan iletin")}))),
   h("div",{class:"pu-actions"},h("button",{type:"button",class:"pu-btn ghost",text:tr("Şimdi değil"),onclick:close})));
 };
 fill(dlg,h("header",{class:"pu-head"},h("h2",{id:"puTitle",text:tr("Müşteri onay formu")}),h("button",{type:"button",class:"pu-x","aria-label":tr("Kapat"),text:"×",onclick:close})),body);
 document.body.append(dlg);menu();dlg.showModal();
}

/** Müşteri kartının üstündeki onay şeridi. */
export async function mountPermitBanner(root,clientId,api){
 if(!root)return;ensure();const tr=api.tr||(s=>s),io=client(api);
 try{
  const d=await io.get({client:clientId});
  const eff=d.effective,pending=d.permits.find(p=>p.status==="pending");
  if(eff)await apply(api,io,eff);
  fill(root,h("div",{class:"pu-banner "+(eff?eff.status:pending?"pending":"none")},
   h("span",{class:"pu-banner-text"},h("b",{text:tr("KVKK ve iletişim onayı")+": "}),eff?tr(STATUS[eff.status])+" · "+when(eff.decidedAt):pending?tr("İmza bekleniyor")+" · "+when(pending.createdAt):tr("Alınmadı")),
   eff?chips(eff,tr):null,
   h("span",{class:"pu-banner-actions"},eff?h("a",{href:"/api/permit/belge/"+eff.id,target:"_blank",rel:"noopener",class:"pu-link-btn",text:tr("İmzalı formu gör")}):null,
    api.canWrite?h("button",{type:"button",class:"pu-link-btn",text:eff?tr("Yeniden onay al"):tr("Onay formu gönder"),onclick:()=>openPermitDialog(clientId,api).then(()=>{})}):null)));
 }catch{root.replaceChildren()}
}

/** Müşteri Onayları sayfası: tüm formlar, durum filtresi, aydınlatma metni düzenleme. */
export async function mountPermitList(root,api){
 ensure();const tr=api.tr||(s=>s),io=client(api);
 let status="",notice=null;
 root.classList.add("pu-page");
 const draw=async()=>{
  fill(root,h("p",{class:"pu-muted",text:tr("Yükleniyor…")}));
  let d;try{d=await io.get(status?{status}:{})}catch(e){fill(root,h("p",{class:"pu-error",text:e.message}));return}
  const total=Object.values(d.counts).reduce((a,b)=>a+b,0);
  fill(root,h("header",{class:"pu-page-head"},h("div",{},h("h2",{text:tr("Müşteri Onayları")}),h("p",{class:"pu-muted",text:tr("KVKK aydınlatma ve SMS/WhatsApp/e-posta izinleri için imzalanan formlar. İmzalı form, tarih, saat, IP ve cihaz bilgisiyle saklanır; metin imza anındaki haliyle mühürlüdür.")})),
    api.isManager?h("button",{type:"button",class:"pu-btn",text:tr("Aydınlatma metnini düzenle"),onclick:editNotice}):null),
   h("div",{class:"pu-filter"},...[["", "Tümü",total],["signed","İmzalandı"],["pending","İmza bekleniyor"],["declined","Onay vermedi"],["expired","Süresi doldu"]].map(([k,l,n])=>h("button",{type:"button",class:status===k?"on":"",onclick:()=>{status=k;draw()}},tr(l)+" ("+(n??d.counts[k]??0)+")"))),
   d.permits.length?h("div",{class:"pu-table-wrap"},h("table",{class:"pu-table"},h("thead",{},h("tr",{},...["Müşteri","Durum","İzinler","Yöntem","Tarih",""].map(t=>h("th",{text:tr(t)})))),
    h("tbody",{},...d.permits.map(p=>h("tr",{},h("td",{},h("a",{href:"#owner/"+encodeURIComponent(p.client),text:p.clientName||"-"}),h("small",{text:p.phone})),
     h("td",{},h("span",{class:"pu-st "+p.status,text:tr(STATUS[p.status])})),h("td",{},chips(p,tr)||"-"),
     h("td",{text:tr({sms:"SMS bağlantısı",whatsapp:"WhatsApp bağlantısı",link:"Bağlantı",clinic:"Klinikte imza"}[p.method]||p.method)}),
     h("td",{text:when(p.decidedAt||p.createdAt)}),
     h("td",{},["signed","declined"].includes(p.status)?h("a",{href:"/api/permit/belge/"+p.id,target:"_blank",rel:"noopener",text:tr("Formu gör")}):null,
      p.status==="pending"&&api.canWrite?h("button",{type:"button",class:"pu-link-btn",text:tr("İptal"),onclick:async()=>{try{await io.post({action:"cancel",id:p.id});draw()}catch(e){api.toast?.(e.message)}}}):null))))))
   :h("p",{class:"pu-muted pu-empty",text:tr("Kayıt yok.")}));
 };
 const editNotice=async()=>{
  try{notice=await io.get({notice:1})}catch(e){api.toast?.(e.message);return}
  const ta=h("textarea",{rows:"22",class:"pu-notice"});ta.value=notice.text;
  fill(root,h("header",{class:"pu-page-head"},h("h2",{text:tr("Müşteri aydınlatma metni")})),
   h("p",{class:"pu-muted",text:tr("Bu metin onay formunun ilk bölümüdür. {klinik}, {adres}, {telefon}, {eposta} alanları ayarlardaki klinik bilgileriyle doldurulur. Değişiklik yalnızca bundan sonra gönderilen formlara yansır; imzalanmış formlar değişmez.")}),ta,
   h("div",{class:"pu-actions"},h("button",{type:"button",class:"pu-btn dark",text:tr("Kaydet"),onclick:async()=>{try{await io.post({action:"notice",text:ta.value});api.toast?.(tr("Aydınlatma metni kaydedildi."));draw()}catch(e){api.toast?.(e.message)}}}),
    h("button",{type:"button",class:"pu-btn",text:tr("Varsayılan metne dön"),onclick:()=>{ta.value=notice.default}}),h("button",{type:"button",class:"pu-btn ghost",text:tr("Vazgeç"),onclick:draw})));
 };
 draw();
}
