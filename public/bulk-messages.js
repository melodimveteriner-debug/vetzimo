import {operationApi} from "./operations.js";
import {paginate} from "./paged.js";

const statuses={queued:"Sırada",sent:"Sağlayıcıya iletildi",delivered:"Teslim edildi",unknown:"Sonuç doğrulanamadı",
  rejected:"Sağlayıcı reddetti",skipped:"Atlandı",ready:"Gönderime hazır",reserved:"İşleniyor",failed:"Başarısız",undelivered:"Teslim edilemedi"};
const normalized=value=>String(value||"").trim().toLocaleLowerCase("tr");
const byDate=(a,b)=>String(a.date||"").localeCompare(String(b.date||""))||a.id.localeCompare(b.id);
const phoneKey=value=>String(value||"").replace(/\D/g,"").replace(/^(?:0090|90|0)(?=5\d{9}$)/,"");

export function audienceEntries(clients,patients,vaccines,{species="",overdue=false,search="",channel="sms",today}) {
  const match=new Map(), expired=new Map();
  for (const row of vaccines.filter(row=>row.kind==="Aşı" && row.date && row.date<today && !row.done &&
    !["Tamamlandı","İptal"].includes(row.status)).sort(byDate)) {
    if (!expired.has(row.patient)) expired.set(row.patient,row);
  }
  for (const patient of patients) {
    if (!patient.owner || (species && normalized(patient.species)!==normalized(species)) || (overdue && !expired.has(patient.id))) continue;
    if (!match.has(patient.owner)) match.set(patient.owner,[]);
    match.get(patient.owner).push(patient);
  }
  const term=normalized(search);
  return clients.flatMap(client=>{
    const pets=match.get(client.id)||[];
    if ((species || overdue) && !pets.length) return [];
    if (term && ![client.name,client.phone,...pets.map(row=>row.name)].some(text=>normalized(text).includes(term))) return [];
    if (term) pets.sort((a,b)=>Number(normalized(b.name).includes(term))-Number(normalized(a.name).includes(term)));
    if (overdue) pets.sort((a,b)=>byDate(expired.get(a.id),expired.get(b.id)));
    const patient=pets[0];
    const phone=phoneKey(client.phone);
    return [{client,patient,pets,vaccine:expired.get(patient?.id),phone,eligible:/^5\d{9}$/.test(phone) && client[channel]==="Var"}];
  });
}

export function mountBulkMessages(root,{templates,patients,clients,vaccines,branchId,previewOnly,esc,today,selectedTemplate}) {
  const action=(key,label,css="")=>`<button type="button" class="button ${css}" data-bulk="${key}">${label}</button>`;
  const species=[...new Map(["Kedi","Köpek",...patients.map(row=>row.species).filter(Boolean)]
    .map(value=>[normalized(value),value])).values()].sort((a,b)=>a.localeCompare(b,"tr"));
  root.innerHTML=`<section class="panel bulk-panel"><header class="operation-heading"><div><h1>Toplu SMS ve WhatsApp</h1><p>Alıcı grubunu oluştur, mesajı incele ve tek seferde onayla.</p></div>
    <div class="bulk-actions"><a class="button" href="#templates">Mesaj şablonları</a><a class="button" href="#bayi-mesajlari">Gönderim geçmişi</a></div></header>
    <div class="bulk-config">
      <label class="form-field"><span>Gönderim kanalı</span><select name="channel"><option value="sms">SMS · Netgsm</option><option value="whatsapp">WhatsApp</option></select></label>
      <label class="form-field"><span>Mesaj şablonu</span><select name="templateId"></select></label>
      <label class="form-field"><span>SMS gönderim türü</span><select name="iysfilter"><option value="0">Bilgilendirme</option><option value="11">Ticari · bireysel (İYS)</option><option value="12">Ticari · tacir (İYS)</option></select></label>
      <label class="form-field bulk-wide" data-message><span>SMS metni</span><textarea name="message" rows="3" maxlength="912" placeholder="Örn. Merhaba {sahip}, kliniğimizin çalışma saatleri güncellendi."></textarea></label>
    </div>
    <h2>Alıcı grubu</h2><div class="bulk-actions">
      ${action("everyone","Tüm hasta sahipleri")}${action("cats","Kedi sahipleri")}${action("dogs","Köpek sahipleri")}${action("late","Aşısı geçenler")}
    </div><div class="bulk-config"><label class="form-field"><span>Müşteri, telefon veya hasta ara</span><input name="filter" type="search"></label>
      <label class="form-field"><span>Hasta türü</span><select name="species"><option value="">Tüm türler</option>
        ${species.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select></label>
      <label class="bulk-check"><input name="overdue" type="checkbox"> Yalnızca aşısı geçenler</label></div>
    <p class="muted" data-selection></p><div class="bulk-actions">${action("all","Filtredeki izinli alıcıları seç")}${action("clear","Seçimi temizle")}</div>
    <div data-recipients></div>
    <div class="bulk-actions">${action("preview","Mesajları önizle","primary")}</div>
    <p role="status" data-bulk-status></p><div data-bulk-results></div></section>`;
  const get=name=>root.querySelector('[name="'+name+'"]');
  const output=root.querySelector("[data-bulk-results]"),message=root.querySelector("[data-bulk-status]"),list=root.querySelector("[data-recipients]");
  const selected=new Map();
  let matches=[],byId=new Map(),snapshot=null,running=false,requestId="";
  const todayValue=today();
  const rankedVaccines=patient=>vaccines.filter(row=>row.patient===patient && row.status!=="İptal").sort((a,b)=>
    Number(!(a.date<todayValue && !a.done && a.status!=="Tamamlandı"))-Number(!(b.date<todayValue && !b.done && b.status!=="Tamamlandı"))||byDate(a,b));
  const create=(tag)=>document.createElement(tag);
  function syncTemplates() {
    const sms=get("channel").value==="sms";
    get("templateId").innerHTML=`<option value="">${sms?"Serbest SMS metni":"Onaylı şablon seçin"}</option>`+
      templates.filter(row=>row.channel===(sms?"SMS":"WhatsApp")).map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("");
    get("iysfilter").closest("label").hidden=!sms;
    syncMessage();
  }
  function syncMessage() {root.querySelector("[data-message]").hidden=get("channel").value!=="sms"||!!get("templateId").value;}
  function invalidate() { snapshot=null;requestId="";output.replaceChildren();message.textContent=""; }
  function filters() {
    matches=audienceEntries(clients,patients,vaccines,{species:get("species").value,overdue:get("overdue").checked,
      search:get("filter").value,channel:get("channel").value,today:todayValue});
    byId=new Map(matches.map(row=>[row.client.id,row]));
    renderList();
  }
  function renderList() {
    root.querySelector("[data-selection]").textContent=matches.length+" eşleşme · "+matches.filter(row=>row.eligible).length+" izinli · "+selected.size+" seçili";
    list.replaceChildren(paginate(matches,visible=>{
      const page=create("div");page.className="bulk-people";
      page.innerHTML=visible.length?visible.map(row=>{
        const choice=selected.get(row.client.id), patientId=choice?.patient||row.patient?.id||"";
        const options=rankedVaccines(patientId);
        const label=row.eligible?(row.patient?.name||"Hasta seçilmedi"):"Kanal izni veya geçerli numara yok";
        return `<div class="bulk-person"><label><input type="checkbox" data-person="${esc(row.client.id)}" ${choice?"checked":""} ${row.eligible?"":"disabled"}>
          <strong>${esc(row.client.name)}</strong><small>${esc(label)}</small></label>
          ${choice && row.pets.length>1?`<select data-pet="${esc(row.client.id)}" aria-label="Hasta"><option value="">Hasta seç</option>${row.pets.map(pet=>`<option value="${esc(pet.id)}" ${pet.id===patientId?"selected":""}>${esc(pet.name)}</option>`).join("")}</select>`:""}
          ${choice && options.length?`<select data-vaccine="${esc(row.client.id)}" aria-label="Aşı"><option value="">Aşı seçilmedi</option>${options.map(vaccine=>`<option value="${esc(vaccine.id)}" ${choice.vaccine===vaccine.id?"selected":""}>${esc(vaccine.title)} · ${esc(vaccine.done||vaccine.date)}</option>`).join("")}</select>`:""}</div>`;
      }).join(""):'<p class="muted">Bu filtrede alıcı bulunamadı.</p>';
      return page;
    },10));
  }
  function add(row) {
    if (!row?.eligible) return;
    selected.set(row.client.id,{client:row.client.id,patient:row.patient?.id||"",vaccine:row.vaccine?.id||"",phone:row.phone});
  }
  function show(results,preview) {
    const ready=results.filter(row=>row.status==="ready");
    const accepted=results.filter(row=>["queued","sent","delivered"].includes(row.status)).length;
    const credits=ready.reduce((total,row)=>total+(row.units||0),0);
    output.innerHTML=`<h2>${preview?"Gönderim önizlemesi":"Gönderim sonucu"}</h2>
      <p>${preview?`${ready.length} hazır · ${results.length-ready.length} atlandı · ${credits} kredi`:`${accepted} sağlayıcıya iletildi · ${results.length-accepted} diğer durum`}</p>
      <div data-result-list></div>
      ${preview && previewOnly?'<p class="callout">Özel önizlemede gerçek gönderim kapalıdır.</p>':""}
      ${preview && !previewOnly && ready.length?`<label><input type="checkbox" name="confirmBulk"> Önizlemedeki izinli alıcılara gönderimi onaylıyorum.</label>
      <div class="bulk-actions">${action("send","Onayla ve toplu gönder","primary")}</div>`:""}`;
    output.querySelector("[data-result-list]").append(paginate(results,items=>{
      const ordered=create("ol");ordered.className="bulk-results";
      ordered.innerHTML=items.map(row=>`<li><strong>${esc(row.name||"Kayıt")}</strong><small>${esc(statuses[row.status]||row.status)}${row.units?" · "+row.units+" kredi":""}</small>
        ${row.body?`<p>${esc(row.body)}</p>`:""}${row.reason?`<small>${esc(row.reason)}</small>`:""}</li>`).join("");
      return ordered;
    },8));
  }
  root.addEventListener("input",event=>{
    if (running) return;
    if(event.target===get("filter")) filters();
    if(event.target===get("message")) invalidate();
  });
  root.addEventListener("change",event=>{
    if (running) return;
    const {person,pet,vaccine}=event.target.dataset;
    if (person) {
      if (event.target.checked) add(byId.get(person));else selected.delete(person);
      const focus=event.target;
      invalidate();
      root.querySelector("[data-selection]").textContent=matches.length+" eşleşme · "+matches.filter(row=>row.eligible).length+" izinli · "+selected.size+" seçili";
      if (byId.get(person)?.pets.length>1 || rankedVaccines(byId.get(person)?.patient?.id).length) {
        const activePage=list.querySelector('[aria-current="page"]')?.textContent;
        renderList();
        if (Number(activePage)>1) [...list.querySelectorAll("button")].find(el=>el.textContent===activePage)?.click();
        list.querySelector('[data-person="'+CSS.escape(person)+'"]')?.focus();
      } else focus.focus();
      return;
    }
    if (pet && selected.has(pet)) {selected.get(pet).patient=event.target.value;selected.get(pet).vaccine="";renderList();}
    if (vaccine && selected.has(vaccine)) selected.get(vaccine).vaccine=event.target.value;
    if (event.target===get("channel")) {selected.clear();syncTemplates();filters();}
    if (event.target===get("templateId")) syncMessage();
    if ([get("species"),get("overdue")].includes(event.target)) {selected.clear();filters();}
    invalidate();
  });
  root.addEventListener("click",async event=>{
    const button=event.target.closest("[data-bulk]");
    if (!button || running) return;
    const op=button.dataset.bulk;
    if (["all","clear","everyone","cats","dogs","late"].includes(op)) {
      if (["everyone","cats","dogs","late"].includes(op)) {
        get("filter").value="";get("species").value=species.find(value=>normalized(value)===(op==="cats"?"kedi":op==="dogs"?"köpek":""))||"";
        get("overdue").checked=op==="late";selected.clear();filters();
      }
      if (op==="clear") selected.clear();
      else for (const row of matches) if ((op!=="everyone"||row.pets.length) && !selected.has(row.client.id)) add(row);
      invalidate();renderList();return;
    }
    const payload={branchId,templateId:get("templateId").value,channel:get("channel").value,
      message:get("message").value.trim(),iysfilter:get("channel").value==="sms"?get("iysfilter").value:"0"};
    if (op==="preview" && ((!payload.templateId && (payload.channel!=="sms" || !payload.message)) || !selected.size)) {
      message.textContent="Mesaj metni veya şablon ve en az bir izinli alıcı seçin.";return;
    }
    if (op==="send" && (!snapshot || previewOnly || !get("confirmBulk")?.checked)) {message.textContent="Önizlemeyi ve onayı kontrol edin.";return;}
    running=true;
    const controls=[...root.querySelectorAll("button,select,input,textarea")].filter(el=>!el.disabled);
    controls.forEach(el=>el.disabled=true);
    let processed=0;
    try {
      if (op==="preview") {
        const unique=new Map();
        for (const target of selected.values()) if (!unique.has(target.phone)) unique.set(target.phone,target);
        const targets=[...unique.values()].map(({client,patient,vaccine})=>({client,patient,vaccine}));
        const results=[];
        for(let start=0;start<targets.length;start+=60) {
          message.textContent=Math.min(start+60,targets.length)+" / "+targets.length+" alıcı inceleniyor.";
          const response=await operationApi("dealer/messages/bulk-preview",{...payload,targets:targets.slice(start,start+60)});
          results.push(...response.results);
        }
        snapshot={...payload,targets:results.filter(row=>row.status==="ready").map(({client,patient,vaccine,proof})=>({client,patient,vaccine,proof}))};
        requestId=crypto.randomUUID();
        show(results,true);
      } else {
        const results=[];
        for(let start=0;start<snapshot.targets.length;start+=8) {
          message.textContent=Math.min(start+8,snapshot.targets.length)+" / "+snapshot.targets.length+" alıcı işleniyor.";
          const response=await operationApi("dealer/messages/bulk",{...snapshot,requestId,confirm:true,targets:snapshot.targets.slice(start,start+8)});
          results.push(...response.results);processed=results.length;
        }
        show(results,false);snapshot=null;
      }
      message.textContent="";
    } catch(error) {
      message.textContent=(processed?processed+" alıcı işlendi. Aynı gönderimi tekrar onaylarsan mevcut kayıtlar yeniden gönderilmez. ":"")+error.message;
    } finally {running=false;controls.forEach(el=>el.disabled=false);}
  });
  const initial=templates.find(row=>row.id===selectedTemplate);
  if (initial) get("channel").value=initial.channel==="WhatsApp"?"whatsapp":"sms";
  syncTemplates();
  if (initial) {get("templateId").value=initial.id;syncMessage();}filters();
}
