import {permissionMatrix} from "./permission-matrix.js";
import {actionNames,clinicFetch} from "./access.js";
import {paginate} from "./paged.js?v=2";

const roles={branch:"Şube yöneticisi",staff:"Personel",customer:"Hasta sahibi"};
const outcomes={active:"Personel hesabı etkin. Telefon ve belirlediğiniz şifre ile giriş yapılabilir.",email_sent:"Tek kullanımlık şifre belirleme bağlantısı e-posta ile gönderildi.",sent:"SMS sağlayıcısı gönderimi kabul etti.",delivery_unknown:"SMS sonucu henüz doğrulanamadı.",provider_pending:"Üyelik beklemede. SMS sağlayıcısı kullanılabilir olduğunda tekrar deneyin.",credit_pending:"Üyelik beklemede. Bayi bakiyesi ve gönderim limitlerini kontrol edin.",quota_pending:"Üyelik beklemede. Gönderim kotası doldu.",wait:"Bir aktivasyon zaten beklemede. Beş dakika sonra yeniden deneyebilirsiniz."};
const memberStatus={pending:"Aktivasyon bekliyor",active:"Aktif",revoked:"Kapatıldı"};
const rolePresets={reception:{appointments:"write",clients:"write",patients:"read",followups:"read"},clinical:{appointments:"read",clients:"read",patients:"write",followups:"write"},inventory:{products:"write",reports:"read"}};
// Yeni özellikler (sunucu ClinicAccess::FEATURES): paket açıksa varsayılan olarak verilir, buradan kapatılabilir.
const featureNames={inbox:"Sohbet (tüm kanallar)",phoneGateway:"Telefon bağlantısı (kendi hattından SMS/WhatsApp)",reminders:"Otomatik hatırlatmalar",bulkMessages:"Toplu mesaj",
  permits:"Müşteri onay formu (KVKK ve ileti izni)",consents:"Dijital onam ve imza",edocs:"e-Fatura / e-Arşiv / e-SMM",bridge:"Bakanlık köprüsü (e-Reçete ve aşı)",
  icu:"Yoğun bakım panosu",surgery:"Ameliyat modülü",homeCare:"Evden takip",homeVisit:"Eve hizmet",webSite:"Web sitesi ve web mesajları",onlineBooking:"Web randevu",
  vebot:"VeBot asistan",voice:"Sesli komut",xray:"Röntgen yapay zekâ yorumu",dicom:"DICOM görüntüleyici",labAi:"Laboratuvar yorum desteği",calculators:"Klinik hesaplayıcılar",
  taskBoard:"İş takibi panosu",commission:"Prim raporu",debtReminders:"Borç hatırlatma",bulkPrice:"Toplu fiyat ve Excel",invoiceImport:"Faturadan stok",okc:"Yazar kasa (ÖKC)"};
const moduleNames={esmm:"e-SMM portal erişimi",appointments:"Randevu görüntüleme ve düzenleme",clients:"Müşteriler ve belgeler",patients:"Hastalar ve muayeneler",followups:"Aşı ve takip",sales:"Satışlar (ürün kataloğu ve müşteri seçimi dahil; satışın stok düşümü kendiliğinden yapılır)",collections:"Tahsilat alma ve tahsilat listesi",products:"Ürünler, alış ve stok yönetimi",expenses:"Kasa, gider ve tedarikçi ödemeleri",reports:"Raporları görüntüleme",messages:"Mesajlar",support:"Destek",overviewClients:"Genel Bakış · Tüm Kayıtlı Müşteriler",overviewPatients:"Genel Bakış · Tüm Kayıtlı Hastalar"};


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
    if (!customer && current && current.collections===undefined) { const r={none:0,read:1,write:2},n=["none","read","write"]; current={...current,collections:n[Math.max(r[current.expenses]||0,r[current.sales]||0)]}; }
    return permissionMatrix({el,selectField,modules:customer?customerSections:{...moduleNames,...actionNames,...featureNames},current:customer?{...customerDefaults,...current}:{...Object.fromEntries(Object.keys(featureNames).map(k=>[k,"write"])),...current},
      readOnly:customer,initial:customer?"read":"none",title:customer?"Hasta sahibi portalı":"Modül erişim tablosu",
      presets:customer?{}:Object.fromEntries(presetList.map(item=>[item.id,{label:item.label,values:item.modules}])),
    });
  }

  // Görev şablonları sunucudan gelir (bayi düzenler); yüklenemezse eski hazır kalıplar kullanılır.
  let presetList=[{id:"reception",label:"Danışma / Resepsiyon",modules:rolePresets.reception},{id:"clinical",label:"Klinik personeli (hekim)",modules:rolePresets.clinical},{id:"inventory",label:"Stok sorumlusu",modules:rolePresets.inventory}];
  // Güvenlik doğrulaması gereken işlemler: şifre sorulur, doğrulanınca işlem aynen tekrarlanır (sessizce başarısız olmaz).
  const askReauth=anchor=>new Promise((resolve,reject)=>{
    anchor.querySelector(".ca-reauth")?.remove();
    const box=el("div","",{className:"ca-reauth"}),pass=field("reauthPassword","Güvenlik için mevcut şifreniz",{type:"password",autocomplete:"current-password",required:false});
    const ok=el("button","Doğrula ve devam et",{type:"button",className:"button primary"}),cancel=el("button","Vazgeç",{type:"button",className:"button"}),msg=el("p","",{className:"muted",role:"status"});
    box.append(el("p","Bu işlem için kimliğinizi yeniden doğrulayın (15 dakika geçerli).",{className:"muted"}),pass,ok,cancel,msg);
    const submit=anchor.querySelector('button[type="submit"]');submit?submit.after(box):anchor.append(box);pass.querySelector("input").focus();
    pass.querySelector("input").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();ok.click();}});
    ok.addEventListener("click",async()=>{ok.disabled=true;try{await api("reauth",{password:pass.querySelector("input").value});box.remove();resolve();}catch(e){msg.textContent=e.message;ok.disabled=false;}});
    cancel.addEventListener("click",()=>{box.remove();reject(Error("Kimlik doğrulaması yapılmadı; değişiklik kaydedilmedi."));});
  });
  const withReauth=async(anchor,fn)=>{try{return await fn();}catch(e){if(!/yeniden doğrula/i.test(e.message))throw e;await askReauth(anchor);return fn();}};

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
    const email=field("email","E-posta adresi",{type:"email",maxLength:254});
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
      const send=()=>api("invite",{...input,partnerId:data.partnerId,verifiedInPerson:input.verifiedInPerson==="on",reopen:input.reopen==="on",modules:readModules(input)});
      let result;
      try{result=await send();}catch(e){if(!/yeniden doğrula/i.test(e.message))throw e;await askReauth(form);result=await send();}
      await management();
      const who=roles[input.role]||"Hesap";
      const l=result.link?link("Tek kullanımlık aktivasyon bağlantısı",result.link):null;
      if (result.status==="device") {
        // Bu cihazda: bağlantı yeni sekmede açılır; kişi cihazı alıp şifresini belirler ve onaylar.
        const w=window.open(result.link,"_blank");if(w)try{w.opener=null}catch{}
        status.replaceChildren(who+" üyeliği oluşturuldu. Aktivasyon ekranı "+(w?"yeni sekmede açıldı":"açılamadı, bağlantıya dokunun")+"; cihazı kişiye verin, şifresini belirleyip onaylasın (15 dakika geçerli). ",l);
      } else if (result.status==="sms_queued") status.replaceChildren(who+" üyeliği oluşturuldu; aktivasyon bağlantısı kliniğin telefon hattından SMS olarak gönderiliyor (24 saat geçerli). ",l);
      else if (result.status==="sms_unavailable") {
        const phoneDigits=(input.phone||"").replace(/\D/g,"").replace(/^0/,"90");
        const wa=link("WhatsApp ile gönder","https://wa.me/"+phoneDigits+"?text="+encodeURIComponent(result.share||result.link));wa.target="_blank";wa.rel="noopener";
        status.replaceChildren(who+" üyeliği oluşturuldu. Telefon Bağlantısı'nda SMS hattı açık olmadığı için SMS gönderilemedi; bağlantıyı WhatsApp ile ya da kopyalayıp iletin: ",wa," · ",l);
      } else if (result.status==="email_failed") status.replaceChildren(who+" üyeliği oluşturuldu ama e-posta gönderilemedi (Bildirim e-postası/SMTP ayarını kontrol edin). Bağlantıyı elle iletin: ",l);
      else if (result.link) status.replaceChildren(who+" üyeliği oluşturuldu. Kimliği doğrulanan kişiye bu cihazda açtırın: ",l);
      else status.textContent=outcomes[result.status]||"İşlem kaydedildi.";
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
      // Tüm hesap türlerinde aynı aktivasyon yöntemleri; şifreyi yöneticinin belirlemesi yalnız ekip hesaplarında.
      const available=[["sms","SMS bağlantısı (kliniğin hattından)"],["email","E-posta bağlantısı"],["device","Bu cihazda aç · kişi şifresini belirleyip onaylar"],["in-person","Yüz yüze kimlik doğrulaması"],
        ...(selected==="customer"?[]:[["password","Şifreyi ben belirleyeyim ve hesabı açayım"]])];
      const selectedMode=mode.value;
      mode.replaceChildren(...available.map(([value,label])=>el("option",label,{value})));
      mode.value=available.some(([value])=>value===selectedMode)?selectedMode:available[0][0];
      approval.hidden=mode.value!=="in-person";
      visitHint.hidden=!staffSetup;
      email.hidden=mode.value!=="email";
      password.hidden=generate.hidden=mode.value!=="password";
      for (const wrapper of [email,password]) {
        const input=wrapper.querySelector("input");
        input.disabled=wrapper.hidden;input.required=!wrapper.hidden;
      }
      form.querySelector('button[type="submit"]').textContent={branch:"Şube yöneticisi oluştur",staff:"Personel oluştur",customer:"Hasta sahibi hesabı aç"}[selected]||"Üyelik aç ve aktivasyonu başlat";
    }
    const emailInput=email.querySelector("input");
    const syncPhone=()=>{if (roleSelect.value==="customer") {const c=data.clients.find(row=>row.id===customerSelect.value);phoneInput.value=c?.phone||"";if(!emailInput.value&&c?.email)emailInput.value=c.email;}};
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
    back.addEventListener("click",()=>{const host=details.parentElement;host.parentElement?.querySelectorAll("[data-member-list]").forEach(x=>{x.hidden=false;});host.replaceChildren();});
    top.append(title,back);details.append(top);
    const controls=el("div","",{className:"links"});
    if (row.status!=="revoked") {
      const revoke=el("button","Üyeliği kapat",{type:"button",className:"button"});
      revoke.addEventListener("click",async()=>{
        if (!window.confirm("Bu kurum üyeliği kapatılsın mı?")) return;
        try { await withReauth(controls,()=>api("revoke",{membershipId:row.id}));await management();status.textContent="Üyelik kapatıldı."; }
        catch(error) {status.textContent=error.message;}
      });
      controls.append(revoke);
    }
    const remove=el("button","Üyeliği sil",{type:"button",className:"button danger-outline"});
    remove.addEventListener("click",async()=>{
      if (!window.confirm("Bu kurum üyeliği kalıcı olarak silinsin mi?")) return;
      remove.disabled=true;
      try { await withReauth(controls,()=>api("delete",{membershipId:row.id,confirm:true}));await management();status.textContent="Üyelik silindi."; }
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
    edit.append(el("summary","Üyelik bilgilerini düzenle"),makeForm([memberName,...(row.role==="customer"?[]:[memberBranch])],"Üyeliği güncelle",async (input,form)=>{
      await withReauth(form,()=>api("edit",{membershipId:row.id,...input}));
      await management();
      status.textContent="Üyelik güncellendi.";
    }));
    details.append(edit);
    if (row.status!=="revoked") details.append(makeForm([moduleFields(row.role==="branch" && row.modules==="{}"?Object.fromEntries(Object.keys(moduleNames).map(key=>[key,key==="esmm"?"none":"write"])):JSON.parse(row.modules),row.role==="customer")],"İzinleri kaydet",async (input,form)=>{
      await withReauth(form,()=>api("permissions",{membershipId:row.id,modules:readModules(input)}));
      await management();
      status.textContent="İzinler kaydedildi. Bu kişinin açık oturumları kapatıldı; yeniden girişte yalnız verdiğiniz yetkilerle çalışır.";
      status.scrollIntoView?.({block:"nearest"});
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

  // Görev şablonları paneli: ad ve izinler düzenlenir, yeni şablon eklenir, seçilen personele tek seferde uygulanır.
  function presetPanel(data) {
    const panel=el("details","",{className:"panel suite-panel ca-presets"});
    panel.append(el("summary","Görev şablonları (Danışma, Klinik personeli, Kasa personeli…)"));
    panel.append(el("p","Şablonun adını ve izinlerini değiştirip kaydedin. Şablonda kapalı olan her yetki personelde de kapalıdır. Değişiklik, şablonu personele uyguladığınızda geçerli olur; uygulanınca o kişilerin açık oturumları kapanır.",{className:"suite-muted"}));
    const team=data.members.filter(row=>["branch","staff"].includes(row.role)&&row.status!=="revoked");
    const editor=(item)=>{
      const box=el("details","",{className:"ca-preset"});
      box.append(el("summary",item?item.label:"+ Yeni görev şablonu"));
      const name=field("label","Şablon adı",{maxLength:80,value:item?.label||"",required:true});
      const matrix=permissionMatrix({el,selectField,modules:{...moduleNames,...actionNames,...featureNames},current:item?.modules||{},initial:"none",prefix:"preset-",title:"Şablonun izinleri"});
      const form=makeForm([name,matrix],item?"Şablonu kaydet":"Şablonu oluştur",async (input,f)=>{
        const modules=Object.fromEntries(Object.entries(input).filter(([k])=>k.startsWith("preset-")).map(([k,v])=>[k.slice(7),v]));
        const result=await api("role-presets",{id:item?.id||"",label:input.label,modules});
        presetList=result.presets;await management();
        status.textContent="Görev şablonu kaydedildi.";
      });
      box.append(form);
      if (item) {
        const remove=el("button","Şablonu sil",{type:"button",className:"button danger-outline"});
        remove.addEventListener("click",async()=>{
          if (!window.confirm("“"+item.label+"” şablonu silinsin mi? Personelin mevcut izinleri değişmez.")) return;
          try { const result=await api("role-presets",{id:item.id,delete:true});presetList=result.presets;await management();status.textContent="Şablon silindi."; }
          catch(error) {status.textContent=error.message;}
        });
        box.append(remove);
        if (team.length) {
          const apply=el("form","",{className:"suite-form ca-preset-apply"});
          const list=el("fieldset");list.append(el("legend","Bu şablonu uygula"));
          for (const row of team) {
            const label=el("label","",{className:"check-field"});
            label.append(el("input","",{type:"checkbox",name:"member",value:row.id}),document.createTextNode(" "+(row.name||row.phone)+" · "+roles[row.role]));
            list.append(label);
          }
          const go=el("button","Seçilen kişilere uygula",{type:"submit",className:"button primary"}),out=el("p","",{className:"suite-muted",role:"status"});
          apply.append(list,go,out);
          apply.addEventListener("submit",async e=>{
            e.preventDefault();
            const ids=[...apply.querySelectorAll('input[name="member"]:checked')].map(x=>x.value);
            if (!ids.length) {out.textContent="En az bir kişi seçin.";return;}
            if (!window.confirm("“"+item.label+"” izinleri seçilen "+ids.length+" kişiye uygulansın mı? Mevcut izinlerinin yerine geçer.")) return;
            go.disabled=true;
            try { const r=await withReauth(apply,()=>api("role-presets-apply",{id:item.id,membershipIds:ids}));await management();status.textContent=r.updated+" kişinin izinleri güncellendi; açık oturumları kapatıldı."; }
            catch(error) {out.textContent=error.message;}
            finally {go.disabled=false;}
          });
          box.append(apply);
        }
      }
      return box;
    };
    for (const item of presetList) panel.append(editor(item));
    panel.append(editor(null));
    return panel;
  }

  // Hasta sahipleri: uygulama (iOS, Android, Mac, Windows) ve hasta sahibi portalı (tarayıcı) kullanımı + uygulama indirimi.
  async function appUsage(box,data,openMember,resendTools) {
    box.replaceChildren(el("h2","Uygulamayı kullananlar"),el("p","Yükleniyor…",{className:"suite-muted"}));
    const rep=await api("app-usage");
    const S=rep.summary, L=rep.labels, fmt=t=>t?new Intl.DateTimeFormat("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(t*1000)):"—";
    const ago=t=>{if(!t)return "";const d=Math.floor((Date.now()/1000-t)/86400);return d<=0?"bugün":d===1?"dün":d+" gün önce";};
    const head=el("div","",{className:"ca-usage-head"});
    head.append(el("div","",{}),el("p","Hasta sahibi hesapları, uygulama ve portal kullanımı. Uygulama: iPhone/iPad, Android, Mac ve Windows uygulamaları. Hasta sahibi portalı: telefon veya bilgisayar tarayıcısından girenler (ayrı raporlanır).",{className:"suite-muted"}));
    head.firstChild.append(el("h2","Uygulamayı kullananlar"));
    const pct=(n,t)=>t?Math.round(n*100/t)+"%":"0%";
    const cards=el("div","",{className:"ca-usage-cards"});
    const card=(label,value,sub,cls,filter)=>{const c=el("button","",{type:"button",className:"ca-usage-card "+(cls||"")});c.append(el("small",label),el("strong",String(value)),el("span",sub));c.dataset.usageFilter=filter;return c;};
    cards.append(card("Hasta sahibi hesabı",S.accounts,S.pending+" aktivasyon bekliyor","","all"),
      card("Uygulamayı kullanan",S.app,pct(S.app,S.accounts)+" · iOS, Android, Mac, Windows","ok","app"),
      card("Yalnız portal (tarayıcı)",S.portalOnly,pct(S.portalOnly,S.accounts)+" · uygulamaya davet edin","mid","portal"),
      card("Hiç giriş yapmamış",S.never,pct(S.never,S.accounts)+" · uygulamayı kullanmıyor","low","never"));
    const chips=el("div","",{className:"ca-usage-chips"});
    for (const [k,label] of Object.entries(L)) if (k!=="web"&&(k!=="linux"||S.channels[k])) chips.append(el("span",label+": "+(S.channels[k]||0),{className:"ca-chip ca-ch-"+k}));
    chips.append(el("span","Son 30 günde aktif: "+S.active30,{className:"ca-chip"}));
    // Hasta sahibi portalı ayrı rapor
    const portal=el("div","",{className:"ca-usage-portal"});
    portal.append(el("strong","Hasta sahibi portalı raporu"),el("span","Tarayıcıdan giren: "+S.portal.users),el("span","Toplam portal girişi: "+S.portal.logins),el("span","Son 30 günde portalı kullanan: "+S.portal.active30));
    // İndirim (bayi)
    const disc=el("form","",{className:"ca-usage-discount"});
    const on=el("input","",{type:"checkbox",checked:!!rep.discount.enabled});const onL=el("label","",{className:"ca-switch"});onL.append(on,el("span","Uygulamayı kullananlara satış indirimi"));
    const per=el("input","",{type:"number",min:"0",max:"100",step:"0.5",value:String(rep.discount.percent||""),inputMode:"decimal",placeholder:"%"});
    const perL=el("label","",{className:"ca-percent"});perL.append(el("span","%"),per);
    const save=el("button","İndirimi kaydet",{type:"submit",className:"button small primary"});
    const out=el("small","",{className:"suite-muted",role:"status"});
    disc.append(onL,perL,save,el("p","Açık olduğunda iOS, Android, Mac veya Windows uygulamasını kullanan hasta sahibinin satışında bu oran genel indirim olarak önerilir ve uygulanır (satış ekranında kaldırılabilir). Uygulamayı teşvik etmek için kullanın.",{className:"suite-muted"}),out);
    disc.addEventListener("submit",async e=>{e.preventDefault();save.disabled=true;out.textContent="";try{const r=await api("app-discount",{enabled:on.checked,percent:Number(per.value||0)});on.checked=r.enabled;per.value=String(r.percent||"");out.textContent=r.enabled?"Kaydedildi: uygulama kullanıcılarına %"+r.percent+" indirim açık.":"Kaydedildi: uygulama indirimi kapalı.";}catch(er){out.textContent=er.message;}finally{save.disabled=false;}});
    // Liste
    let filterValue="all", term="";
    const tabs=el("div","",{className:"suite-tabs ca-usage-tabs"});
    for (const [k,label] of [["all","Tümü"],["app","Uygulama"],["portal","Yalnız portal"],["never","Hiç girmedi"]]) {const b=el("button",label,{type:"button",className:"button small"});b.dataset.usageFilter=k;tabs.append(b);}
    const search=el("input","",{type:"search",placeholder:"Ad veya telefon",className:"ca-usage-search"});
    const list=el("div");
    const chan=r=>{const w=el("div","",{className:"ca-usage-chans"});for(const k of Object.keys(r.channels))w.append(el("span",L[k]||k,{className:"ca-chip ca-ch-"+k,title:(L[k]||k)+" · "+(r.channels[k].logins||0)+" giriş · son kullanım "+fmt(r.channels[k].lastSeen)}));if(!w.childElementCount)w.append(el("span","Kullanmıyor",{className:"ca-chip ca-ch-none"}));return w;};
    const draw=()=>{
      for (const b of tabs.children) b.setAttribute("aria-pressed",String(b.dataset.usageFilter===filterValue));
      for (const c of cards.children) c.setAttribute("aria-pressed",String(c.dataset.usageFilter===filterValue));
      const q=term.trim().toLocaleLowerCase("tr-TR");
      const rows=rep.members.filter(r=>(filterValue==="all"||filterValue==="app"&&r.app||filterValue==="portal"&&!r.app&&r.portal||filterValue==="never"&&!r.app&&!r.portal)&&(!q||[r.name,r.phone].some(v=>v?.toLocaleLowerCase("tr-TR").includes(q))));
      list.replaceChildren(paginate(rows,visible=>{
        if(!visible.length) return el("p","Bu seçimde hasta sahibi yok.",{className:"suite-muted"});
        const wrap=el("div","",{className:"suite-table"}),table=el("table"),hr=table.createTHead().insertRow(),body=table.createTBody();
        for (const h of ["Hasta sahibi","Kullandığı","Son giriş","Toplam giriş","Son kullanım","İşlemler"]) hr.append(el("th",h,{scope:"col"}));
        for (const r of visible) {
          const tr=body.insertRow();
          tr.insertCell().append(el("strong",r.name||r.phone),...(r.name?[el("small",r.phone)]:[]),...(r.status==="pending"?[el("span","Aktivasyon bekliyor",{className:"suite-pill"})]:[]));
          tr.insertCell().append(chan(r));
          tr.insertCell().append(el("span",fmt(r.lastLogin)),el("small",ago(r.lastLogin)));
          tr.insertCell().append(el("strong",String(r.logins||0)));
          tr.insertCell().append(el("span",fmt(r.lastSeen)),el("small",ago(r.lastSeen)));
          const cell=tr.insertCell(),bt=el("button","Yetkileri düzenle",{type:"button",className:"button small"});
          const member=data.members.find(m=>m.id===r.id);
          bt.addEventListener("click",()=>member&&openMember(member));cell.append(bt);
          if(member&&member.status==="pending") cell.append(resendTools(member));
        }
        wrap.append(table);return wrap;
      },15));
    };
    tabs.addEventListener("click",e=>{const b=e.target.closest("[data-usage-filter]");if(b){filterValue=b.dataset.usageFilter;draw();}});
    cards.addEventListener("click",e=>{const b=e.target.closest("[data-usage-filter]");if(b){filterValue=b.dataset.usageFilter;draw();}});
    search.addEventListener("input",()=>{term=search.value;draw();});
    const tools=el("div","",{className:"ca-usage-tools"});tools.append(tabs,search);
    box.replaceChildren(head,cards,chips,portal,disc,tools,list);
    draw();
  }

  let searchValue="",roleValue="",branchValue="",statusValue="";
  async function management() {
    const [session,data,presets]=await Promise.all([api("session"),api("directory"),api("role-presets").catch(()=>null)]);
    if (presets?.presets?.length) presetList=presets.presets;
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
    const role=selectField("member-role","Rol",[["","Tüm roller"],...availableRoles.filter(([key])=>key!=="customer")],false);
    const branch=selectField("member-branch","Şube",[["","Tüm şubeler"],...data.branches.map(row=>[row.id,row.name])],false);
    const state=selectField("member-state","Durum",[["","Tüm durumlar"],...Object.entries(memberStatus)],false);
    const search=field("member-search","Ad veya telefon",{type:"search",value:searchValue,required:false});
    const roleSelect=role.querySelector("select"), branchSelect=branch.querySelector("select"), stateSelect=state.querySelector("select");
    roleSelect.value=roleValue;branchSelect.value=branchValue;stateSelect.value=statusValue;
    branch.hidden=activeBranches(data).length===1;
    filters.append(search,...(data.quotas.userCap?[role]:[]),...(data.quotas.branchCap?[branch]:[]),state);
    const staffRoles=availableRoles.filter(([key])=>key!=="customer");
    for (const [key,label] of staffRoles) {
      const active=data.members.filter(row=>row.role===key&&row.status==="active").length;
      const pending=data.members.filter(row=>row.role===key&&row.status==="pending").length;
      const card=el("button","",{type:"button",className:"panel suite-metric"});
      card.append(el("strong",label),el("span",active+" aktif · "+pending+" bekleyen"));
      card.addEventListener("click",()=>{roleSelect.value=roleSelect.value===key?"":key;render();});
      card.dataset.role=key;metrics.append(card);
    }
    // Aktivasyon bekleyen üyelik: yeni bağlantı SMS (kliniğin hattından), e-posta veya bu cihazda; eskisi geçersiz olur.
    function resendTools(row) {
      const box=el("div","",{className:"ca-resend"}), out=el("p","",{className:"suite-muted",role:"status"});
      const send=async(method,email="")=>{
        const go=()=>api("resend",{membershipId:row.id,method,email});
        let r;
        try{r=await go();}
        catch(e){
          if(!/yeniden doğrula/i.test(e.message)){out.textContent=e.message;return;}
          const pass=el("input","",{type:"password",autocomplete:"current-password",placeholder:"Mevcut şifreniz"}),ok=el("button","Doğrula ve gönder",{type:"button",className:"button small primary"});
          const wrapPass=el("div","",{className:"ca-resend-auth"});wrapPass.append(el("small","Güvenlik için şifrenizi girin (15 dakika geçerli)."),pass,ok);box.append(wrapPass);pass.focus();
          await new Promise(res=>ok.addEventListener("click",async()=>{ok.disabled=true;try{await api("reauth",{password:pass.value});wrapPass.remove();res();}catch(er){out.textContent=er.message;ok.disabled=false;}}));
          try{r=await go();}catch(er){out.textContent=er.message;return;}
        }
        const l=r.link?link("bağlantı",r.link):null;
        if(r.status==="sms_queued") out.replaceChildren("Yeni aktivasyon bağlantısı SMS ile gönderiliyor (24 saat geçerli).");
        else if(r.status==="sms_unavailable"){const wa=link("WhatsApp ile gönder","https://wa.me/"+(row.phone||"").replace(/\D/g,"").replace(/^0/,"90")+"?text="+encodeURIComponent(r.share||r.link));wa.target="_blank";wa.rel="noopener";out.replaceChildren("SMS hattı açık değil. ",wa," · ",l);}
        else if(r.status==="email_sent") out.replaceChildren("Yeni aktivasyon bağlantısı e-posta ile gönderildi.");
        else if(r.status==="email_failed") out.replaceChildren("E-posta gönderilemedi; bağlantıyı elle iletin: ",l);
        else if(r.status==="device"){const w=window.open(r.link,"_blank");if(w)try{w.opener=null}catch{}out.replaceChildren("Aktivasyon ekranı "+(w?"yeni sekmede açıldı":"açılamadı")+" (15 dakika geçerli). ",l);}
      };
      const sms=el("button","SMS ile tekrar gönder",{type:"button",className:"button small"});
      const mail=el("button","E-posta ile",{type:"button",className:"button small"});
      const here=el("button","Bu cihazda aç",{type:"button",className:"button small"});
      sms.addEventListener("click",()=>send("sms"));
      here.addEventListener("click",()=>send("device"));
      mail.addEventListener("click",()=>{
        if(box.querySelector(".ca-resend-mail"))return;
        const f=el("form","",{className:"ca-resend-mail"}),input=el("input","",{type:"email",required:true,maxLength:254,placeholder:"ornek@eposta.com"});
        const client=data.clients?.find(c=>c.id===row.customer_id);if(client?.email)input.value=client.email;
        f.append(input,el("button","Gönder",{type:"submit",className:"button small primary"}));
        f.addEventListener("submit",e=>{e.preventDefault();f.remove();send("email",input.value.trim());});
        box.append(f);input.focus();
      });
      box.append(sms,mail,here,out);
      return box;
    }
    function render() {
      roleValue=roleSelect.value;branchValue=branchSelect.value;statusValue=stateSelect.value;
      searchValue=search.querySelector("input").value;
      const term=searchValue.trim().toLocaleLowerCase("tr-TR");
      for (const card of metrics.children) card.setAttribute("aria-pressed",String(roleValue===card.dataset.role));
      const found=data.members.filter(row=>row.role!=="customer"&&(!roleValue||row.role===roleValue)&&(!branchValue||row.branch_id===branchValue)&&
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
            catalog.hidden=true;usage.hidden=true;detail.replaceChildren(memberCard(row,data));
            detail.querySelector("h2").focus({preventScroll:true});detail.scrollIntoView({block:"start"});
          });
          const cell=tr.insertCell();cell.append(button);
          if (row.status==="pending") cell.append(resendTools(row));
        }
        wrap.append(table);return wrap;
      },15));
    }
    filters.addEventListener("input",render);
    filters.addEventListener("change",render);
    catalog.append(el("h2","Kurum üyelikleri"),el("p","Klinik ekibi: şube yöneticileri ve personel. Hasta sahibi hesapları aşağıda, Uygulamayı kullananlar bölümündedir.",{className:"suite-muted"}),filters,list);
    catalog.dataset.memberList="1";
    const usage=el("section","",{className:"panel suite-panel ca-usage"});usage.dataset.memberList="1";
    const openMember=row=>{catalog.hidden=true;usage.hidden=true;detail.replaceChildren(memberCard(row,data));detail.querySelector("h2").focus({preventScroll:true});detail.scrollIntoView({block:"start"});};
    view.append(tools,reauth(session.previewReauth),metrics,invitation,...(data.quotas.userCap&&presets?[presetPanel(data)]:[]),...(data.quotas.userCap?[catalog]:[]),usage,detail,brandForm(data.partnerId));
    render();
    appUsage(usage,data,openMember,resendTools).catch(e=>usage.replaceChildren(el("h2","Uygulamayı kullananlar"),el("p",e.message,{className:"suite-muted"})));
    // Şifremi unuttum istekleri (SMS gidemediyse tek dokunuşla SMS/WhatsApp) — yalnız istek varsa görünür.
    const resets=el("div");usage.before(resets);
    import("./password-resets-clinic.js?v=1").then(m=>m.mountResetList(resets,{api:clinicFetch,tr:s=>s})).catch(()=>{});
  }

  await management();
}
