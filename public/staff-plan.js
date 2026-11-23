const kinds={shift:"Vardiya",leave:"Personel izni"};
const states={pending:"Onay bekliyor",approved:"Onaylandı",declined:"Reddedildi",cancelled:"İptal edildi"};
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const advance=(value,count)=>{
  const day=new Date(value+"T12:00:00Z");
  day.setUTCDate(day.getUTCDate()+count);
  return day.toISOString().slice(0,10);
};

export async function mountStaffPlan(ui,scope) {
  const {el,field,view,heading,makeForm,selectField,status}=ui;
  const locale=document.documentElement.lang||"tr";
  const clock=new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"});
  const displayTime=value=>clock.format(new Date(value.replace(" ","T")+"Z"));
  let current=today(), generation=0;
  async function api(query,body) {
    const headers={"X-VeTNet-Scope":scope};
    if (body) headers["Content-Type"]="application/json";
    const response=await fetch("/api/staff/plan"+query,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    if (!response.ok) throw Error(data.error||"İşlem tamamlanamadı.");
    return data;
  }
  function btn(label,callback) {
    const button=el("button",label,{className:"button small",type:"button"});
    button.addEventListener("click",async()=>{
      button.disabled=true;
      try {await callback();} catch (error) {status.textContent=error.message;} finally {button.disabled=false;}
    });
    return button;
  }
  if (!document.querySelector('link[data-staff-plan-style]')) {
    const css=document.createElement("link");
    css.rel="stylesheet"; css.href="/staff-plan.css?v=r69"; css.dataset.staffPlanStyle="";
    document.head.append(css);
  }
  heading("Vardiya ve izinler");
  view.dataset.i18nScope="staff";
  const filter=el("div","",{className:"suite-tabs staff-plan-filters"});
  const picker=field("week","Hafta seçin",{type:"date",value:current});
  const selected=picker.querySelector("input");
  const content=el("div","",{className:"staff-plan-content"});
  const loadDay=async (date,cursors=[""])=>{
    if (!date) return;
    const token=++generation;
    const result=await api("?"+new URLSearchParams({day:date,after:cursors.at(-1)}));
    if (token!==generation||!view.isConnected) return;
    current=result.week;
    selected.value=current;
    render(result,cursors);
  };
  selected.addEventListener("change",()=>loadDay(selected.value).catch(error=>{status.textContent=error.message;}));
  filter.append(picker,btn("Önceki hafta",()=>loadDay(advance(current,-7))),btn("Bu hafta",()=>loadDay(today())),
    btn("Sonraki hafta",()=>loadDay(advance(current,7))),btn("Yenile",()=>loadDay(current)));
  view.append(filter,content);

  function render(data,cursors) {
    const editor=el("details","",{className:"panel suite-panel suite-invite"});
    editor.append(el("summary",data.manager?"Yeni plan":"İzin talep et"));
    if (!data.members.length) editor.append(el("p","Etkin personel bulunamadı."));
    else {
      const staff=selectField("member","Personel",data.members.map(item=>[item.id,item.name+(item.branch_name?" · "+item.branch_name:"")]));
      staff.querySelectorAll("option").forEach(option=>option.dataset.uiPreserve="");
      const kind=selectField("kind","Tür",(data.manager?["shift","leave"]:["leave"]).map(key=>[key,kinds[key]]));
      if (data.members.length===1) staff.hidden=true;
      if (!data.manager) kind.hidden=true;
      const defaultDate=today()>=current&&today()<advance(current,7)?today():current;
      editor.append(makeForm([staff,kind,field("starts","Başlangıç",{type:"datetime-local",value:defaultDate+"T09:00"}),
        field("ends","Bitiş",{type:"datetime-local",value:defaultDate+"T18:00"})],"Kaydet",async values=>{
          await api("",{action:"add",...values});
          await loadDay(values.starts.slice(0,10));
          status.textContent="Kaydedildi.";
        }));
    }
    const agenda=el("section","",{className:"panel suite-panel"});
    agenda.append(el("h2","Haftalık plan"));
    const history=el("details","",{className:"panel suite-panel"});
    history.append(el("summary","Geçmiş"));
    let count=0;
    for (const item of data.rows) {
      const historyRow=["declined","cancelled"].includes(item.status);
      const article=el("article","",{className:"staff-plan-row"});
      const name=el("strong",item.name), dates=el("p",displayTime(item.starts)+" – "+displayTime(item.ends));
      name.dataset.uiPreserve=dates.dataset.uiPreserve="";
      dates.className="staff-plan-date";
      article.append(name,el("p",kinds[item.kind]),dates,el("span",states[item.status],{className:"suite-pill"}));
      if (item.branch_name) {
        const branch=el("small",item.branch_name);
        branch.dataset.uiPreserve="";
        article.append(branch);
      }
      if (historyRow) { history.append(article); continue; }
      count++;
      const actions=el("div","",{className:"suite-tabs"});
      function action(key,label) {
        const confirmAction=async()=>{
          await api("",{id:item.id,status:item.status,action:key});
          await loadDay(current);
          status.textContent="Kaydedildi.";
        };
        if (key==="approve") return btn(label,confirmAction);
        const wrap=el("details");
        wrap.append(el("summary",label,{className:"button small"}),el("p",key==="cancel"?"Kaydı iptal etmek istiyor musunuz?":"Onaylıyor musunuz?"),
          btn(label,confirmAction),btn("Vazgeç",()=>{wrap.open=false;}));
        return wrap;
      }
      if (data.manager&&item.status==="pending") actions.append(action("approve","Onayla"),action("decline","Reddet"));
      if (data.manager||item.status==="pending") actions.append(action("cancel","İptal et"));
      article.append(actions);
      agenda.append(article);
    }
    if (!count && cursors.length===1 && !data.nextCursor && !data.rows.length) agenda.append(el("p","Bu hafta kayıt yok.",{className:"suite-muted"}));
    content.replaceChildren(editor,agenda);
    if (history.childElementCount>1) content.append(history);
    if (cursors.length>1 || data.nextCursor) {
      const pages=el("div","",{className:"suite-tabs"});
      if (cursors.length>1) pages.append(btn("Önceki sayfa",()=>loadDay(current,cursors.slice(0,-1))));
      if (data.nextCursor) pages.append(btn("Sonraki sayfa",()=>loadDay(current,[...cursors,data.nextCursor])));
      content.append(pages);
    }
  }
  await loadDay(current);
}
