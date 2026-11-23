import {addDays,cents,saleLines,saleTotals,weekStart} from "./model.js";

const inPeriod=(row,from,to)=>/^\d{4}-\d{2}-\d{2}$/.test(row.date||"") && Number.isFinite(Date.parse(row.date)) && row.date>=from && row.date<=to;
const increment=(map,label,value)=>map.set(label,(map.get(label)||0)+value);
const ranked=map=>[...map].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"tr"));

export function salesAnalysis({sales,collections,from,to,method="",group="",name}) {
  const eligible=sales.filter(row=>!method || row.method===method);
  const entries=eligible.filter(row=>inPeriod(row,from,to)).sort((a,b)=>b.date.localeCompare(a.date));
  const saleById=new Map(sales.map(row=>[row.id,row]));
  const paidBySale=new Map();
  for (const row of collections) increment(paidBySale,row.sale,cents(row.amount));
  const incoming=collections.filter(row=>inPeriod(row,from,to) && (!method || row.method===method));
  const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  const grouping=(group==="day" && days>120 ? (days<=840?"week":"month") : group==="week" && days>840?"month":group) || (days<=31?"day":days<=120?"week":"month");
  const keyFor=date=>grouping==="month"?date.slice(0,7)+"-01":grouping==="week"?weekStart(date):date;
  const trend=new Map();
  const products=new Map(), people=new Map(), receipts=new Map();
  const metrics={turnover:0,paid:0,cash:0,open:0,discount:0,vat:0,count:entries.length,items:0,prior:0};
  const first=keyFor(from), last=keyFor(to);
  const shift=date=>{
    if(grouping!=="month") return addDays(date,grouping==="week"?7:1);
    const next=new Date(date+"T12:00:00Z");next.setUTCMonth(next.getUTCMonth()+1);
    return next.toISOString().slice(0,10);
  };
  for (let date=first;date<=last && trend.size<120;date=shift(date)) trend.set(date,[0,0]);
  const move=(date,index,value)=>{
    const key=keyFor(date);
    if (!trend.has(key) && trend.size>=120) return;
    const bucket=trend.get(key)||[0,0];
    bucket[index]+=value;
    trend.set(key,bucket);
  };
  const table=[];
  for (const row of entries) {
    const amount=cents(row.amount), paid=cents(row.paid)+(paidBySale.get(row.id)||0), due=amount-paid;
    const lines=saleLines(row);
    const calculation=saleTotals(lines,row.discount,row.discountType);
    const customer=row.client?name("clients",row.client):"Müşterisiz satış";
    const units=lines.reduce((sum,line)=>sum+(Number(line.quantity)||0),0);
    metrics.turnover+=amount;metrics.paid+=paid;metrics.open+=due;
    metrics.discount+=calculation.discount;metrics.vat+=calculation.vat;metrics.items+=units;
    move(row.date,0,amount);
    increment(people,customer,amount);
    for (const line of lines) increment(products,line.name||"İsimsiz kalem",Number(line.quantity)||0);
    table.push({row,amount,due,paid,discount:calculation.discount,vat:calculation.vat,units,customer});
  }
  for (const receipt of [...sales.filter(row=>inPeriod(row,from,to)&&cents(row.paid)>0).map(row=>({...row,amount:row.paid})),...incoming]) {
    if (method && receipt.method!==method) continue;
    const paid=cents(receipt.amount);
    metrics.cash+=paid;
    move(receipt.date,1,paid);
    increment(receipts,receipt.method||"Belirtilmemiş",paid);
  }
  if (days>0 && days<=36525) {
    const previousStart=addDays(from,-days),previousEnd=addDays(from,-1);
    metrics.prior=eligible.filter(row=>inPeriod(row,previousStart,previousEnd)).reduce((sum,row)=>sum+cents(row.amount),0);
  }
  metrics.average=metrics.count?Math.round(metrics.turnover/metrics.count):0;
  const delta=metrics.prior?((metrics.turnover-metrics.prior)/metrics.prior)*100:null;
  const cashTable=[
    ...sales.filter(row=>inPeriod(row,from,to)&&cents(row.paid)>0&&(!method||row.method===method)).map(row=>[row.date,row.client?name("clients",row.client):"Müşterisiz satış","İlk tahsilat",row.method||"—",cents(row.paid)/100]),
    ...incoming.map(row=>{const sale=saleById.get(row.sale);return [row.date,sale?.client?name("clients",sale.client):"—","Ek tahsilat",row.method||"—",cents(row.amount)/100];}),
  ].sort((a,b)=>b[0].localeCompare(a[0]));
  return {metrics,delta,grouping,table,trend:[...trend].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,[turnover,cash]])=>[key,turnover,cash]),products:ranked(products),people:ranked(people),receipts:ranked(receipts),cashTable};
}
