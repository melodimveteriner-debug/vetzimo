import {balance,config,norm,tracksStock} from "./model.js";

export const migrationSources=[
 ["vetnet","VetZimo"],["bulutvet","BulutVet"],["vetc","Vetc"],["kolayvet","Kolayvet"],
 ["bivet","biVet"],["veterian","Veterian"],["evet","E-vet Smart Plus"],["other","Diğer yazılım"]
];
export const migrationNames={
 clients:"Hasta Sahipleri",patients:"Hastalar",suppliers:"Tedarikçiler",products:"Ürünler",
 vaccineCatalog:"Aşı Tanımları",followups:"Aşı ve Takip",appointments:"Randevular",exams:"Muayeneler",labs:"Tetkikler",
 treatments:"Tedaviler",prescriptions:"Reçeteler",stays:"Konaklama",purchases:"Alışlar",sales:"Satışlar",
 collections:"Tahsilatlar",payments:"Tedarikçi Ödemeleri",expenses:"Kasa Hareketleri",
 stockLots:"Stok Partileri",stockMoves:"Stok Hareketleri",weights:"Kilo Geçmişi",documents:"Doküman Kayıtları"
};
const aliases={
 clients:["müşteriler","müşteri","hasta sahibi","sahipler","clients","customers","owners"],
 patients:["hasta","pets","animals","patients","evcil hayvanlar"],
 followups:["aşılar","aşı geçmişi","aşı takvimi","vaccinations","vaccines","followups"],
 products:["ürün ve stok","stok","ürün listesi","stok kartları","products","items","inventory"],
 suppliers:["firmalar","firmalar ve depolar","suppliers","vendors"],purchases:["alış faturaları","purchases","purchase invoices"],
 sales:["satış ve tahsilat","satış faturaları","sales","invoices"],collections:["receipts","tahsilat","customer payments"],
 payments:["payments","vendor payments","supplier payments","firma ödemeleri"],
 stockLots:["stock lots","inventory lots","partiler"],stockMoves:["stock moves","inventory movements","stok hareket"],
 appointments:["appointments"],exams:["medical records","visits"],labs:["lab results"],expenses:["cash","expenses"],vaccineCatalog:["vaccine catalog"]
};
const extraFields={
 clients:["registered","createdAt","taxOffice","taxNo"],patients:["registered","createdAt","unknownOwner"],
 followups:["examId","renewEvery","renewUnit","previous","createdAt"],
 products:["archived","createdAt","buy","sell"],suppliers:["address","taxNo","taxOffice","contact","city","district","createdAt"],
 purchases:["paid","createdAt"],sales:["amount","product","quantity","items","discount","discountType","examId","createdAt"],
 stockLots:["product","supplier","supplierName","serial","expiry","date","received","remaining","buy","sell","reason","updatedAt"],
 stockMoves:["product","lot","date","delta","reason","source","balance","note","sale","purchase","record"],
 weights:["patient","date","weight"],documents:["patient"],labs:["exam","verified"]
};
const required={
 clients:["name"],patients:["name"],products:["name"],suppliers:["name"],vaccineCatalog:["name"],
 followups:["patient","title","date"],purchases:["product","supplier","date","amount","quantity"],
 sales:["date","amount"],collections:["sale","date","amount"],payments:["purchase","date","amount"],
 expenses:["date","type","amount","detail"],stockLots:["product","received","remaining"],stockMoves:["product","delta"],
 appointments:["date","time","patient"],exams:["patient","date"],labs:["patient","date","title"],
 treatments:["patient","date","title"],prescriptions:["patient","date","drug"],stays:["patient","start"],
 weights:["patient","date","weight"],documents:["title"]
};
const refs={
 patients:{owner:"clients"},followups:{patient:"patients",vaccine:"vaccineCatalog",examId:"exams"},
 appointments:{patient:"patients",client:"clients"},exams:{patient:"patients"},labs:{patient:"patients",exam:"exams"},
 treatments:{patient:"patients"},prescriptions:{patient:"patients",product:"products"},stays:{patient:"patients"},
 purchases:{product:"products",supplier:"suppliers"},sales:{client:"clients",patient:"patients",product:"products",examId:"exams"},
 vaccineCatalog:{product:"products"},collections:{sale:"sales"},payments:{purchase:"purchases"},
 stockLots:{product:"products",supplier:"suppliers"},stockMoves:{product:"products",lot:"stockLots",sale:"sales",purchase:"purchases"},
 weights:{patient:"patients"},documents:{client:"clients",patient:"patients"}
};
const common={
 id:["id","kayıt id","kayıt kodu","record id","external id"],name:["ad","adı","ad soyad","isim","unvan","name","fullname","full name"],
 phone:["cep telefonu","telefon","telefon numarası","gsm","mobile","phone"],email:["email","e-posta","mail"],sku:["stok kodu","ürün kodu","kod","sku","item code"],
 barcode:["barkod","barkod numarası","barcode"],chip:["mikroçip","çip no","chip","microchip"],protocol:["protokol","protokol no","protocol"],
 owner:["sahip id","hasta sahibi id","müşteri id","owner id","customer id","client id","hasta sahibi","sahip adı","owner"],
 client:["müşteri id","sahip id","hasta sahibi id","customer id","client id","müşteri","hasta sahibi","customer"],
 patient:["hasta id","patient id","pet id","hasta","hasta adı","pet"],product:["ürün id","product id","item id","ürün","stok kodu","barkod"],
 supplier:["tedarikçi id","firma id","supplier id","vendor id","firma","tedarikçi"],sale:["satış id","fatura id","sale id","invoice id"],
 purchase:["alış id","alış faturası id","purchase id","purchase invoice id"],date:["tarih","işlem tarihi","planlanan tarih","aşı tarihi","date"],
 done:["uygulama tarihi","yapılma tarihi","yapıldığı tarih","applied date","vaccinated at"],next:["sonraki aşı tarihi","sonraki uygulama tarihi","tekrar tarihi","next date","due date"],
 status:["durum","yapıldı mı","aşı yapıldı mı","tamamlandı mı","status","completed"],title:["başlık","aşı","aşı adı","uygulama adı","işlem adı","vaccine","vaccine name","title"],
 expiry:["skt","son kullanma tarihi","expiry","expiration date"],stock:["stok","mevcut stok","stok miktarı","quantity on hand"],
 amount:["tutar","toplam","toplam tutar","fatura tutarı","amount","total"],price:["fiyat","satış fiyatı","birim fiyat","price"],
 paid:["ödenen","tahsil edilen","ilk ödeme","paid"],method:["yöntem","ödeme şekli","ödeme yöntemi","payment method"],
 species:["tür","hasta türü","species"],breed:["ırk","breed"],sex:["cinsiyet","sex","gender"],birth:["doğum tarihi","birth date","dob"],
 notes:["notlar","açıklama","notes"],serial:["seri","lot","parti numarası","lot no","batch number"],
 remaining:["kalan","kalan miktar","available","remaining"],received:["alınan","alınan miktar","received"],
 quantity:["miktar","adet","quantity"],buy:["alış fiyatı","buy price","cost"],sell:["satış fiyatı","sell price"]
};
const ids={
 clients:["müşteri id","hasta sahibi id","customer id","client id"],patients:["hasta id","patient id","pet id"],
 products:["ürün id","product id","item id"],suppliers:["tedarikçi id","supplier id","firma id"],
 purchases:["alış id","purchase id"],sales:["satış id","sale id","invoice id"],followups:["aşı id","vaccination id"]
};
const cleanKey=value=>norm(value).replace(/[^a-z0-9]/g,"");
export function detectMigrationTable(label) {
  const key=cleanKey(label);
  return Object.keys(migrationNames).find(type=>[type,migrationNames[type],config[type]?.label,...(aliases[type]||[])].some(value=>value&&cleanKey(value)===key))||"";
}
export function migrationFields(type) {
  if (!Object.hasOwn(migrationNames,type)) return [];
  const configFields=config[type]?.fields||[];
  const fieldKeys=["id",...new Set([...configFields.map(field=>field.key),...(extraFields[type]||[])])];
  return fieldKeys.map(key=>{
    const field=configFields.find(item=>item.key===key);
    return {key,label:key==="id"?"Kayıt ID":field?.label||common[key]?.[0]||key,
      required:required[type]?.includes(key)||false,type:field?.type||"",
      aliases:[key,field?.label,...(key==="id"?ids[type]||[]:[]),...(common[key]||[])].filter(Boolean)};
  });
}
export function matchMigrationColumns(headers,type) {
  const keys=headers.map(cleanKey), used=new Set();
  return Object.fromEntries(migrationFields(type).map(field=>{
    const matched=field.aliases.map(value=>keys.indexOf(cleanKey(value))).find(index=>index>=0&&!used.has(index));
    if (matched!==undefined) used.add(matched);
    return [field.key,matched??-1];
  }));
}
function dayValue(text) {
  const input=String(text||"").trim();
  if (/^\d{5}(?:\.\d+)?$/.test(input)&&Number(input)>=20000&&Number(input)<85000) {
    return new Date(Date.UTC(1899,11,30)+Math.floor(Number(input))*86400000).toISOString().slice(0,10);
  }
  const iso=input.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/);
  const local=input.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:$| )/);
  const candidate=iso?.[1]||(local?local[3]+"-"+local[2].padStart(2,"0")+"-"+local[1].padStart(2,"0"):"");
  if (!candidate||!Number.isFinite(Date.parse(candidate))||new Date(candidate).toISOString().slice(0,10)!==candidate) return "";
  return candidate;
}
function numberValue(value) {
  let text=value.replace(/[₺\s]/g,"").replace(/(?:TRY|TL)$/i,"");
  if (text.includes(",")) text=text.replace(/\./g,"").replace(",",".");
  return /^-?\d{1,12}(?:\.\d{1,4})?$/.test(text)&&Number.isFinite(Number(text))?String(Number(text)):"";
}
function fingerprint(value) {
  let hash=0xcbf29ce484222325n;
  for (const char of value) hash=BigInt.asUintN(64,(hash^BigInt(char.codePointAt(0)))*0x100000001b3n);
  return hash.toString(36);
}
const dateKeys=new Set(["birth","chipDate","date","done","next","expiry","registered"]);
const numericKeys=new Set(["amount","paid","quantity","price","vat","stock","min","weight","delta","received","remaining","buy","sell","discount","offsetDays","renewEvery","balance"]);
const countKeys=new Set(["quantity","stock","min","delta","received","remaining","offsetDays","renewEvery"]);
const normalizedStatus=value=>{
  const key=cleanKey(value);
  if (["1","evet","true","yapildi","tamamlandi","uygulandi","done","completed"].includes(key)) return "Tamamlandı";
  if (["iptal","cancelled","canceled"].includes(key)) return "İptal";
  if (["0","hayir","false","yapilmadi","planlandi","pending","bekliyor",""].includes(key)) return "Planlandı";
  return "";
};

export function migrationWorkbook(state,branch,types=Object.keys(migrationNames),template=false) {
  return types.filter(type=>Object.hasOwn(migrationNames,type)).map(type=>{
    const fields=migrationFields(type).map(({key})=>key);
    const debt=["sales","purchases"].includes(type);
    return {name:migrationNames[type],headers:[...fields,...(debt?["Kalan borç (TL)"]:[])],rows:template?[]:
      (state[type]||[]).filter(row=>!branch||row.branch===branch).map(row=>[
        ...fields.map(key=>row[key]??""),...(debt?[balance(state,type,row)/100]:[])
      ])};
  });
}

export function buildMigration(state,datasets,source,branch,date) {
  const next={...state}, issues=[],counts={}, links={};
  let totalIssues=0, imported=0, skipped=0;
  const problem=(type,index,message)=>{totalIssues++;if(issues.length<60)issues.push({table:migrationNames[type],row:index+2,message});};
  for (const type of Object.keys(migrationNames)) {
    next[type]=[...(state[type]||[])];
    links[type]=new Map();
    counts[type]={added:0,skipped:0};
  }
  const keyFor=(type,id)=>"m-"+fingerprint(source+"|"+branch+"|"+type+"|"+id);
  const indexRow=(type,row,values)=>{
    for (const value of values.filter(Boolean)) {
      const key=norm(value);
      const map=links[type];
      if (!map.has(key)) map.set(key,row.id);
      else if (map.get(key)!==row.id) map.set(key,"");
    }
  };
  const identityKeys=row=>[row.name,row.protocol,row.chip,row.barcode,row.sku,row.invoice,row.phone];
  for (const type of Object.keys(migrationNames)) for (const row of next[type].filter(row=>row.branch===branch)) {
    indexRow(type,row,[row.id,...(row.importSource===source?[row.importId]:[]),...identityKeys(row)]);
  }
  const staged=[];
  for (const type of Object.keys(migrationNames)) {
    const fields=migrationFields(type);
    const existing=new Set(next[type].map(row=>row.id));
    const previousImports=new Set(next[type].filter(row=>row.branch===branch&&row.importSource===source).map(row=>row.importId));
    for (const [index,input] of (datasets[type]||[]).entries()) {
      if (!input||typeof input!=="object"||Array.isArray(input)) {problem(type,index,"Satır biçimi geçersiz.");continue;}
      const idText=String(input.id??"").trim().slice(0,180);
      const inputValues=fields.filter(field=>field.key!=="id").map(({key})=>[key,typeof input[key]==="string"||typeof input[key]==="number"?String(input[key]).trim():""]);
      if (!idText&&!inputValues.some(([,value])=>value)) continue;
      const importId=idText||"auto-"+fingerprint(JSON.stringify(inputValues.filter(([,value])=>value)));
      const id=keyFor(type,importId);
      if (existing.has(id)||previousImports.has(importId)||(source==="vetnet"&&idText&&next[type].some(row=>row.branch===branch&&row.id===idText))) {
        counts[type].skipped++;skipped++;continue;
      }
      const row={id,branch,importId,importSource:source};
      for (const [key,value] of inputValues) {
        if (value.length>(key==="items"?32000:8000)) {problem(type,index,"Hücre desteklenen uzunluğu aşıyor.");continue;}
        if (!value) continue;
        let normalized=value;
        if (dateKeys.has(key)) normalized=dayValue(value);
        if (numericKeys.has(key)) normalized=numberValue(value);
        if (!normalized||(countKeys.has(key)&&(!Number.isSafeInteger(Number(normalized))||(key!=="delta"&&Number(normalized)<0)))||
          (numericKeys.has(key)&&!["delta","balance"].includes(key)&&Number(normalized)<0)) {
          problem(type,index,fields.find(field=>field.key===key).label+" biçimi geçersiz.");continue;
        }
        row[key]=normalized;
      }
      if (type==="followups") {
        row.kind ||= "Aşı";
        row.date ||= row.done;
        row.status=row.status?normalizedStatus(row.status):row.done?"Tamamlandı":"Planlandı";
        if (!row.status) problem(type,index,"Aşı durumunu Planlandı, Tamamlandı veya İptal olarak belirtin.");
        if (row.status==="Tamamlandı"&&!row.done) problem(type,index,"Yapılan aşı için uygulama tarihi gerekli.");
        if (row.done&&row.status==="Planlandı") problem(type,index,"Uygulama tarihi ile aşı durumu çelişiyor.");
      }
      if (row.method) row.method=({cash:"Nakit",card:"Kart",creditcard:"Kart",bank:"Havale",transfer:"Havale",eft:"Havale"})[cleanKey(row.method)]||row.method;
      if (type==="patients"&&row.species) row.species=({cat:"Kedi",dog:"Köpek",bird:"Kuş",rabbit:"Tavşan",rodent:"Kemirgen",reptile:"Sürüngen"})[cleanKey(row.species)]||row.species;
      if (type==="products"&&cleanKey(row.category)==="service") row.category="Hizmet";
      if (type==="clients") {
        row.kind ||= "Klinik müşterisi";row.registered ||= date;
        if (source!=="vetnet") for (const permission of ["sms","whatsapp","emailPermission","notifications"]) row[permission]="Yok";
      }
      if (type==="patients") {row.registered ||= date;row.species ||= "Diğer";row.sex ||= "Bilinmiyor";}
      if (type==="products") {row.stock ||= "0";row.min ||= "0";row.category ||= "Ürün";row.track ||= row.category==="Hizmet"?"Hayır":"Evet";}
      if (["sales","purchases"].includes(type)) row.paid ||= "0";
      for (const key of required[type]||[]) if (!row[key]) problem(type,index,fields.find(field=>field.key===key)?.label+" zorunludur.");
      if (type==="stockLots"&&Number(row.remaining)>Number(row.received)) problem(type,index,"Kalan stok alınan miktardan büyük.");
      if (Number(row.vat)>100||(["sales","purchases"].includes(type)&&Number(row.paid)>Number(row.amount))) problem(type,index,"KDV veya ilk ödeme tutarını kontrol edin.");
      existing.add(id);
      indexRow(type,row,[id,importId,...identityKeys(row)]);
      staged.push({type,index,row});
    }
  }
  const resolve=(type,value)=>links[type].get(norm(value))||"";
  // Native stock lot IDs link back to their purchase and opening stock records.
  for (const entry of staged.filter(item=>item.type==="stockLots"&&source==="vetnet")) {
    const {row}=entry;
    const purchase=row.importId.startsWith("purchase-")&&resolve("purchases",row.importId.slice(9));
    const product=row.importId.startsWith("initial-")&&resolve("products",row.importId.slice(8));
    if (!purchase&&!product) continue;
    row.id=purchase?"purchase-"+purchase:"initial-"+product;
    links.stockLots.set(norm(row.importId),row.id);
  }
  const supplierNames=new Map([...next.suppliers,...staged.filter(item=>item.type==="suppliers").map(item=>item.row)].map(row=>[row.id,row.name]));
  for (const {type,index,row} of staged) {
    for (const [field,target] of Object.entries(refs[type]||{})) {
      if (!row[field]) continue;
      const mapped=resolve(target,row[field]);
      if (!mapped) problem(type,index,migrationNames[target]+" bağlantısı bulunamadı veya birden fazla eşleşti.");
      else row[field]=mapped;
    }
    if (type==="stockLots"&&row.supplier&&!row.supplierName) row.supplierName=supplierNames.get(row.supplier)||"";
    if (type==="sales"&&row.items) {
      try {
        const lines=JSON.parse(row.items);
        if (!Array.isArray(lines)||lines.length>100) throw Error();
        for (const line of lines) {
          if (!line||typeof line!=="object"||Array.isArray(line)) throw Error();
          const quantity=Number(line.quantity),price=Number(line.price),vat=Number(line.vat||0);
          if (!Number.isSafeInteger(quantity)||quantity<1||!Number.isFinite(price)||price<0||!Number.isFinite(vat)||vat<0||vat>100) throw Error();
          if (line.product) {
            line.product=resolve("products",line.product);
            if (!line.product) throw Error();
          }
        }
        row.items=JSON.stringify(lines);
      } catch {problem(type,index,"Satış kalemleri okunamadı veya ürüne bağlanamadı.");}
    }
    if (type==="patients"&&!row.owner) row.unknownOwner="Evet";
    next[type].push(row);
    counts[type].added++;imported++;
  }
  for (const product of next.products.filter(row=>row.branch===branch&&tracksStock(row))) {
    const lots=next.stockLots.filter(row=>row.product===product.id&&row.branch===branch);
    if (lots.length&&staged.some(item=>item.type==="stockLots"&&item.row.product===product.id)) {
      const index=next.products.indexOf(product);
      next.products[index]={...product,stock:String(lots.reduce((sum,row)=>sum+Number(row.remaining||0),0))};
    }
  }
  for (const {type,index,row} of staged) {
    if (["collections","payments"].includes(type)) {
      const target=type==="collections"?"sales":"purchases", parent=next[target].find(item=>item.id===row[type==="collections"?"sale":"purchase"]);
      if (parent&&balance(next,target,parent)<0) problem(type,index,"Ödemeler bağlı kaydın tutarını aşıyor.");
    }
  }
  return {next,counts,imported,skipped,issues,totalIssues};
}
