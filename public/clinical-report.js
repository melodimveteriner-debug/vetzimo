const dateKey=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)?value.slice(0,10):"";

export function clinicalIndicators({appointments,exams,followups,from,to}) {
  const inRange=value=>{
    const date=dateKey(value);
    return date!==""&&date>=from&&date<=to;
  };
  const appointmentStates=new Map(), clinicianVisits=new Map(), vaccinations=new Map();
  const firstVisit=new Map(), repeatVisits=new Map();
  const count=(map,label)=>map.set(label,(map.get(label)||0)+1);
  const completed=exams.filter(row=>row.status==="Tamamlandı"&&dateKey(row.date));
  for (const row of appointments) if (inRange(row.date)) count(appointmentStates,row.status||"Belirtilmemiş");
  for (const row of completed) {
    if (row.patient && (!firstVisit.has(row.patient)||row.date<firstVisit.get(row.patient))) firstVisit.set(row.patient,row.date);
  }
  for (const row of completed) {
    if (!inRange(row.date)) continue;
    count(clinicianVisits,row.clinician?.trim()||"Belirtilmemiş");
    if (!row.patient||dateKey(firstVisit.get(row.patient))>=dateKey(row.date)) continue;
    const dates=repeatVisits.get(row.patient)||new Set();
    dates.add(dateKey(row.date));
    repeatVisits.set(row.patient,dates);
  }
  for (const row of followups) {
    if (row.kind==="Aşı"&&row.status==="Tamamlandı"&&inRange(row.done)) count(vaccinations,row.title||"Belirtilmemiş");
  }
  const ranked=map=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"tr"));
  return {appointmentStates:ranked(appointmentStates),clinicianVisits:ranked(clinicianVisits),vaccinations:ranked(vaccinations),
    repeatVisits:[...repeatVisits].map(([id,dates])=>[id,dates.size])};
}
