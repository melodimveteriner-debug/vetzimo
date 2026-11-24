export const accessModules = {
  appointments:["Randevular","appointments"],
  clients:["Müşteriler","clients","documents","visitors"],
  patients:["Hastalar","patients","weights","exams","labs","treatments","prescriptions","stays","surgeries"],
  followups:["Aşı ve takip","followups","vaccineCatalog"],
  sales:["Satışlar","sales"],
  products:["Ürünler, alış ve stok","products","suppliers","purchases","stockLots","stockMoves"],
  expenses:["Muhasebe ve kasa","expenses","collections","payments"],
  reports:["Raporlar"],
  messages:["SMS ve WhatsApp","messages","templates"],
  support:["Bayi desteği"],
  esmm:["e-SMM portal erişimi"],
  overviewClients:["Genel Bakış · Tüm Kayıtlı Müşteriler"],
  overviewPatients:["Genel Bakış · Tüm Kayıtlı Hastalar"],
};

export const actionNames={
  deletePatients:"Hasta silme",deleteClients:"Hasta sahibi silme",deleteAppointments:"Randevu silme",
  deleteHomeVisit:"Evde Hizmet başvurusu silme",deleteProducts:"Ürün ve hizmet silme",
  deleteSales:"Satış iptali",deleteCollections:"Tahsilat iptali",deleteCash:"Kasa hareketi iptali",deleteNotes:"Not ve alım listesi silme",deleteMessages:"Mesaj taslağı silme",deleteTemplates:"Mesaj şablonu silme",
  overviewSales:"Genel Bakış · Satış grafiği",smsSend:"Toplu SMS gönderimi",whatsappSend:"Toplu WhatsApp gönderimi",
  smsHistory:"SMS gönderim geçmişi",whatsappHistory:"WhatsApp gönderim geçmişi",backup:"Şube yedeği",
  dataImport:"Aktarım ve yedeği içe aktarma",spreadsheet:"Excel olarak indirme",cashCorrect:"Manuel kasa kaydı düzeltme",
};
export const allowedAction=(actor,key,write=false)=>
  actor.role==="dealer" || actor.role==="owner" || (!actor.central && actor.role!=="staff") ||
  (write ? actor.modules?.[key]==="write" : ["read","write"].includes(actor.modules?.[key]));
export const moduleFor = key => Object.keys(accessModules).find(module=>accessModules[module].slice(1).includes(key));
export const permitted = (actor,module,write=false) => (actor.role!=="staff" && (!actor.packageRestricted || !module)) ||
  (write ? actor.modules?.[module]==="write" : ["read","write"].includes(actor.modules?.[module]));

let clinicRequestScope="";
export function setClinicRequestScope(scope) {
  clinicRequestScope=scope||"";
}

export function clinicFetch(url,options={}) {
  if (!clinicRequestScope) return fetch(url,options);
  const headers=new Headers(options.headers);
  headers.set("X-VeTNet-Scope",clinicRequestScope);
  return fetch(url,{...options,headers});
}
