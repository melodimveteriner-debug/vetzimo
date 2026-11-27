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
  deleteSales:"Satış iptali",deleteCollections:"Tahsilat iptali ve borç silme",deleteCash:"Kasa hareketi iptali",deleteNotes:"Not ve alım listesi silme",deleteMessages:"Mesaj taslağı silme",deleteTemplates:"Mesaj şablonu silme",
  overviewSales:"Ciro ve satış toplamları (Genel Bakış grafiği, satış geçmişi Bugün/Bu hafta/Bu ay tutarları, işletme analizi)",smsSend:"Toplu SMS gönderimi",whatsappSend:"Toplu WhatsApp gönderimi",
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

// Ayrı yüklenen modüller (personel/hesaplar, ayarlar vb.) ana uygulamanın kapsam bilgisini paylaşmaz.
// Kapsam verilmemişse etkin üyelik oturumdan bir kez alınır; böylece istekler bayi yöneticisi kimliğiyle gider.
let sessionScopePromise=null;
function sessionScope() {
  if (!sessionScopePromise) {
    sessionScopePromise=fetch("/api/identity/session",{credentials:"same-origin"})
      .then(response=>response.ok?response.json():{})
      .then(data=>{const scope=typeof data?.scopeId==="string"?data.scopeId:"";if(!scope)sessionScopePromise=null;return scope;})
      .catch(()=>{sessionScopePromise=null;return "";});
  }
  return sessionScopePromise;
}
export async function clinicFetch(url,options={}) {
  let scope=clinicRequestScope;
  if (!scope && !String(url).startsWith("/api/identity/session")) scope=await sessionScope();
  if (!scope) return fetch(url,options);
  const headers=new Headers(options.headers);
  if (!headers.has("X-VeTNet-Scope")) headers.set("X-VeTNet-Scope",scope);
  return fetch(url,{...options,headers});
}
