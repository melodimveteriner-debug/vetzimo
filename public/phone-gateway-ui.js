// Telefon Bağlantısı: SMS kliniğin kendi SIM kartından (Android telefon ajanı), WhatsApp kliniğin kendi numarasından
// (yarı otomatik "aç ve gönder" ya da bilgisayardaki ajanda WhatsApp Web ile otomatik). Ücretli sağlayıcı gerekmez.
const h=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else if(v===true)n.setAttribute(k,"");else n.setAttribute(k,v)}for(const c of kids.flat())c!=null&&c!==false&&n.append(c);return n};
const fill=(el,...kids)=>el.replaceChildren(...kids.flat().filter(k=>k!=null&&k!==false));
const ago=(ts,tr)=>{if(!ts)return tr("hiç");const s=Math.max(0,Date.now()/1000-ts|0);return s<60?tr("az önce"):s<3600?Math.round(s/60)+" "+tr("dk önce"):s<86400?Math.round(s/3600)+" "+tr("sa önce"):new Date(ts*1000).toLocaleDateString("tr-TR")};
const when=ts=>new Date(ts*1000).toLocaleString("tr-TR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});

export function mountPhoneGateway(root,api){
 const tr=api.tr||(s=>s),toast=api.toast||(()=>{});
 const css="/phone-gateway.css?v=2";if(!document.querySelector(`link[href="${css}"]`))document.head.append(h("link",{rel:"stylesheet",href:css}));
 const get=async()=>{const r=await api.fetch("/api/phone");const d=await r.json();if(!r.ok)throw Error(d.error||tr("İşlem tamamlanamadı."));return d};
 const post=async body=>{const r=await api.fetch("/api/phone",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||tr("İşlem tamamlanamadı."));return d};
 let data=null,tab="kurulum",code=null,filter="all",timer=0;
 root.classList.add("pg-root");
 const strip=h("div",{class:"pg-strip"}),tabs=h("div",{class:"pg-tabs",role:"tablist"}),body=h("div",{class:"pg-body"});
 fill(root,h("header",{class:"pg-head"},h("div",{},h("h2",{text:tr("Telefon Bağlantısı")}),h("p",{class:"pg-muted",text:tr("Hatırlatma, toplu mesaj ve gelen kutusu yanıtları kliniğin kendi telefon numarasından gider. Ücretli SMS veya WhatsApp sağlayıcısı gerekmez.")}))),strip,tabs,body);
 const act=async(payload,ok)=>{try{data=await post(payload);ok&&toast(ok);draw()}catch(e){toast(e.message)}};

 function drawStrip(){
  const s=data.settings,online=data.devices.filter(d=>d.online).length,wa=data.whatsappAgent;
  const pill=(cls,text)=>h("span",{class:"pg-pill "+cls,text});
  fill(strip,
   s.sms?pill(online?"ok":data.devices.length?"warn":"bad",online?tr("SMS: telefon bağlı")+" ("+online+")":data.devices.length?tr("SMS: telefon çevrimdışı"):tr("SMS: telefon bağlanmadı")):pill("",tr("SMS: kapalı")),
   s.whatsapp==="off"?pill("",tr("WhatsApp: kapalı")):s.whatsapp==="assist"?pill("ok",tr("WhatsApp: yarı otomatik")):
    pill(wa.state==="ready"?"ok":"warn",tr("WhatsApp: otomatik")+" · "+tr({ready:"bilgisayar bağlı",qr:"QR bekleniyor",closed:"pencere kapalı",offline:"bilgisayar çevrimdışı",error:"hata","":"ajan bağlanmadı",off:"WhatsApp bağlanmadı"}[wa.state]??wa.state)),
   data.quietNow?pill("warn",tr("Sessiz saat: hatırlatmalar bekletiliyor")):null,
   ...["sms","whatsapp"].map(c=>{const k=data.counts[c];return k?pill("",(c==="sms"?"SMS":"WhatsApp")+" · "+tr("bugün")+" "+k.sentToday+" · "+tr("bekleyen")+" "+k.queued+(k.failedToday?" · "+tr("hatalı")+" "+k.failedToday:"")):null}));
 }
 function drawTabs(){
  const items=[["kurulum","Kurulum"],["ayarlar","Ayarlar"],["kuyruk","Gönderim kuyruğu"]];
  fill(tabs,...items.map(([k,l])=>h("button",{type:"button",role:"tab","aria-selected":String(tab===k),class:tab===k?"on":"",onclick:()=>{tab=k;draw()}},tr(l),k==="kuyruk"&&waiting()?h("b",{text:String(waiting())}):null)));
 }
 const waiting=()=>data.outbox.filter(o=>o.channel==="whatsapp"&&o.status==="queued"&&data.settings.whatsapp==="assist").length;

 function setup(){
  const cmd=code?`curl -fsSL ${data.server}/telefon-ajani.sh | bash -s ${code.code}`:"";
  const copyBtn=h("button",{type:"button",class:"pg-btn",text:tr("Kopyala"),onclick:async e=>{try{await navigator.clipboard.writeText(cmd);e.target.textContent=tr("Kopyalandı")}catch{}}});
  const devices=data.devices.map(d=>h("article",{class:"pg-device "+(d.online?"on":"off")},
   h("div",{},h("strong",{text:d.name||tr("Android telefon")}),h("span",{class:"pg-muted",text:(d.online?tr("Çevrimiçi"):tr("Son görülme")+": "+ago(d.lastSeen,tr))+(d.battery!=null?" · 🔋 %"+d.battery:"")+(d.version?" · v"+d.version:"")})),
   d.error?h("p",{class:"pg-err",text:d.error}):null,
   data.canManage?h("button",{type:"button",class:"pg-btn danger",text:tr("Bağlantıyı kaldır"),onclick:()=>{if(confirm(tr("Bu telefonun bağlantısı kaldırılsın mı?")))act({action:"revoke",id:d.id},tr("Telefon bağlantısı kaldırıldı."))}}):null));
  return [
   h("section",{class:"pg-card"},h("h3",{},"📱 "+tr("SMS için Android telefon")),
    h("p",{class:"pg-muted",text:tr("Kliniğin hattının takılı olduğu Android telefona küçük bir ajan kurulur. SMS'ler bu hattan gider, gelen SMS'ler Gelen Kutusu'na düşer. Telefon şarjda ve internete bağlı kalmalıdır.")}),
    devices.length?h("div",{class:"pg-devices"},devices):h("p",{class:"pg-muted",text:tr("Henüz telefon bağlanmadı.")}),
    data.canManage?h("ol",{class:"pg-steps"},
     h("li",{},tr("Telefona F-Droid'den şu üç uygulamayı kurun: Termux, Termux:API, Termux:Boot (Google Play sürümleri eskidir).")),
     h("li",{},tr("Termux'u açın, aşağıdaki komutu yapıştırıp Enter'a basın. Android SMS izni sorarsa izin verin.")),
     code?h("div",{class:"pg-cmd"},h("code",{text:cmd}),copyBtn):h("button",{type:"button",class:"pg-btn dark",text:tr("Eşleştirme kodu oluştur"),onclick:async()=>{try{code=await post({action:"pair"});draw()}catch(e){toast(e.message)}}}),
     code?h("p",{class:"pg-muted",text:tr("Kod 30 dakika geçerlidir")+": "+code.code}):null,
     h("li",{},tr("Ayarlar › Pil bölümünden Termux ve Termux:API için pil optimizasyonunu kapatın; Termux:Boot uygulamasını bir kez açın (telefon yeniden başlayınca ajan kendiliğinden açılır)."))):h("p",{class:"pg-muted",text:tr("Telefon eklemek için klinik yöneticisi yetkisi gerekir.")})),
   h("section",{class:"pg-card"},h("h3",{},"💬 "+tr("WhatsApp kliniğin kendi numarasından")),
    h("p",{},h("b",{text:tr("Yarı otomatik")+": "}),tr("Mesaj hazır metniyle WhatsApp'ta açılır, personel tek dokunuşla gönderir. Android ajanı bildirim gösterir; bilgisayardan da Gönderim kuyruğu sekmesindeki düğmeyle açılır. Hiçbir hesap riski yoktur.")),
    h("p",{},h("b",{text:tr("Otomatik")+": "}),tr("Klinik bilgisayarındaki VetZimo ajanı (Bakanlık Köprüsü ile aynı program) kliniğin WhatsApp numarasına QR kodla bağlı cihaz olarak bağlanır ve mesajları kendisi gönderir, gelen mesajları Gelen Kutusu'na aktarır.")),
    h("p",{class:"pg-muted"},tr("Ajan kurulu değilse Bakanlık Köprüsü sayfasından indirip eşleştirin; ardından ajan panelinde (http://127.0.0.1:5199) \"WhatsApp'ı bağla\" düğmesiyle QR kodunu okutun."),
     " ",h("a",{href:"#bakanlik-koprusu",text:tr("Bakanlık Köprüsü sayfası")})),
    h("p",{class:"pg-muted",text:tr("Bilgisayar ajanı durumu")+": "+(data.whatsappAgent.lastSeen?tr({ready:"WhatsApp bağlı",qr:"QR kodu bekleniyor",closed:"WhatsApp penceresi kapalı",offline:"çevrimdışı",error:"hata",off:"WhatsApp bağlanmadı"}[data.whatsappAgent.state]??data.whatsappAgent.state)+" · "+ago(data.whatsappAgent.lastSeen,tr):tr("henüz bağlanmadı"))}))];
 }

 function settings(){
  const s=data.settings,dis=!data.canManage;
  const f={sms:h("input",{type:"checkbox",checked:s.sms,disabled:dis}),simSlot:h("select",{disabled:dis},...[["","Varsayılan SIM"],["0","SIM 1"],["1","SIM 2"]].map(([v,l])=>h("option",{value:v,selected:s.simSlot===v,text:tr(l)}))),
   smsPerMinute:h("input",{type:"number",min:"1",max:"20",value:String(s.smsPerMinute),disabled:dis}),smsPerDay:h("input",{type:"number",min:"1",max:"2000",value:String(s.smsPerDay),disabled:dis}),
   waPerHour:h("input",{type:"number",min:"1",max:"60",value:String(s.waPerHour),disabled:dis}),waPerDay:h("input",{type:"number",min:"1",max:"400",value:String(s.waPerDay),disabled:dis}),
   quietStart:h("input",{type:"time",value:s.quietStart,disabled:dis}),quietEnd:h("input",{type:"time",value:s.quietEnd,disabled:dis}),risk:h("input",{type:"checkbox",checked:s.waRiskAccepted,disabled:dis})};
  let mode=s.whatsapp;
  const riskBox=h("div",{class:"pg-risk",hidden:mode!=="auto"},h("p",{},h("b",{text:"⚠ "+tr("Otomatik WhatsApp hakkında")}),h("br"),
    tr("WhatsApp, resmi olmayan otomatik gönderimi kullanım koşullarında yasaklar ve çok mesaj gönderen numaraları geçici ya da kalıcı olarak kısıtlayabilir. Riski azaltmak için mesajlar yalnızca izni olan müşterilere, saatlik ve günlük sınırlarla, aralarında 20-45 saniye beklenerek gönderilir. Kampanya ve toplu tanıtım için kullanmayın.")),
   h("label",{class:"pg-check"},f.risk,h("span",{text:tr("Okudum; numaramın kısıtlanma riskini kabul ediyorum.")})));
  const modes=h("div",{class:"pg-modes"},...[["off","Kapalı","Hatırlatmalar WhatsApp'tan gönderilmez."],["assist","Yarı otomatik","Personel tek dokunuşla gönderir. Önerilen."],["auto","Otomatik","Bilgisayardaki ajan gönderir. Risk onayı gerekir."]]
   .map(([v,l,d])=>h("label",{class:"pg-mode"},h("input",{type:"radio",name:"pgwa",value:v,checked:mode===v,disabled:dis,onchange:()=>{mode=v;riskBox.hidden=v!=="auto"}}),h("span",{},h("b",{text:tr(l)}),h("small",{text:tr(d)})))));
  const field=(label,input,hint)=>h("label",{class:"pg-field"},h("span",{text:tr(label)}),input,hint?h("small",{class:"pg-muted",text:tr(hint)}):null);
  return [h("form",{class:"pg-card pg-settings",onsubmit:e=>{e.preventDefault();act({action:"settings",sms:f.sms.checked,simSlot:f.simSlot.value,smsPerMinute:+f.smsPerMinute.value,smsPerDay:+f.smsPerDay.value,
    whatsapp:mode,waRiskAccepted:f.risk.checked,waPerHour:+f.waPerHour.value,waPerDay:+f.waPerDay.value,quietStart:f.quietStart.value,quietEnd:f.quietEnd.value},tr("Ayarlar kaydedildi."))}},
   h("h3",{text:"SMS"}),h("label",{class:"pg-check"},f.sms,h("span",{text:tr("SMS'leri kliniğin telefonundan gönder (Netgsm gerekmez)")})),
   h("div",{class:"pg-grid"},field("SIM kartı",f.simSlot),field("Dakikada en fazla",f.smsPerMinute,"Operatör engelini önlemek için düşük tutun."),field("Günde en fazla",f.smsPerDay)),
   h("h3",{text:"WhatsApp"}),modes,riskBox,
   h("div",{class:"pg-grid"},field("Saatte en fazla (otomatik)",f.waPerHour),field("Günde en fazla (otomatik)",f.waPerDay)),
   h("h3",{text:tr("Sessiz saatler")}),h("p",{class:"pg-muted",text:tr("Bu saatler arasında hatırlatma ve toplu mesajlar bekletilir; gelen kutusundan yazılan yanıtlar ve deneme mesajları yine gider.")}),
   h("div",{class:"pg-grid"},field("Başlangıç",f.quietStart),field("Bitiş",f.quietEnd)),
   h("p",{class:"pg-muted",text:tr("Not: Bilgilendirme amaçlı hatırlatmalar için izin gerekmez; kampanya ve tanıtım iletileri için müşterinin onayı (İYS) gerekir. Sistem yalnızca SMS/WhatsApp izni \"Var\" olan müşterilere gönderir.")}),
   data.canManage?h("div",{class:"pg-actions"},h("button",{class:"pg-btn dark",text:tr("Kaydet")})):h("p",{class:"pg-muted",text:tr("Ayarları yalnızca klinik yöneticisi değiştirebilir.")})),
   testForm()];
 }
 function testForm(){
  const ch=h("select",{},h("option",{value:"sms",text:"SMS"}),h("option",{value:"whatsapp",text:"WhatsApp"})),phone=h("input",{type:"tel",placeholder:"05XX XXX XX XX",required:!0}),text=h("input",{value:tr("VetZimo deneme mesajı"),maxlength:"300",required:!0});
  return h("form",{class:"pg-card",onsubmit:e=>{e.preventDefault();act({action:"test",channel:ch.value,phone:phone.value,text:text.value},tr("Deneme mesajı kuyruğa eklendi."))}},
   h("h3",{text:tr("Deneme mesajı")}),h("div",{class:"pg-grid"},h("label",{class:"pg-field"},h("span",{text:tr("Kanal")}),ch),h("label",{class:"pg-field"},h("span",{text:tr("Telefon")}),phone),h("label",{class:"pg-field wide"},h("span",{text:tr("Metin")}),text)),
   h("div",{class:"pg-actions"},h("button",{class:"pg-btn",text:tr("Gönder")})));
 }
 function queue(){
  const label={queued:"Bekliyor",claimed:"Gönderiliyor",sent:"Gönderildi",failed:"Gönderilemedi",unknown:"Belirsiz",cancelled:"İptal",expired:"Süresi geçti"};
  const source={reminder:"Hatırlatma",bulk:"Toplu mesaj",inbox:"Gelen kutusu",test:"Deneme",manual:"Elle"};
  const rows=data.outbox.filter(o=>filter==="all"||(filter==="wait"?["queued","claimed"].includes(o.status):filter==="problem"?["failed","unknown","expired"].includes(o.status):o.channel===filter));
  const assist=data.settings.whatsapp==="assist"?data.outbox.filter(o=>o.channel==="whatsapp"&&o.status==="queued"):[];
  return [
   assist.length?h("section",{class:"pg-card pg-assist"},h("h3",{text:"💬 "+tr("Gönderilmeyi bekleyen WhatsApp mesajları")}),
    h("p",{class:"pg-muted",text:tr("Düğmeye basınca WhatsApp hazır metinle açılır; Gönder'e dokunmanız yeterli.")}),
    ...assist.slice(0,30).map(o=>h("div",{class:"pg-row"},h("div",{},h("b",{text:o.phone}),h("p",{text:o.body})),
     h("a",{class:"pg-btn dark",href:o.link,target:"_blank",rel:"noopener",text:tr("Aç ve gönder"),onclick:()=>setTimeout(()=>act({action:"opened",id:o.id}),400)})))):null,
   h("div",{class:"pg-filter"},...[["all","Tümü"],["wait","Bekleyen"],["problem","Sorunlu"],["sms","SMS"],["whatsapp","WhatsApp"]].map(([k,l])=>h("button",{type:"button",class:filter===k?"on":"",onclick:()=>{filter=k;draw()},text:tr(l)}))),
   rows.length?h("div",{class:"pg-table-wrap"},h("table",{class:"pg-table"},h("thead",{},h("tr",{},...["Zaman","Kanal","Alıcı","Mesaj","Kaynak","Durum",""].map(t=>h("th",{text:tr(t)})))),
    h("tbody",{},...rows.map(o=>h("tr",{},h("td",{text:when(o.at)}),h("td",{text:o.channel==="sms"?"SMS":"WhatsApp"}),h("td",{text:o.phone}),h("td",{class:"pg-msg",text:o.body,title:o.body}),
     h("td",{text:tr(source[o.source]||o.source)}),h("td",{},h("span",{class:"pg-st "+o.status,text:tr(label[o.status]||o.status)}),o.error?h("small",{class:"pg-err",text:o.error}):null),
     h("td",{class:"pg-row-actions"},o.status==="queued"?h("button",{type:"button",class:"pg-link",text:tr("İptal"),onclick:()=>act({action:"cancel",id:o.id})}):null,
      ["failed","expired"].includes(o.status)?h("button",{type:"button",class:"pg-link",text:tr("Yeniden dene"),onclick:()=>act({action:"retry",id:o.id})}):null,
      o.status==="unknown"?h("button",{type:"button",class:"pg-link",text:tr("Yeniden dene"),onclick:()=>{if(confirm(tr("Bu mesajın alıcıya ulaşıp ulaşmadığı bilinmiyor. Yeniden gönderilirse iki kez gidebilir. Devam edilsin mi?")))act({action:"retry",id:o.id,checked:!0})}}):null,
      o.link?h("a",{class:"pg-link",href:o.link,target:"_blank",rel:"noopener",text:tr("Aç ve gönder"),onclick:()=>setTimeout(()=>act({action:"opened",id:o.id}),400)}):null)))))):h("p",{class:"pg-muted pg-empty",text:tr("Kayıt yok.")})];
 }
 function draw(){if(!data)return;drawStrip();drawTabs();fill(body,...(tab==="kurulum"?setup():tab==="ayarlar"?settings():queue()))}
 async function load(){try{data=await get();draw()}catch(e){fill(body,h("p",{class:"pg-err",text:e.message}))}}
 const loop=()=>{if(!root.isConnected)return;if(!document.hidden&&tab!=="ayarlar"&&!root.querySelector("form :focus"))load();timer=setTimeout(loop,15000)};
 load();timer=setTimeout(loop,15000);
 return()=>clearTimeout(timer);
}
