import {uiLabel,uiLanguage} from "./ui-locale.js?v=20261123-r64";
import {evaluate,loadRules} from "./homecare-triage.js?v=20261126-r1";
const observations={routine:"Rutin gözlem",change:"Bir değişiklik fark ettim",contact:"Kliniğin beni aramasını istiyorum"};
const decisions={reviewed:"İncelendi",contact:"Klinik iletişim isteği",called:"Arandı"};
const dateFormat=new Intl.DateTimeFormat((document.documentElement.lang||"tr"),{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Istanbul"});
export const homeCareTime=value=>{
  const date=new Date(String(value).replace(" ","T")+"Z");
  return Number.isNaN(date.getTime())?"":dateFormat.format(date);
};

const checkinFields={
  appetite:{label:"İştah",values:{usual:"Her zamanki gibi",less:"Azaldı",none:"Yemedi"}},
  water:{label:"Su tüketimi",values:{usual:"Her zamanki gibi",less:"Azaldı",more:"Arttı"}},
  activity:{label:"Hareketlilik",values:{usual:"Her zamanki gibi",less:"Azaldı",more:"Arttı"}},
  medication:{label:"Planlanan ilaç uygulaması",values:{given:"Uygulandı",missed:"Uygulanmadı",none:"Planlanmadı"}},
};
const kilograms=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:3});

// Ön değerlendirme: acil, yakın takip (bugün), rutin. Tanı koymaz; hasta sahibini kliniğe yönlendirir.
const levelLabels={urgent:"Acil",soon:"Öncelikli",routine:"Rutin"};
export const triageReasons={
  breathing:"Nefes güçlüğü",poison:"Zehirlenme şüphesi",bleeding:"Kanama",seizure:"Nöbet veya kasılma",collapse:"Bayılma veya bilinç kaybı",
  trauma:"Kaza veya düşme",urinary:"İdrar yapamama",bloat:"Karın şişmesi",birth:"Zor doğum",heat:"Sıcak çarpması",eye:"Göz yaralanması",
  vomit:"Kusma",diarrhea:"İshal",not_eating:"Yemiyor",lethargy:"Halsizlik",wound:"Yara veya dikiş",limp:"Topallama",eye_soon:"Göz sorunu",
  fever:"Ateş",cough:"Öksürük veya hapşırma",swelling:"Şişlik",pain:"Ağrı",appetite_none:"Hiç yemedi",water_less:"Su içmesi azaldı",
  appetite_activity:"Yemiyor ve hareketsiz",contact:"Aranma isteği",med_missed:"İlaç dozu atlandı",
};
const advice={
  urgent:{title:"Bu durum acil olabilir",text:"Lütfen beklemeden kliniğinizi arayın ve hayvanınızı en kısa sürede kliniğe götürün. Klinik kapalıysa ve ulaşamıyorsanız en yakın 7/24 açık veteriner kliniğine başvurun."},
  soon:{title:"Bugün içinde kliniğinizle görüşün",text:"Gözleminiz kliniğe öncelikli olarak iletildi. Durum kötüleşirse veya yeni belirtiler eklenirse beklemeden arayın."},
  routine:{title:"Gözleminiz kliniğe iletildi",text:"Klinik gözleminizi inceleyip size yanıt verecek."},
};
const liveAdvice={
  urgent:{title:"Yazdıklarınız acil olabilecek bir duruma işaret ediyor",text:"Gözleminizi göndermeyi beklemeden kliniğinizi arayın. Klinik kapalıysa ve ulaşamıyorsanız en yakın 7/24 açık veteriner kliniğine başvurun."},
  soon:{title:"Bu belirtiler için bugün kliniğinizle görüşün",text:"Gözleminizi gönderdiğinizde kliniğe öncelikli olarak iletilecek."},
};
const disclaimer="Bu uyarı yazdıklarınıza göre yapılan otomatik bir ön değerlendirmedir, tanı değildir.";
const medicationAdvice="Atlanan dozu telafi etmek için iki doz birden vermeyin; kliniğinize danışın.";

function phoneLine(label,number,preserve=false){
  const line=element("p","","homecare-phone");
  const text=element("span",label);
  if(preserve)text.setAttribute("data-ui-preserve","");
  const value=element("strong",number);
  value.setAttribute("dir","ltr");
  line.append(text,value);
  const digits=String(number).replace(/[^\d+]/g,"");
  if(digits.length>=7){
    const call=element("a",uiLabel("Hemen ara"),"button small homecare-call");
    call.href="tel:"+digits;
    line.append(call);
  }
  return line;
}
function contactLines(contact){
  const lines=[];
  if(contact?.phone)lines.push(phoneLine(contact.clinic||"Klinik",contact.phone,!!contact.clinic));
  if(contact?.emergency)lines.push(phoneLine("Acil / nöbet hattı",contact.emergency));
  return lines;
}
function reasonList(reasons){
  const list=element("ul","","homecare-reasons");
  for(const code of reasons||[])if(triageReasons[code])list.append(element("li",triageReasons[code]));
  return list;
}
function triageBox(level,reasons,contact,live=false){
  const copy=(live?liveAdvice:advice)[level];
  const box=element("section","","homecare-alert is-"+level);
  box.setAttribute("role",level==="urgent"?"alert":"status");
  if(!copy)return box;
  box.append(element("strong",copy.title,"homecare-alert-title"),element("p",copy.text));
  const named=(reasons||[]).filter(code=>code!=="med_missed"&&triageReasons[code]);
  if(named.length&&level!=="routine")box.append(reasonList(named));
  if(level!=="routine"||!live)box.append(...contactLines(contact));
  if((reasons||[]).includes("med_missed"))box.append(element("p",medicationAdvice,"homecare-alert-note"));
  if(level!=="routine")box.append(element("small",disclaimer));
  return box;
}
function triagePill(level){
  return level&&level!=="routine"?element("span",levelLabels[level],"homecare-pill homecare-level is-"+level):null;
}

export function homeCareRequest(scope,params,body){
  return fetch("/api/homecare?"+new URLSearchParams(params),{
    ...(body?{method:"POST",body:JSON.stringify(body)}:{}),
    headers:{"X-VeTNeT-Scope":scope,...(body?{"Content-Type":"application/json"}:{})},
    signal:AbortSignal.timeout(12000),
  }).then(async response=>{
    if(!response.ok)throw Error((await response.json().catch(()=>null))?.error||"Evde bakım kaydı alınamadı.");
    return response.json();
  });
}

function element(tag,text="",className=""){
  const el=document.createElement(tag);
  el.textContent=text;
  if(className)el.className=className;
  return el;
}
function field(label,input){
  const wrapper=element("label",label);
  input.setAttribute("aria-label",label);
  wrapper.append(input);
  return wrapper;
}
function picker(items){
  const input=element("select");
  for(const [value,label] of Object.entries(items)){
    const option=element("option",label);
    option.value=value;
    input.append(option);
  }
  return input;
}
function paragraph(text){return element("p",text,"homecare-text");}
function submitForm(label,fields,submit){
  const form=element("form","","homecare-form");
  const button=element("button",label,"button primary");
  const status=element("p");
  status.setAttribute("role","status");
  form.append(...fields,button,status);
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(button.disabled)return;
    button.disabled=true;status.textContent="Kaydediliyor…";
    try{await submit();}
    catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
  return form;
}
function noteInput(value="",length=1000){
  const input=element("textarea");
  input.rows=3;input.maxLength=length;input.value=value;
  return input;
}

export function mountHomeCare(root,{scope,patient="",patients,clinic=false,record=""}){
  root.classList.add("homecare");
  const content=element("div","","homecare-content");
  if(patients){
    const choice=picker(Object.fromEntries(patients));
    root.append(field("Hayvan",choice));
    if (patients.has(patient)) choice.value=patient;
    patient=choice.value;
    choice.addEventListener("change",()=>{patient=choice.value;void load();});
  }
  root.append(content);
  let sequence=0;
  async function load(){
    const seq=++sequence,current=patient;
    content.replaceChildren(paragraph("Takip kayıtları yükleniyor…"));
    try{
      const data=await homeCareRequest(scope,{patient:current});
      if(seq===sequence&&root.isConnected)render(data,current);
    }catch(error){
      if(seq===sequence&&root.isConnected)content.replaceChildren(paragraph(error.message));
    }
  }
  function render({plan,items,canWrite,contact},current,notice=""){
    content.replaceChildren();
    if(notice&&typeof notice==="object"){
      const saved=items.find(row=>row.id===notice.id);
      content.append(triageBox(saved?.triage||"routine",saved?.triage_reasons||[],contact));
    }else if(notice){const message=paragraph(notice);message.setAttribute("role","status");content.append(message);}
    const save=async body=>{
      const seq=sequence;
      const data=await homeCareRequest(scope,{patient:current},body);
      if(clinic&&body.action==="review")window.dispatchEvent(new Event("vetnet-homecare-reviewed"));
      if(seq===sequence&&root.isConnected)
        render(data,current,body.action==="observe"?{id:body.id}:"Takip kaydı güncellendi.");
    };
    const active=Number(plan?.active)===1;
    const hero=element("header","","homecare-hero");
    const heading=element("div","","homecare-heading");
    heading.append(element("h3",clinic?"Takip planı":"Takip planım"),
      paragraph(clinic?"Hasta sahibine iletilen planı ve ev gözlemlerini buradan takip edin.":"Kliniğinizin talimatlarını ve gönderdiğiniz gözlemleri burada görebilirsiniz."));
    hero.append(heading,element("span",active?"Takip açık":"Takip kapalı","homecare-pill"+(active?" is-active":"")));
    content.append(hero);
    if(plan?.instructions){
      const instructions=element("section","","homecare-card");
      instructions.append(element("h3","Bakım talimatı"),paragraph(plan.instructions));
      if(plan.updated_at)instructions.append(element("small","Son güncelleme · "+homeCareTime(plan.updated_at)));
      content.append(instructions);
    }
    if(clinic&&canWrite){
      const instructions=noteInput(plan?.instructions??"",2000);
      const status=picker({closed:"Kapalı",open:"Gözlem kabul ediyor"});
      status.value=active?"open":"closed";
      const editor=element("details","","homecare-card");
      editor.open=!plan;
      editor.append(element("summary",plan?"Bakım planını düzenle":"Bakım planı oluştur"),
        submitForm("Bakım planını kaydet",[
          field("Hasta sahibine bakım talimatı",instructions),field("Plan durumu",status),
        ],()=>save({action:"plan",instructions:instructions.value,active:status.value==="open"})));
      content.append(editor);
    }
    if(!clinic&&!active)content.append(paragraph("Şu anda gözlem kabul eden bir bakım planı yok."));
    if(!clinic&&active){
      const observation=picker(observations),note=noteInput();
      const id=crypto.randomUUID();
      const details=element("details","","homecare-measurements");
      const formGrid=element("div","","homecare-field-grid");
      const entries=Object.entries(checkinFields).map(([key,{label,values}])=>{
        const input=picker({"":"Belirtilmedi",...values});
        formGrid.append(field(label,input));
        return [key,input];
      });
      const weight=element("input");
      weight.inputMode="decimal";weight.maxLength=8;weight.placeholder="Örn. 4,25";
      formGrid.append(field("Evde ölçülen kilo (kg)",weight));entries.push(["weight",weight]);
      details.append(element("summary","İştah, su, hareket, ilaç ve kilo ekle"),formGrid);
      const checkin=element("section","","homecare-card");
      const emergencyHint=element("div","","homecare-hint");
      emergencyHint.append(paragraph("Klinik gözlemleri daha sonra inceler. Acil durumda kliniğinizi doğrudan arayın."),...contactLines(contact));
      const live=element("div","","homecare-live");
      live.setAttribute("aria-live","polite");
      const collect=()=>({observation:observation.value,note:note.value,
        details:Object.fromEntries(entries.map(([key,input])=>[key,input.value.trim()]))});
      let timer=0,shown="";
      const refresh=()=>{clearTimeout(timer);timer=setTimeout(async()=>{
        try{
          const result=evaluate(await loadRules(),collect());
          const key=result.level+":"+result.reasons.join(",");
          if(key===shown)return;
          shown=key;
          live.replaceChildren(result.level==="routine"?"":triageBox(result.level,result.reasons,contact,true));
        }catch{/* Kurallar yüklenemezse sunucu değerlendirmesi yine yapılır. */}
      },300);};
      for(const input of [observation,note,...entries.map(([,input])=>input)]){input.addEventListener("input",refresh);input.addEventListener("change",refresh);}
      const form=submitForm("Gözlemi gönder",[field("Evdeki durum",observation),details,field("Gözlem notu",note),live],
          ()=>save({action:"observe",id,...collect()}));
      checkin.append(element("h3","Yeni gözlem"),emergencyHint,form);
      content.append(checkin);
    }
    content.append(element("h3","Gönderilen gözlemler"));
    if(!items.length)content.append(paragraph("Henüz gözlem gönderilmedi."));
    const pending=items.filter(row=>!row.decision).length;
    if(items.length&&clinic){
      const filter=picker({all:"Tümü",pending:"İnceleme bekliyor",priority:"Acil ve öncelikli",callback:"Aranma isteği",reviewed:"Sonuçlanmış"});
      content.append(paragraph(pending+" bekleyen · Son "+items.length+" gözlem"),field("Gözlemleri filtrele",filter));
      filter.addEventListener("change",()=>{
        for(const item of content.querySelectorAll(".homecare-entry")){
          item.hidden=filter.value==="pending"?item.dataset.reviewed==="yes":
            filter.value==="reviewed"?item.dataset.reviewed==="no":
            filter.value==="callback"?item.dataset.callback==="no":
            filter.value==="priority"?item.dataset.triage==="routine":false;
        }
      });
    }
    for(const row of items){
      const article=element("article","","homecare-entry");
      article.dataset.reviewed=row.decision?"yes":"no";
      article.dataset.callback=row.observation==="contact"?"yes":"no";
      const meta=element("header","","homecare-entry-head");
      article.dataset.triage=row.triage||"routine";
      if(row.triage&&row.triage!=="routine")article.classList.add("is-"+row.triage);
      meta.append(element("h4",observations[row.observation]||"Ev gözlemi"),
        ...[triagePill(row.triage)].filter(Boolean),
        element("span",decisions[row.decision]||"İnceleme bekliyor","homecare-pill"+(row.decision?" is-active":" is-pending")));
      article.append(meta,element("small",[row.submitted_name,homeCareTime(row.created_at)].filter(Boolean).join(" · ")));
      const recorded=element("dl","","homecare-measurements-list");
      for(const [key,definition] of Object.entries(checkinFields)){
        const label=definition.values[row.details?.[key]];
        if(label){
          const line=element("div");
          line.append(element("dt",definition.label),element("dd",label));
          recorded.append(line);
        }
      }
      if(Number(row.details?.weight)>0){
        const line=element("div");
        line.append(element("dt","Evde ölçülen kilo"),element("dd",kilograms.format(Number(row.details.weight))+" kg"));
        recorded.append(line);
      }
      if(recorded.childElementCount)article.append(recorded);
      if(clinic&&(row.triage_reasons||[]).length)article.append(reasonList(row.triage_reasons));
      if(row.note)article.append(paragraph(row.note));
      if(row.response){
        const reply=element("div","","homecare-reply");
        reply.append(element("strong",row.decision==="called"?"Telefonla arama kaydı":"Klinik yanıtı"),paragraph(row.response));
        const reviewMeta=[row.reviewed_name,homeCareTime(row.reviewed_at)].filter(Boolean);
        if(reviewMeta.length)reply.append(element("small",reviewMeta.join(" · ")));
        article.append(reply);
      }
      if(clinic&&canWrite&&!row.decision){
        const decision=picker(decisions),response=noteInput();
        response.required=true;
        const review=element("details","","homecare-review");
        review.append(element("summary","İncele ve yanıtla"),submitForm("İncelemeyi kaydet",[
          field("İnceleme sonucu",decision),field("Hasta sahibine yanıt",response),
        ],()=>save({action:"review",id:row.id,decision:decision.value,response:response.value})));
        article.append(review);
      }
      if (row.id===record) {
        article.classList.add("owner-current-record");
        if (!root.closest("[hidden]")) requestAnimationFrame(()=>article.scrollIntoView({block:"center"}));
      }
      content.append(article);
    }
  }
  if(patient)void load();
}

export async function mountHomeCareQueue(root,{scope,branch}){
  const countFormat=new Intl.NumberFormat(uiLanguage);
  try{
    const {total,items,callbackCount,urgentCount=0,soonCount=0}=await homeCareRequest(scope,{branch});
    if(!root.isConnected)return;
    const summary=element("dl","","homecare-queue-summary");
    const stats=[[total,"Bekleyen gözlem",""],[callbackCount,"Aranma isteği",""]];
    if(urgentCount)stats.unshift([urgentCount,"Acil gözlem","is-urgent"]);
    if(soonCount)stats.splice(urgentCount?1:0,0,[soonCount,"Öncelikli gözlem","is-soon"]);
    for(const [count,label,tone] of stats){
      const stat=element("div","","homecare-queue-stat"+(tone?" "+tone:""));
      stat.append(element("dt",uiLabel(label)),element("dd",countFormat.format(count??0)));
      summary.append(stat);
    }
    root.replaceChildren(summary);
    if(!total)root.append(element("p",uiLabel("Bu şubede incelenmeyi bekleyen gözlem yok."),"homecare-queue-message"));
    if(items.length){
      const list=element("ul","","homecare-queue");
      for(const row of items){
        const item=element("li","","homecare-queue-row");
        const link=element("a",uiLabel("İncele"),"button small");
        link.setAttribute("aria-label",row.name+" takip kaydını incele");
        link.href="#patient/"+encodeURIComponent(row.patient_id)+"/homecare";
        const identity=element("span","","homecare-queue-patient");
        const kind=row.observation==="contact"?"Aranma isteği":observations[row.observation]||"Ev gözlemi";
        identity.append(element("strong",row.name),element("small",[kind,countFormat.format(row.total)+" kayıt",homeCareTime(row.oldest)].filter(Boolean).join(" · ")));
        const pill=triagePill(row.triage);
        if(pill){item.classList.add("is-"+row.triage);identity.querySelector("strong").after(pill);}
        item.append(identity,link);
        list.append(item);
      }
      root.append(list);
    }
  }catch(error){
    if(!root.isConnected)return;
    const retry=element("button",uiLabel("Yeniden dene"),"button small");
    retry.type="button";
    retry.addEventListener("click",()=>{
      root.replaceChildren(element("p",uiLabel("Gözlemler yükleniyor…"),"homecare-queue-message"));
      void mountHomeCareQueue(root,{scope,branch});
    });
    const message=element("div","","homecare-queue-message homecare-queue-error");
    message.append(paragraph(error.message),retry);
    root.replaceChildren(message);
  }
}
