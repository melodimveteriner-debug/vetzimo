// Çok kanallı gelen kutusu: WhatsApp, Facebook, Instagram, Telegram, SMS, e-posta ve web formu tek ekranda.
// Yanıtı yazan ekip üyesi konuşmayı kendi adıyla üstlenir; iç notlar müşteriye gitmez. Kanal kurulumu klinik yöneticisindedir.
const KIND={whatsapp:{label:"WhatsApp",color:"#25d366",icon:"M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Zm4.6 12.6c-.2.6-1.2 1.1-1.7 1.1-.4.1-1 .1-3.3-.9-2.8-1.2-4.5-4.1-4.7-4.3-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.1.3.7 1.1 1.5 1.8 1 .9 1.8 1.2 2.1 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.4.2.5.3.1.2.1.6-.1 1.1Z"},
 messenger:{label:"Facebook",color:"#1877f2",icon:"M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.3S17 3 12 3Zm.9 11.2-2.3-2.4-4.4 2.4 4.9-5.2 2.3 2.4 4.4-2.4-4.9 5.2Z"},
 instagram:{label:"Instagram",color:"#e1306c",icon:"M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3Zm4.5 4.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Zm0 1.8a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm4.8-2.9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"},
 telegram:{label:"Telegram",color:"#229ed9",icon:"M20.7 4.3 3.4 11c-1.2.5-1.2 1.2-.2 1.5l4.4 1.4 1.7 5.2c.2.6.4.8.8.8s.6-.2.9-.5l2.1-2 4.4 3.2c.8.4 1.4.2 1.6-.8l2.9-13.6c.3-1.2-.4-1.7-1.3-1.3ZM8.9 13.6l8.5-5.4c.4-.2.8-.1.5.2l-7 6.4-.3 3-1.7-4.2Z"},
 sms:{label:"SMS",color:"#64748b",icon:"M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2Zm3 6.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"},
 email:{label:"E-posta",color:"#f59e0b",icon:"M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v.3l8 5 8-5V7H4Zm16 2.6-8 5-8-5V17h16V9.6Z"},
 web:{label:"Web sitesi",color:"#7c3aed",icon:"M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3a15 15 0 0 0-1.4-3.9A8 8 0 0 1 18.9 8ZM12 4c.8 1.1 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.9 1.9-4ZM4.3 14a8 8 0 0 1 0-4h3.4a16 16 0 0 0 0 4H4.3Zm.8 2h3a15 15 0 0 0 1.4 3.9A8 8 0 0 1 5.1 16ZM8 8H5.1a8 8 0 0 1 4.4-3.9C8.9 5.3 8.4 6.6 8 8Zm4 12c-.8-1.1-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.9-1.9 4Zm2.3-6H9.7a14 14 0 0 1 0-4h4.6a14 14 0 0 1 0 4Zm.2 5.9c.6-1.2 1.1-2.5 1.4-3.9h3a8 8 0 0 1-4.4 3.9ZM16.3 14a16 16 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4Z"}};
const SETUP={
 whatsapp:{title:"WhatsApp Business (Cloud API)",fields:[["phoneNumberId","Telefon numarası kimliği (Phone number ID)",1],["displayPhone","Görünen numara (isteğe bağlı)"],["accessToken","Kalıcı erişim anahtarı (System User token)",1,1],["appSecret","Uygulama gizli anahtarı (App Secret)",1,1],["apiVersion","API sürümü (boşsa v21.0)"]],
  steps:["Meta for Developers'ta bir uygulama oluşturun ve WhatsApp ürününü ekleyin; işletme numaranızı doğrulayın.","Business Manager › Sistem Kullanıcıları'ndan whatsapp_business_messaging izinli kalıcı erişim anahtarı üretin.","Aşağıdaki bilgileri kaydedin; ardından WhatsApp › Yapılandırma › Webhook bölümüne Geri Çağırma URL'si ve Doğrulama Anahtarı'nı yapıştırıp messages alanına abone olun.","Mevcut WhatsApp Business uygulamanızı kullanmaya devam etmek isterseniz Meta'nın uygulama ile Cloud API'nin birlikte çalışma (coexistence) kurulumunu seçin."]},
 messenger:{title:"Facebook Messenger",fields:[["pageId","Facebook sayfa kimliği",1],["pageName","Sayfa adı (isteğe bağlı)"],["pageToken","Sayfa erişim anahtarı",1,1],["appSecret","Uygulama gizli anahtarı (App Secret)",1,1],["apiVersion","API sürümü (boşsa v21.0)"]],
  steps:["Meta uygulamanıza Messenger ürününü ekleyin ve klinik sayfanızı bağlayın; pages_messaging izniyle sayfa erişim anahtarı oluşturun.","Bilgileri kaydedin; Messenger › Webhook ayarına URL ve doğrulama anahtarını girip messages ve message_echoes alanlarına abone olun."]},
 instagram:{title:"Instagram mesajları",fields:[["igId","Instagram profesyonel hesap kimliği",1],["username","Kullanıcı adı (isteğe bağlı)"],["pageToken","Bağlı Facebook sayfasının erişim anahtarı",1,1],["appSecret","Uygulama gizli anahtarı (App Secret)",1,1],["apiVersion","API sürümü (boşsa v21.0)"]],
  steps:["Instagram hesabınızı profesyonel hesaba çevirip Facebook sayfanıza bağlayın; Instagram ayarlarında 'Mesajlara erişime izin ver'i açın.","Meta uygulamanızda instagram_manage_messages iznini alın, bilgileri kaydedin ve Instagram webhook'una URL ile doğrulama anahtarını girip messages alanına abone olun."]},
 telegram:{title:"Telegram botu",fields:[["botToken","Bot anahtarı (BotFather)",1,1]],steps:["Telegram'da @BotFather'a /newbot yazarak kliniğiniz için bir bot oluşturun ve verilen anahtarı kopyalayın.","Anahtarı kaydettiğinizde webhook otomatik kurulur; müşterileriniz botunuza yazdığında mesajlar buraya düşer."]},
 sms:{title:"SMS (Netgsm)",fields:[["account","Netgsm hesap numarası (850…)",1],["password","API şifresi",1,1],["sender","Onaylı SMS başlığı",1],["number","Gelen SMS numarası (isteğe bağlı)"]],
  steps:["Netgsm'de API alt kullanıcısı ve onaylı SMS başlığınızı hazırlayın; yanıtlar bu başlıkla gider.","Gelen SMS için Netgsm panelinde 'Gelen SMS'leri URL'ye yönlendir' ayarına aşağıdaki adresi girin (GET veya POST desteklenir)."]},
 email:{title:"E-posta",fields:[["address","Klinik e-posta adresi",1],["smtpHost","SMTP sunucusu",1],["smtpPort","SMTP portu (465 veya 587)",1],["imapHost","IMAP sunucusu (gelen kutusu)"],["imapPort","IMAP portu (boşsa 993)"],["username","Kullanıcı adı",1],["password","Şifre veya uygulama şifresi",1,1]],
  steps:["Yanıtlar SMTP ile kliniğin kendi adresinden gönderilir.","Gelen e-postalar IMAP girilirse her dakika otomatik alınır (sunucuda bin/inbox-poll.php zamanlanmış görevi). IMAP kullanmıyorsanız e-posta sağlayıcınızın 'gelen postayı URL'ye yönlendir' özelliğine aşağıdaki adresi girin."]}};
const h=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else if(v===true)n.setAttribute(k,"");else n.setAttribute(k,v)}for(const c of kids.flat())c!=null&&c!==false&&n.append(c);return n};
const svg=(path,size=16)=>{const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("width",size);s.setAttribute("height",size);s.setAttribute("aria-hidden","true");const p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d",path);p.setAttribute("fill","currentColor");s.append(p);return s};
const badge=(kind,size=14)=>{const k=KIND[kind]||KIND.sms;const b=h("span",{class:"ox-kind",style:`--k:${k.color}`,title:k.label});b.append(svg(k.icon,size));return b};
const initials=s=>String(s||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toLocaleUpperCase("tr-TR")||"?";
const pad=n=>String(n).padStart(2,"0");
function when(ts,full){const d=new Date(ts*1000),now=new Date(),same=d.toDateString()===now.toDateString();const y=new Date(now);y.setDate(now.getDate()-1);
 if(full)return d.toLocaleString("tr-TR",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"});
 if(same)return pad(d.getHours())+":"+pad(d.getMinutes());if(d.toDateString()===y.toDateString())return"Dün";return d.toLocaleDateString("tr-TR",{day:"numeric",month:"short"})}
function dayLabel(ts){const d=new Date(ts*1000);return d.toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long"}).toLocaleUpperCase("tr-TR")}
const copy=async(text,btn,tr)=>{try{await navigator.clipboard.writeText(text);const o=btn.textContent;btn.textContent=tr("Kopyalandı");setTimeout(()=>btn.textContent=o,1400)}catch{prompt("",text)}};

const fill=(el,...kids)=>el.replaceChildren(...kids.flat().filter(k=>k!=null&&k!==false));
export function mountOmniInbox(root,api){
 const tr=api.tr||(s=>s),toast=api.toast||(()=>{});
 const get=async q=>{const r=await api.fetch("/api/inbox?"+new URLSearchParams(q));const d=await r.json();if(!r.ok)throw Error(d.error||tr("İşlem tamamlanamadı."));return d};
 const post=async body=>{const r=await api.fetch("/api/inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||tr("İşlem tamamlanamadı."));return d};
 const st={box:"open",channel:"",q:"",items:[],boxes:{},chan:{},cursor:0,sel:null,thread:null,team:[],me:"",quick:[],settings:{},mode:"reply",view:"inbox",channels:null,canManage:!1,pane:"list",draft:new Map};
 root.classList.add("ox-root");
 const css="/omni-inbox.css?v=2";if(!document.querySelector(`link[href="${css}"]`))document.head.append(h("link",{rel:"stylesheet",href:css}));
 const side=h("aside",{class:"ox-side","aria-label":tr("Kutular ve kanallar")}),list=h("section",{class:"ox-list","aria-label":tr("Konuşmalar")}),chat=h("section",{class:"ox-chat","aria-label":tr("Konuşma")}),card=h("aside",{class:"ox-card","aria-label":tr("Müşteri kartı")});
 const shell=h("div",{class:"ox-shell"},side,list,chat,card);
 root.replaceChildren(shell);
 let timer=0,alive=!0,busy=!1;
 const setPane=p=>{st.pane=p;shell.dataset.pane=p;shell.dataset.view=st.view==='inbox'?'inbox':'setup'};setPane("list");

 // ── sol bölme
 function drawSide(){
  const b=st.boxes||{};const box=(key,label,count,icon)=>h("button",{type:"button",class:"ox-box"+(st.view==="inbox"&&st.box===key&&!st.channel?" on":""),onclick:()=>{st.view="inbox";st.box=key;st.channel="";setPane(st.sel?"chat":"list");st.thread?(drawChat(),drawCard()):drawChat();reload(!0)}},h("span",{text:tr(label)}),count?h("b",{text:String(count)}):null);
  const chans=Object.keys(KIND).map(k=>h("button",{type:"button",class:"ox-box"+(st.view==="inbox"&&st.channel===k?" on":""),onclick:()=>{st.view="inbox";st.channel=k;st.box="all";setPane("list");st.thread?(drawChat(),drawCard()):drawChat();reload(!0)}},h("span",{class:"ox-chl"},badge(k),tr(KIND[k].label)),st.chan[k]?h("b",{text:String(st.chan[k])}):null));
  fill(side,
   h("div",{class:"ox-side-head"},h("strong",{text:tr("Gelen kutusu")}),b.unread?h("span",{class:"ox-new",text:b.unread+" "+tr("yeni")}):null),
   box("open","Açık",b.open),box("mine","Bana atanan",b.mine),box("unassigned","Atanmamış",b.unassigned),box("snoozed","Ertelenmiş",b.snoozed),box("closed","Çözüldü",b.closed),box("all","Tümü",b.total),
   h("p",{class:"ox-group",text:tr("KANAL")}),...chans,
   h("p",{class:"ox-group",text:tr("AYARLAR")}),
   h("button",{type:"button",class:"ox-box"+(st.view==="channels"?" on":""),onclick:()=>{st.view="channels";drawChannels()}},h("span",{text:tr("Kanal bağlantıları")})),
   h("button",{type:"button",class:"ox-box"+(st.view==="quick"?" on":""),onclick:()=>{st.view="quick";drawQuick()}},h("span",{text:tr("Hazır yanıtlar")})));
 }

 // ── orta bölme: liste
 const search=h("input",{type:"search",placeholder:tr("Konuşma ara"),"aria-label":tr("Konuşma ara")});
 let searchT=0;search.addEventListener("input",()=>{clearTimeout(searchT);searchT=setTimeout(()=>{st.q=search.value.trim();reload(!0)},300)});
 function drawList(){
  const rows=st.items.map(c=>{
   const active=st.sel===c.id;
   const row=h("button",{type:"button",class:"ox-row"+(active?" on":"")+(c.unread?" unread":""),onclick:()=>open(c.id)},
    h("span",{class:"ox-av"},initials(c.name||c.handle),h("i",{},badge(c.kind,11))),
    h("span",{class:"ox-row-main"},
     h("span",{class:"ox-row-top"},h("b",{class:"ox-name",text:c.name||c.handle}),c.client?h("span",{class:"ox-linked",title:tr("Müşteri kartına bağlı"),text:"●"}):null,h("time",{text:when(c.lastAt)})),
     h("span",{class:"ox-prev"},c.direction==="out"?h("em",{text:tr("Siz")+": "}):null,c.preview||""),
     h("span",{class:"ox-row-meta"},...c.tags.map(t=>h("span",{class:"ox-tag",text:t})),c.assigneeName?h("span",{class:"ox-who",title:tr("Atanan"),text:initials(c.assigneeName)}):h("span",{class:"ox-tag ox-unassigned",text:tr("atanmamış")}),
      c.status==="snoozed"?h("span",{class:"ox-tag",text:"⏰ "+when(c.snoozeUntil)}):null)),
    c.unread?h("span",{class:"ox-count",text:String(c.unread)}):null);
   return row});
  fill(list,
   h("div",{class:"ox-list-head"},search,h("select",{"aria-label":tr("Durum"),onchange:e=>{st.box=e.target.value;st.channel=st.channel;reload(!0)}},
     ...[["open","Açık"],["mine","Bana atanan"],["unassigned","Atanmamış"],["snoozed","Ertelenmiş"],["closed","Çözüldü"],["all","Tümü"]].map(([v,l])=>h("option",{value:v,selected:st.box===v,text:tr(l)})))),
   st.channel?h("p",{class:"ox-filter"},badge(st.channel),tr(KIND[st.channel].label)+" · ",h("button",{type:"button",class:"ox-link",text:tr("Filtreyi kaldır"),onclick:()=>{st.channel="";st.box="open";reload(!0)}})):null,
   rows.length?h("div",{class:"ox-rows"},rows):h("div",{class:"ox-empty"},h("strong",{text:tr("Konuşma yok")}),h("p",{text:st.channels&&!st.channels.length?tr("Henüz kanal bağlanmadı. Sol menüden Kanal bağlantıları bölümüne gidin."):tr("Bu görünümde gösterilecek konuşma bulunmuyor.")})));
 }

 // ── sohbet
 function msgNode(m,prev){
  const out=[];
  if(!prev||new Date(prev.at*1000).toDateString()!==new Date(m.at*1000).toDateString())out.push(h("div",{class:"ox-day"},h("span",{text:dayLabel(m.at)})));
  if(m.direction==="event"){out.push(h("div",{class:"ox-event"},h("span",{text:m.body+" · "+when(m.at)})));return out}
  if(m.direction==="note"){out.push(h("div",{class:"ox-note"},h("div",{class:"ox-note-head"},h("b",{text:"🔒 "+tr("İÇ NOT")+" · "+(m.author||"")}),h("time",{text:when(m.at)})),h("p",{text:m.body})));return out}
  const mine=m.direction==="out";
  const ticks=mine?h("span",{class:"ox-ticks "+m.status,title:tr({queued:"Gönderiliyor",sent:"Gönderildi",delivered:"İletildi",read:"Okundu",failed:"Gönderilemedi"}[m.status]||"")},m.status==="failed"?"⚠":m.status==="read"||m.status==="delivered"?"✓✓":m.status==="sent"?"✓":"…"):null;
  out.push(h("div",{class:"ox-msg "+(mine?"out":"in")},h("div",{class:"ox-bubble"},h("p",{text:m.body})),
   h("div",{class:"ox-meta"},mine?h("span",{text:m.author||""}):null,h("time",{text:when(m.at)}),ticks),
   m.status==="failed"&&m.error?h("p",{class:"ox-err",text:m.error}):null));
  return out}
 const composer=h("textarea",{rows:"3",maxlength:"4000","aria-label":tr("Mesaj")});
 const counter=h("span",{class:"ox-counter"});
 const quickPop=h("div",{class:"ox-quick",hidden:!0});
 composer.addEventListener("input",()=>{counter.textContent=composer.value.length+" / 4000";st.sel&&st.draft.set(st.sel,composer.value);
  const m=/(?:^|\s)\/([\p{L}0-9_-]*)$/u.exec(composer.value.slice(0,composer.selectionStart));
  if(m&&st.quick.length){const hits=st.quick.filter(q=>q.shortcut.toLocaleLowerCase("tr-TR").startsWith(m[1].toLocaleLowerCase("tr-TR"))).slice(0,6);
   fill(quickPop,...hits.map(q=>h("button",{type:"button",onclick:()=>{const pos=composer.selectionStart,start=pos-m[1].length-1;composer.setRangeText(q.body,start,pos,"end");quickPop.hidden=!0;composer.focus();composer.dispatchEvent(new Event("input"))}},h("b",{text:"/"+q.shortcut}),h("span",{text:q.body}))));quickPop.hidden=!hits.length}else quickPop.hidden=!0});
 composer.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send()}if(e.key==="Escape")quickPop.hidden=!0});
 async function send(template){
  if(busy||!st.thread)return;const text=composer.value.trim();if(!text&&!template)return;
  busy=!0;sendBtn.disabled=!0;
  try{const r=await post(st.mode==="note"?{action:"note",id:st.sel,text}:{action:"reply",id:st.sel,text,...(template?{template}:{})});
   composer.value="";st.draft.delete(st.sel);counter.textContent="";st.thread=r;drawChat(!0);drawCard();r.warning?toast(r.warning):null;refreshList()}
  catch(e){toast(e.message)}finally{busy=!1;sendBtn.disabled=!1}}
 const sendBtn=h("button",{type:"button",class:"ox-send",onclick:()=>send()},tr("Gönder"),h("kbd",{text:"Ctrl ↵"}));
 function drawChat(scroll){
  const t=st.thread;
  if(!t){fill(chat,h("div",{class:"ox-empty ox-chat-empty"},h("strong",{text:tr("Bir konuşma seçin")}),h("p",{text:tr("WhatsApp, Facebook, Instagram, Telegram, SMS, e-posta ve web sitesi mesajları burada tek listede toplanır.")})));return}
  const c=t.conversation,k=KIND[c.kind]||KIND.sms;
  const assign=h("select",{class:"ox-assign","aria-label":tr("Atanan kişi"),disabled:!api.canWrite,onchange:async e=>{try{st.thread=await post({action:"assign",id:c.id,to:e.target.value});drawChat(!0);refreshList()}catch(x){toast(x.message);drawChat()}}},
   h("option",{value:"",text:tr("Atanmamış")}),...st.team.map(m=>h("option",{value:m.id,selected:m.id===c.assignee,text:m.id===st.me?m.name+" ("+tr("ben")+")":m.name})));
  if(c.assignee&&!st.team.some(m=>m.id===c.assignee))assign.append(h("option",{value:c.assignee,selected:!0,text:c.assigneeName}));
  const snooze=h("select",{class:"ox-snooze","aria-label":tr("Ertele"),disabled:!api.canWrite,onchange:async e=>{const v=e.target.value;if(!v)return;const now=Date.now()/1000|0;let until=now+3600;
    if(v==="3h")until=now+3*3600;if(v==="tomorrow"){const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);until=d/1000|0}if(v==="week"){const d=new Date();d.setDate(d.getDate()+7);d.setHours(9,0,0,0);until=d/1000|0}
    try{st.thread=await post({action:"status",id:c.id,status:"snoozed",until});drawChat();refreshList()}catch(x){toast(x.message)}}},
   h("option",{value:"",text:"⏰ "+tr("Ertele")}),h("option",{value:"1h",text:tr("1 saat")}),h("option",{value:"3h",text:tr("3 saat")}),h("option",{value:"tomorrow",text:tr("Yarın 09:00")}),h("option",{value:"week",text:tr("Gelecek hafta")}));
  const resolve=c.status==="closed"?h("button",{type:"button",class:"ox-btn",disabled:!api.canWrite,onclick:()=>setStatus("open"),text:tr("Yeniden aç")}):h("button",{type:"button",class:"ox-btn dark",disabled:!api.canWrite,onclick:()=>setStatus("closed")},"✓ "+tr("Çözüldü olarak işaretle"));
  const msgs=h("div",{class:"ox-msgs",role:"log","aria-live":"polite"});
  let prev=null;for(const m of t.messages){msgs.append(...msgNode(m,prev));prev=m}
  const windowInfo=c.window===0?h("div",{class:"ox-window"},h("b",{text:tr("24 saatlik yanıt penceresi kapalı.")}),h("span",{text:c.kind==="whatsapp"?tr("WhatsApp'ta yalnızca onaylı şablon mesaj gönderebilirsiniz."):tr("Müşteri yeniden yazana kadar bu kanaldan mesaj gönderilemez.")}),c.kind==="whatsapp"?templateForm():null)
   :c.window!=null&&c.window<3*3600?h("div",{class:"ox-window soft",text:tr("Yanıt penceresinin kapanmasına")+" "+Math.max(1,Math.round(c.window/60))+" "+tr("dakika kaldı.")}):null;
  const modeTabs=h("div",{class:"ox-modes",role:"tablist"},
   h("button",{type:"button",role:"tab","aria-selected":String(st.mode==="reply"),class:st.mode==="reply"?"on":"",onclick:()=>{st.mode="reply";drawChat()}},tr("Yanıtla")),
   h("button",{type:"button",role:"tab","aria-selected":String(st.mode==="note"),class:st.mode==="note"?"on note":"",onclick:()=>{st.mode="note";drawChat()}},"🔒 "+tr("İç not")),
   h("span",{class:"ox-from"},st.mode==="note"?tr("Yalnızca ekip görür"):[tr("Şuradan gönder")+": ",badge(c.kind,12)," "+(c.channel||tr(k.label))]));
  composer.placeholder=st.mode==="note"?tr("Ekip için not yazın; müşteriye gönderilmez."):tr("Yanıtınızı yazın… Hazır yanıt için / yazın.");
  composer.classList.toggle("note",st.mode==="note");
  composer.value=st.draft.get(c.id)||"";counter.textContent=composer.value?composer.value.length+" / 4000":"";
  sendBtn.firstChild.textContent=st.mode==="note"?tr("Notu kaydet"):tr("Gönder");
  fill(chat,
   h("header",{class:"ox-chat-head"},
    h("button",{type:"button",class:"ox-back","aria-label":tr("Listeye dön"),onclick:()=>setPane("list"),text:"‹"}),
    h("span",{class:"ox-av big"},initials(c.name||c.handle),h("i",{},badge(c.kind,12))),
    h("div",{class:"ox-who-box"},h("strong",{text:c.name||c.handle}),h("span",{},tr(k.label)+" · "+c.handle+(c.subject?" · "+c.subject:""))),
    h("div",{class:"ox-head-actions"},assign,snooze,resolve,h("button",{type:"button",class:"ox-btn ox-card-toggle",onclick:()=>setPane(st.pane==="card"?"chat":"card"),text:tr("Kart")}))),
   msgs,windowInfo,
   api.canWrite?h("div",{class:"ox-compose"+(st.mode==="note"?" note":"")},modeTabs,h("div",{class:"ox-compose-box"},quickPop,composer),h("div",{class:"ox-compose-foot"},counter,sendBtn)):h("p",{class:"ox-ro",text:tr("Yanıt yazmak için müşteri yazma yetkisi gerekir.")}));
  if(scroll!==!1)requestAnimationFrame(()=>{msgs.scrollTop=msgs.scrollHeight});
 }
 function templateForm(){
  const name=h("input",{placeholder:tr("Şablon adı (ör. randevu_hatirlatma)"),pattern:"[a-z0-9_]+"}),lang=h("input",{value:"tr",size:"4","aria-label":tr("Dil")}),params=h("input",{placeholder:tr("Parametreler, | ile ayırın")});
  return h("form",{class:"ox-template",onsubmit:e=>{e.preventDefault();send({name:name.value.trim(),language:lang.value.trim()||"tr",params:params.value.split("|").map(s=>s.trim()).filter(Boolean)})}},name,lang,params,h("button",{class:"ox-btn",text:tr("Şablon gönder")}))}
 async function setStatus(status){try{st.thread=await post({action:"status",id:st.sel,status});drawChat();refreshList();status==="closed"&&toast(tr("Konuşma çözüldü olarak işaretlendi."))}catch(e){toast(e.message)}}

 // ── sağ bölme: müşteri kartı
 function drawCard(){
  const t=st.thread;if(!t){fill(card,);return}
  const c=t.conversation,k=t.card;
  const parts=[h("button",{type:"button",class:"ox-back",onclick:()=>setPane("chat"),text:"‹ "+tr("Konuşmaya dön")})];
  if(k){
   parts.push(h("div",{class:"ox-card-head"},h("span",{class:"ox-av big"},initials(k.name)),h("div",{},h("strong",{text:k.name}),h("span",{text:k.group||tr("Müşteri")}))),
    h("dl",{class:"ox-dl"},k.phone?[h("dt",{text:tr("Telefon")}),h("dd",{text:k.phone})]:null,k.email?[h("dt",{text:tr("E-posta")}),h("dd",{text:k.email})]:null,k.address?[h("dt",{text:tr("Adres")}),h("dd",{text:k.address})]:null),
    k.warning?h("p",{class:"ox-warn",text:"⚠ "+k.warning}):null,
    h("p",{class:"ox-group",text:tr("HAYVANLAR")}),
    k.pets.length?h("div",{class:"ox-pets"},...k.pets.map(p=>h("a",{href:"#patient/"+encodeURIComponent(p.id),class:"ox-pet"},h("span",{class:"ox-pet-ic",text:/kedi/i.test(p.species)?"🐱":/köpek/i.test(p.species)?"🐶":"🐾"}),h("span",{},h("b",{text:p.name}),h("small",{text:[p.species,p.breed,p.weight&&p.weight+" kg"].filter(Boolean).join(" · ")})),p.warning?h("em",{title:p.warning,text:"⚠"}):null))):h("p",{class:"ox-muted",text:tr("Kayıtlı hayvan yok.")}),
    h("div",{class:"ox-actions"},h("a",{class:"ox-btn",href:"#owner/"+encodeURIComponent(k.id),text:tr("Müşteri kartı")}),h("a",{class:"ox-btn",href:"#appointments",text:tr("Randevu")}),k.pets[0]?h("a",{class:"ox-btn",href:"#patient/"+encodeURIComponent(k.pets[0].id),text:tr("Hasta dosyası")}):null),
    api.canWrite?h("button",{type:"button",class:"ox-link",text:tr("Müşteri bağlantısını kaldır"),onclick:()=>link("")}):null);
  }else{
   const q=h("input",{type:"search",placeholder:tr("Ad veya telefonla müşteri ara")}),res=h("div",{class:"ox-results"});
   q.addEventListener("input",()=>{const hits=(api.search?.(q.value)||[]);fill(res,...hits.map(x=>h("button",{type:"button",class:"ox-hit",onclick:()=>link(x.id)},h("b",{text:x.name}),h("span",{text:x.phone||""}))))});
   parts.push(h("div",{class:"ox-card-head"},h("span",{class:"ox-av big"},initials(c.name||c.handle)),h("div",{},h("strong",{text:c.name||c.handle}),h("span",{text:tr("Kayıtlı müşteriyle eşleşmedi")}))),
    api.canWrite?h("div",{class:"ox-linkbox"},h("p",{class:"ox-muted",text:tr("Bu konuşmayı bir müşteri kartına bağlayın; hayvanları ve geçmişi burada görünür.")}),q,res):null);
  }
  if(t.history?.length)parts.push(h("p",{class:"ox-group",text:tr("DİĞER KANALLARDAKİ KONUŞMALAR")}),...t.history.map(x=>h("button",{type:"button",class:"ox-hist",onclick:()=>open(x.id)},badge(x.kind),h("span",{text:tr(KIND[x.kind]?.label||x.kind)}),h("time",{text:when(x.lastAt)}))));
  const tags=h("input",{value:c.tags.join(", "),placeholder:tr("ör. aşı, randevu, VIP"),disabled:!api.canWrite});
  tags.addEventListener("change",async()=>{try{st.thread=await post({action:"tag",id:c.id,tags:tags.value.split(",").map(s=>s.trim()).filter(Boolean)});refreshList()}catch(e){toast(e.message)}});
  parts.push(h("p",{class:"ox-group",text:tr("ETİKETLER")}),tags);
  fill(card,...parts);
 }
 async function link(id){try{st.thread=await post({action:"link",id:st.sel,client:id});drawChat(!1);drawCard();refreshList()}catch(e){toast(e.message)}}

 // ── veri
 async function reload(resetSel){if(resetSel&&st.pane==="list")st.sel=st.sel;drawSide();await refreshList();if(st.view!=="inbox")return}
 async function refreshList(){try{const d=await get({op:"list",box:st.box,channel:st.channel,q:st.q});st.items=d.items;st.boxes=d.boxes;st.chan=d.channels;st.cursor=d.cursor;st.me=d.me;api.badge?.(d.boxes.unread||0);
  if(st.view==="inbox"){drawSide();drawList()}}catch(e){fill(list,h("p",{class:"ox-empty",text:e.message}))}}
 async function open(id){st.sel=id;st.mode="reply";st.view="inbox";setPane("chat");drawList();fill(chat,h("p",{class:"ox-empty",text:tr("Yükleniyor…")}));
  try{st.thread=await get({op:"thread",id});drawChat();drawCard();refreshList()}catch(e){fill(chat,h("p",{class:"ox-empty",text:e.message}))}}
 async function poll(){if(!alive||!root.isConnected){alive=!1;return}
  if(!document.hidden&&!busy){try{const d=await get({op:"cursor"});if(d.cursor!==st.cursor){const typing=document.activeElement===composer;
   if(st.sel&&st.view==="inbox"){const t=await get({op:"thread",id:st.sel});const grew=t.messages.length!==st.thread?.messages.length;st.thread=t;if(grew){drawChat(!0);drawCard();typing&&composer.focus()}}
   await refreshList()}}catch{}}
  timer=setTimeout(poll,8000)}

 // ── kanal bağlantıları
 async function drawChannels(){
  drawSide();setPane("chat");
  fill(chat,h("p",{class:"ox-empty",text:tr("Yükleniyor…")}));fill(card,);fill(list,h("div",{class:"ox-empty"},h("strong",{text:tr("Kanal bağlantıları")}),h("p",{text:tr("Her kanal kliniğin kendi resmi hesabıyla bağlanır. Mesajlar yalnızca bu klinikte saklanır.")})));
  let d;try{d=await get({op:"channels"})}catch(e){fill(chat,h("p",{class:"ox-empty",text:e.message}));return}
  st.channels=d.channels;st.canManage=d.canManage;
  const cards=d.channels.map(c=>{
   const info=[];
   if(c.webhookUrl){const b1=h("button",{type:"button",class:"ox-btn",text:tr("Kopyala")});b1.onclick=()=>copy(c.webhookUrl,b1,tr);info.push(h("label",{class:"ox-copy"},h("span",{text:c.kind==="telegram"?tr("Webhook adresi (otomatik kuruldu)"):tr("Geri çağırma / yönlendirme URL'si")}),h("code",{text:c.webhookUrl}),b1))}
   if(c.verifyToken){const b2=h("button",{type:"button",class:"ox-btn",text:tr("Kopyala")});b2.onclick=()=>copy(c.verifyToken,b2,tr);info.push(h("label",{class:"ox-copy"},h("span",{text:tr("Doğrulama anahtarı (Verify token)")}),h("code",{text:c.verifyToken}),b2))}
   return h("article",{class:"ox-chan "+c.status},
    h("header",{},badge(c.kind,18),h("div",{},h("strong",{text:c.label}),h("span",{text:tr(KIND[c.kind]?.label||c.kind)+(c.externalId?" · "+c.externalId:"")})),
     h("span",{class:"ox-state "+c.status,text:tr({active:"Etkin",error:"Hata",removed:"Kaldırıldı"}[c.status]||c.status)})),
    c.lastError?h("p",{class:"ox-err",text:c.lastError}):null,
    h("p",{class:"ox-muted",text:c.lastEventAt?tr("Son mesaj")+": "+when(c.lastEventAt,!0):tr("Henüz mesaj alınmadı.")}),
    ...info,
    d.canManage&&c.status!=="removed"?h("div",{class:"ox-actions"},
     h("button",{type:"button",class:"ox-btn",text:tr("Bağlantıyı dene"),onclick:async e=>{e.target.disabled=!0;try{toast((await post({action:"channel-test",id:c.id})).message)}catch(x){toast(x.message)}finally{e.target.disabled=!1;drawChannels()}}}),
     h("button",{type:"button",class:"ox-btn",text:tr("Düzenle"),onclick:()=>channelForm(c.kind,c)}),
     h("button",{type:"button",class:"ox-btn danger",text:tr("Kaldır"),onclick:async()=>{if(!confirm(tr("Kanal kaldırılsın mı? Geçmiş yazışmalar saklanır, yeni mesaj alınmaz.")))return;try{await post({action:"channel-delete",id:c.id});drawChannels()}catch(x){toast(x.message)}}})):null)});
  const add=d.canManage?h("div",{class:"ox-add"},h("p",{class:"ox-group",text:tr("YENİ KANAL BAĞLA")}),h("div",{class:"ox-add-grid"},...Object.keys(SETUP).map(k=>h("button",{type:"button",class:"ox-add-btn",style:`--k:${KIND[k].color}`,onclick:()=>channelForm(k)},badge(k,22),h("span",{text:tr(KIND[k].label)}))))):h("p",{class:"ox-muted",text:tr("Kanal eklemek ve ayarlarını görmek için klinik yöneticisi yetkisi gerekir.")});
  const settings=d.canManage?settingsForm():null;
  fill(chat,h("div",{class:"ox-setup"},h("h2",{text:tr("Kanal bağlantıları")}),
   h("p",{class:"ox-muted",text:tr("Mesajlar her platformun resmi API'si üzerinden gelir ve aynı kanaldan yanıtlanır. Erişim anahtarları şifreli saklanır ve yeniden gösterilmez.")}),
   cards.length?h("div",{class:"ox-chans"},cards):h("p",{class:"ox-muted",text:tr("Henüz bağlı kanal yok.")}),add,settings));
 }
 function settingsForm(){
  const sig=h("input",{type:"checkbox",checked:!!st.settings.signature});
  return h("form",{class:"ox-settings",onsubmit:async e=>{e.preventDefault();try{const r=await post({action:"settings",signature:sig.checked});st.settings=r.settings;toast(tr("Ayarlar kaydedildi."))}catch(x){toast(x.message)}}},
   h("p",{class:"ox-group",text:tr("YANIT AYARLARI")}),h("label",{class:"ox-check"},sig,h("span",{text:tr("Giden mesajların sonuna yanıtlayan kişinin adını ekle (ör. — Dr. Fatih)")})),h("button",{class:"ox-btn",text:tr("Kaydet")}))}
 function channelForm(kind,existing){
  const s=SETUP[kind];const inputs={};
  const fields=s.fields.map(([key,label,req,secret])=>{const val=existing?.config?.[key]??"";const i=h("input",{name:key,type:secret?"password":"text",autocomplete:"off",value:secret?"":val,placeholder:secret&&val==="saved"?tr("Kayıtlı · değiştirmek için yeni değer girin"):"",required:!!req&&!(secret&&val==="saved")});inputs[key]=i;
   return h("label",{},h("span",{text:tr(label)+(req?" *":"")}),i)});
  const label=h("input",{value:existing?.label||KIND[kind].label,maxlength:"80"});
  const form=h("form",{class:"ox-form",onsubmit:async e=>{e.preventDefault();const btn=form.querySelector("button[type=submit]");btn.disabled=!0;
    try{const config={};for(const[k,i]of Object.entries(inputs))config[k]=i.value.trim();const r=await post({action:"channel-save",kind,id:existing?.id||"",label:label.value,config});toast(tr("Kanal kaydedildi."));
     r.channel.lastError?toast(r.channel.lastError):null;drawChannels()}catch(x){toast(x.message)}finally{btn.disabled=!1}}},
   h("h2",{},badge(kind,20)," "+tr(s.title)),h("ol",{class:"ox-steps"},...s.steps.map(x=>h("li",{text:tr(x)}))),
   h("label",{},h("span",{text:tr("Görünen ad")}),label),...fields,
   h("div",{class:"ox-actions"},h("button",{type:"submit",class:"ox-btn dark",text:existing?tr("Kaydet"):tr("Kanalı bağla")}),h("button",{type:"button",class:"ox-btn",text:tr("Vazgeç"),onclick:()=>drawChannels()})));
  fill(chat,h("div",{class:"ox-setup"},form));setPane("chat");
 }
 // ── hazır yanıtlar
 function drawQuick(){
  drawSide();setPane("chat");fill(card,);fill(list,h("div",{class:"ox-empty"},h("strong",{text:tr("Hazır yanıtlar")}),h("p",{text:tr("Yazarken / ve kısayolu yazın; metin otomatik eklenir.")})));
  const sc=h("input",{placeholder:tr("kısayol (ör. adres)"),maxlength:"40",required:!0}),body=h("textarea",{rows:"3",maxlength:"1000",required:!0,placeholder:tr("Yanıt metni")});
  fill(chat,h("div",{class:"ox-setup"},h("h2",{text:tr("Hazır yanıtlar")}),
   h("form",{class:"ox-form",onsubmit:async e=>{e.preventDefault();try{st.quick=(await post({action:"quick-save",shortcut:sc.value.trim(),body:body.value.trim()})).quick;drawQuick()}catch(x){toast(x.message)}}},
    h("label",{},h("span",{text:tr("Kısayol")}),sc),h("label",{},h("span",{text:tr("Metin")}),body),h("div",{class:"ox-actions"},h("button",{class:"ox-btn dark",text:tr("Kaydet")}))),
   h("div",{class:"ox-qlist"},...st.quick.map(q=>h("div",{class:"ox-q"},h("b",{text:"/"+q.shortcut}),h("p",{text:q.body}),h("button",{type:"button",class:"ox-link",text:tr("Sil"),onclick:async()=>{try{st.quick=(await post({action:"quick-delete",id:q.id})).quick;drawQuick()}catch(x){toast(x.message)}}}))))));
 }

 // ── başlat
 (async()=>{try{const t=await get({op:"team"});st.team=t.team;st.me=t.me;st.quick=t.quick;st.settings=t.settings}catch{}
  try{const c=await get({op:"channels"});st.channels=c.channels;st.canManage=c.canManage}catch{}
  drawSide();drawChat();await refreshList();
  const want=Number(new URLSearchParams(location.hash.split("?")[1]||"").get("c"));if(want)open(want);
  timer=setTimeout(poll,8000)})();
 return()=>{alive=!1;clearTimeout(timer)};
}
