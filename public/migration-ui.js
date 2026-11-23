import {detectMigrationTable,matchMigrationColumns,migrationFields,migrationNames,migrationSources,migrationWorkbook} from "./migration-model.js";
import {readMigrationFile} from "./migration-file.js";
import {workbook} from "./xlsx.js";

const make=(tag,text="",properties={})=>Object.assign(document.createElement(tag),{textContent:text,...properties});
const option=(value,label)=>make("option",label,{value});
const field=(label,child)=>{const wrapper=make("label",label);wrapper.append(child);return wrapper;};
const button=(label,primary=false)=>make("button",label,{type:"button",className:"button"+(primary?" primary":" secondary")});
const tableOptions=Object.entries(migrationNames);
function downloadWorkbook(sheets,name) {
  const blob=new Blob([workbook(sheets)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob), link=make("a","",{href:url,download:name+".xlsx"});
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function call(scope,path="",body) {
  const response=await fetch("/api/migration"+path,body?{method:"POST",
    headers:{"Content-Type":"application/json",...(scope?{"X-VeTNet-Scope":scope}:{})},body:JSON.stringify(body)}:{});
  const result=await response.json();
  if (!response.ok) throw Error(result.error||"Veri aktarımı tamamlanamadı.");
  return result;
}
export async function mountMigration(root,{center=false,scope="",branch="",canBackup=true,canImport=true,canExport=true}={}) {
  const importTypes=center?null:new Set(["clients","patients","suppliers","products","vaccineCatalog","followups","stockLots","stockMoves"]);
  const wrap=make("section","",{className:"migration-studio panel"});
  const head=make("header","");
  head.append(make("p","VETZIMO · VERİ MERKEZİ"),make("h2","Yedekleme ve içe aktarma"),
    make("p","Dosyanızı açın, sütunları eşleştirin ve aktarım özetini kontrol edin. Kayıtlar seçili kliniğin şubesine eklenir."));
  const targets=make("div","",{className:"migration-grid"});
  const partner=make("select"), branchSelect=make("select"), source=make("select"), file=make("input","",{type:"file",accept:".xlsx,.csv,.tsv,.json"});
  source.append(...migrationSources.map(([id,name])=>option(id,name)));source.value="other";
  if (center) targets.append(field("Hedef bayi",partner));
  const branchField=field("Hedef şube",branchSelect);
  targets.append(branchField);
  if (canImport) targets.append(field("Kaynak yazılım",source),field("Yedek dosyası",file));
  const actions=make("div","",{className:"migration-actions"});
  const template=button("Boş Excel şablonu"), backup=button("Şube Excel yedeği"), preview=button("Aktarımı önizle",true), apply=button("Onayla ve aktar",true);
  apply.hidden=true;preview.disabled=true;backup.disabled=true;
  if (canExport && canImport) actions.append(template);
  if (canBackup && canExport) actions.append(backup);
  const json=make("a","Şube JSON yedeği",{className:"button",download:"vetzimo-sube-yedegi.json"});
  const updateLink=()=>{if (branchSelect.value) json.href="/api/migration?"+new URLSearchParams({branch:branchSelect.value,export:"json"});else json.removeAttribute("href");};
  if (canBackup && !center) actions.append(json);
  if (canImport) actions.append(preview,apply);
  const mappings=make("div","",{className:"migration-mappings"});
  const summary=make("div","",{className:"migration-summary",role:"status",ariaLive:"polite"});
  const help=make("p","XLSX, CSV, TSV ve VetZimo JSON desteklenir. Eski XLS dosyasını XLSX veya CSV olarak kaydedin. Klinik hesapları, dosya ekleri ve erişim şifreleri aktarım kapsamının dışındadır.",{className:"muted"});
  wrap.append(head,targets,help,mappings,actions,summary);
  root.replaceChildren(wrap);
  let sheets=[], payload=null, version=0;
  function resetSummary() {
    version++;
    payload=null;apply.hidden=true;summary.replaceChildren();
    preview.disabled=!branchSelect.value||!sheets.some(item=>item.type);
  }
  function showMessage(message) {summary.replaceChildren(make("p",message));}
  const targetQuery=()=>"?"+new URLSearchParams({...((center&&partner.value)?{partner:partner.value}:{}),...(branchSelect.value?{branch:branchSelect.value}:{})});
  async function branches() {
    branchSelect.replaceChildren(option("","Şube seçin"));
    backup.disabled=true;resetSummary();
    if (center&&!partner.value) return;
    const selectedPartner=partner.value;
    const data=await call(scope,center?"?"+new URLSearchParams({partner:selectedPartner}):"");
    if (!root.contains(wrap)||partner.value!==selectedPartner) return;
    branchField.hidden=data.branches.length===1;
    branchSelect.append(...data.branches.map(row=>option(row.id,row.name+(row.sharedWith?" · Ortak kayıt alanı":""))));
    if (data.branches.some(row=>row.id===branch)) branchSelect.value=branch;
    else if (data.branches.length===1) branchSelect.value=data.branches[0].id;
    backup.disabled=!branchSelect.value;resetSummary();updateLink();
  }
  function mapEditor(sheet) {
    const details=make("details","",{className:"migration-map"});
    const name=sheet.name+(sheet.sourceBranch?" · Kaynak "+sheet.sourceBranch:"");
    details.append(make("summary",name+" · "+sheet.rows.length+" satır"));
    const table=make("select");
    table.append(option("","Atla"),...tableOptions.filter(([key])=>!importTypes||importTypes.has(key)).map(([key,label])=>option(key,label)));
    if (importTypes && !importTypes.has(sheet.type)) sheet.type="";
    table.value=sheet.type;
    const controls=make("div","",{className:"migration-grid"});
    const draw=()=>{
      controls.replaceChildren();
      for (const item of migrationFields(sheet.type)) {
        const select=make("select");
        select.append(option("-1","Eşleştirme yok"),...sheet.headers.map((label,i)=>option(String(i),label||"Sütun "+(i+1))));
        select.value=String(sheet.mapping[item.key]??-1);
        select.addEventListener("change",()=>{sheet.mapping[item.key]=Number(select.value);resetSummary();});
        controls.append(field(item.label+(item.required?" · zorunlu":""),select));
      }
    };
    table.addEventListener("change",()=>{sheet.type=table.value;sheet.mapping=matchMigrationColumns(sheet.headers,sheet.type);draw();resetSummary();});
    details.append(field("Aktarılacak bölüm",table),controls);draw();return details;
  }
  file.addEventListener("change",async()=>{
    sheets=[];mappings.replaceChildren();resetSummary();
    const request=version;
    try {
      const selected=file.files[0];
      if (!selected) return;
      showMessage("Dosya okunuyor…");
      const parsed=await readMigrationFile(selected);
      if (request!==version) return;
      if (!parsed.length) throw Error("Aktarılabilecek çalışma sayfası veya satır bulunamadı.");
      if (/\.json$/i.test(selected.name)) source.value="vetnet";
      sheets=parsed.map(row=>{const type=row.type||detectMigrationTable(row.name);return {...row,type,mapping:matchMigrationColumns(row.headers,type)};});
      const sourceBranches=[...new Set(sheets.map(row=>row.sourceBranch).filter(Boolean))];
      if (sourceBranches.length>1) for (const sheet of sheets) {sheet.type="";sheet.mapping={};}
      mappings.append(...sheets.map(mapEditor));
      resetSummary();
      if (sourceBranches.length>1) showMessage("Dosya birden fazla kaynak şube içeriyor. Bir seferde tek kaynak şubeye ait çalışma sayfalarını seçin.");
    } catch(error) {if(request===version)showMessage(error.message);}
  });
  partner.addEventListener("change",()=>void branches().catch(error=>showMessage(error.message)));
  branchSelect.addEventListener("change",()=>{backup.disabled=!branchSelect.value;resetSummary();updateLink();});
  source.addEventListener("change",resetSummary);
  template.addEventListener("click",()=>downloadWorkbook(migrationWorkbook({},"",undefined,true),"VetZimo-aktarim-sablonu"));
  backup.addEventListener("click",async()=>{
    backup.disabled=true;
    try {
      const data=await call(scope,targetQuery());
      downloadWorkbook(migrationWorkbook(data.datasets,""),"VetZimo-klinik-yedegi");
    } catch(error) {showMessage(error.message);}
    finally {backup.disabled=!branchSelect.value;}
  });
  preview.addEventListener("click",async()=>{
    const request=++version;
    apply.hidden=true;preview.disabled=true;payload=null;
    try {
      const datasets={}, chosen=sheets.filter(sheet=>sheet.type);
      if (new Set(chosen.map(sheet=>sheet.sourceBranch).filter(Boolean)).size>1) throw Error("Tek bir kaynak şubeye ait çalışma sayfaları seçin.");
      if (chosen.reduce((count,sheet)=>count+sheet.rows.length,0)>1500) throw Error("Bir aktarım en fazla 1.500 satır içerebilir.");
      for (const sheet of chosen) {
        const fields=migrationFields(sheet.type);
        if (fields.some(item=>item.required&&sheet.mapping[item.key]<0&&!(sheet.type==="followups"&&item.key==="date"&&sheet.mapping.done>=0))) throw Error(sheet.name+" sayfasındaki zorunlu alanları eşleştirin.");
        const indices=Object.values(sheet.mapping).filter(value=>value>=0);
        if (new Set(indices).size!==indices.length) throw Error("Aynı kaynak sütunu birden fazla alana eşleştirildi.");
        (datasets[sheet.type]||=([])).push(...sheet.rows.map(row=>Object.fromEntries(Object.entries(sheet.mapping)
          .filter(([,index])=>index>=0).map(([key,index])=>[key,row[index]||""]))));
      }
      const staged={partner:partner.value,branch:branchSelect.value,source:source.value,datasets};
      showMessage("Kayıtlar ve bağlantılar doğrulanıyor…");
      const result=await call(scope,"",{...staged,action:"preview"});
      if (request!==version) return;
      const status=make("strong",result.imported+" yeni · "+result.skipped+" tekrar · "+result.totalIssues+" sorun");
      summary.replaceChildren(status);
      for (const [key,count] of Object.entries(result.counts)) if (count.added||count.skipped) summary.append(make("p",migrationNames[key]+" · "+count.added+" yeni / "+count.skipped+" tekrar"));
      if (result.restriction) summary.append(make("p",result.restriction));
      if (result.issues.length) {
        const list=make("ul","");
        for (const issue of result.issues) list.append(make("li",issue.table+" · Satır "+issue.row+" · "+issue.message));
        summary.append(list);
      }
      if (!result.restriction&&!result.totalIssues&&result.imported) {
        payload={...staged,revision:result.revision};apply.hidden=false;
      }
    } catch(error) {if(request===version)showMessage(error.message);}
    finally {if(request===version)preview.disabled=false;}
  });
  apply.addEventListener("click",async()=>{
    if (!payload||!window.confirm("Önizlenen kayıtlar seçili şubeye eklensin mi?")) return;
    const requested=payload;
    apply.disabled=true;
    try {
      const result=await call(scope,"",{...requested,action:"apply",confirm:true});
      payload=null;apply.hidden=true;
      showMessage(result.imported+" kayıt aktarıldı. "+(center?"":"Klinik panelinde güncel kayıtları görmek için sayfayı yenileyin."));
      if (!center) {
        const reload=button("Klinik panelini yenile");
        reload.addEventListener("click",()=>location.reload());
        summary.append(reload);
      }
    } catch(error) {showMessage(error.message);}
    finally {apply.disabled=false;}
  });
  try {
    if (center) {
      const {partners}=await call(scope);
      partner.append(option("","Bayi seçin"),...partners.map(row=>option(row.id,row.name)));
    }
    await branches();
  } catch(error) {showMessage(error.message);}
}
