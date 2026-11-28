import {clinicFetch} from "./access.js?v=20261127-r66";
import {mountClinicAccounts} from "./clinic-accounts-ui.js?v=r78";
import {mountTemplates} from "./clinic-tools-ui.js?v=2";
import {mountCreditShop} from "./center-shop.js?v=7";
import {opsFetch} from "./center-ops.js";
import {mountReleaseHistory} from "./release-history.js?v=2";

function el(tag,text="",properties={}) {
  const node=document.createElement(tag);
  node.textContent=text;
  Object.assign(node,properties);
  return node;
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


function workspaceUi(root) {
  const view=el("div","",{className:"suite-content"});
  const status=el("p","",{className:"suite-status",role:"status"});
  root.replaceChildren(status,view);
  function heading(title,description="") {
    const header=el("header","",{className:"suite-heading"});
    header.append(el("div","KLİNİK ÇALIŞMA ALANI",{className:"eyebrow"}),el("h1",title));
    if (description) header.append(el("p",description));
    view.replaceChildren(header);
  }
  async function api(path,body) {
    const response=await clinicFetch("/api/identity/"+path,body===undefined?{}:{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    });
    const result=await response.json();
    if (!response.ok) throw Error(result.error||"İşlem tamamlanamadı.");
    return result;
  }
  function makeForm(fields,text,action) {
    const form=el("form","",{className:"suite-form"});
    const submit=formButton(text);
    submit.className="button primary";
    const errorLine=el("p","",{className:"suite-form-error",role:"alert"});
    form.append(...fields,submit,errorLine);
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if (submit.disabled) return;
      errorLine.textContent="";
      status.textContent="";
      submit.disabled=true;
      try {await action(Object.fromEntries(new FormData(form)),form);}
      catch(error) {errorLine.textContent=error.message;}
      finally {submit.disabled=false;}
    });
    return form;
  }
  function reauth(preview) {
    if (preview) return el("p","Test hesabı · Kimlik doğrulaması etkin",{className:"suite-muted"});
    const details=el("details","",{className:"suite-reauth"});
    const input=password("password","Mevcut şifre");
    details.append(el("summary","Kimliği yeniden doğrula"),makeForm([input],"Doğrula",async(values,form)=>{
      await api("reauth",values);
      form.reset();
      details.open=false;
      status.textContent="Kimliğiniz doğrulandı. Hassas işlemler beş dakika boyunca kullanılabilir.";
    }));
    return details;
  }
  return {view,heading,el,field,selectField,makeForm,link,status,api,reauth};
}

export async function mountClinicSuite(root,page,{id,ref,branch,preview,scope}) {
  const ui=workspaceUi(root);
  const {view,heading,status,api,reauth,makeForm}=ui;
  status.textContent="Yükleniyor…";
  const loading=status.firstChild;
  try {
    if (page==="personel-plani") {
      const {mountStaffPlan}=await import("./staff-plan.js?v=r69");
      await mountStaffPlan(ui,scope);
    } else if (page==="cikti-sablonlari") {
      const params=new URLSearchParams();
      if (["patient","client","vaccine","sale","exam","stay","surgery","purchase"].includes(id) && ref) params.set(id,ref);
      await mountTemplates(ui,params,{branch,preview,scope});
    } else if (page==="hesaplayicilar") {
      const {mountCalculators}=await import("./clinic-calculators.js?v=1");
      mountCalculators(ui,{weight:id==="kilo"&&/^[0-9]+([.,][0-9]+)?$/.test(ref||"")?ref:""});
    } else if (page==="merkezi-hesaplar") {
      await mountClinicAccounts(ui,new URLSearchParams(ref&&id==="musteri"?{customer:ref}:{}));
    } else if (page==="kredi-magazasi") await mountCreditShop(ui,{section:id});
    else if (page==="son-degisiklikler") {
      heading("Son Değişiklikler","VetZimo sürüm notları ve paket güncellemeleri");
      const target=el("section");
      view.append(target);
      await mountReleaseHistory(target);
    } else if (page==="bildirim-epostasi") {
      let token=id||"";
      try {token=token||sessionStorage.getItem("vetnet-support-email-token")||"";} catch {}
      if (token) {
        try {
          await opsFetch("/api/ops/contact/verify",{token},scope);
          status.textContent="Bildirim e-postası doğrulandı.";
        } catch(error) {
          status.textContent=error.message;
        } finally {
          if(id)history.replaceState(null,"","#bildirim-epostasi");
          try {sessionStorage.removeItem("vetnet-support-email-token");} catch {}
        }
      }
      const contact=await opsFetch("/api/ops/contact");
      heading("Bildirim e-postası","Destek yanıtı e-postalarını almak için adresinizi doğrulayın.");
      view.append(reauth(preview));
      if(contact.smtpEnabled===false)view.append(el("p","Doğrulama bağlantısı için merkez yönetiminde SMTP bağlantısını etkinleştirin.",{className:"suite-muted"}));
      if (contact.email) view.append(el("p","Doğrulanmış adres · "+contact.email));
      if (contact.pending_email) view.append(el("p","Doğrulama bekleniyor · "+contact.pending_email,{className:"suite-muted"}));
      view.append(makeForm([field("email","E-posta adresi",{type:"email",maxLength:254})],"Doğrulama bağlantısını gönder",async input=>{
        const result=await opsFetch("/api/ops/contact",input,scope);
        status.textContent=result.status==="accepted"?"Doğrulama bağlantısı e-postaya gönderildi.":"E-posta gönderilemedi. Sağlayıcı ayarını kontrol edin.";
      }));
    } else if (page==="kurum-sec") {
      const session=await api("session");
      heading("Çalışma alanını değiştir","Yalnızca onaylı kurum üyelikleriniz listelenir.");
      for (const member of session.members) {
        const button=el("button",[member.partner,member.branch,{dealer:"Bayi yöneticisi",branch:"Şube yöneticisi",staff:"Personel",customer:"Hasta sahibi"}[member.role]].filter(Boolean).join(" · "),{type:"button",className:"button"});
        button.disabled=member.id===session.scopeId;
        button.addEventListener("click",async()=>{
          button.disabled=true;
          try {
            await api("select",{membershipId:member.id});
            let hash="";
            try {if(sessionStorage.getItem("vetnet-support-email-token"))hash="#bildirim-epostasi";} catch {}
            location.assign(member.role==="customer"?"/hasta-sahibi":location.pathname+hash);
          } catch(error) {status.textContent=error.message;button.disabled=false;}
        });
        view.append(button);
      }
    }
    if (status.firstChild===loading) status.textContent="";
  } catch(error) {status.textContent=error.message;}
}
