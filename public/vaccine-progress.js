export const vaccineLabels={done:"Yapıldı",soon:"Yaklaşıyor",late:"Geçti",planned:"Planlandı"};
export const vaccineSoonDays=7;

export function vaccineStatus(row,today) {
  if (row.status==="İptal") return null;
  if (row.done || row.status==="Tamamlandı") return "done";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date||"")) return "planned";
  if (row.date<today) return "late";
  const ahead=(Date.parse(row.date)-Date.parse(today))/86400000;
  return ahead<=vaccineSoonDays?"soon":"planned";
}

export function vaccineCounts(rows,today) {
  const counts={done:0,soon:0,late:0,planned:0};
  for (const row of rows) {
    const status=vaccineStatus(row,today);
    if (status) counts[status]++;
  }
  return counts;
}

export function monthlyVaccineTrends(rows, from, to, today) {
  if (![from,to].every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value||"")) || from>to) return [];
  const monthIndex=date=>Number(date.slice(0,4))*12+Number(date.slice(5,7))-1;
  const last=monthIndex(to);
  const first=Math.max(monthIndex(from),last-23);
  const months=Array.from({length:last-first+1},(_,index)=>{
    const month=first+index;
    return {month:String(Math.floor(month/12)).padStart(4,"0")+"-"+String(month%12+1).padStart(2,"0"),done:0,late:0,planned:0};
  });
  for (const row of rows) {
    if (row.kind!=="Aşı") continue;
    const status=vaccineStatus(row,today);
    if (!status) continue;
    const date=status==="done"?row.done:row.date;
    if (!date || date<from || date>to) continue;
    const bucket=months[monthIndex(date)-first];
    if (bucket) bucket[status==="soon"?"planned":status]++;
  }
  return months;
}
