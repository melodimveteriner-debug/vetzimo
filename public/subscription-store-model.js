export function subscriptionEnd(start,years) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isInteger(years)||years<1||years>10) throw Error("Abonelik süresi 1–10 yıl olmalıdır.");
  const [year,month,day]=start.split("-").map(Number);
  if (year<1||year+years>9999||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()) throw Error("Geçerli bir abonelik tarihi gerekli.");
  const lastDay=new Date(Date.UTC(year+years,month,0)).getUTCDate();
  return [year+years,String(month).padStart(2,"0"),String(Math.min(day,lastDay)).padStart(2,"0")].join("-");
}
