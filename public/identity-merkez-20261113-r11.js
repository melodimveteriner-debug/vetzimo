import {petPortrait} from "./pet-portrait.js";
import {loadAppearance} from "./theme.js";
import {mountAccessLayout} from "./access-layout.js";
import {paginate} from "./paged.js";
import {mountCenterSuite,opsFetch} from "./center-ops-merkez-20261113-r11.js";
import {vaccineLabels} from "./vaccine-progress.js";
const view=document.querySelector("#view");
const status=document.querySelector("#status");
const captchaBox=document.querySelector("#captcha");
const route=location.pathname;
const center=route==="/yonetim";
const params=new URLSearchParams(location.search);
const fragment=location.hash.slice(1).split("/");
if (fragment[1]) history.replaceState(null,"",location.pathname+location.search);
let config={}, challenge="", captchaLoading, previewReauth=false;
const roles={dealer:"Bayi yöneticisi",branch:"Şube yöneticisi",staff:"Personel",customer:"Hasta sahibi"};
const outcomes={active:"Hesap etkin.",sent:"SMS sağlayıcısı gönderimi kabul etti.",delivery_unknown:"SMS sonucu henüz doğrulanamadı.",provider_pending:"Üyelik beklemede. SMS sağlayıcısı kullanılabilir olduğunda tekrar deneyin.",credit_pending:"Üyelik beklemede. Bayi bakiyesi ve gönderim limitlerini kontrol edin.",quota_pending:"Üyelik beklemede. Gönderim kotası doldu.",wait:"Bir aktivasyon zaten beklemede. Beş dakika sonra yeniden deneyebilirsiniz."};
function el(tag,text="",properties={}) {
  const node=document.createElement(tag);
  node.textContent=text;
  Object.assign(node,properties);
  return node;
}

function heading(title,body="") {
  view.replaceChildren(el("h1",title,{id:"page-title"}));
  if (body) view.append(el("p",body,{className:"muted"}));
}

function link(text,href,className="") {
  return el("a",text,{href,className});
}

function field(name,title,properties={}) {
  const label=el("label",title);
  const input=el("input","",{name,required:true,...properties});
  label.append(input);
  return label;
}

function password(name,title,auto="current-password",required=true) {
  const label=el("label",title);
  const wrap=el("span","",{className:"inline"});
  const input=el("input","",{name,type:"password",autocomplete:auto,required,maxLength:128});
  if (auto==="new-password") input.minLength=6;
  const toggle=el("button","Göster",{type:"button",className:"secondary"});
  toggle.addEventListener("click",()=>{
    input.type=input.type==="password"?"text":"password";
    toggle.textContent=input.type==="password"?"Göster":"Gizle";
  });
  wrap.append(input,toggle);
  label.append(wrap);
  return label;
}

function selectField(name,title,options,required=true) {
  const label=el("label",title);
  const select=el("select","",{name,required});
  select.append(...options.map(([value,text])=>el("option",text,{value})));
  label.append(select);
  return label;
}

function formButton(text) {
  return el("button",text,{type:"submit"});
}

function makeForm(fields,text,action) {
  const form=el("form");
  const button=formButton(text);
  form.append(...fields,button);
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    status.textContent="";
    delete status.dataset.tone;
    button.disabled=true;
    try { await action(Object.fromEntries(new FormData(form)),form); }
    catch(error) {status.dataset.tone="error";status.textContent=error.message;}
    finally { button.disabled=false; }
  });
  return form;
}

function showCaptcha() {
  if (!config.captchaSiteKey || captchaLoading) return;
  captchaLoading=new Promise((resolve,reject)=>{
    const script=el("script","",{src:"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",async:true});
    script.onload=resolve;script.onerror=reject;
    document.head.append(script);
  }).then(()=>{
    window.turnstile.render(captchaBox,{sitekey:config.captchaSiteKey,action:"vetnet-auth",
      callback:token=>{challenge=token;},
      "expired-callback":()=>{challenge="";}});
  }).catch(()=>{status.textContent="Güvenlik doğrulaması yüklenemedi.";captchaLoading=null;});
}

async function api(path,body) {
  const headers=body?{"Content-Type":"application/json"}:undefined;
  const response=await fetch("/api/identity/"+path,body?{method:"POST",headers,body:JSON.stringify({...body,captcha:challenge})}:{});
  const result=await response.json();
  if (body && challenge) {challenge="";window.turnstile?.reset();}
  if (response.status===428) showCaptcha();
  if (!response.ok) throw Object.assign(Error(result.error||"İşlem tamamlanamadı."),{status:response.status});
  if (path==="session") previewReauth=result.previewReauth===true;
  return result;
}

function contact(clinic) {
  const note=el("section","",{className:"support"});
  note.append(el("h2","SMS almak istemiyor musunuz?"),el("p","SMS ile şifre oluşturma bağlantısı almak istemiyorsanız kliniğinizle iletişime geçebilirsiniz."));
  if (clinic?.phone && /^[+()\d -]{7,24}$/.test(clinic.phone)) {
    const p=el("p",clinic.name+" · ");
    p.append(link(clinic.phone,"tel:"+clinic.phone.replace(/[^+\d]/g,"")));
    note.append(p);
  }
  return note;
}

function previewAccounts(form) {
  const panel=el("section","",{className:"preview-guide","aria-label":"Örnek test hesapları"});
  panel.append(el("p","ÖZEL TEST ORTAMI",{className:"preview-label"}),el("h2","Örnek bir hesap seçin"),
    el("p","Hasta sahibi seçeneği örnek portalı açar. Diğer hesaplarda alanlar dolunca Giriş yap’a basın.",{className:"muted"}));
  const choices=center?[["center","Merkez yöneticisi"]]:[["dealer","Bayi yöneticisi"],["branch","Şube yöneticisi"],["staff","Personel"],["customer","Hasta sahibi"]];
  const buttons=el("div","",{className:"preview-choices"});
  for (const [role,label] of choices) {
    const button=el("button",label,{type:"button",className:"secondary"});
    button.addEventListener("click",async()=>{
      button.disabled=true;
      status.textContent="";
      try {
        const response=await fetch("/api/preview/accounts"+(center?"?center=1":""),{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role}),
        });
        const data=await response.json();
        if (!response.ok) throw Error(data.error||"Test hesabı hazırlanamadı.");
        const account=data.accounts.find(item=>item.role===role);
        form.elements[center?"email":"phone"].value=account.identifier;
        form.elements.password.value=data.password;
        if (center) form.elements.otp.value=data.otp||"";
        status.textContent=center&&!data.otp?"Yeni doğrulama kodu için 30 saniye bekleyip örnek hesabı yeniden seçin.":label+" hesabı hazır.";
        if (role==="customer") form.requestSubmit();
        else form.querySelector('button[type="submit"]').focus();
      } catch(error) {status.textContent=error.message;}
      finally {button.disabled=false;}
    });
    buttons.append(button);
  }
  panel.append(buttons,el("p","Örnek klinik ve hasta kayıtları kullanılır. Dış SMS ve e-posta gönderimi kapalıdır.",{className:"muted preview-note"}));
  const details=el("details","",{className:"preview-details"});
  details.append(el("summary","Örnek hesapla dene"),panel);
  return details;
}

const entryKind=center?"center":route==="/hasta-sahibi"?"owner":"phone";

function accessHeading(title,description,kicker) {
  mountAccessLayout(view,{kind:entryKind,appearance:config.appearance,clinic:center?null:config.clinic,logo:center?null:config.clinic?.logo,captcha:captchaBox});
  heading(title,description);
  view.prepend(el("span",kicker,{className:"access-form-kicker"}));
  status.textContent="";
  delete status.dataset.tone;
}

function phoneField() {
  const label=field("phone","Cep telefonu",{type:"tel",autocomplete:"username",placeholder:"5xx xxx xx xx",maxLength:24});
  const wrap=el("span","",{className:"access-phone"});
  const prefix=el("span","TR +90",{className:"access-phone-prefix"});
  prefix.setAttribute("aria-hidden","true");
  wrap.append(prefix,label.querySelector("input"));
  label.append(wrap);
  return label;
}

function login(mode="login") {
  const kind=center?"center":"phone";
  const activation=mode==="redeem"&&fragment[0]==="aktivasyon";
  const title=mode==="recover"?"Şifremi unuttum":mode==="redeem"?(activation?"Hesabınızı etkinleştirin":"Yeni şifre belirleyin"):
    center?"Merkez yönetici girişi":entryKind==="owner"?"Hasta sahibi girişi":"VeTNeT’e giriş";
  const description=mode==="recover"?"Şifre yenileme bağlantısı istemek için hesap bilgilerinizi girin.":
    mode==="redeem"?(activation?"İlk hesabınız için yeni şifre belirleyin. Hesabınız varsa mevcut şifrenizi kullanın.":"Hesabınız için yeni şifrenizi belirleyin."):
    center?"E-posta, şifre ve doğrulama kodunuzla devam edin.":config.clinic?.name||
    (entryKind==="owner"?"Telefon numaranız ve şifrenizle kliniğinize bağlanın.":"Bayi, şube, personel ve hasta sahibi hesapları.");
  accessHeading(title,description,center?"Merkez erişimi":entryKind==="owner"?"Hasta sahibi portalı":"Klinik erişimi");
  const username=center?field("email","E-posta",{type:"email",autocomplete:"username",placeholder:"ornek@klinik.com",maxLength:254}):phoneField();
  const otp=field("otp","Doğrulama uygulaması kodu",{inputMode:"numeric",autocomplete:"one-time-code",pattern:"[0-9]{6}",maxLength:6});
  let fields=[username,password("password","Şifre"),...(center?[otp]:[])];
  if (mode==="recover") fields=[username,...(center?[]:[field("clinic","Klinik veya bayi kodu",{value:config.clinic?.code||"",maxLength:32})])];
  if (mode==="redeem") {
    fields=[password("password","Yeni hesap şifresi","new-password",!activation)];
    if (activation) fields.push(password("currentPassword","Mevcut VeTNeT hesabınızın şifresi","current-password",false));
    if (center) fields.push(otp);
  }
  const form=makeForm(fields,mode==="recover"?"Yenileme isteği gönder":mode==="redeem"?"Onayla":"Giriş yap",async data=>{
    if (mode==="redeem") data.token=fragment[1];
    const result=await api(kind+"/"+mode,data);
    if (mode==="recover") status.textContent=result.message;
    else if (mode==="redeem") { login();status.textContent="İşlem tamamlandı. Giriş yapabilirsiniz."; }
    else if (result.destination) {
      let redirect=result.destination;
      if (!center) {
        try {if (sessionStorage.getItem("vetnet-support-email-token") && redirect==="/klinik") redirect="/klinik#bildirim-epostasi";} catch {}
      }
      location.assign(redirect);
    }
    else status.textContent="Bu telefon için aktif kurum yetkisi bulunamadı. Bayi yöneticinize başvurun.";
  });
  view.append(form,status);
  if (!center && mode==="login") {
    const phone=form.elements.phone;
    const hint=el("small","Cep telefonu numaranız kullanıcı adınızdır.",{id:"phone-username-hint",className:"access-phone-hint"});
    username.append(hint);
    phone.setAttribute("aria-describedby",hint.id);
    if (matchMedia("(pointer:fine)").matches) phone.focus({preventScroll:true});
  }
  const links=el("div","",{className:"links"});
  if (mode==="login") {
    const reset=el("button","Şifremi unuttum",{type:"button",className:"access-text-button"});
    reset.addEventListener("click",()=>{
      const identifier=form.elements[center?"email":"phone"].value;
      login("recover");
      const field=view.querySelector(center?'input[name="email"]':'input[name="phone"]');
      field.value=identifier;
      field.focus();
    });
    links.append(reset);
    if (center) links.append(link("Telefonla giriş","/giris"));
    else {
      const scope=new URLSearchParams([...params].filter(([key])=>["clinic","branch"].includes(key)));
      const target=entryKind==="owner"?"/giris":"/hasta-sahibi";
      links.append(link(entryKind==="owner"?"Klinik girişi":"Hasta sahibi girişi",target+(scope.size?"?"+scope:"")));
    }
  } else links.append(link("Girişe dön",route+location.search));
  view.append(links);
  if (config.preview && mode==="login") view.append(previewAccounts(form));
  if (!center) {
    const help=el("details");
    help.append(el("summary","Aktivasyon yardımı"),el("p","İlk giriş için kliniğinizden tek kullanımlık aktivasyon bağlantısı alın."));
    view.append(help,contact(config.clinic));
  }
}

async function logout() {
  await api("logout",{});
  location.assign(center?"/yonetim":"/giris");
}

function logoutButton() {
  const button=el("button","Güvenli çıkış",{type:"button",className:"secondary"});
  button.addEventListener("click",()=>logout().catch(error=>{status.textContent=error.message;}));
  return button;
}

async function workspaceChoice() {
  const session=await api("session");
  if (session.kind==="center") {location.assign("/yonetim");return;}
  accessHeading("Kurum ve rol seçin","Yalnızca erişiminizin onaylandığı üyelikler listelenir.","Çalışma alanı");
  const list=el("div","",{className:"stack"});
  if (!session.members.length) list.append(el("p","Aktif üyeliğiniz bulunmuyor. Kliniğinizle iletişime geçin."));
  for (const member of session.members) {
    const button=el("button",[member.partner,member.branch,roles[member.role]].filter(Boolean).join(" · "),{type:"button",className:"secondary"});
    button.addEventListener("click",async()=>{
      button.disabled=true;
      try {
        await api("select",{membershipId:member.id});
        let destination=member.role==="customer"?"/hasta-sahibi":"/klinik";
        try {if(destination==="/klinik"&&sessionStorage.getItem("vetnet-support-email-token"))destination="/klinik#bildirim-epostasi";} catch {}
        location.assign(destination);
      } catch(error) {status.textContent=error.message;button.disabled=false;}
    });
    list.append(button);
  }
  view.append(list,status,el("div","",{className:"links"}));
  view.lastChild.append(logoutButton());
}

function group(title,rows) {
  const section=el("article");
  section.append(el("h2",title));
  if (!rows.length) section.append(el("p","Kayıt bulunmuyor.",{className:"muted"}));
  else {
    section.append(paginate(rows,visible=>{const list=el("ul");list.append(...visible.map(row=>el("li",row)));return list;}));
  }
  return section;
}

function dateText(value) {
  if (!value) return "—";
  const date=new Date(value+"T12:00:00Z");
  return Number.isNaN(date.valueOf())?"—":new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeZone:"Europe/Istanbul"}).format(date);
}

function vaccinePortal(rows,names) {
  const section=el("article");
  section.append(el("h2","Aşı takvimim"),el("p","Yaklaşıyor durumu, önümüzdeki 7 gün içindeki aşıları gösterir.",{className:"muted"}));
  const filters=el("div","",{className:"identity-filters"});
  const stateFilter=selectField("vaccine-status","Durum",[["","Tümü"],...Object.entries(vaccineLabels)]);
  const petFilter=selectField("vaccine-pet","Hayvan",[["","Tümü"],...names]);
  filters.append(stateFilter,petFilter);
  const graph=el("div","",{className:"identity-metrics","aria-label":"Aşı durumlarına göre dağılım"});
  for (const [key,label] of Object.entries(vaccineLabels)) {
    const count=rows.filter(row=>row.status===key).length;
    const card=el("div","",{className:"identity-metric "+key});
    card.append(el("strong",String(count)),el("span",label),
      el("meter","",{min:0,max:Math.max(rows.length,1),value:count,ariaLabel:label+": "+count}));
    graph.append(card);
  }
  const results=el("div","",{className:"stack vaccine-portal-list"});
  function render() {
    const statusKey=stateFilter.querySelector("select").value, pet=petFilter.querySelector("select").value;
    const shown=rows.filter(row=>(!statusKey || row.status===statusKey) && (!pet || row.patient===pet));
    results.replaceChildren();
    if (!shown.length) results.append(el("p","Bu seçimde aşı kaydı yok.",{className:"muted"}));
    for (const row of shown) {
      const card=el("div","",{className:"vaccine-portal-row"});
      const detail=el("div");
      detail.append(el("h3",row.title),el("p",names.get(row.patient)||"",{className:"muted"}));
      const dates=el("div","",{className:"vaccine-dates"});
      dates.append(el("span","Planlanan: "+dateText(row.scheduledAt)),
        el("span",row.status==="done"&&!row.administeredAt?"Uygulama tarihi girilmemiş":"Uygulama: "+dateText(row.administeredAt)));
      card.append(detail,el("span",vaccineLabels[row.status],{className:"identity-pill "+row.status}),dates);
      results.append(card);
    }
  }
  filters.addEventListener("change",render);
  section.append(graph,filters,results);
  render();
  return section;
}

async function portal() {
  const [data,session]=await Promise.all([api("portal"),api("session")]);
  heading("Merhaba, "+data.name,[data.clinic.partner,data.clinic.branch].filter(Boolean).join(" · "));
  const names=new Map(data.pets.map(row=>[row.id,row.name]));
  const pets=el("section","",{className:"identity-card"});
  pets.append(el("h2","Hayvanlarım"));
  const petGrid=el("div","",{className:"portal-pet-grid"});
  for (const row of data.pets) {
    const portrait=petPortrait(row), card=el("article","",{className:"portal-pet"});
    if (portrait) card.append(el("img","",{src:portrait.src,alt:portrait.label,loading:"lazy",width:64,height:64}));
    const label=el("div");
    label.append(el("h3",row.name),el("p",[row.species,row.breed].filter(Boolean).join(" · ")));
    if (portrait?.sample) label.append(el("small","Temsili görsel"));
    card.append(label);
    petGrid.append(card);
  }
  pets.append(data.pets.length?petGrid:el("p","Bağlı hasta kaydı yok."));
  view.append(pets);
  if (data.sections.vaccines) view.append(vaccinePortal(data.vaccines,names));
  if (data.sections.appointments) view.append(group("Randevularım",data.appointments.map(row=>[dateText(row.date),row.time,names.get(row.patient),row.service,row.status].filter(Boolean).join(" · "))));
  if (data.sections.shares) view.append(group("Kliniğin paylaştığı bilgiler",data.shared.map(row=>({exam:"Muayene",treatment:"Tedavi",document:"Belge",notice:"Bildirim"})[row.category]+" · "+row.summary)));
  view.append(contact({name:data.clinic.branch||data.clinic.partner,phone:data.clinic.phone}));
  const links=el("div","",{className:"links"});
  if (session.members.length>1) links.append(link("Kurum değiştir","/giris?kurum=1"));
  links.append(logoutButton());
  view.append(links);
}

function reauth(centerAccount) {
  if (previewReauth) return el("p","Örnek hesap · Test doğrulaması otomatik",{className:"preview-label"});
  const detail=el("details");
  detail.append(el("summary","Kimliği yeniden doğrula"));
  const fields=[password("password","Mevcut şifre")];
  if (centerAccount) fields.push(field("otp","Yeni doğrulama kodu",{inputMode:"numeric",autocomplete:"one-time-code",pattern:"[0-9]{6}",maxLength:6}));
  detail.append(makeForm(fields,"Doğrula",async (data,form)=>{
    await api("reauth",data);
    form.reset();
    detail.open=false;
    status.textContent="Kimliğiniz doğrulandı. Yetkili işlemleri beş dakika boyunca yapabilirsiniz.";
  }));
  return detail;
}

function inviteCenterDealer(data) {
  const method=selectField("method","Aktivasyon yöntemi",[["sms","SMS bağlantısı"],["in-person","Yüz yüze kimlik doğrulaması"]]);
  const approval=field("verifiedInPerson","Kimliği yüz yüze doğruladım",{type:"checkbox",required:false});
  const select=method.querySelector("select");
  const sync=()=>{approval.hidden=select.value!=="in-person";};
  select.addEventListener("change",sync);
  sync();
  return makeForm([field("name","Ad ve soyad",{maxLength:160,required:false}),
    field("phone","Cep telefonu (+90)",{type:"tel",value:data.phone||"",maxLength:24}),method,approval,
    field("reopen","Kapalı üyeliği yeniden aç ve aktivasyon gönder",{type:"checkbox",required:false})],"Üyelik aç ve aktivasyonu başlat",async input=>{
    const result=await api("invite",{...input,role:"dealer",partnerId:data.partnerId,verifiedInPerson:input.verifiedInPerson==="on",reopen:input.reopen==="on",modules:{}});
    await centerManagement();
    if (result.link) status.replaceChildren("Bağlantıyı yalnızca kimliği doğrulanan kişiye iletin. ",link("Tek kullanımlık aktivasyon bağlantısı",result.link));
    else status.textContent=outcomes[result.status]||"İşlem kaydedildi.";
  });
}

const tl=cents=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(cents/100);

function centerCash(partner,branch) {
  const box=el("details");
  box.append(el("summary","Kasa özetini görüntüle"));
  const results=el("div");
  const read=async (range="month",start,end)=>{
    const query=new URLSearchParams({partner,view:"cash",range,...(branch?{branch}:{}),...(range==="custom"?{start,end}:{})});
    const data=await api("center-directory?"+query);
    box.querySelector('input[name="start"]').value=data.start;
    box.querySelector('input[name="end"]').value=data.end;
    results.replaceChildren(el("p",dateText(data.start)+" – "+dateText(data.end),{className:"muted"}));
    const metrics=el("div","",{className:"identity-metrics"});
    for (const [label,value] of [["Giriş",data.income],["Çıkış",data.expense],["Net",data.income-data.expense]]) {
      const card=el("div","",{className:"identity-metric"});
      card.append(el("strong",tl(value)),el("span",label));
      metrics.append(card);
    }
    results.append(metrics);
    if (!data.days.length) results.append(el("p","Bu aralıkta kasa hareketi yok.",{className:"muted"}));
    const scale=Math.max(1,...data.days.flatMap(row=>[row.income,row.expense]));
    for (const day of data.days) {
      const line=el("div","",{className:"cash-graph-row"});
      line.append(el("strong",data.monthly?day.date.slice(0,7):dateText(day.date)));
      for (const [label,value] of [["Giriş",day.income],["Çıkış",day.expense]]) {
        const cell=el("div");
        cell.append(el("span",label+" "+tl(value)),el("meter","",{min:0,max:scale,value,ariaLabel:label}));
        line.append(cell);
      }
      results.append(line);
    }
  };
  const range=selectField("range","Dönem",[["month","Bu ay"],["week","Bu hafta"],["year","Bu yıl"],["all","Tüm zamanlar"],["custom","Tarih aralığı"]]);
  const from=field("start","Başlangıç",{type:"date",required:false}), to=field("end","Bitiş",{type:"date",required:false});
  from.hidden=to.hidden=true;
  range.addEventListener("change",()=>{from.hidden=to.hidden=range.querySelector("select").value!=="custom";});
  box.append(makeForm([range,from,to],"Dönemi göster",data=>read(data.range,data.start,data.end)),results);
  box.addEventListener("toggle",()=>{if (box.open && !results.childElementCount) read().catch(error=>{status.textContent=error.message;});});
  return box;
}

function dealerEditor(session,organization=null) {
  const details=el("details");
  details.append(el("summary",organization?"Bayi bilgilerini düzenle":"Yeni bayi oluştur"));
  const keys=[["name","Bayi adı"],["code","Bayi kodu"],["email","E-posta"],["contact","Yetkili"],["phone","Telefon"],["city","İl"]];
  const fields=keys.map(([key,title])=>field(key,title,{value:organization?.[key]||"",required:["name","code","email"].includes(key),type:key==="email"?"email":key==="phone"?"tel":"text"}));
  fields.push(field("active","Bayi aktif",{type:"checkbox",checked:organization?Boolean(organization.active):true,required:false}));
  details.append(makeForm(fields,"Bayiyi kaydet",async input=>{
    const response=await fetch("/api/dealer/partners"+(organization?"/"+encodeURIComponent(organization.id):""),{
      method:"POST",headers:{"Content-Type":"application/json","X-VeTNet-Scope":session.scopeId},
      body:JSON.stringify({...input,active:input.active==="on"}),
    });
    const result=await response.json();
    if (!response.ok) throw Error(result.error||"Bayi kaydedilemedi.");
    location.assign("/yonetim?partner="+encodeURIComponent(result.id));
  }));
  return details;
}

async function centerDirectoryArea(area,partner,branch,permissions) {
  const query=new URLSearchParams({partner,...(branch?{branch}:{})});
  const data=await api("center-directory?"+query);
  const org=data.organization;
  const card=el("section","",{className:"center-card"});
  card.append(el("h3",org.name),el("p",[org.code,org.city,org.active?"Aktif":"Pasif"].filter(Boolean).join(" · "),{className:"muted"}));
  if (permissions.edit) card.append(dealerEditor(await api("session"),org));
  if (permissions.edit && org.active && !branch) {
    const invite=el("details");
    invite.append(el("summary","Bayi yöneticisini davet et"),inviteCenterDealer({partnerId:org.id,phone:org.phone}));
    card.append(invite);
  }
  const branches=selectField("center-branch","Kullanıcı listesi için şube",[["","Bütün şubeler"],...data.branches.map(row=>[row.id,row.name+(row.status==="Pasif"?" · Pasif":"")])]);
  const select=branches.querySelector("select");
  select.value=branch||"";
  select.addEventListener("change",()=>location.assign("/yonetim?tab=bayiler&partner="+encodeURIComponent(partner)+(select.value?"&branch="+encodeURIComponent(select.value):"")));
  card.append(branches,group("Kullanıcılar",data.members.map(row=>[row.name||row.phone,roles[row.role],data.branches.find(item=>item.id===row.branch_id)?.name,
    {active:"Aktif",pending:"Beklemede",revoked:"Kapalı"}[row.status]].filter(Boolean).join(" · "))));
  if (permissions.finance) card.append(centerCash(partner,branch));
  area.append(card);
}

const suiteUi={view,heading,el,field,selectField,makeForm,link,status,logoutButton,reauth,dealerEditor,directory:centerDirectoryArea,session:()=>api("session")};

async function centerManagement() {
  const session=await api("session");
  if (session.kind!=="center") {login();return;}
  await mountCenterSuite(suiteUi,session);
}

async function centerEnrollment() {
  const token=fragment[1];
  const data=await opsFetch("/api/ops/enroll",{token,action:"view"});
  accessHeading("Yardımcı yönetici hesabı oluştur",data.email,"Merkez hesabı aktivasyonu");
  const code=el("p",data.secret,{className:"enroll-secret"});
  view.append(el("p","Doğrulama uygulamanıza bu kurulum anahtarını ekleyin. Zamana bağlı, 6 haneli kod kullanın."),code);
  view.append(makeForm([password("password","Yeni şifre","new-password"),
    field("otp","Doğrulama uygulaması kodu",{inputMode:"numeric",pattern:"[0-9]{6}",maxLength:6})],"Hesabı etkinleştir",async input=>{
    await opsFetch("/api/ops/enroll",{...input,token,action:"complete"});
    login();status.textContent="Hesap etkinleştirildi. Yeni doğrulama koduyla giriş yapın.";
  }),status);
}
if (route==="/iletisim") {
  if (fragment[0]==="dogrula" && fragment[1]) {
    try {sessionStorage.setItem("vetnet-support-email-token",fragment[1]);} catch {}
  }
  location.replace("/klinik#bildirim-epostasi");
} else try {
  const query=new URLSearchParams();
  for (const key of ["clinic","branch"]) if (params.has(key)) query.set(key,params.get(key));
  const [identityConfig,appearance]=await Promise.all([api("config?"+query),loadAppearance()]);
  config={...identityConfig,appearance};
  if (appearance.palette) document.body.dataset.identityPalette=appearance.palette;
  if (config.clinic?.logo && !center) {
    const logo=document.querySelector(".identity-brand img");
    logo.src=config.clinic.logo;
    logo.alt=config.clinic.name;
  }
  if (route==="/giris" && fragment[0]==="bildirim-epostasi" && /^[a-f0-9]{64}$/.test(fragment[1]||"")) {
    try {
      sessionStorage.setItem("vetnet-support-email-token",fragment[1]);
      const session=await api("session");
      if(session.active?.role==="dealer")location.replace("/klinik#bildirim-epostasi");
      else login();
    } catch {login();}
  }
  else if (center && fragment[0]==="davet" && fragment[1]) await centerEnrollment();
  else if (route==="/hasta-sahibi") {
    try {await portal();} catch(error) {if(error.status===401) login();else throw error;}
  }
  else if (fragment[1] && ["aktivasyon","yenile"].includes(fragment[0])) login("redeem");
  else if (center) {
    try { await centerManagement(); } catch(error) {if (error.status===401) login();else throw error;}
  } else if (params.has("kurum")) {
    try { await workspaceChoice(); } catch { login(); }
  } else login();
} catch(error) {
  if (["/giris","/yonetim","/hasta-sahibi","/merkez-giris"].includes(route) && !document.body.classList.contains("center-suite")) {
    accessHeading("VeTNeT erişimi",error.message,"Hesap erişimi");
  } else heading("VeTNeT erişimi",error.message);
  view.append(link("Giriş ekranı","/giris"));
}
