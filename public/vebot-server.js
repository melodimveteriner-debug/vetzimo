import {clinicFetch} from "./access.js";

export function requireVeBotAnswer(value) {
  if (typeof value!=="string" || !value.trim()) {
    throw Error("Model boş yanıt döndürdü. Mesajınız korunuyor. Bağlantı ayarlarını kontrol edip tekrar deneyin.");
  }
  return value.trim();
}

const labels={chat:"Sohbet",translate:"Çeviri",writing:"İçerik",research:"Bilimsel araştırma",document:"Belge",vision:"Fotoğraf",lab:"Laboratuvar"};

export function mountServerVeBot(root,access,scope) {
  access={...access};
  const controller=new AbortController();
  const make=(tag,text="",props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
  const key="vebot-thread:"+scope;
  const readThread=()=>{try{return localStorage.getItem(key);}catch{return null;}};
  let thread=readThread()||crypto.randomUUID();
  const saveThread=()=>{try{localStorage.setItem(key,thread);}catch{}};
  saveThread();
  let active=true,ready=false,requestController;
  const card=make("section","",{className:"vebot-studio"});
  const log=make("div","",{className:"bot-thread",role:"log"});
  const status=make("p","",{role:"status",ariaLive:"polite"});
  const form=make("form","",{className:"vebot-form"});
  const modes=make("select","",{ariaLabel:"VeBot çalışma modu"});
  for(const mode of access.modes)modes.add(make("option",labels[mode],{value:mode}));
  const prompt=make("textarea","",{maxLength:4000,rows:4,ariaLabel:"Mesaj",placeholder:"VeBot’a yazın…"});
  const attachment=make("input","",{type:"file",ariaLabel:"Belge veya fotoğraf"});
  const extracted=make("details","",{hidden:true});
  const rawText=make("textarea","",{readOnly:true,rows:5,ariaLabel:"Fotoğraftan okunan metin"});
  extracted.append(make("summary","Fotoğraftan okunan metni kontrol edin"),rawText);
  const send=make("button","Gönder",{className:"button primary",type:"submit"});
  const cancel=make("button","İsteği durdur",{type:"button",className:"button",hidden:true});
  cancel.addEventListener("click",()=>requestController?.abort(Error("İstek durduruldu. Mesajınız korunuyor.")));
  const hint=make("small","Enter gönderir · Shift+Enter yeni satır");
  const reset=make("button","Yeni sohbet",{className:"button",type:"button"});
  const bubble=(author,message)=>{
    const row=make("div","",{className:"identity-card"});
    row.append(make("strong",author),make("p",message,{style:"white-space:pre-wrap;overflow-wrap:anywhere"}));
    log.append(row);
    log.scrollTop=log.scrollHeight;
  };
  async function call(body){
    const signal=AbortSignal.any([controller.signal,...(requestController?[requestController.signal]:[]),AbortSignal.timeout(body?95000:15000)]);
    const response=await clinicFetch("/api/vebot?"+new URLSearchParams({thread}),{
      signal,...(body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"VeBot isteği tamamlanamadı.");
    return data;
  }
  async function waitForLocalAnswer(job,signal){
    const url="/api/vebot/local-job?"+new URLSearchParams({job});
    try {
      while(true){
        signal.throwIfAborted();
        const response=await clinicFetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
        const data=await response.json();
        if(!response.ok)throw Error(data.error||"Yerel VeBot isteği tamamlanamadı.");
        if(!data.pending)return data;
        await new Promise(resolve=>setTimeout(resolve,2500));
      }
    }finally{
      if(signal.aborted)void clinicFetch(url,{method:"POST",signal:AbortSignal.timeout(5000)}).catch(()=>{});
    }
  }
  function updateAttachment(){
    attachment.value="";
    rawText.value="";extracted.hidden=true;
    attachment.hidden=!["vision","document","lab"].includes(modes.value);
    const images="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
    const documents=".txt,.csv,.tsv,.md,.json,.docx,.xlsx,.pdf";
    attachment.accept=modes.value==="vision"?images:modes.value==="lab"?images+","+documents:documents;
  }
  modes.addEventListener("change",updateAttachment);
  updateAttachment();
  reset.addEventListener("click",()=>{thread=crypto.randomUUID();saveThread();log.replaceChildren();status.textContent="";updateAttachment();prompt.focus();});
  prompt.addEventListener("keydown",event=>{
    if(event.key!=="Enter" || event.shiftKey || event.isComposing || event.keyCode===229)return;
    event.preventDefault();
    if(!send.disabled && !event.repeat)form.requestSubmit(send);
  });
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(send.disabled || !ready)return;
    send.disabled=reset.disabled=modes.disabled=attachment.disabled=true;
    requestController=new AbortController();cancel.hidden=false;
    status.textContent="Yanıt hazırlanıyor…";
    try{
      const mode=modes.value,file=attachment.files[0];
      const message=prompt.value.trim() || (file && mode==="lab" ? "Raporu değerlendir. Okunamayan değerleri uydurma." : "");
      if(!message)throw Error("Önce bir mesaj yazın.");
      if(access.browser)throw Error("Bu hosting için VeBot Groq bağlantısını yapılandırın. Eski tarayıcı modeli devreden çıkarıldı.");
      let filename=file?.name||"";
      let content="";
      if(file){
        if(file.size>3000000)throw Error("Dosya en fazla 3 MB olabilir.");
        if(mode==="lab" && (/^image\/(jpeg|png|webp)$/.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name))){
          status.textContent="Laboratuvar fotoğrafı taranıyor…";
          const {recognize}=await import("./lab.js?v=yerel-20261118");
          content=(await recognize(file,()=>{},{signal:requestController.signal})).trim().slice(0,12000);
          if(!content)throw Error("Fotoğrafta okunabilir metin bulunamadı.");
          rawText.value=content;extracted.hidden=false;
          filename="laboratuvar-ocr.txt";
          status.textContent="Okunan metin modele gönderiliyor…";
        }else if(access.browser && !/\.(txt|csv|tsv|md|json)$/i.test(file.name)){
          throw Error("Tarayıcı modunda TXT, CSV, TSV, Markdown veya JSON dosyası seçin.");
        }else if(mode==="vision" || /\.(pdf|docx|xlsx)$/i.test(file.name)){
          const reader=new FileReader();
          const uri=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
          content=uri.split(",")[1];
        }else content=await file.text();
      }
      requestController.signal.throwIfAborted();
      let data=await call({mode,prompt:message,thread,attachment:content,filename});
      if(data.job){
        status.textContent="Yerel bilgisayarın yanıtı bekleniyor…";
        const signal=AbortSignal.any([controller.signal,requestController.signal,AbortSignal.timeout(600000)]);
        data=await waitForLocalAnswer(data.job,signal);
      }
      const answer=requireVeBotAnswer(data?.answer);
      if(!active)return;
      bubble("Siz",message);
      bubble("VeBot",answer);
      prompt.value=attachment.value=status.textContent="";
    }catch(error){if(!controller.signal.aborted)status.textContent=error.name==="TimeoutError"?"İstek zaman aşımına uğradı. Mesajınız korunuyor; yeniden deneyebilirsiniz.":error.message;}
    finally{requestController=undefined;cancel.hidden=true;send.disabled=!ready;reset.disabled=modes.disabled=attachment.disabled=false;}
  });
  const fileLabel=make("label","Dosya veya fotoğraf yükle");
  fileLabel.append(attachment);
  const setLabel=()=>{fileLabel.hidden=attachment.hidden;};
  modes.addEventListener("change",setLabel);setLabel();
  form.append(modes,prompt,fileLabel,extracted,cancel,send,hint);
  form.prepend(status);
  const providerNote=make("p");
  card.append(make("h1","VeBot"),providerNote,reset,log,form);
  root.replaceChildren(card);
  send.disabled=reset.disabled=true;

  status.textContent="VeBot çalışma modu kontrol ediliyor…";
  void call().then(data=>{
    if(!active)return;
    if(data.protocol!==2 || typeof data.browser!=="boolean"){
      throw Error("VeBot sunucusu eski sürümde. Paketteki public/index.php ve src/VeBot.php dosyalarını yükleyin.");
    }
    access.browser=data.browser;
    if(data.localWorker)providerNote.textContent="Yanıtlar kliniğin yerel model bilgisayarında üretilir.";
    ready=true;reset.disabled=send.disabled=false;
    updateAttachment();setLabel();
    if(access.browser){
      send.disabled=true;
      status.textContent="Bu hosting için Groq bağlantısı yapılandırılmalı. config.php içindeki vebot/provider değerini groq yapıp ücretsiz API anahtarınızı girin.";
    }else{
      for(const turn of data.history||[]){
        if(typeof turn.answer==="string" && turn.answer.trim()){
          bubble("Siz",turn.prompt);bubble("VeBot",turn.answer);
        }
      }
      send.disabled=false;status.textContent="";
    }
  }).catch(error=>{if(active)status.textContent=error.name==="TimeoutError"?"İstek zaman aşımına uğradı. Mesajınız korunuyor; yeniden deneyebilirsiniz.":error.message;});
  return ()=>{active=false;controller.abort();};
}
