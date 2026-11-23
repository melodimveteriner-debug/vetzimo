const categories={
  exams:{label:"Muayene",title:"title",summary:"assessment"},
  labs:{label:"Tetkik",title:"title",summary:"result"},
  treatments:{label:"Tedavi",title:"title",summary:"plan"},
  followups:{label:"Aşı ve takip",title:"title",summary:"notes"},
  prescriptions:{label:"Reçete",title:"drug"},
  stays:{label:"Yatış ve konaklama",title:"kind"},
  appointments:{label:"Randevu",title:"service"},
  weights:{label:"Kilo kaydı"},
};
const dateForm=new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeZone:"UTC"});
const decimal=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:3});
const text=value=>typeof value==="string"?value:"";

function calendarDate(value){
  const date=text(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return "";
  const parsed=new Date(date+"T00:00:00Z");
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:"";
}

const numeric=value=>typeof value==="number"||typeof value==="string"&&value.trim()?Number(value):NaN;
const clock=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(text(value))?value:"";
const formatDate=date=>date?dateForm.format(new Date(date+"T00:00:00Z")):"Tarih belirtilmemiş";

export function healthEvents(records,patientNames){
  const events=[];
  for(const [type,definition] of Object.entries(categories)){
    for(const row of records[type]??[]){
      if(!row||!patientNames.has(row.patient))continue;
      const applied=type==="followups"&&row.status==="Tamamlandı"?calendarDate(row.done):"";
      const start=type==="stays"?text(row.start):"";
      const date=applied||calendarDate(start||row.date);
      const time=clock(type==="stays"?start.slice(11,16):row.time);
      const weight=numeric(row.weight);
      const title=type==="weights"&&Number.isFinite(weight)&&weight>0?decimal.format(weight)+" kg":text(row[definition.title]).trim()||definition.label;
      const linkedExam=type==="labs"&&typeof row.exam==="string"?row.exam:null;
      events.push({
        type,id:row.id,patient:row.patient,patientName:patientNames.get(row.patient),
        label:definition.label,title,date,time,linkedExam,
        dateLabel:type==="followups"?(applied?"Uygulama":"Planlanan tarih"):"",
        status:text(row.status),author:text(row.clinician)||text(row.createdBy),
        summary:text(row[definition.summary]),
      });
    }
  }
  return events.sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
}

export function examComparison(exams,patient){
  const measurements=[["weight","Kilo","kg"],["temperature","Vücut sıcaklığı","°C"],
    ["pulse","Nabız","atım/dk"],["respiratory","Solunum","nefes/dk"]];
  const completed=exams.filter(row=>row.patient===patient&&row.status==="Tamamlandı"&&calendarDate(row.date))
    .sort((a,b)=>b.date.localeCompare(a.date)||text(b.createdAt).localeCompare(text(a.createdAt)));
  if(completed.length<2)return null;
  const [latest,previous]=completed;
  const values=measurements.flatMap(([key,label,unit])=>{
    const current=numeric(latest[key]), before=numeric(previous[key]);
    if(!Number.isFinite(current)||!Number.isFinite(before)||current<=0||before<=0)return [];
    return [{label,unit,current,before}];
  });
  return {latest:calendarDate(latest.date),previous:calendarDate(previous.date),values};
}

export function mountHealthTimeline(root,events,{patients=new Map(),openRecord,openExam,comparison}={}){
  const make=(tag,value="",className="")=>{
    const el=document.createElement(tag);
    el.textContent=value;
    if(className)el.className=className;
    return el;
  };
  const filters=make("div","","health-timeline-filters");
  const list=make("ol","","health-timeline-list");
  const status=make("p","","muted");
  status.setAttribute("role","status");
  const more=make("button","Daha fazla kayıt göster","button secondary");
  more.type="button";
  const picker=(label,items)=>{
    const group=make("label",label);
    const select=make("select");
    select.setAttribute("aria-label",label);
    for(const [value,name] of items){
      const option=make("option",name);option.value=value;select.append(option);
    }
    group.append(select);filters.append(group);
    select.addEventListener("change",()=>{limit=20;render();});
    return select;
  };
  const patient=patients.size>1?picker("Hayvan",[["","Tüm hayvanlar"],...patients]):null;
  const type=picker("Kayıt türü",[["","Tüm kayıtlar"],...Object.entries(categories)
    .filter(([key])=>events.some(event=>event.type===key)).map(([key,item])=>[key,item.label])]);
  let limit=20;
  function render(){
    const filtered=events.filter(event=>(!type.value||event.type===type.value)&&(!patient?.value||event.patient===patient.value));
    status.textContent=filtered.length?filtered.length+" kayıt":"Bu seçimde kayıt yok.";
    list.replaceChildren();
    for(const event of filtered.slice(0,limit)){
      const item=make("li","","health-timeline-item");
      const date=[formatDate(event.date),event.time].filter(Boolean).join(" · ");
      const heading=make("strong",event.title);
      const metadata=[event.label,event.dateLabel?event.dateLabel+": "+date:date,patient?event.patientName:"",event.status,event.author].filter(Boolean).join(" · ");
      item.append(heading,make("small",metadata));
      if(event.summary){
        const details=make("details");
        details.append(make("summary","Kayıt özeti"),make("p",event.summary));
        item.append(details);
      }
      const addAction=(label,action)=>{
        const button=make("button",label,"button small secondary");
        button.type="button";button.addEventListener("click",action);item.append(button);
      };
      if(openRecord?.allowed(event))addAction("Kaydı aç",()=>openRecord.run(event));
      if(openExam?.allowed(event))addAction("Bağlı muayeneyi aç",()=>openExam.run(event));
      list.append(item);
    }
    more.hidden=filtered.length<=limit;
  }
  root.classList.add("health-timeline");
  if(comparison){
    const section=make("section","","health-timeline-comparison");
    section.append(make("h3","Son iki tamamlanan muayene"),make("p",formatDate(comparison.previous)+" → "+formatDate(comparison.latest)));
    const values=make("dl");
    for(const value of comparison.values){
      const row=make("div");
      const direction=value.current>value.before?" · Artış":value.current<value.before?" · Azalış":" · Aynı";
      row.append(make("dt",value.label),make("dd",decimal.format(value.before)+" → "+decimal.format(value.current)+" "+value.unit+direction));
      values.append(row);
    }
    section.append(comparison.values.length?values:make("p","İki muayenede de kayıtlı ortak bir ölçüm yok."));
    root.append(section);
  }
  more.addEventListener("click",()=>{limit+=20;render();});
  root.append(filters,status,list,more);
  render();
}
