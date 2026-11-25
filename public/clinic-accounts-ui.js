import {permissionMatrix} from "./permission-matrix.js";
import {actionNames} from "./access.js";
import {paginate} from "./paged.js";

const roles={branch:"Şube yöneticisi",staff:"Personel",customer:"Hasta sahibi"};
const outcomes={active:"Personel hesabı etkin. Telefon ve belirlediğiniz şifre ile giriş yapılabilir.",email_sent:"Tek kullanımlık şifre belirleme bağlantısı e-posta ile gönderildi.",sent:"SMS sağlayıcısı gönderimi kabul etti.",delivery_unknown:"SMS sonucu henüz doğrulanamadı.",provider_pending:"Üyelik beklemede. SMS sağlayıcısı kullanılabilir olduğunda tekrar deneyin.",credit_pending:"Üyelik beklemede. Bayi bakiyesi ve gönderim limitlerini kontrol edin.",quota_pending:"Üyelik beklemede. Gönderim kotası doldu.",wait:"Bir aktivasyon zaten beklemede. Beş dakika sonra yeniden deneyebilirsiniz."};
const memberStatus={pending:"Aktivasyon bekliyor",active:"Aktif",revoked:"Kapatıldı"};
const rolePresets={reception:{appointments:"write",clients:"write",patients:"read",followups:"read"},clinical:{appointments:"read",clients:"read",patients:"write",followups:"write"},inventory:{products:"write",reports:"read"}};
// Yeni özellikler (sunucu ClinicAccess::FEATURES): paket açıksa varsayılan olarak verilir, buradan kapatılabilir.
const featureNames={inbox:"Gelen kutusu (tüm kanallar)",phoneGateway:"Telefon bağlantısı (kendi hattından SMS/WhatsApp)",reminders:"Otomatik hatırlatmalar",bulkMessages:"Toplu mesaj",
  permits:"Müşteri onay formu (KVKK ve ileti izni)",consents:"Dijital onam ve imza",edocs:"e-Fatura / e-Arşiv / e-SMM",bridge:"Bakanlık köprüsü (e-Reçete ve aşı)",
  icu:"Yoğun bakım panosu",surgery:"Ameliyat modülü",homeCare:"Evden takip",homeVisit:"Eve hizmet",webSite:"Web sitesi ve web mesajları",onlineBooking:"Web randevu",
  vebot:"VeBot asistan",voice:"Sesli komut",xray:"Röntgen yapay zekâ yorumu",dicom:"DICOM görüntüleyici",labAi:"Laboratuvar yorum desteği",calculators:"Klinik hesaplayıcılar",
  taskBoard:"İş takibi panosu",commission:"Prim raporu",debtReminders:"Borç hatırlatma",bulkPrice:"Toplu fiyat ve Excel",invoiceImport:"Faturadan stok",okc:"Yazar kasa (ÖKC)"};
const moduleNames={esmm:"e-SMM portal erişimi",appointments:"Randevu görüntüleme ve düzenleme",clients:"Müşteriler ve belgeler",patients:"Hastalar ve muayeneler",followups:"Aşı ve takip",sales:"Satışlar",products:"Ürünler ve stok",expenses:"Kasa ve muhasebe görüntüleme ve düzenleme",reports:"Raporları görüntüleme",messages:"Mesajlar",support:"Destek",overviewClients:"Genel Bakış · Tüm Kayıtlı Müşteriler",overviewPatients:"Genel Bakış · Tüm Kayıtlı Hastalar"};


export async function mountClinicAccounts(ui,params) {
  const {view,heading,el,link,field,selectField,makeForm,status,reauth,api}=ui;
  function brandForm(partnerId) {
    const details=el("details","",{className:"suite-reauth"});
    const upload=field("logo","Klinik logosu",{type:"file",accept:"image/jpeg,image/png,image/webp"});
    details.append(el("summary","Giriş ekranı logosu"),makeForm([upload],"Logoyu kaydet",async input=>{
      if (!input.logo?.size || input.logo.size>5_000_000) throw Error("En fazla 5 MB boyutunda bir görsel seçin.");
      const image=await createImageBitmap(input.logo);
      const size=Math.min(1,320/Math.max(image.width,image.height));
      const canvas=el("canvas","",{width:Math.max(1,Math.round(image.width*size)),height:Math.max(1,Math.round(image.height*size))});
      const drawing=canvas.getContext("2d");
      drawing.fillStyle="#fff";
      drawing.fillRect(0,0,canvas.width,canvas.height);
      drawing.drawImage(image,0,0,canvas.width,canvas.height);
      image.close();
      await api("brand",{partnerId,logo:canvas.toDataURL("image/jpeg",0.82)});
      status.textContent="Logo kaydedildi.";
    }));
    const remove=el("button","Logoyu kaldır",{type:"button",className:"button"});
    remove.addEventListener("click",async()=>{
      try {await api("brand",{partnerId,logo:""});status.textContent="Logo kaldırıldı.";}
      catch(error) {status.textContent=error.message;}
    });
    details.append(remove);
    return details;
  }

  const customerSections={vaccines:"Aşı takvimi",appointments:"Randevular",shares:"Bildirimler",exam:"Muayene özetleri",lab:"Laboratuvar fotoğrafları",xray:"Röntgen fotoğrafları",homeCare:"Evden takip (gözlem gönderme)",balance:"Borç / bakiye bilgisi",documents:"İmzalı onam ve izin belgeleri"};
  const customerDefaults={homeCare:"read",balance:"read",documents:"read"};

  function moduleFields(current={},customer=false) {
    return permissionMatrix({el,selectField,modules:customer?customerSections:{...moduleNames,...actionNames,...featureNames},current:customer?{...customerDefaults,...current}:{...Object.fromEntries(Object.keys(featureNames).map(k=>[k,"write"])),...current},
      readOnly:customer,initial:customer?"read":"none",title:customer?"Hasta sahibi portalı":"Modül erişim tablosu",
      presets:customer?{}:{
        reception:{label:"Resepsiyon",values:rolePresets.reception},
        clinical:{label:"Klinik ekibi",values:rolePresets.clinical},
        inventory:{label:"Stok sorumlusu",values:rolePresets.inventory},
      },
    });
  }

  const readModules=data=>Object.fromEntries(Object.entries(data).filter(([name,value])=>name.startsWith("module-")).map(([name,value])=>[name.slice(7),value]));

  const activeBranches=data=>data.branches.filter(row=>row.status!=="Pasif");
  function inviteForm(data) {
    const branches=activeBranches(data);
    const quota=data.quotas;
    const allowed=[...(quota?.userCap?(quota.branchCap?["branch","staff"]:["staff"]):[]),"customer"];
    const quotaFull=!quota?.unlimitedUsers && quota?.userCap>0 && quota.users>=quota.userCap;
    const role=selectField("role","Hesap türü",allowed.map(key=>[key,roles[key]]));
    const branch=selectField("branchId","Şube",[["","Şube seçin"],...branches.map(row=>[row.id,row.name])]);
    const customer=selectField("customerId","Müşteri",[["","Müşteri seçin"]]);
    const phone=field("phone","Cep telefonu (+90)",{type:"tel",maxLength:24});
    const name=field("name","Ad ve soyad",{maxLength:160,required:false});
    const method=selectField("method","Aktivasyon yöntemi",[["sms","SMS bağlantısı"],["in-person","Yüz yüze kimlik doğrulaması"]]);
    const mode=method.querySelector("select");
    const email=field("email","Personel e-postası",{type:"email",maxLength:254});
    const password=field("password","Personel şifresi · en az 12 karakter",{type:"password",minLength:12,maxLength:128,autocomplete:"new-password"});
    const generate=el("button","Güçlü şifre oluştur",{type:"button",className:"button"});
    generate.addEventListener("click",()=>{
      const bytes=crypto.getRandomValues(new Uint8Array(15));
      const input=password.querySelector("input");
      input.value=Array.from(bytes,n=>n.toString(16).padStart(2,"0")).join("");
      input.type="text";
      input.select();
    });
    const visitHint=el("p","Saha görevi için Randevular iznini seçin ve personeli Evde Hizmet ayarlarında yetkilendirin.",{className:"muted"});
    visitHint.append(" ",link("Evde Hizmet ayarları","/clinic#evde-hizmet/ayarlar"));
    const approval=field("verifiedInPerson","Kimliği yüz yüze doğruladım",{type:"checkbox",required:false});
    const modules=moduleFields(), portalModules=moduleFields({},true);
    const reopen=field("reopen","Kapalı üyeliği yeniden aç ve aktivasyon gönder",{type:"checkbox",required:false});
    const summary=quota?.userCap?el("p",quota.users+" / "+(quota.unlimitedUsers?"SINIRSIZ":quota.userCap)+" ekip hesabı. "+(quotaFull?"Kota dolu. Yalnızca mevcut ekip hesaplarına yeni üyelik verilebilir.":"Bekleyen davetler kotaya dahildir."),{className:"muted"}):null;
    const form=makeForm([...(summary?[summary]:[]),role,branch,customer,name,phone,method,email,password,generate,approval,reopen,visitHint,modules,portalModules],"Üyelik aç ve aktivasyonu başlat",async input=>{
      const result=await api("invite",{...input,partnerId:data.partnerId,verifiedInPerson:input.verifiedInPerson==="on",reopen:input.reopen==="on",modules:readModules(input)});
      await management();
      if (result.link) {
        status.replaceChildren(result.status==="email_failed"?"E-posta gönderilemedi. Personel üyeliği oluşturuldu. ":"",
          link("Tek kullanımlık aktivasyon bağlantısı",result.link));
      } else status.textContent=outcomes[result.status]||"İşlem kaydedildi.";
    });
    const roleSelect=role.querySelector("select"), branchSelect=branch.querySelector("select"), customerSelect=customer.querySelector("select");
    const phoneInput=phone.querySelector("input");
    const target=params.get("customer");
    const direct=target?data.clients.find(row=>row.id===target):null;
    function customerOptions() {
      const selected=customerSelect.value;
      customerSelect.replaceChildren(el("option","Müşteri seçin",{value:""}),...data.clients.filter(row=>row.branch===(data.branches.find(item=>item.id===branchSelect.value)?.sharedWith||branchSelect.value) && row.phone).map(row=>el("option",row.name,{value:row.id})));
      if (Array.from(customerSelect.options).some(option=>option.value===selected)) customerSelect.value=selected;
    }
    function sync() {
      const selected=roleSelect.value;
      branch.hidden=selected==="dealer" || branches.length===1;
      branchSelect.required=!branch.hidden;
      if (branches.length===1) {branchSelect.value=branches[0].id;customerOptions();}
      customer.hidden=selected!=="customer";customerSelect.required=!customer.hidden;
      name.hidden=selected==="customer";
      modules.hidden=!["branch","staff"].includes(selected);modules.disabled=modules.hidden;
      portalModules.hidden=selected!=="customer";portalModules.disabled=portalModules.hidden;
      const staffSetup=data.staffSetup&&selected==="staff";
      const available=staffSetup?[["staff-password","Şifre belirle ve hesabı aç"],["staff-email","Tek kullanımlık e-posta bağlantısı"],["in-person","Yüz yüze aktivasyon"]]:
        [["sms","SMS bağlantısı"],["in-person","Yüz yüze kimlik doğrulaması"]];
      const selectedMode=mode.value;
      mode.replaceChildren(...available.map(([value,label])=>el("option",label,{value})));
      mode.value=available.some(([value])=>value===selectedMode)&&!(staffSetup&&selectedMode==="sms")?selectedMode:available[0][0];
      approval.hidden=mode.value!=="in-person";
      visitHint.hidden=!staffSetup;
      email.hidden=mode.value!=="staff-email";
      password.hidden=generate.hidden=mode.value!=="staff-password";
      for (const wrapper of [email,password]) {
        const input=wrapper.querySelector("input");
        input.disabled=wrapper.hidden;input.required=!wrapper.hidden;
      }
      form.querySelector('button[type="submit"]').textContent=staffSetup?"Personel oluştur":"Üyelik aç ve aktivasyonu başlat";
    }
    const syncPhone=()=>{if (roleSelect.value==="customer") phoneInput.value=data.clients.find(row=>row.id===customerSelect.value)?.phone||"";};
    roleSelect.addEventListener("change",()=>{sync();syncPhone();});
    branchSelect.addEventListener("change",()=>{customerOptions();syncPhone();});
    customerSelect.addEventListener("change",syncPhone);
    method.querySelector("select").addEventListener("change",sync);
    if (direct) {
      roleSelect.value="customer";
      branchSelect.value=direct.branch;
      customerOptions();
      customerSelect.value=direct.id;
      syncPhone();
    }
    sync();
    return form;
  }

  function memberCard(row,data) {
    const details=el("section","",{className:"panel suite-panel"});
    const top=el("header","",{className:"suite-toolbar"});
    const title=el("div");
    title.append(el("h2",row.name||row.phone,{tabIndex:-1}),el("p",[roles[row.role],data.branches.find(item=>item.id===row.branch_id)?.name,memberStatus[row.status]].filter(Boolean).join(" · "),{className:"suite-muted"}));
    const back=el("button","Üyelik listesine dön",{type:"button",className:"button"});
    back.addEventListener("click",()=>{details.parentElement.previousElementSibling.hidden=false;details.parentElement.replaceChildren();});
    top.append(title,back);details.append(top);
    const controls=el("div","",{className:"links"});
    if (row.status!=="revoked") {
      const revoke=el("button","Üyeliği kapat",{type:"button",className:"button"});
      revoke.addEventListener("click",async()=>{
        if (!window.confirm("Bu kurum üyeliği kapatılsın mı?")) return;
        try { await api("revoke",{membershipId:row.id});await management();status.textContent="Üyelik kapatıldı."; }
        catch(error) {status.textContent=error.message;}
      });
      controls.append(revoke);
    }
    const remove=el("button","Üyeliği sil",{type:"button",className:"button danger-outline"});
    remove.addEventListener("click",async()=>{
      if (!window.confirm("Bu kurum üyeliği kalıcı olarak silinsin mi?")) return;
      remove.disabled=true;
      try { await api("delete",{membershipId:row.id,confirm:true});await management();status.textContent="Üyelik silindi."; }
      catch(error) {status.textContent=error.message;remove.disabled=false;}
    });
    controls.append(remove);
    details.append(controls);
    const edit=el("details","",{className:"suite-reauth"});
    const memberName=field("name","Üyelik adı",{maxLength:160,value:row.name,required:true});
    const editableBranches=activeBranches(data);
    const memberBranch=selectField("branchId","Şube",editableBranches.map(item=>[item.id,item.name]));
    memberBranch.querySelector("select").value=editableBranches.length===1?editableBranches[0].id:row.branch_id;
    memberBranch.hidden=editableBranches.length===1;
    edit.append(el("summary","Üyelik bilgilerini düzenle"),makeForm([memberName,...(row.role==="customer"?[]:[memberBranch])],"Üyeliği güncelle",async input=>{
      await api("edit",{membershipId:row.id,...input});
      await management();
      status.textContent="Üyelik güncellendi.";
    }));
    details.append(edit);
    if (row.status!=="revoked") details.append(makeForm([moduleFields(row.role==="branch" && row.modules==="{}"?Object.fromEntries(Object.keys(moduleNames).map(key=>[key,key==="esmm"?"none":"write"])):JSON.parse(row.modules),row.role==="customer")],"İzinleri kaydet",async input=>{
      await api("permissions",{membershipId:row.id,modules:readModules(input)});
      await management();
      status.textContent="İzinler güncellendi.";
    }));
    if (row.role==="customer" && row.status==="active") {
      const picker=selectField("record","Paylaşılacak kayıt",[["notice/","Bildirim"],...Object.entries(data.sharedRecords).filter(([type])=>!["lab","xray"].includes(type)).flatMap(([type,rows])=>
        rows.filter(item=>item.client===row.customer_id && item.branch===(data.branches.find(branch=>branch.id===row.branch_id)?.sharedWith||row.branch_id)).map(item=>[type+"/"+item.id,({exam:"Muayene",lab:"Laboratuvar",xray:"Röntgen"})[type]+" · "+(item.title||item.id)]))]);
      const summary=el("label","Hasta sahibinin göreceği metin");
      summary.append(el("textarea","",{name:"summary",required:true,maxLength:4000}));
      details.append(el("p","Muayene ve bağlı tetkik görselleri, ilgili izinler açıldığında portalda otomatik görünür."));
      details.append(makeForm([picker,summary],"Paylaş",async (input,form)=>{
        const [category,recordId]=input.record.split("/");
        await api("share",{membershipId:row.id,category,recordId:recordId||crypto.randomUUID(),summary:input.summary});
        form.reset();
        await management();
        status.textContent="Paylaşım kaydedildi.";
      }));
      const published=(data.shares||[]).filter(item=>item.membership_id===row.id);
      for (const item of published) {
        const line=el("p",item.summary+" ");
        const remove=el("button","Paylaşımı kaldır",{type:"button",className:"button"});
        remove.addEventListener("click",async()=>{
          try {
            await api("unshare",{membershipId:row.id,category:item.category,recordId:item.record_id});
            await management();
            status.textContent="Paylaşım kaldırıldı.";
          } catch(error) {status.textContent=error.message;}
        });
        line.append(remove);
        details.append(line);
      }
    }
    return details;
  }

  let searchValue="",roleValue="",branchValue="",statusValue="";
  async function management() {
    const [session,data]=await Promise.all([api("session"),api("directory")]);
    if (!view.isConnected) return;
    heading(data.quotas.userCap?"Klinik hesapları ve yetkileri":"Hasta sahibi yetkileri","Şube ve personel erişimini, aktivasyonları ve hasta sahibi paylaşımlarını yönetin.");
    const tools=el("div","",{className:"suite-tabs"});
    tools.append(link("Vardiya ve izinler","#personel-plani","button"));
    if (data.quotas.branchCap) tools.append(link("Şubeleri yönet","#branches","button"));
    if (session.members.length>1) tools.append(link("Kurum değiştir","#kurum-sec","button"));
    const invitation=el("details","",{className:"panel suite-panel suite-invite"});
    invitation.open=Boolean(params.get("customer"));
    invitation.append(el("summary","+ Yeni üyelik ve aktivasyon"),inviteForm(data));
    const metrics=el("div","",{className:"suite-metrics"});
    const availableRoles=Object.entries(roles).filter(([key])=>key==="customer"||(data.quotas.userCap&&(key==="staff"||data.quotas.branchCap)));
    const catalog=el("section","",{className:"panel suite-panel"});
    const detail=el("div");
    const list=el("div");
    const filters=el("div","",{className:"suite-form suite-filters"});
    const role=selectField("member-role","Rol",[["","Tüm roller"],...availableRoles],false);
    const branch=selectField("member-branch","Şube",[["","Tüm şubeler"],...data.branches.map(row=>[row.id,row.name])],false);
    const state=selectField("member-state","Durum",[["","Tüm durumlar"],...Object.entries(memberStatus)],false);
    const search=field("member-search","Ad veya telefon",{type:"search",value:searchValue,required:false});
    const roleSelect=role.querySelector("select"), branchSelect=branch.querySelector("select"), stateSelect=state.querySelector("select");
    roleSelect.value=roleValue;branchSelect.value=branchValue;stateSelect.value=statusValue;
    branch.hidden=activeBranches(data).length===1;
    filters.append(search,...(data.quotas.userCap?[role]:[]),...(data.quotas.branchCap?[branch]:[]),state);
    for (const [key,label] of availableRoles) {
      const active=data.members.filter(row=>row.role===key&&row.status==="active").length;
      const pending=data.members.filter(row=>row.role===key&&row.status==="pending").length;
      const card=el("button","",{type:"button",className:"panel suite-metric"});
      card.append(el("strong",label),el("span",active+" aktif · "+pending+" bekleyen"));
      card.addEventListener("click",()=>{roleSelect.value=roleSelect.value===key?"":key;render();});
      card.dataset.role=key;metrics.append(card);
    }
    function render() {
      roleValue=roleSelect.value;branchValue=branchSelect.value;statusValue=stateSelect.value;
      searchValue=search.querySelector("input").value;
      const term=searchValue.trim().toLocaleLowerCase("tr-TR");
      for (const card of metrics.children) card.setAttribute("aria-pressed",String(roleValue===card.dataset.role));
      const found=data.members.filter(row=>(!roleValue||row.role===roleValue)&&(!branchValue||row.branch_id===branchValue)&&
        (!statusValue||row.status===statusValue)&&(!term||[row.name,row.phone].some(value=>value?.toLocaleLowerCase("tr-TR").includes(term))));
      list.replaceChildren(paginate(found,visible=>{
        if (!visible.length) return el("p","Bu seçimde üyelik bulunamadı.",{className:"suite-muted"});
        const wrap=el("div","",{className:"suite-table"});
        const table=el("table"), head=table.createTHead().insertRow(), body=table.createTBody();
        for (const label of ["Hesap","Rol / şube","Durum","İşlemler"]) head.append(el("th",label,{scope:"col"}));
        for (const row of visible) {
          const tr=body.insertRow();
          tr.insertCell().append(el("strong",row.name||row.phone),...(row.name?[el("small",row.phone)]:[]));
          tr.insertCell().append(el("strong",roles[row.role]),el("small",data.branches.find(item=>item.id===row.branch_id)?.name||""));
          tr.insertCell().append(el("span",memberStatus[row.status]||row.status,{className:"suite-pill"}));
          const button=el("button",row.status==="revoked"?"Görüntüle":"Yetkileri düzenle",{type:"button",className:"button small"});
          button.addEventListener("click",()=>{
            catalog.hidden=true;detail.replaceChildren(memberCard(row,data));
            detail.querySelector("h2").focus({preventScroll:true});detail.scrollIntoView({block:"start"});
          });
          tr.insertCell().append(button);
        }
        wrap.append(table);return wrap;
      },15));
    }
    filters.addEventListener("input",render);
    filters.addEventListener("change",render);
    catalog.append(el("h2","Kurum üyelikleri"),filters,list);
    view.append(tools,reauth(session.previewReauth),metrics,invitation,catalog,detail,brandForm(data.partnerId));
    render();
  }

  await management();
}
