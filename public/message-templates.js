export const messageTags={
  sahip:"Müşteri adı",hasta:"Hasta adı",asi:"Aşı adı",asi_tarihi:"Aşı tarihi",
  klinik:"Klinik adı",klinik_telefon:"Klinik telefonu",
};
const tokenPattern=/\{(sahip|hasta|asi|asi_tarihi|klinik|klinik_telefon)\}/g;

export function resolveMessageTemplate(template,values) {
  const keys=[...new Set([...template.matchAll(tokenPattern)].map(match=>match[1]))];
  const missing=keys.filter(key=>!values[key]);
  const variables=Object.fromEntries(keys.map((key,index)=>[String(index+1),values[key]]));
  const body=template.replace(tokenPattern,(_,key)=>values[key]||"");
  const approvedBody=template.replace(tokenPattern,(_,key)=>"{{"+(keys.indexOf(key)+1)+"}}");
  return {body,approvedBody,missing,variables};
}
