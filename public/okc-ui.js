import {clinicFetch} from "./access.js";
import {okcScenarios} from "./okc-adapters.js";
import {paginate} from "./paged.js";

const statusNames={
  awaiting:"Ödeme sonucu bekleniyor",review:"Sonuç belirsiz · aynı işlemi sorgula",fiscal_missing:"Ödeme başarılı · mali belge eksik",
  completed:"Simülasyon tamamlandı",declined:"Ödeme reddedildi",failed:"Cihaz işlemi başarısız",cancelled:"İptal",
  partially_refunded:"Kısmen iade",refunded:"İade",pending:"Bekliyor",unknown:"Belirsiz",paid:"Onaylandı",simulated:"Test belgesi",
  none:"Belge yok",simulation_ready:"Simülatör hazır",inactive:"Pasif",unverified:"Üretici doğrulaması bekliyor",
  authorization_required:"Yetkilendirme gerekli",maintenance:"Bakımda",busy:"Cihaz meşgul",start:"Başlatıldı",query:"Sonuç sorgulandı",
  cancel:"İptal",refund:"İade",reconcile:"Test belge mutabakatı",device_registered:"Cihaz kaydı",device_pair:"Eşleştirme",device_default:"Varsayılan cihaz",
  device_enable:"Etkinleştirme",device_disable:"Kapatma",device_maintenance:"Bakım",model_saved:"Model kaydı",license_saved:"Model yetkisi",
};
const label=value=>statusNames[value]||value;
const currency=new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"});
const tl=cents=>currency.format(Number(cents||0)/100);
const payment=value=>value==="cash"?"Nakit":"Kart";
const el=(tag,text="",props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
const button=(text,run)=>{const node=el("button",text,{className:"button secondary",type:"button"});node.addEventListener("click",run);return node;};
const link=(text,href)=>el("a",text,{href,className:"button"});
const section=(title,text="")=>{
  const box=el("section","",{className:"okc-section panel"});
  box.append(el("h2",title));if(text)box.append(el("p",text));return box;
};
const field=(text,name,props={})=>{
  const wrapper=el("label",text);
  wrapper.append(el("input","",{name,required:true,...props}));return wrapper;
};
const select=(text,name,choices,selected="")=>{
  const wrapper=el("label",text),input=el("select","",{name,required:true});
  for (const [value,title] of choices) input.append(el("option",title,{value}));
  if (selected) input.value=selected;
  wrapper.append(input);return wrapper;
};
const table=(headers,rows)=>{
  const wrap=el("div","",{className:"table-wrap okc-table"}), node=el("table"), head=node.createTHead().insertRow();
  for (const title of headers) head.append(el("th",title,{scope:"col"}));
  const body=node.createTBody();
  for (const cells of rows) {
    const row=body.insertRow();
    for (const value of cells) {
      const cell=row.insertCell();
      if (value instanceof Node) cell.append(value);else cell.textContent=value??"";
    }
  }
  wrap.append(node);return wrap;
};
function form(fields,title,handler) {
  const node=el("form","",{className:"okc-form"});
  const submit=el("button",title,{type:"submit",className:"button primary"}), feedback=el("p","",{role:"status",className:"okc-feedback"});
  node.append(...fields,submit,feedback);
  node.addEventListener("submit",async event=>{
    event.preventDefault();submit.disabled=true;feedback.textContent="İşleniyor…";
    try {await handler(Object.fromEntries(new FormData(node)));feedback.textContent="Tamamlandı.";}
    catch(error) {feedback.textContent=error.message;}
    finally {submit.disabled=false;}
  });
  return node;
}
async function okcFetch(path,{scope="",body,query={}}={}) {
  const suffix=new URLSearchParams(Object.entries(query).filter(([,value])=>value));
  const response=await clinicFetch("/api/okc/"+path+(suffix.size?"?"+suffix:""),body?{
    method:"POST",headers:{"Content-Type":"application/json",...(scope?{"X-VeTNet-Scope":scope}:{})},body:JSON.stringify(body),
  }:{});
  const result=await response.json();
  if (!response.ok) throw Error(result.error||"ÖKC işlemi tamamlanamadı.");
  return result;
}
function authForm() {
  const box=el("details");
  box.append(el("summary","Cihaz yönetimi için kimliği yeniden doğrula"),
    form([field("Mevcut şifre","password",{type:"password",autocomplete:"current-password"})],"Kimliği doğrula",async body=>{
      const response=await clinicFetch("/api/identity/reauth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok) throw Error(result.error);
    }));
  return box;
}
function saveFile(data,name,type) {
  const url=URL.createObjectURL(new Blob([data],{type}));
  el("a","",{href:url,download:name}).click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function printReport(headers,rows,day) {
  const page=el("section","",{className:"okc-print-page"});
  page.append(el("h1","ÖKC simülasyon raporu · "+day),el("p","Test raporu. Mali belge veya banka gün sonu değildir."),table(headers,rows));
  document.body.classList.add("okc-print");document.body.append(page);
  window.addEventListener("afterprint",()=>{page.remove();document.body.classList.remove("okc-print");},{once:true});
  window.print();
}
function transactionPanel(call,context,initial,feedback,mayReverse) {
  const panel=el("div","",{className:"okc-progress"});
  const actions=new Map();
  async function transition(current,action,amount) {
    const buttons=Array.from(panel.querySelectorAll("button"));
    if (buttons.some(item=>item.disabled)) return;
    buttons.forEach(item=>item.disabled=true);
    const key=action+":"+current.revision+":"+(amount||0);
    if (!actions.has(key)) actions.set(key,crypto.randomUUID());
    try {
      const data=await call("transaction/"+current.id,{body:{...context,action,actionId:actions.get(key),revision:current.revision,amount}});
      feedback.textContent="";draw(data);
    } catch(error) {feedback.textContent=error.message;}
    finally {buttons.forEach(item=>item.disabled=false);}
  }
  function draw(data) {
    const t=data.transaction;
    const summary=el("div","",{className:"okc-tx-summary"});
    summary.append(el("strong",label(t.status)),el("span","Toplam "+tl(t.amount)+" · KDV "+tl(t.vat)),
      el("span","Ödeme: "+label(t.payment)+" · Belge: "+label(t.fiscal)),el("small","Test referansı "+t.id));
    if (t.refunded) summary.append(el("span","Test iadesi "+tl(t.refunded)));
    const controls=el("div","",{className:"okc-actions"});
    controls.append(button("Mevcut işlemi sorgula",()=>void transition(t,"query")));
    if (mayReverse && t.status==="fiscal_missing") controls.append(button("Test belge mutabakatını tamamla",()=>void transition(t,"reconcile")));
    if (mayReverse && t.status==="awaiting") controls.append(button("Test işlemini iptal et",()=>void transition(t,"cancel")));
    if (mayReverse && ["completed","partially_refunded"].includes(t.status)) {
      const remaining=t.amount-t.refunded;
      const amount=el("input","",{type:"number",min:"0.01",max:(remaining/100).toFixed(2),step:"0.01",value:(remaining/100).toFixed(2),ariaLabel:"Test iade tutarı TL"});
      controls.append(amount,button("Test iadesi yap",()=>{
        if (amount.reportValidity()) void transition(t,"refund",Math.round(Number(amount.value)*100));
      }));
    }
    const history=el("details");history.append(el("summary","İşlem günlüğü"),table(["Zaman","İşlem","Sonuç"],data.events.map(row=>[row.at,label(row.operation),label(row.status)])));
    panel.replaceChildren(summary,controls,history);
  }
  draw(initial);return panel;
}
export async function openOkcCheckout({branch,lines,discount,draftId,requestId,mayReverse,onClose}) {
  const dialog=el("dialog","",{className:"okc-dialog"});
  const close=button("Kapat",()=>dialog.close());
  const status=el("p","Cihazlar kontrol ediliyor…",{role:"status"});
  const content=el("div");
  dialog.append(el("p","SİMÜLASYON · TAHSİLAT YOK",{className:"okc-kicker"}),
    el("h2","Yazar Kasa POS ile Satış Yap"),status,content,close);
  document.body.append(dialog);
  dialog.addEventListener("close",()=>{dialog.remove();onClose?.();},{once:true});
  dialog.showModal();
  const query={branch}, call=(path,options={})=>okcFetch(path,{query,...options});
  try {
    if (requestId.transactionId) {
      const saved=await call("transaction/"+requestId.transactionId);
      if (dialog.open) {
        status.textContent="Bu işlem yalnızca simülasyondur.";
        content.replaceChildren(transactionPanel(call,{branch},saved,status,mayReverse));
      }
      return;
    }
    const data=await call("overview");
    if (!dialog.open) return;
    const devices=data.devices.filter(row=>row.connection==="simulation" && row.state==="paired" && row.active && row.model_active);
    if (!devices.length) {
      status.textContent="Bu şubede etkin ve eşleşmiş bir test cihazı bulunamadı.";
      content.append(link("Yazar kasa cihazlarım","#okc"));
      content.firstChild.addEventListener("click",()=>dialog.close());
      return;
    }
    status.textContent="Bu işlem satış, stok, tahsilat veya mali fiş oluşturmaz.";
    content.append(form([
      select("Test cihazı","deviceId",devices.map(row=>[row.id,row.label+(row.connectionStatus==="busy"?" · işlem bekliyor":"")])),
      select("Ödeme yöntemi","method",[["card","Kart"],["cash","Nakit"]]),
      select("Test senaryosu","scenario",Object.entries(okcScenarios)),
    ],"Test ödemesini başlat",async values=>{
      const saved=await call("start",{body:{branch,mode:"simulation",lines,discount,draftId,requestId:requestId.key,...values}});
      requestId.transactionId=saved.transaction.id;
      if (dialog.open) content.replaceChildren(transactionPanel(call,{branch},saved,status,mayReverse));
    }));
  } catch(error) {if(dialog.open)status.textContent=error.message;}
}
export async function mountOkc(root,{center=false,scope="",branch:initialBranch="",preview=false}={}) {
  let partner="",branch=initialBranch,day="",generation=0;
  const status=el("p","",{role:"status"});
  const view=el("div","",{className:"okc-module"});
  root.replaceChildren(status,view);
  const call=(path,options={})=>okcFetch(path,{scope,query:{partner,branch,day},...options});
  async function draw() {
    const turn=++generation;
    status.textContent="ÖKC kayıtları yükleniyor…";
    try {
      const data=await call("overview");
      if (!root.isConnected || turn!==generation) return;
      const overview=section(center?"Yazar Kasa POS (ÖKC)":"Yazar kasa cihazlarım",
        "Simülasyon ortamı. Test kayıtları gerçek tahsilat, mali fiş ve stok hareketi oluşturmaz.");
      overview.prepend(el("p","ENTEGRASYONLAR",{className:"okc-kicker"}));
      if (center) {
        const navigation=el("nav","",{className:"okc-actions",ariaLabel:"ÖKC bölümleri"});
        const groups=[["catalog","Marka, modeller ve adaptörler"],["licenses","Bayi entegrasyonları"],["devices","Şube, cihaz ve aktivasyon"],
          ["report","İşlem kayıtları"],["end","Gün sonu ve mutabakat"],["audit","Sistem günlüğü"]];
        for (const [id,title] of groups) navigation.append(link(title,"#okc-"+id));
        overview.append(navigation);
      }
      if (!center) overview.append(link("Satış geçmişi","#sales"));
      overview.append(form([
        ...(center?[select("Bayi","partner",[["","Tüm bayiler"],...data.partners.map(row=>[row.id,row.name])],partner),
          ...(partner?[select("Şube","branch",[["","Tüm şubeler"],...data.branches.map(row=>[row.id,row.name])],branch)]:[])]:[]),
        field("İşlem günü","day",{type:"date",value:data.day}),
      ],"Görüntüle",async values=>{
        if (center) {
          if (partner!==values.partner) branch="";else branch=values.branch||"";
          partner=values.partner;
        }
        day=values.day;await draw();
      }));
      overview.querySelectorAll("select").forEach(item=>{item.required=false;});
      view.replaceChildren(overview);
      if (center) {
        const catalog=section("Marka, model ve adaptörler","Katalog adayı oluşturmak, canlı cihaz desteğini etkinleştirmez.");
        catalog.id="okc-catalog";
        const modelEditor=(row={})=>form([
          field("Marka","brand",{value:row.brand||"",maxLength:50}),
          field("Model","model",{value:row.model||"",maxLength:80}),
          field("Üretici","manufacturer",{value:row.manufacturer||"",maxLength:100}),
          field("Adaptör adı","adapter",{value:row.adapter||"",maxLength:80}),
          field("Adaptör sürümü","adapterVersion",{value:row.adapter_version||"",maxLength:30}),
          select("Bağlantı","connection",[["cloud","Bulut API"],["local","Yerel servis"]],row.connection),
          field("Gerekli API / SDK","sdk",{value:row.sdk||"",required:false,maxLength:120}),
          field("Not","notes",{value:row.notes||"",required:false,maxLength:500}),
        ],"Model adayını kaydet",async values=>{await call("model",{body:{...values,id:row.id}});await draw();});
        catalog.append(modelEditor());
        for (const row of data.models) {
          const item=el("details");
          item.append(el("summary",row.brand+" "+row.model+" · "+(row.active?"Simülasyon":"Üretici onayı ve test bekliyor")));
          item.append(el("p",[row.adapter,row.adapter_version,row.connection,row.sdk].filter(Boolean).join(" · ")));
          if (!row.active) item.append(modelEditor(row));
          else item.append(el("p","Test yetenekleri: "+row.capabilities.map(label).join(", ")));
          catalog.append(item);
        }
        view.append(catalog);
        const grants=section("Bayi model yetkileri ve lisanslar","Bayi yalnız etkin ve süresi dolmamış yetkilerini kullanabilir.");
        grants.id="okc-licenses";
        grants.append(form([
          select("Bayi","partner",[["","Bayi seçin"],...data.partners.map(row=>[row.id,row.name])],partner),
          select("Model","modelId",data.models.map(row=>[row.id,row.brand+" "+row.model])),
          select("Yetki","enabled",[["true","Etkin"],["false","Kapalı"]]),
          field("Lisans son günü","expires",{type:"date",required:false}),
        ],"Yetkiyi kaydet",async values=>{await call("grant",{body:{...values,enabled:values.enabled==="true"}});await draw();}));
        grants.append(table(["Bayi","Model","Yetki","Bitiş"],data.grants.map(row=>[data.partners.find(item=>item.id===row.partner_id)?.name||row.partner_id,
          data.models.find(item=>item.id===row.model_id)?.model||row.model_id,row.enabled?"Etkin":"Kapalı",row.expires||"Süresiz"])));
        view.append(grants);
      }
      const devices=section("Şube cihazları ve aktivasyon","Fiziksel cihaz adayları üretici doğrulaması bekler. Simülatör durumları test ortamına aittir.");
      devices.id="okc-devices";
      if (data.canManage && !center && !preview) devices.append(authForm());
      if (data.canManage && branch && data.models.length) {
        const candidates=center?data.models.filter(row=>data.grants.some(grant=>grant.model_id===row.id&&grant.partner_id===partner&&grant.enabled)):data.models;
        if (candidates.length) {
          const deviceForm=form([
            field("Cihaz adı","label",{maxLength:90}),field("Seri numarası","serial",{maxLength:64}),
            select("Model","modelId",candidates.map(row=>[row.id,row.brand+" "+row.model])),
            field("VKN / TCKN · yalnız fiziksel cihaz","taxpayer",{inputMode:"numeric",maxLength:11,required:false,autocomplete:"off"}),
          ],"Cihaz kaydı oluştur",async values=>{await call("device",{body:{...values,partner,branch,action:"register"}});await draw();});
          const sync=()=>{
            const taxpayer=deviceForm.elements.taxpayer, physical=deviceForm.elements.modelId.value!=="simulation-v1";
            taxpayer.closest("label").hidden=!physical;taxpayer.required=physical;
            if (!physical) taxpayer.value="";
          };
          deviceForm.elements.modelId.addEventListener("change",sync);sync();devices.append(deviceForm);
        }
      }
      const equipment=data.devices.map(row=>{
        const actions=el("div","",{className:"okc-actions"});
        const allowed=data.canManage && (!center||!!partner);
        const run=action=>async event=>{
          const source=event.currentTarget;source.disabled=true;
          try {
            const result=await call("device",{body:{partner,branch:row.branch_id,deviceId:row.id,action}});
            if (action==="connection") status.textContent=row.label+" · "+label(result.connectionStatus);
            else await draw();
          } catch(error){status.textContent=error.message;}
          finally{source.disabled=false;}
        };
        if (allowed) {
          actions.append(button("Bağlantıyı kontrol et",run("connection")));
          if (row.active && row.connection==="simulation" && row.state!=="paired") actions.append(button("Testte eşleştir",run("pair")));
          if (row.active && row.state==="paired" && !row.preferred) actions.append(button("Varsayılan yap",run("default")));
          actions.append(button(row.active?"Pasif yap":"Etkinleştir",run(row.active?"disable":"enable")));
          if (row.active && row.state!=="maintenance") actions.append(button("Bakıma al",run("maintenance")));
        }
        return [row.label+(row.preferred?" · Varsayılan":""),row.branch_id,row.brand+" "+row.model,label(row.connectionStatus),row.taxpayer_last4?"•••• "+row.taxpayer_last4:"—",actions];
      });
      devices.append(table(["Cihaz","Şube","Model","Durum","Mükellef","İşlemler"],equipment));
      if (!equipment.length) devices.append(el("p","Bu görünümde cihaz kaydı bulunmuyor."));
      view.append(devices);
      const report=section("İşlem kayıtları ve günlük özet","Test tutarları mali ve banka toplamlarından ayrıdır. İşlem listesi son 200 kaydı içerir.");
      report.id="okc-report";
      const columns=["Şube","Cihaz","Yöntem","Durum","Ödeme","Mali durum","Adet","Toplam","İade"];
      const totals=data.grouped.map(row=>[row.branch_id,data.devices.find(item=>item.id===row.device_id)?.label||row.device_id,
        payment(row.method),label(row.status),label(row.payment),label(row.fiscal),row.count,tl(row.amount),tl(row.refunded)]);
      const exportButton=button("Excel indir",async()=>{
        try {
          const {workbook}=await import("./xlsx.js");
          const rows=totals.map((row,index)=>[...row.slice(0,-2),data.grouped[index].amount/100,data.grouped[index].refunded/100]);
          saveFile(workbook([{name:"ÖKC test özeti",headers:[...columns.slice(0,-2),"Toplam (TL)","İade (TL)"],rows}]),
            "okc-test-"+data.day+".xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        }
        catch(error){status.textContent=error.message;}
      });
      const options=el("div","",{className:"okc-actions"});options.append(exportButton,button("PDF / Yazdır",()=>printReport(columns,totals,data.day)));
      report.append(options,table(columns,totals));
      const selected=el("div");report.append(selected);
      report.append(paginate(data.transactions,rows=>table(["Referans","Tutar","Durum","Ayrıntı"],rows.map(row=>[
        row.id,tl(row.amount),label(row.status),button("Aç",async()=>{
          try {const context={partner,branch:row.branch_id};const info=await call("transaction/"+row.id,{query:context});
            if (selected.isConnected) selected.replaceChildren(transactionPanel(call,context,info,status,data.canReverse));}
          catch(error) {status.textContent=error.message;}
        }),
      ])),12));
      view.append(report);
      const end=section("Gün sonu ve mutabakat","Z raporu ile banka POS kapanışı ayrı işlemlerdir. Bağlı ve doğrulanmış canlı adaptör gerekli.");
      end.id="okc-end";
      end.append(...["ÖKC Z raporu","Banka POS gün sonu"].map(text=>el("button",text,{type:"button",disabled:true,className:"button"})));
      view.append(end);
      if (center) {
        const audit=section("Sistem ve aktivasyon günlüğü");
        audit.id="okc-audit";
        audit.append(table(["Zaman","Bayi","Şube","Olay"],data.audit.map(row=>[row.at,row.partner_id||"Merkez",row.branch_id||"—",label(row.operation)])));
        view.append(audit);
      }
      status.textContent="";
    } catch (error) {if (root.isConnected && turn===generation)status.textContent=error.message;}
  }
  await draw();
}
