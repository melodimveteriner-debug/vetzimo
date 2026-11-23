import {clinicFetch} from "./access.js";

const labelChannel = channel => channel==="whatsapp" ? "WhatsApp" : "SMS";
const statusText = {reserved:"İşleniyor",queued:"Sağlayıcı kuyruğunda",sent:"Gönderildi",delivered:"Teslim edildi",read:"Okundu",failed:"Başarısız",undelivered:"Teslim edilemedi",rejected:"Sağlayıcı reddetti",unknown:"Durum belirsiz"};
const dateTime = value => value ? new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",dateStyle:"short",timeStyle:"short"}).format(new Date(value)) : "—";
const quantity = value => new Intl.NumberFormat("tr-TR").format(Number(value)||0);
const opts = [["sms","SMS"],["whatsapp","WhatsApp"]];
const selected = (a,b) => a===b ? "selected" : "";

export function createDealerPanel({esc,toast}) {
  let generation=0, root, location, info, filters={}, page=1, requestBusy=false;

  async function api(path,data) {
    const response=await clinicFetch("/api/dealer/"+path,data===undefined?{}:{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),
    });
    const result=await response.json();
    if (!response.ok) throw Error(result.error || "İşlem tamamlanamadı.");
    return result;
  }
  const btn=(label,attrs="",style="")=>`<button class="button ${style}" type="button" ${attrs}>${esc(label)}</button>`;
  const submit=label=>`<button type="submit" class="button primary">${esc(label)}</button>`;
  const link=(label,href,style="")=>`<a class="button ${style}" href="#${href}">${esc(label)}</a>`;
  const input=(key,label,value="",type="text",attrs="")=>`<label class="dealer-field">${esc(label)}<input name="${key}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const textarea=(key,label,value="",attrs="")=>`<label class="dealer-field dealer-wide">${esc(label)}<textarea name="${key}" rows="3" ${attrs}>${esc(value)}</textarea></label>`;
  const select=(key,label,options,value="")=>`<label class="dealer-field">${esc(label)}<select name="${key}">${options.map(([id,text])=>`<option value="${esc(id)}" ${selected(id,value)}>${esc(text)}</option>`).join("")}</select></label>`;
  const status=(value)=>`<span class="dealer-status ${["delivered","read"].includes(value)?"positive":["failed","undelivered","rejected"].includes(value)?"negative":"neutral"}">${esc(statusText[value] || value)}</span>`;
  const empty=message=>`<p class="dealer-empty">${esc(message)}</p>`;
  const section=(title,subtitle,body)=>`<section class="panel dealer-section"><header><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:""}</header>${body}</section>`;
  const facts=items=>`<dl class="dealer-facts">${items.map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(value ?? "—")}</dd></div>`).join("")}</dl>`;
  const table=(headers,body)=>`<div class="table-wrap dealer-table" tabindex="0" aria-label="Yatay kaydırılabilir kayıt tablosu"><table><thead><tr>${headers.map(item=>`<th scope="col">${esc(item)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  const cells=items=>`<tr>${items.map(item=>`<td>${esc(item)}</td>`).join("")}</tr>`;
  const channelLabel=provider=>[provider?.sms?"SMS":"",provider?.whatsapp?"WhatsApp":""].filter(Boolean).join(" ve ");
  const formError='<p data-error role="alert" class="dealer-error"></p>';
  const params=()=>new URLSearchParams({...filters,page:String(page)});

  function shell(title,subtitle,body,actions="") {
    const owner=info.role==="owner";
    return `<div class="dealer-workspace"><div class="page-head"><div><div class="eyebrow">${owner?"BAYİ YÖNETİMİ":"BAYİ ÇALIŞMA ALANI"}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>
      <nav class="dealer-tabs" aria-label="Bayilik ekranları">${owner?link("Bayi hesapları","bayi-admin",location[0]==="bayi-admin"?"primary":"")+link("Bayi desteği","bayi-destek")+link("Mesaj izleme","bayi-mesajlari",location[0]==="bayi-mesajlari"?"primary":"")+link("Sağlayıcı ayarları","bayi-saglayici",location[0]==="bayi-saglayici"?"primary":""):
      link("Destek","bayi-destek")+link("Kredi ve limitler","bayi-hesabim",location[0]==="bayi-hesabim"?"primary":"")+link("Mesajlarım","bayi-mesajlari",location[0]==="bayi-mesajlari"?"primary":"")}</nav>
      ${info.provider && !channelLabel(info.provider) ? '<p class="callout dealer-provider-note">Gönderim sağlayıcısı bağlı değil. Bayi kayıtları ve limitler düzenlenebilir. Canlı gönderim ve teslimat sorgusu bağlantı kurulduğunda çalışır.</p>':""}${body}</div>`;
  }
  function stat(title,value,subtitle) {
    return `<div class="dealer-stat"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(subtitle)}</small></div>`;
  }
  function accountForm(account={}) {
    return `<form data-form="account" data-id="${esc(account.id)}" class="dealer-form">
      ${input("name","Bayi / klinik adı",account.name,"text","required maxlength=160")}
      ${input("code","Bayi kodu",account.code,"text",'required pattern="[A-Za-z0-9_-]{2,32}" maxlength=32')}
      ${input("email","ChatGPT hesap e-postası",account.email,"email","required maxlength=254")}
      ${input("contact","Yetkili kişi",account.contact)}
      ${input("phone","Telefon",account.phone,"tel","maxlength=30")}${input("city","İl",account.city)}
      ${select("active","Hesap durumu",[["1","Aktif"],["0","Durduruldu"]],account.active===0?"0":"1")}
      ${textarea("notes","Yönetici notları",account.notes,"maxlength=1600")}
      <p class="dealer-wide dealer-note">Bayi giriş yapabilmek için aynı e-postayla bu özel Site’ye erişim iznine de sahip olmalıdır.</p>
      <div class="dealer-form-actions dealer-wide">${submit(account.id?"Bayi bilgilerini kaydet":"Bayi oluştur")}${formError}</div></form>`;
  }
  function partnerList({partners}) {
    const active=partners.filter(row=>row.active).length;
    const stats=`<div class="dealer-stats">${stat("Bayiler",partners.length,"Tanımlanan hesap")}${stat("Aktif hesap",active,"Girişe açık")}${stat("SMS kredisi",quantity(partners.reduce((n,row)=>n+row.sms_balance,0)),"Toplam kullanılabilir")}${stat("WhatsApp kredisi",quantity(partners.reduce((n,row)=>n+row.whatsapp_balance,0)),"Toplam kullanılabilir")}</div>`;
    const list=partners.length?table(["Bayi","E-posta","Durum","Son giriş","SMS","WhatsApp","İşlem"],partners.map(row=>`<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.code)}${row.city?" · "+esc(row.city):""}</small></td><td>${esc(row.email)}</td><td>${status(row.active?"Aktif":"Durduruldu")}</td><td>${dateTime(row.last_seen)}</td><td>${quantity(row.sms_balance)}</td><td>${quantity(row.whatsapp_balance)}</td><td>${link("Bayi ayrıntısı","bayi-admin/"+esc(row.id),"small")}</td></tr>`).join("")):empty("Henüz bayi hesabı oluşturulmadı.");
    return shell("Bayilik Yönetimi","Klinik hesapları, kanal bazında kredi ve kullanım limitleri.",stats+
      section("Bayi hesapları",partners.length+" kayıt",list)+section("Yeni bayi oluştur","İletişim bilgilerini ve giriş e-postasını tanımlayın.",accountForm()));
  }
  function limitsBlock(data,owner) {
    const {limits,account}=data;
    const body=limits.map(row=>`<div class="dealer-channel"><h3>${labelChannel(row.channel)}</h3>
      ${facts([["Kalan kredi",quantity(row.balance)],["Günlük kullanım",quantity(row.day_used)+" / "+quantity(row.day_cap)],["Aylık kullanım",quantity(row.month_used)+" / "+quantity(row.month_cap)],["Kanal durumu",row.enabled?"Açık":"Kapalı"]])}
      ${owner?`<div class="dealer-form">
      ${select(row.channel+"_enabled","Gönderim",[["1","Açık"],["0","Kapalı"]],String(row.enabled))}
      ${input(row.channel+"_day","Günlük üst sınır",row.day_cap,"number","required min=0 max=10000000 step=1")}
      ${input(row.channel+"_month","Aylık üst sınır",row.month_cap,"number","required min=0 max=10000000 step=1")}</div>`:""}
      </div>`).join("");
    return section("Kredi ve gönderim kuralları","Sıfır limit gönderimi kapatır. Gün ve ay Türkiye saatine göre hesaplanır.",
      owner?`<form data-form="limits" data-id="${esc(account.id)}"><div class="dealer-channels">${body}</div><div class="dealer-form-actions">${submit("Limitleri kaydet")}${formError}</div></form>`:`<div class="dealer-channels">${body}</div>`);
  }
  function partnerPage(data,owner) {
    const {account,ledger,counts}=data;
    const credit=owner?section("Kredi ekle veya düş","Pozitif değer kredi ekler. Negatif değer kullanılabilir krediden düşer.",
      `<form class="dealer-form" data-form="credit" data-id="${esc(account.id)}">${select("channel","Kanal",opts)}
      ${input("delta","Kredi değişimi","","number","required min=-10000000 max=10000000 step=1")}${input("reason","İşlem nedeni","","text","required maxlength=240")}
      <div class="dealer-form-actions dealer-wide">${submit("Kredi hareketini kaydet")}${formError}</div></form>`):"";
    const history=ledger.length?table(["Zaman","Kanal","Değişim","Neden",...(owner?["İşlemi yapan"]:[])],ledger.map(row=>cells([dateTime(row.created_at),labelChannel(row.channel),(row.delta>0?"+":"")+quantity(row.delta),row.reason,...(owner?[row.actor]:[])])).join("")):empty("Bu hesapta kredi hareketi yok.");
    const deliveries=counts.length?table(["Kanal","Durum","Adet"],counts.map(row=>`<tr><td>${labelChannel(row.channel)}</td><td>${status(row.status)}</td><td>${quantity(row.count)}</td></tr>`).join("")):empty("Bu hesaba ait gönderim kaydı yok.");
    return shell(account.name,account.code+" · "+(account.active?"Aktif hesap":"Durduruldu"),section("Bayi profili","",facts([["E-posta",account.email],["Yetkili",account.contact||"—"],["Telefon",account.phone||"—"],["İl",account.city||"—"],["Oluşturulma",dateTime(account.created_at)],["Son giriş",dateTime(account.last_seen)]])+
      (owner?`<details><summary>Bayi bilgilerini düzenle</summary>${accountForm(account)}</details>`:""))+
      (!owner?section("Gönderim bağlantıları","",facts([["SMS Gönderim Bağlantısı",info.provider?.sms?"Etkin":"Etkinleştirilmedi"],["WhatsApp Gönderim Bağlantısı",info.provider?.whatsapp?"Etkin":"Etkinleştirilmedi"]])):"")+limitsBlock(data,owner)+credit+section("Mesaj durumu özeti","Kayıtlı SMS ve WhatsApp gönderimleri",deliveries)+section("Kredi hareketleri","Son 50 kredi işlemi",history),
      owner?link("Bayilere dön","bayi-admin")+btn("Bayi mesajlarını incele",`data-action="partner-messages" data-id="${esc(account.id)}"`,"primary"):link("Mesajlarımı aç","bayi-mesajlari","primary"));
  }
  function providerPage(provider) {
    return shell("Gönderim Sağlayıcısı","Netgsm SMS ve WhatsApp bağlantılarını yönetin.",
      section("Gönderim ayarları",channelLabel(provider)?channelLabel(provider)+" için ayar kaydedildi.":"Bağlantı için hesabın gönderici bilgilerini girin.",
      `<form class="dealer-form" data-form="provider" autocomplete="off">
      ${input("netgsmAccount","Netgsm abone numarası",provider.netgsmAccount,"tel",'placeholder="0850…" maxlength=24')}
      ${input("netgsmToken","Netgsm API alt kullanıcı şifresi","","password",'autocomplete="new-password" maxlength=160')}
      ${input("smsFrom","Netgsm onaylı SMS başlığı",provider.smsFrom,"text",'placeholder="MELODIM VET" maxlength=11')}
      ${input("account","WhatsApp Account SID","","text",'placeholder="AC…" maxlength=34')}
      ${input("token","Auth Token","","password",'autocomplete="new-password" maxlength=64')}
      ${input("whatsappFrom","WhatsApp gönderen numarası",provider.whatsappFrom,"tel",'placeholder="+90…" maxlength=20')}
      ${input("template","Onaylı WhatsApp Content SID",provider.template,"text",'placeholder="HX…" maxlength=34')}
      <p class="dealer-wide dealer-note">Bağlantı testi kayıtlı Netgsm hesabını ve başlığını mesaj göndermeden doğrular. Şifreyi korumak için ilgili alanı boş bırakın. WhatsApp gönderimi onaylı şablon kullanır.</p>
      <div class="dealer-form-actions dealer-wide">${submit("Bağlantı ayarlarını kaydet")}${btn("Netgsm bağlantısını doğrula",'data-action="test-provider"')}${formError}</div></form>`));
  }
  function messagesPage(result,partners,owner) {
    const delivered=result.messages.filter(row=>["delivered","read"].includes(row.status)).length;
    const controls=`<form data-form="filters" class="dealer-form dealer-filters">
      ${owner?select("partner","Bayi",[["","Tüm bayiler"],...partners.map(row=>[row.id,row.name])],filters.partner):""}
      ${select("channel","Kanal",[["","Tümü"],...opts],filters.channel)}
      ${select("status","Teslimat durumu",[["","Tümü"],...Object.entries(statusText)],filters.status)}
      ${input("start","Başlangıç",filters.start,"date")}${input("end","Bitiş",filters.end,"date")}
      ${input("q","Alıcı, bayi, metin veya referans",filters.q,"search","maxlength=100")}
      <div class="dealer-form-actions dealer-wide">${submit("Filtrele")}${btn("Temizle",'data-action="clear"')}</div></form>`;
    const body=result.messages.length?table(["Zaman",...(owner?["Bayi"]:[]),"Kanal","Alıcı","Durum","Kredi","İşlem"],result.messages.map(row=>`<tr>
      <td>${dateTime(row.created_at)}</td>${owner?`<td>${esc(row.partner_name)}<small>${esc(row.partner_code)}</small></td>`:""}<td>${labelChannel(row.channel)}</td><td>${esc(row.recipient)}</td>
      <td>${status(row.status)}${row.error_code?`<small>Hata ${esc(row.error_code)}</small>`:""}</td><td>${quantity(row.charged)}</td><td>${link("Ayrıntıyı aç","bayi-mesajlari/"+esc(row.id),"small")}</td></tr>`).join("")):empty("Bu filtrelerle eşleşen gönderim kaydı yok.");
    const pending=result.messages.filter(row=>row.provider_id && (["queued","sent","unknown"].includes(row.status) || row.channel==="whatsapp" && row.status==="delivered")).slice(0,8).map(row=>row.id);
    const paging=`<div class="dealer-paging">${result.page>1?btn("Önceki",'data-action="prev"'):""}<span>Sayfa ${result.page}</span>${result.more?btn("Sonraki",'data-action="next"'):""}</div>`;
    const summary=`<div class="dealer-stats">${stat("Gösterilen kayıt",result.messages.length,"Bu sayfadaki sonuç")}${stat("Teslim edildi / okundu",delivered,"Sağlayıcının doğruladığı")}${stat("Başarısız / reddedildi",result.messages.filter(row=>["failed","undelivered","rejected"].includes(row.status)).length,"Bu sayfadaki sonuç")}${stat("Tüketilen kredi",quantity(result.messages.reduce((sum,row)=>sum+row.charged,0)),"Bu sayfadaki sonuç")}</div>`;
    return shell(owner?"SMS ve WhatsApp İzleme":"Mesajlarım","Gönderildi durumu, alıcıya teslim edildiği anlamına gelmez.",summary+
      section("Gönderimleri filtrele","Bayiye, kanala, tarihe ve duruma göre inceleyin.",controls)+section("Gönderim geçmişi","Durumlar sağlayıcı sorgulamasıyla güncellenir.",body+paging),
      (pending.length?btn("Teslimat durumlarını sorgula",`data-action="refresh-many" data-ids="${esc(pending.join(","))}"`):"")+
      (!owner?link("Yeni mesaj gönder","bayi-mesajlari/yeni","primary"):""));
  }
  function messageDetail({message,history}) {
    const detail=facts([["Bayi",message.partner_name],["Kanal",labelChannel(message.channel)],["Alıcı",message.recipient],["Son durum",statusText[message.status]],["Sağlayıcı durumu",message.provider_status||"—"],
      ["Sağlayıcı referansı",message.provider_id||"—"],["Hata kodu",message.error_code||"—"],["Oluşturulma",dateTime(message.created_at)],["Son sorgu",dateTime(message.checked_at)],
      ["Ayrılan kredi",quantity(message.units)],["Tüketilen kredi",quantity(message.charged)],["Sağlayıcı parça sayısı",message.provider_segments??"—"],
      ["İzin kaydı referansı",message.consent_ref],["Gönderen hesap",message.actor]]);
    const logs=history.length?table(["Zaman","Durum","Sağlayıcı","Açıklama"],history.map(event=>`<tr><td>${dateTime(event.created_at)}</td><td>${status(event.status)}</td><td>${esc(event.provider_status||"—")}</td><td>${esc(event.detail||"—")}</td></tr>`).join("")):empty("Durum hareketi bulunamadı.");
    return shell("Mesaj Ayrıntısı",message.partner_name+" · "+labelChannel(message.channel),
      section("Teslimat bilgileri","",detail+(message.detail?`<p class="callout">${esc(message.detail)}</p>`:""))+
      section("Mesaj içeriği","Klinik içi gönderim kaydı",message.channel==="sms"?`<p class="dealer-message-body">${esc(message.body)}</p>`:
      facts([["Şablon kimliği",message.template_sid],["Şablon alanları",message.variables||"—"]]))+section("Durum geçmişi","Sağlayıcının bildirdiği geçişler",logs),
      link("Listeye dön","bayi-mesajlari")+(message.provider_id?btn("Durumu sorgula",`data-action="refresh" data-id="${esc(message.id)}"`,"primary"):""));
  }
  function compose() {
    const available=opts.filter(([key])=>info.provider?.[key]);
    if (!available.length) return shell("Yeni Mesaj","Gönderim ayarı gerekli.",empty("Yönetici sağlayıcı bağlantısını açtığında buradan mesaj gönderebilirsiniz."));
    return shell("Yeni Mesaj","Mesaj, gönderimden önce kullanılabilir kredi ve limitlere göre kontrol edilir.",
      section("Gönderim bilgileri","Alıcının iletişim iznini ve numarasını doğrulayın.",
      `<form class="dealer-form" data-form="send">${select("channel","Kanal",available)}${input("recipient","Alıcı numarası","","tel",'required placeholder="+90…" maxlength=20')}
      ${input("consent","Alıcı iletişim izni kayıt referansı","","text",'required maxlength=200 placeholder="Onam veya müşteri kayıt referansı"')}
      <div class="dealer-wide" data-sms>${select("iysfilter","SMS gönderim türü",[["0","Bilgilendirme"],["11","Ticari · bireysel alıcı (İYS)"],["12","Ticari · tacir (İYS)"]])}
      ${textarea("body","SMS metni","","maxlength=912")}</div>
      <div class="dealer-wide" data-whatsapp>${textarea("variables","WhatsApp şablon değişkenleri","","maxlength=9000")}<p class="dealer-note">Tanımlı şablon kullanılır. Değişkeni olmayan şablonlarda boş bırakın.</p></div>
      <label class="dealer-wide dealer-check"><input name="confirm" type="checkbox" required> Bu alıcı için seçilen kanalda geçerli iletişim iznini kontrol ettim.</label>
      <div class="dealer-form-actions dealer-wide">${submit("Gönderimi başlat")}${formError}</div></form>`),link("Listeye dön","bayi-mesajlari")+(info.central?link("Şablondan toplu mesaj","bayi-mesajlari/toplu"):""));
  }

  function showChannel(form) {
    const sms=form.elements.channel.value==="sms";
    form.querySelector("[data-sms]").hidden=!sms;
    form.querySelector("[data-whatsapp]").hidden=sms;
    form.elements.body.required=sms;
  }

  async function paint() {
    const turn=++generation;
    const [screen,id]=location;
    const owner=info.role==="owner";
    root.innerHTML='<p class="dealer-empty" role="status">Bayilik paneli yükleniyor…</p>';
    let html;
    try {
      if (owner && screen==="bayi-admin") html=id ? partnerPage(await api("partners/"+id),true) : partnerList(await api("partners"));
      else if (owner && screen==="bayi-saglayici") html=providerPage(await api("provider"));
      else if (!owner && screen==="bayi-hesabim") html=partnerPage(await api("account"),false);
      else if (["owner","dealer","staff"].includes(info.role) && screen==="bayi-mesajlari") {
        if (id==="yeni" && !owner) html=compose();
        else if (id) html=messageDetail(await api("messages/"+id));
        else {
          const [records,accounts]=await Promise.all([api("messages?"+params()),owner?api("partners"):Promise.resolve({partners:[]})]);
          html=messagesPage(records,accounts.partners,owner);
        }
      } else html=empty("Bu bölüm için yetkiniz bulunmuyor.");
    } catch(error) {
      html=shell("Bayilik Paneli","Kayıtlar şu anda görüntülenemiyor.",empty(error.message),btn("Tekrar dene",'data-action="retry"'));
    }
    if (turn!==generation || !root.isConnected) return;
    root.innerHTML=html;
    const composer=root.querySelector('[data-form="send"]');
    if (composer) showChannel(composer);
  }
  function mount(element,route,session) {
    root=element;
    location=route;
    info=session;
    root.addEventListener("submit",onSubmit);
    root.addEventListener("click",onClick);
    root.addEventListener("change",event=>{
      if (event.target.name==="channel" && event.target.form?.dataset.form==="send") showChannel(event.target.form);
    });
    return paint();
  }

  async function onSubmit(event) {
    const form=event.target, type=form.dataset.form;
    if (!type) return;
    event.preventDefault();
    if (requestBusy) return;
    const data=Object.fromEntries(new FormData(form));
    if (type==="filters") {
      if (data.start && data.end && data.start>data.end) { toast("Başlangıç tarihi bitişten sonra olamaz.");return; }
      filters=Object.fromEntries(Object.entries(data).filter(([,value])=>value));
      page=1;
      void paint();
      return;
    }
    const error=form.querySelector("[data-error]");
    if (error) error.textContent="";
    const button=event.submitter;
    if (button) button.disabled=true;
    requestBusy=true;
    try {
      const id=form.dataset.id;
      let result;
      if (type==="account") {
        result=await api("partners"+(id?"/"+id:""),{...data,active:data.active==="1"});
        toast("Bayi bilgileri kaydedildi.");
        if (!id) { window.location.hash="bayi-admin/"+result.id;return; }
      } else if (type==="limits") {
        await api("partners/"+id+"/limits",Object.fromEntries(opts.map(([key])=>[key,{
          enabled:data[key+"_enabled"]==="1",day_cap:Number(data[key+"_day"]),month_cap:Number(data[key+"_month"]),
        }])));
        toast("Kanal limitleri kaydedildi.");
      } else if (type==="credit") {
        form.dataset.requestId ||= crypto.randomUUID();
        await api("partners/"+id+"/credit",{...data,delta:Number(data.delta),requestId:form.dataset.requestId});
        toast("Kredi hareketi kaydedildi.");
      } else if (type==="provider") {
        await api("provider",data);
        info.provider=await api("provider");
        toast("Bağlantı ayarları kaydedildi.");
      } else if (type==="send") {
        form.dataset.requestId ||= crypto.randomUUID();
        result=await api("messages",{...data,confirm:data.confirm==="on",requestId:form.dataset.requestId});
        toast("Gönderim kaydı oluşturuldu. Sonucu ayrıntıda görebilirsiniz.");
        window.location.hash="bayi-mesajlari/"+result.id;
        return;
      }
      await paint();
    } catch(problem) {
      if (error) error.textContent=problem.message;
      else toast(problem.message);
    } finally {
      requestBusy=false;
      if (button) button.disabled=false;
    }
  }

  async function onClick(event) {
    const button=event.target.closest("button[data-action]");
    if (!button || requestBusy) return;
    const {action,id,ids}=button.dataset;
    if (action==="partner-messages") { filters={partner:id};page=1;window.location.hash="bayi-mesajlari";return; }
    if (["clear","prev","next","retry"].includes(action)) {
      if (action==="clear") { filters={};page=1; }
      if (action==="prev") page=Math.max(1,page-1);
      if (action==="next") page+=1;
      void paint();
      return;
    }
    requestBusy=true;
    button.disabled=true;
    try {
      if (action==="refresh") {
        await api("messages/"+id+"/refresh",{});
        toast("Mesaj durumu sorgulandı.");
      } else if (action==="refresh-many") {
        const results=await Promise.allSettled(ids.split(",").map(key=>api("messages/"+key+"/refresh",{})));
        const ok=results.filter(row=>row.status==="fulfilled").length;
        toast(ok+" kayıt sorgulandı"+(ok<results.length?" · "+(results.length-ok)+" kayıt sorgulanamadı":"")+".");
      } else if (action==="test-provider") {
        await api("provider/test",{});
        toast("Netgsm hesabı ve SMS başlığı doğrulandı.");
        return;
      }
      await paint();
    } catch(error) { toast(error.message); }
    finally { requestBusy=false;button.disabled=false; }
  }
  return {mount};
}
