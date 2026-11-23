import {followupKey,dueWithinDay} from "./clinic-workflow.js";

export const reminderLabels={birthday:"5. yaş ve Check-Up",appointments:"Randevu",stays:"Konaklama bitişi",followups:"Aşı"};
export const reminderTemplates={
  birthday:"5. yaşınızı kutlarız. Check-Up yaptırmanız gerekmektedir. Nice Mutlu Senelere {{1}}. Lütfen randevu oluşturunuz. {{2}} · {{3}}",
  appointments:"{{1}} için randevu tarih ve saati {{2}}. {{3}} · {{4}}",
  stays:"{{1}} için konaklama bitişi {{2}} olarak planlandı. {{3}} · {{4}}",
  followups:"{{1}} için {{2}} tarihinde {{3}} aşısı planlandı. {{4}} · {{5}}",
};

function fifthBirthday(birth) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birth||"")) return "";
  const original=new Date(birth+"T12:00:00Z");
  if(!Number.isFinite(+original) || original.toISOString().slice(0,10)!==birth) return "";
  const month=original.getUTCMonth();
  original.setUTCFullYear(original.getUTCFullYear()+5);
  if(original.getUTCMonth()!==month) original.setUTCDate(0);
  return original.toISOString().slice(0,10);
}
const displayDate=value=>value.slice(0,10).split("-").reverse().join(".")+(value.length>10?" "+value.slice(11,16):"");

export function planClinicReminders(state,partnerName,now) {
  const date=new Date(now+3*3600000).toISOString().slice(0,10);
  const preferences=state?.preferences||{};
  const branches=new Map((state?.branches||[]).filter(row=>row.status!=="Pasif").map(row=>[row.id,row]));
  const patients=new Map((state?.patients||[]).map(row=>[row.id,row]));
  const clients=new Map((state?.clients||[]).map(row=>[row.id,row]));
  const jobs=[];
  function queue(kind,row,patient,due,clientId=patient?.owner) {
    if(preferences["reminder_"+kind]!=="Evet") return;
    const branch=branches.get(row.branch);
    const client=clients.get(clientId);
    if(!branch || !client || client.branch!==row.branch || (patient && patient.branch!==row.branch)) return;
    const clinic=String(preferences.clinic||branch.name||partnerName).trim();
    const phone=String(branch.phone||preferences.phone||"").trim();
    if(!clinic || !phone) return;
    const subject=patient?.name||client.name;
    if(!subject) return;
    const values=kind==="birthday"?[subject,clinic,phone]:kind==="followups"?[subject,displayDate(due.slice(0,10)),row.title,clinic,phone]:
      [subject,displayDate(due),clinic,phone];
    if(values.some(value=>!value)) return;
    const parameters=Object.fromEntries(values.map((value,index)=>[String(index+1),String(value).trim().replace(/\s+/g," ").slice(0,160)]));
    const body=reminderTemplates[kind].replace(/\{\{(\d+)\}\}/g,(_,key)=>parameters[key]);
    for(const channel of ["sms","whatsapp"]) {
      if(preferences["reminder_"+channel]==="Evet" && client[channel]==="Var" && client.phone) {
        jobs.push({kind,id:row.id,branch:row.branch,channel,client:client.id,phone:client.phone,due,parameters,body});
      }
    }
  }
  for(const kind of ["appointments","stays","followups"]) {
    for(const row of state?.[kind]||[]) {
      if(["İptal","Tamamlandı","Taburcu","Gelmedi"].includes(row.status)) continue;
      if(kind==="followups" && (row.kind!=="Aşı" || row.done)) continue;
      const due=kind==="followups"?(row.date||"")+"T09:00":followupKey(kind,row);
      if(dueWithinDay(due,now)) queue(kind,row,patients.get(row.patient),due,row.client||patients.get(row.patient)?.owner);
    }
  }
  if(now>=Date.parse(date+"T09:00:00+03:00")) {
    for(const patient of patients.values()) if(fifthBirthday(patient.birth)===date) queue("birthday",patient,patient,date);
  }
  return jobs.sort((a,b)=>a.due.localeCompare(b.due));
}
