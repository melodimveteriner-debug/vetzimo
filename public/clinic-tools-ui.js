import {clinicFetch} from "./access.js";
import {opsFetch} from "./center-ops.js";
import {currency,dateLabel,today} from "./model.js";
import {paginate} from "./paged.js";
import {fillPrintTemplate,printCategories,printFields} from "./print-model.js";

const asDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||"")?dateLabel(value,{day:"numeric",month:"long",year:"numeric"}):String(value||"").replace("T"," ");
const asMoney=value=>value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))?currency.format(Number(value)):"";
const recordNames={vaccine:"Aşı kaydı",exam:"Muayene",stay:"Konaklama",surgery:"Ameliyat",sale:"Satış",purchase:"Alış"};
const recordCategories={patient:["vaccine","exam"],owner:["exam"],exam:["exam","vaccine"],stay:["stay"],surgery:["surgery"],sale:["sale"],purchase:["purchase"]};

export async function mountTemplates(ui,params,{branch:activeBranch}) {
  const {view,heading,el,field,selectField,makeForm,status,reauth}=ui;
  const endpoint="/api/ops/templates";
  const read=async()=>{
    const response=await clinicFetch(endpoint+(params.toString()?"?"+params:""));
    const result=await response.json();
    if (!response.ok) throw Error(result.error||"Şablonlar yüklenemedi.");
    return result;
  };
  let data=await read();
  if (!view.isConnected) return;
  let category="", query="";
  const detail=el("section","",{className:"panel suite-panel template-detail",hidden:true});
  const search=field("template-search","Şablon ara",{type:"search",placeholder:"Örneğin aşı kartı",required:false});
  const tableArea=el("div");
  const filters=el("div","",{className:"suite-tabs",ariaLabel:"Belge kategorileri"});
  const catalog=el("section","",{className:"panel suite-panel"});
  const toolbar=el("div","",{className:"suite-toolbar"});
  const button=(text,handler,{primary=false,disabled=false,extra=""}={})=>{
    const node=el("button",text,{type:"button",className:"button "+(primary?"primary ":"")+extra,disabled});
    node.addEventListener("click",handler);
    return node;
  };
  const selector=(name,label,options)=>selectField(name,label,options,false);
  const input=wrapper=>wrapper.querySelector("input,textarea,select");
  const textArea=(name,label,value="",maxLength=8000)=>{
    const wrap=el("label",label);
    wrap.append(el("textarea","",{name,value,maxLength}));
    return wrap;
  };
  function open(title,description,...content) {
    const top=el("header","",{className:"suite-toolbar"});
    const copy=el("div");
    copy.append(el("h2",title,{tabIndex:-1}),el("p",description,{className:"suite-muted"}));
    top.append(copy,button("Listeye dön",()=>{
      detail.replaceChildren();detail.hidden=true;catalog.hidden=false;
      toolbar.querySelector("input").focus();
    }));
    detail.replaceChildren(top,...content);
    detail.hidden=false;catalog.hidden=true;
    copy.firstChild.focus({preventScroll:true});
    detail.scrollIntoView({block:"start"});
  }
  async function mutate(action,payload,notice) {
    await opsFetch(endpoint+"/"+action,payload,data.scopeId);
    data=await read();
    detail.replaceChildren();detail.hidden=true;catalog.hidden=false;
    draw();
    status.textContent=notice;
  }
  async function actionFrom(button,action) {
    if (button.disabled) return;
    button.disabled=true;
    try {await action();}
    catch(error) {status.textContent=error.message;}
    finally {button.disabled=false;}
  }
  function formatted(target,body,values) {
    target.replaceChildren();
    let list, table;
    for (const line of String(body).split(/\r?\n/)) {
      if (!line.trim()) {list=null;table=null;continue;}
      if (line.startsWith("| ")&&line.endsWith(" |")) {
        list=null;
        const cells=line.slice(2,-2).split(/\s*\|\s*/).slice(0,8);
        if (!table) {
          table=el("table","",{className:"template-paper-table"});
          const row=table.createTHead().insertRow();
          for (const text of cells) row.append(el("th",fillPrintTemplate(text,values),{scope:"col"}));
          table.createTBody();
          target.append(table);
        } else {
          const row=table.tBodies[0].insertRow();
          for (const text of cells) row.insertCell().textContent=fillPrintTemplate(text,values);
        }
        continue;
      }
      table=null;
      const heading=line.startsWith("## "), bullet=line.startsWith("- ");
      const node=el(heading?"h4":bullet?"li":"p");
      const value=heading?line.slice(3):bullet?line.slice(2):line;
      for (const [i,text] of value.split(/\*\*/).entries()) {
        const resolved=fillPrintTemplate(text,values);
        node.append(i%2?el("strong",resolved):document.createTextNode(resolved));
      }
      if (bullet) {
        if (!list) {list=el("ul");target.append(list);}
        list.append(node);
      } else {list=null;target.append(node);}
    }
  }
  function documentPreview(template,values,{sample=false}={}) {
    const page=el("article","",{className:"template-paper"});
    const top=el("header","",{className:"template-paper-head"});
    const mark=/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(values.logo||"")?
      el("img","",{alt:"Klinik logosu",src:values.logo}):
      el("span",String(values.klinik||"VT").trim().split(/\s+/).slice(0,2).map(word=>word[0]).join("").toLocaleUpperCase("tr"),{className:"template-paper-mark"});
    const org=el("div");
    org.append(el("strong",values.klinik||"VetZimo"),el("small",[values.sube,values.klinik_telefon,values.klinik_adres].filter(Boolean).join(" · ")));
    top.append(mark,org,el("time",values.tarih||asDate(today())));
    page.append(top,el("p",printCategories[template.category]||"Belge",{className:"template-paper-kicker"}),el("h2",template.title||"Başlıksız belge"));
    if (sample) page.append(el("p","ÖRNEK ÇIKTI · Eğitim ve önizleme",{className:"template-paper-sample"}));
    const identity=el("dl","",{className:"template-paper-identities"});
    for (const [label,value] of [["Hasta",values.hasta],["Hasta sahibi",values.musteri],["Tür / ırk",[values.tur,values.irk].filter(Boolean).join(" / ")],["Protokol",values.protokol]]) {
      if (!value) continue;
      const box=el("div");box.append(el("dt",label),el("dd",value));identity.append(box);
    }
    if (identity.children.length) page.append(identity);
    const body=el("div","",{className:"template-paper-body"});
    formatted(body,template.body,values);
    page.append(body,el("footer","VetZimo · "+(values.sube||values.klinik||"Klinik kaydı")));
    return page;
  }
  const example={
    klinik:"Örnek Veteriner Kliniği",sube:"Merkez",klinik_telefon:"0 (000) 000 00 00",
    musteri:"Örnek Hasta Sahibi",hasta:"Mia",tur:"Kedi",irk:"Tekir",protokol:"ÖRNEK-001",tarih:asDate(today()),
    hekim:"Örnek Veteriner Hekim",islem:"Kontrol muayenesi",asi:"Kuduz",asi_durum:"Tamamlandı",
    asi_tarihi:asDate(today()),uygulama_tarihi:asDate(today()),muayene_tarihi:asDate(today()),satis_tarihi:asDate(today()),
    kalemler:"Kontrol muayenesi × 1",toplam:asMoney(900),tahsilat:asMoney(900),odeme:"Nakit",belge_no:"ÖRNEK-001",
    tedarikci:"Örnek Tedarikçi",urun:"Örnek ürün",adet:"2",oda:"Oda 01",not:"Örnek açıklama alanı",
  };
  function print(page) {
    const area=document.getElementById("printArea");
    if (!page||!area) return;
    area.replaceChildren(page.cloneNode(true));
    document.body.classList.add("suite-printing");
    window.addEventListener("afterprint",()=>{
      document.body.classList.remove("suite-printing");
      area.replaceChildren();
    },{once:true});
    window.print();
  }
  function edit(row={}) {
    const title=field("title","Belge adı",{value:row.title||"",maxLength:120});
    const type=selector("category","Belge türü",Object.entries(printCategories));
    input(type).value=row.category||category||"patient";
    const content=textArea("body","Belge içeriği",row.body||"");
    const textarea=input(content);textarea.required=true;textarea.rows=13;
    const active=field("active","Etkin şablon",{type:"checkbox",checked:row.active===undefined||Boolean(row.active),required:false});
    const tools=el("div","",{className:"suite-tabs",ariaLabel:"Belge biçimlendirme"});
    const insert=(before,after="",fallback="")=>{
      const start=textarea.selectionStart,end=textarea.selectionEnd;
      textarea.setRangeText(before+(textarea.value.slice(start,end)||fallback)+after,start,end,"end");
      textarea.focus();refresh();
    };
    tools.append(button("Başlık",()=>insert("\n## ","\n","Bölüm başlığı")),
      button("Kalın",()=>insert("**","**","Vurgulu metin")),
      button("Liste",()=>insert("\n- ","\n","Liste maddesi")),
      button("Tablo",()=>insert("\n\n","","| İşlem / malzeme | Adet | Birim fiyat | Tutar |\n| ______ | ___ | ______ | ______ |\n")),
      button("İmza satırı",()=>insert("\n\n","","İmza ____________________")));
    const fields=el("details","",{className:"suite-placeholder"});
    fields.open=true;
    const tags=el("div","",{className:"suite-tabs"});
    for (const [key,label] of Object.entries(printFields)) tags.append(button(label,()=>insert("{{"+key+"}}"),{extra:"small"}));
    fields.append(el("summary","Otomatik alanlar · tıklayarak ekleyin"),tags);
    const preview=el("div","",{className:"template-canvas"});
    const refresh=()=>preview.replaceChildren(documentPreview({title:input(title).value,category:input(type).value,body:textarea.value},example,{sample:true}));
    const form=makeForm([title,type,tools,fields,content,active],"Şablonu kaydet",async values=>{
      await mutate("save",{...values,id:row.id,active:values.active==="on"},"Şablon kaydedildi.");
    });
    form.addEventListener("input",refresh);
    form.addEventListener("change",refresh);
    const frame=el("div","",{className:"template-editor-grid"});
    const previewBox=el("div");
    previewBox.append(button("Örneği yazdır / PDF",()=>print(preview.firstElementChild)),preview);
    frame.append(form,previewBox);
    open(row.id?"Şablonu düzenle":"Yeni çıktı şablonu","Biçimlendirin, otomatik alanları yerleştirin ve örneği inceleyin.",frame);
    refresh();
  }
  function output(row,sample=false) {
    const preview=el("div","",{className:"template-canvas"});
    const printButton=button("Yazdır / PDF olarak kaydet",()=>print(preview.firstElementChild),{primary:true});
    if (sample) {
      preview.append(documentPreview(row,example,{sample:true}));
      open("Örnek çıktı",row.title,printButton,preview);
      return;
    }
    const initialRecordType=["vaccine","exam","stay","surgery","sale","purchase"].find(key=>params.has(key));
    const initialRecord=data.records[initialRecordType]?.find(item=>item.id===params.get(initialRecordType));
    const initialPatient=data.patients.find(item=>item.id===(params.get("patient")||initialRecord?.patient));
    const initialClient=data.clients.find(item=>item.id===(params.get("client")||initialRecord?.client||initialPatient?.owner));
    const branch=selector("branch","Şube",data.branches.map(item=>[item.id,item.name]));
    const client=selector("client","Hasta sahibi",[]);
    const patient=selector("patient","Hasta",[]);
    const date=field("date","Belge tarihi",{type:"date",value:today(),required:false});
    const manualClient=field("manual-client","Hasta sahibi (elle)",{required:false,maxLength:160});
    const manualPatient=field("manual-patient","Hasta adı (elle)",{required:false,maxLength:160});
    const procedure=field("procedure","İşlem açıklaması",{required:false,maxLength:280});
    const note=textArea("note","Ek açıklama","",2500);
    input(note).rows=3;
    const scope=data.branches.find(item=>item.id===activeBranch);
    const initialScope=initialRecord?.branch||initialPatient?.branch||initialClient?.branch;
    input(branch).value=scope?.dataId===initialScope||!initialScope?(scope?.id||data.branches[0]?.id):
      data.branches.find(item=>item.dataId===initialScope)?.id||data.branches[0]?.id;
    const controls=el("div","",{className:"suite-form template-controls"});
    const selectors=Object.fromEntries(recordCategories[row.category].map(key=>[key,selector(key,recordNames[key],[])]));
    const currentOffice=()=>data.branches.find(item=>item.id===input(branch).value);
    const inBranch=item=>item.branch===currentOffice()?.dataId;
    const choices=(wrapper,items,label,value)=>{
      const select=input(wrapper);
      select.replaceChildren(el("option","Seçiniz / boş bırakın",{value:""}),...items.map(item=>el("option",label(item),{value:item.id})));
      if (items.some(item=>item.id===value)) select.value=value;
    };
    function update() {
      const office=currentOffice(), patientId=input(patient).value, clientId=input(client).value;
      const selectedRecords=Object.fromEntries(Object.entries(selectors).map(([key,wrap])=>[
        key,data.records[key].find(item=>inBranch(item)&&item.id===input(wrap).value),
      ]));
      const {vaccine,exam,stay,surgery,sale,purchase}=selectedRecords;
      const p=data.patients.find(item=>inBranch(item)&&item.id===(patientId||sale?.patient||exam?.patient||stay?.patient||surgery?.patient||vaccine?.patient));
      const c=data.clients.find(item=>inBranch(item)&&item.id===(clientId||sale?.client||p?.owner));
      const product=data.products.find(item=>inBranch(item)&&item.id===purchase?.product);
      const supplier=data.suppliers.find(item=>inBranch(item)&&item.id===purchase?.supplier);
      const values={klinik:data.clinic.name,sube:office?.name,klinik_telefon:office?.phone||data.clinic.phone,
        klinik_adres:office?.address||data.clinic.address,logo:data.clinic.logo,
        musteri:input(manualClient).value.trim()||c?.name,musteri_telefon:c?.phone,musteri_eposta:c?.email,musteri_adres:c?.address,
        hasta:input(manualPatient).value.trim()||p?.name,tur:p?.species,irk:p?.breed,cinsiyet:p?.sex,dogum:asDate(p?.birth),kilo:surgery?.weight||p?.weight,
        protokol:p?.protocol,cip:p?.chip,islem:input(procedure).value.trim()||exam?.title||vaccine?.title||surgery?.procedure||sale?.detail||stay?.kind||product?.name,
        tarih:asDate(input(date).value),not:input(note).value.trim()||sale?.publicNotes,hekim:exam?.clinician||vaccine?.clinician||surgery?.surgeon,
        asi:vaccine?.title,asi_tarihi:asDate(vaccine?.date),uygulama_tarihi:asDate(vaccine?.done),sonraki_asi:asDate(vaccine?.next),lot:vaccine?.batch||purchase?.serial,asi_durum:vaccine?.status,
        muayene_tarihi:asDate(exam?.date),sikayet:exam?.complaint,bulgular:exam?.findings,tani:exam?.assessment,plan:exam?.plan,kontrol:asDate(exam?.next),
        satis_tarihi:asDate(sale?.date),belge_no:sale?.invoice||purchase?.invoice,kalemler:sale?.lines.map(item=>item.name+" × "+item.quantity).join("\n"),
        toplam:asMoney(sale?.amount??purchase?.amount),tahsilat:asMoney(sale?.paid),odeme:sale?.method,
        yatis:asDate(stay?.start),cikis:asDate(stay?.end),oda:stay?.room,
        ameliyat_tarihi:[asDate(surgery?.date),surgery?.time].filter(Boolean).join(" "),operasyon:surgery?.procedure,cerrah:surgery?.surgeon,anestezist:surgery?.anesthetist,asa:surgery?.asa,
        premedikasyon:surgery?.premed,anestezi:surgery?.anesthesia,operasyon_notu:surgery?.findings,komplikasyon:surgery?.complications,bakim_plani:surgery?.postop,dikis_kontrol:asDate(surgery?.next),onam_veren:surgery?.consentBy,tedarikci:supplier?.name,urun:product?.name,adet:purchase?.quantity};
      preview.replaceChildren(documentPreview(row,values));
    }
    function records(values={}) {
      const clientId=input(client).value, patientId=input(patient).value;
      const allowedPatients=new Set(data.patients.filter(item=>inBranch(item)&&item.owner===clientId).map(item=>item.id));
      for (const [key,wrapper] of Object.entries(selectors)) {
        const candidates=data.records[key].filter(item=>inBranch(item)&&(!patientId||item.patient===patientId||key==="purchase"||(key==="sale"&&!item.patient))&&
          (!clientId||item.client===clientId||allowedPatients.has(item.patient)||key==="purchase"));
        choices(wrapper,candidates,item=>[asDate(item.date||item.start),item.title||item.detail||item.invoice||item.room||item.id].filter(Boolean).join(" · "),values[key]);
        wrapper.hidden=!candidates.length;
      }
    }
    function patients(selected="") {
      choices(patient,data.patients.filter(item=>inBranch(item)&&(!input(client).value||item.owner===input(client).value)),item=>item.name,selected);
    }
    function branchChoices(clientId="",patientId="") {
      choices(client,data.clients.filter(inBranch),item=>item.name,clientId);
      patients(patientId);
    }
    branchChoices(initialClient?.id,initialPatient?.id);
    records(initialRecordType?{[initialRecordType]:initialRecord?.id}:{});
    input(branch).addEventListener("change",()=>{branchChoices();records();});
    input(client).addEventListener("change",()=>{patients();records();});
    input(patient).addEventListener("change",()=>records());
    for (const [key,wrapper] of Object.entries(selectors)) {
      input(wrapper).addEventListener("change",()=>{
        const picked=data.records[key].find(item=>inBranch(item)&&item.id===input(wrapper).value);
        if (!picked?.patient&&!picked?.client) return;
        const linkedPatient=data.patients.find(item=>inBranch(item)&&item.id===picked.patient);
        const linkedClient=picked.client||linkedPatient?.owner;
        const selected=Object.fromEntries(Object.entries(selectors).map(([type,field])=>[type,input(field).value]));
        branchChoices(linkedClient,picked.patient);
        records(selected);
      });
    }
    controls.append(branch,client,patient,...Object.values(selectors),date,procedure,manualClient,manualPatient,note);
    controls.addEventListener("input",update);
    controls.addEventListener("change",update);
    open("Çıktı hazırla",row.title,controls,printButton,preview);
    update();
  }
  function draw() {
    filters.replaceChildren(...[["","Tüm şablonlar"],...Object.entries(printCategories).filter(([key])=>data.allowed.includes(key))].map(([key,label])=>{
      const tab=button(label,()=>{category=key;draw();filters.querySelector('[aria-pressed="true"]')?.focus();},{extra:"small"});
      tab.setAttribute("aria-pressed",String(category===key));
      return tab;
    }));
    const results=data.templates.filter(row=>(!category||row.category===category)&&
      (!query||row.title.toLocaleLowerCase("tr-TR").includes(query)));
    tableArea.replaceChildren(paginate(results,rows=>{
      if (!rows.length) return el("p","Bu seçimde şablon bulunamadı.",{className:"suite-muted"});
      const wrap=el("div","",{className:"suite-table"});
      const table=el("table");
      const head=table.createTHead().insertRow();
      for (const label of ["Durum","Şablon adı","İşlemler"]) head.append(el("th",label,{scope:"col"}));
      const body=table.createTBody();
      for (const row of rows) {
        const tr=body.insertRow();
        if (data.canEdit) {
          const toggle=button(row.active?"Etkin":"Kapalı",event=>actionFrom(event.currentTarget,()=>mutate("save",{...row,active:!row.active},"Şablon durumu güncellendi.")),{extra:"small suite-toggle"});
          toggle.setAttribute("aria-pressed",String(Boolean(row.active)));
          toggle.setAttribute("aria-label",row.title+" etkin");
          tr.insertCell().append(toggle);
        } else tr.insertCell().textContent="Etkin";
        const title=tr.insertCell();
        title.append(el("strong",row.title),el("small",printCategories[row.category]+" · "+(row.system?"Sistem şablonu":"Bayi şablonu")));
        const actions=el("div","",{className:"suite-tabs"});
        actions.append(button("Çıktı hazırla",()=>output(row),{extra:"small",disabled:!row.active}),button("Örnek çıktı",()=>output(row,true),{extra:"small"}));
        if (data.canEdit) {
          actions.append(button("Düzenle",()=>edit(row),{extra:"small"}),button("Kopyala",()=>edit({...row,id:undefined,title:row.title.slice(0,112)+" · Kopya"}),{extra:"small"}));
          if (!row.system) actions.append(button("Sil",event=>{
            if (window.confirm("Bu özel şablon silinsin mi?")) void actionFrom(event.currentTarget,()=>mutate("delete",{id:row.id},"Şablon silindi."));
          },{extra:"small suite-danger"}));
        }
        tr.insertCell().append(actions);
      }
      wrap.append(table);return wrap;
    },15));
  }
  heading("Çıktı Şablonları","Klinik belgelerini seçin, düzenleyin ve hasta dosyasından kişiselleştirilmiş çıktı alın.");
  toolbar.append(search);
  if (data.canEdit) toolbar.append(button("+ Yeni şablon",()=>edit(),{primary:true}));
  catalog.append(toolbar,filters,tableArea);
  view.append(...(data.canEdit?[reauth(data.preview)]:[]),catalog,detail);
  input(search).addEventListener("input",()=>{query=input(search).value.trim().toLocaleLowerCase("tr-TR");draw();});
  draw();
  const direct=Object.keys(printCategories).find(key=>params.has(key));
  const initialCategory=params.has("client")?"owner":params.has("vaccine")?"patient":direct;
  if (initialCategory) {
    category=initialCategory;
    const first=data.templates.find(row=>row.active&&row.category===initialCategory);
    if (first) output(first);
    draw();
  }
}
