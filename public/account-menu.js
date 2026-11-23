export function mountAccountMenu(root,{name="VetZimo kullanıcısı",central,center=false,settings="/#settings",directSettings=false,notification="/#bildirim-epostasi",canNotify=central&&!center}) {
  const make=(tag,text,props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
  const toggle=make("button","",{type:"button",className:"header-profile",ariaLabel:"VetZimo hesabı"});
  toggle.setAttribute("aria-expanded","false");
  const popupId="vetnet-account-actions-"+crypto.randomUUID();
  toggle.setAttribute("aria-controls",popupId);
  const initials=make("img","",{className:"vetzimo-account-mark",src:"/vetzimo-mark.png",alt:"",width:32,height:32});
  toggle.append(initials,make("span","VetZimo"));
  const list=make("div","",{className:"account-popup",id:popupId,hidden:true});
  const dialog=make("dialog","",{className:"account-dialog"});
  dialog.setAttribute("aria-label","VetZimo hesap işlemleri");
  const call=async(action,body)=>{
    const response=await fetch("/api/identity/"+action,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
    const result=await response.json();
    if (!response.ok) throw Error(result.error||"Hesap işlemi tamamlanamadı.");
    return result;
  };
  function expand(show) { list.hidden=!show;toggle.setAttribute("aria-expanded",String(show)); }
  function open(title) {
    const close=make("button","Kapat",{type:"button",className:"button"});
    close.addEventListener("click",()=>dialog.close());
    dialog.replaceChildren(make("h2",title),close);expand(false);dialog.showModal();return close;
  }
  dialog.addEventListener("click",event=>{
    if (event.target.closest("a[href]")) dialog.close();
  });
  async function accountSettings() {
    const close=open("Hesap Ayarları");
    const accountData=make("p",name);
    dialog.insertBefore(accountData,close);
    dialog.insertBefore(make("a","Görünüm ve panel tercihleri",{href:settings,className:"button"}),close);
    if (!central) return;
    try {
      const profile=await call("profile");
      if (!dialog.open || !accountData.isConnected) return;
      accountData.textContent=profile.name+" · "+profile.identifier;

    } catch (error) {if(accountData.isConnected)accountData.textContent=error.message;}
  }
  function changePassword() {
    const close=open("Şifre Değiştir");
    const form=make("form","");
    const field=(key,label,type,auto)=>{
      const wrapper=make("label",label);
      const input=make("input","",{name:key,type,required:true,autocomplete:auto,maxLength:128});
      wrapper.append(input);form.append(wrapper);return input;
    };
    const current=field("currentPassword","Mevcut şifre","password","current-password");
    const next=field("password","Yeni şifre · en az 12 karakter","password","new-password");next.minLength=12;
    const again=field("repeat","Yeni şifreyi tekrar gir","password","new-password");
    const otp=center?field("otp","Doğrulama kodu","text","one-time-code"):null;
    if (otp) {otp.inputMode="numeric";otp.maxLength=6;otp.pattern="[0-9]{6}";}
    const feedback=make("p","",{role:"status"});
    const save=make("button","Şifreyi güncelle",{type:"submit",className:"button primary"});
    form.append(feedback,save);
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if (save.disabled) return;
      if (next.value!==again.value) {feedback.textContent="Yeni şifreler eşleşmiyor.";return;}
      save.disabled=true;
      try {
        await call("password/change",{currentPassword:current.value,password:next.value,...(otp?{otp:otp.value}:{})});
        form.reset();location.assign(center?"/yonetim":"/giris");
      } catch (error) {feedback.textContent=error.message;save.disabled=false;}
    });
    dialog.insertBefore(form,close);current.focus();
    dialog.addEventListener("close",()=>form.reset(),{once:true});
  }
  const action=(label,handler)=>{
    const button=make("button",label,{type:"button"});
    button.addEventListener("click",handler);return button;
  };
  list.append(make("strong",name||"VetZimo kullanıcısı"),action("Hesap Ayarları",directSettings?()=>{expand(false);location.assign(settings);}:accountSettings));
  if (canNotify) list.append(action("Bildirim e-postası",()=>{expand(false);location.assign(notification);}));
  if (central) list.append(action("Şifre Değiştir",changePassword),action("Çıkış",async()=>{
    expand(false);
    try {await call("logout",{});location.assign(center?"/yonetim":"/giris");}
    catch (error) {const close=open("Çıkış");dialog.insertBefore(make("p",error.message,{role:"status"}),close);}
  }));
  root.classList.add("account-menu");
  root.replaceChildren(toggle,list,dialog);
  toggle.addEventListener("click",()=>expand(list.hidden));
  document.addEventListener("pointerdown",event=>{
    if(root.isConnected && !root.contains(event.target)) expand(false);
  });
  root.addEventListener("focusout",event=>{
    if(event.relatedTarget && !root.contains(event.relatedTarget)) expand(false);
  });
  root.addEventListener("keydown",event=>{if(event.key==="Escape"&&!list.hidden){expand(false);toggle.focus();}});
}
