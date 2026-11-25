import {defaultTheme} from "./theme.js?v=2";
import {allocateInventory, applyInventoryPurchase, productLots} from "./stock.js";

export const tz = "Europe/Istanbul";
const dateFormat = new Intl.DateTimeFormat("en-CA", {timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"});
export const today = () => dateFormat.format(new Date());
export function addDays(date, days) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0,10);
}
export function renewalDate(date, count, unit) {
  if (!date || !Number.isInteger(count) || count<1) return "";
  if (unit==="Gün") return addDays(date,count);
  if (unit==="Hafta") return addDays(date,count*7);
  if (!["Ay","Yıl"].includes(unit)) return "";
  const value=new Date(date+"T12:00:00Z");
  const day=value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth()+count*(unit==="Yıl"?12:1));
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
  value.setUTCDate(Math.min(day,last));
  return value.toISOString().slice(0,10);
}
export const dateLabel = (date, options = {day:"numeric",month:"short"}, locale = "tr-TR") => date
  ? new Intl.DateTimeFormat(locale,{timeZone:tz,...options}).format(new Date(date + "T12:00:00Z")) : "—";
export const currency = new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"});
export const norm = value => String(value ?? "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replaceAll("ı","i");
export const matches = (query, values) => norm(query).trim().split(/\s+/).every(word => values.some(value => norm(value).includes(word)));
export const defaults = {menu:"left",customerLabel:"Müşteriler",showPublicNotes:"Evet",warnings:"Evet",opens:"10:00",closes:"23:00",slot:"30",clinic:"VetZimo",themeColor:defaultTheme,phone:"",email:"",address:"",invoiceName:"",taxOffice:"",taxNo:""};
export const empty = () => ({
  preferences:{...defaults},
  version:1, demo:false, branches:[{id:"merkez",name:"Eskişehir Merkez",city:"Eskişehir",status:"Aktif"}],
  clients:[], patients:[], appointments:[], exams:[], labs:[], treatments:[], followups:[], prescriptions:[], stays:[], surgeries:[], products:[], suppliers:[], purchases:[], sales:[], collections:[], payments:[], expenses:[], templates:[],
  weights:[], stockLots:[], stockMoves:[], clinicNotes:[],
  messages:[], users:[], dealers:[], activity:[], visitors:[], vaccineCatalog:[], documents:[], support:[],
});
export function sample() {
  const base = empty(), now = today();
  const local = values => values.map(value => ({...value,branch:"merkez"}));
  return {
    ...base, demo:true,
    clients:local([
      {id:"c1",name:"Ayşe Yılmaz",phone:"05XX XXX XX 01",email:"ayse@example.invalid",permission:"Yok",registered:now},
      {id:"c2",name:"Mert Kaya",phone:"05XX XXX XX 02",email:"mert@example.invalid",permission:"Yok",registered:now},
      {id:"c3",name:"Deniz Demir",phone:"05XX XXX XX 03",email:"deniz@example.invalid",permission:"Yok",registered:now},
      {id:"c4",name:"Ece Arslan",phone:"05XX XXX XX 04",email:"ece@example.invalid",permission:"Yok",registered:now},
    ]),
    patients:local([
      {id:"p1",name:"Pamuk",species:"Kedi",breed:"British Shorthair",owner:"c1",weight:"4.2",sex:"Dişi",birth:"2022-05-16",neutered:"Evet",chip:"",protocol:"MLD-0001",registered:now,warning:"Taşıma çantasında stres yaşayabiliyor."},
      {id:"p2",name:"Tarçın",species:"Köpek",breed:"Golden Retriever",owner:"c2",weight:"23",sex:"Erkek",birth:"2020-04-04",protocol:"MLD-0002",registered:now},
      {id:"p3",name:"Mia",species:"Kedi",breed:"Tekir",owner:"c3",weight:"3.6",sex:"Dişi",birth:"2023-08-17",protocol:"MLD-0003",registered:now},
      {id:"p4",name:"Boncuk",species:"Köpek",breed:"Pomeranian",owner:"c4",weight:"4.5",sex:"Erkek",birth:"2021-11-20",protocol:"MLD-0004",registered:now},
    ]),
    appointments:local([
      {id:"a1",patient:"p1",date:now,time:"10:30",service:"Genel muayene",status:"Tamamlandı"},
      {id:"a2",patient:"p2",date:now,time:"11:15",service:"Aşı uygulaması",status:"Bekliyor"},
      {id:"a3",patient:"p3",date:now,time:"13:00",service:"Kontrol muayenesi",status:"Onaylandı"},
      {id:"a4",patient:"p4",date:now,time:"15:30",service:"Genel muayene",status:"Planlandı"},
      {id:"a5",patient:"p1",date:addDays(now,2),time:"14:00",service:"Kontrol muayenesi",status:"Planlandı"},
    ]),
    exams:local([{id:"e1",patient:"p1",date:addDays(now,-7),title:"Rutin kontrol",weight:"4.2",temperature:"38.4",assessment:"Genel durum iyi.",plan:"Yıllık kontrol planlandı."}]),
    followups:local([
      {id:"f1",patient:"p1",date:addDays(now,-2),kind:"Aşı",title:"Karma aşı",status:"Planlandı"},
      {id:"f2",patient:"p2",date:now,kind:"Aşı",title:"Kuduz aşısı",status:"Planlandı"},
      {id:"f3",patient:"p3",date:addDays(now,3),kind:"Parazit",title:"İç parazit kontrolü",status:"Planlandı"},
    ]),
    products:local([
      {id:"s1",name:"Steril gazlı bez",sku:"MLD-S01",barcode:"8690000000001",category:"Sarf",stock:"4",min:"8",price:"90",expiry:""},
      {id:"s2",name:"Kedi maması 2 kg",sku:"MLD-S02",barcode:"8690000000002",category:"Mama",stock:"18",min:"5",price:"850",expiry:addDays(now,130)},
    ]),
    suppliers:local([{id:"su1",name:"Örnek Veteriner Tedarik"}]),
    purchases:local([{id:"buy1",supplier:"su1",product:"s1",date:now,quantity:"4",amount:"200",invoice:"ÖRNEK-001"}]),
    sales:local([
      {id:"sale1",client:"c1",date:now,detail:"Genel muayene",product:"",quantity:"1",amount:"850",paid:"850",method:"Kart"},
      {id:"sale2",client:"c2",date:addDays(now,-1),detail:"Örnek kontrol muayenesi",product:"",quantity:"1",amount:"600",paid:"100",method:"Nakit"},
    ]),
    expenses:local([{id:"ex1",date:now,type:"Gider",detail:"Sarf malzeme",amount:"180"}]),
    templates:local([
      {id:"t1",name:"Randevu hatırlatma",channel:"SMS",message:"Merhaba {sahip}, {hasta} için randevunuzu hatırlatırız. VetZimo"},
      {id:"t2",name:"Aşı hatırlatma",channel:"WhatsApp",message:"Merhaba {sahip}, {hasta} için aşı kontrolü planlamak üzere kliniğimize ulaşabilirsiniz."},
    ]),
    dealers:[{id:"d1",name:"VetZimo",contact:"Merkez yönetim",status:"Aktif"}],
  };
}

const field = (key,label,type = "text",options = {}) => ({key,label,type,...options});
const required = {required:true};
const wide = {wide:true};
const patient = field("patient","Hasta","ref",{required:true,ref:"patients"});
const date = field("date","Tarih","date",required);
const amount = field("amount","Tutar (₺)","number",{required:true,min:0.01,step:0.01});
export const appointmentStatuses = ["Planlandı","Yeni Talep","Onay Bekliyor","Onaylandı","Görüşüldü","Bekliyor","Muayenede","Tamamlandı","Reddedildi","İptal","İptal Edildi","Gelmedi"];
const quantity = field("quantity","Adet","number",{required:true,min:1,step:1});
const method = field("method","Kasa / ödeme yöntemi","select",{required:true,values:["Kart","Nakit","Havale","Diğer"]});
const yesNo = ["Bilinmiyor","Evet","Hayır"];

export const config = {
  patients:{label:"Hastalar",singular:"Hasta",action:"Yeni hasta",description:"Hasta dosyaları, kimlik bilgileri ve klinik geçmiş.",columns:["name","species","breed","owner","protocol"],fields:[
    field("owner","Hasta sahibi","ref",{required:true,ref:"clients"}),field("name","Hasta adı","text",required),
    field("species","Tür","select",{required:true,values:["Kedi","Köpek","Kuş","Tavşan","Kemirgen","Sürüngen","Diğer"]}),field("breed","Irk"),
    field("sex","Cinsiyet","select",{required:true,values:["Bilinmiyor","Dişi","Erkek"]}),field("birth","Doğum tarihi","date"),
    field("color","Renk"),field("weight","Kilo (kg)","number",{min:0.001,step:0.001}),field("neutered","Kısırlaştırılmış mı?","select",{values:yesNo}),
    field("chip","Mikroçip numarası","text",{maxlength:15,pattern:"[0-9]{15}"}),field("chipDate","Çip takılma tarihi","date"),field("passport","Pasaport numarası","text",{maxlength:40}),field("chipSite","Çip Takılma Yeri","select",{values:["İki Scapula arası","Boyun Kısmına"]}),field("protocol","Protokol numarası","text",{automatic:true}),
    field("temperament","Davranış","select",{values:["Bilinmiyor","Sakin","Stresli","Saldırgan"]}),field("blood","Kan grubu"),
    field("food","Beslenme / mama"),field("marking","Ayırt edici özellik"),field("registry","Bakanlık kayıt durumu","select",{values:["Bildirilmemiş","Kayıtlı","Kontrol edilecek"]}),
    field("warning","Kritik uyarılar","textarea",wide),field("notes","Klinik içi notlar","textarea",wide),
  ]},
  clients:{label:"Hasta Sahipleri",singular:"Müşteri",action:"Yeni Müşteri Ekle",description:"İletişim kayıtları ve her hasta sahibine bağlı dosyalar.",columns:["name","phone","email","city","group","protocol"],fields:[
    field("name","Ad soyad","text",required),field("phone","Cep telefonu · kullanıcı adı","tel",required),field("nationalId","T.C. kimlik numarası","text",{maxlength:11,pattern:"[0-9]{11}"}),field("email","E-posta","email"),
    field("phone2","İkinci telefon","tel"),field("birth","Doğum tarihi","date"),
    field("city","İl"),field("district","İlçe"),field("neighborhood","Mahalle"),field("profession","Meslek"),
    field("group","Müşteri grubu"),field("source","Edinme kanalı"),field("kind","Müşteri tipi","select",{values:["Klinik müşterisi","Dış müşteri"]}),field("protocol","Protokol numarası","text",{automatic:true}),
    field("address","Adres","textarea",wide),field("notes","Klinik içi notlar","textarea",wide),field("warning","Kritik uyarılar","textarea",wide),
    ...[["sms","SMS"],["whatsapp","WhatsApp"],["emailPermission","E-posta"],["notifications","Bildirim"]].map(([key,label]) => field(key,label+" gönderim izni","select",{values:["Yok","Var"]})) ,
  ]},
  visitors:{label:"Ziyaretçiler",singular:"Ziyaretçi",action:"Yeni ziyaretçi",description:"Hasta kaydı açılmadan yapılan ziyaretleri ve görüşmeleri takip edin.",columns:["date","name","phone","detail","status"],fields:[
    date,field("name","Ad soyad","text",required),field("phone","Telefon","tel"),field("detail","Ziyaret nedeni","text",required),
    field("status","Durum","select",{values:["Bekliyor","Görüşüldü","Takip edilecek"]}),field("notes","Not","textarea",wide),
  ]},
  documents:{label:"Müşteri Belge Kayıtları",singular:"Belge kaydı",action:"Yeni belge kaydı",description:"Klinik arşivindeki müşteri belgeleri için başlık, tür ve arşiv referansı tutun.",columns:["date","client","title","kind","reference"],fields:[
    field("client","Müşteri","ref",{required:true,ref:"clients"}),date,field("title","Belge başlığı","text",required),
    field("kind","Belge türü","select",{values:["Onam","İletişim izni","Teslim belgesi","Diğer"]}),
    field("reference","Arşiv / dosya referansı"),field("notes","Açıklama","textarea",wide),
  ]},
  vaccineCatalog:{label:"Aşı Listesi",singular:"Aşı tanımı",action:"Yeni aşı tanımı",description:"Türe göre başlangıç gününü, yenileme aralığını ve ücretleri yönetin.",columns:["species","name","offsetDays","renewEvery","required","product","price","status"],fields:[
    field("name","Aşı / uygulama adı","text",required),
    field("species","Hasta türü","select",{values:["Tümü","Kedi","Köpek","Kuş","Tavşan","Kemirgen","Sürüngen","Egzotik","Diğer"]}),
    field("offsetDays","Başlangıçtan sonraki gün","number",{min:0,step:1}),
    field("renewEvery","Yenileme aralığı (0 = yenilenmesin)","number",{min:0,step:1}),
    field("renewUnit","Yenileme birimi","select",{values:["Gün","Hafta","Ay","Yıl"]}),
    field("required","Klinik protokolünde zorunlu mu?","select",{values:["Evet","Hayır"]}),
    field("product","Bağlı ürün","ref",{ref:"products"}),field("price","Aşı ücreti (₺)","number",{min:0,step:0.01}),
    field("brand","Marka"),field("status","Durum","select",{values:["Aktif","Pasif"]}),field("notes","Notlar","textarea",wide),
  ]},
  support:{label:"Destek ve İş Takibi",singular:"İş kaydı",action:"Yeni iş kaydı",description:"Klinik içi destek isteklerini, sorumluları ve durumları takip edin.",columns:["date","title","priority","clinician","status"],fields:[
    date,field("title","Konu","text",required),field("priority","Öncelik","select",{values:["Normal","Yüksek"]}),field("clinician","Sorumlu"),
    field("status","Durum","select",{values:["Açık","İnceleniyor","Tamamlandı"]}),field("notes","Açıklama","textarea",wide),
  ]},
  appointments:{label:"Randevular",singular:"Randevu",action:"Yeni randevu",description:"Günlük takvim, hasta kabulü ve randevu durumları.",columns:["date","time","endTime","client","patient","service","clinician","status"],fields:[
    date,field("time","Başlangıç saati","time",required),field("endTime","Bitiş saati","time"),field("status","Randevu durumu","select",{required:true,values:appointmentStatuses}),
    field("clinician","Personel / hekim","text",required),field("client","Müşteri","ref",{ref:"clients"}),{...patient,required:false},
    field("service","Yapılacak işlem / hizmet","text",required),field("notes","Randevu notları","textarea",wide),
  ]},
  exams:{label:"Muayeneler",singular:"Muayene",action:"Yeni muayene",description:"Klinik değerlendirme, tetkik ve tedavi planları.",columns:["date","patient","title","clinician","status","assessment"],fields:[
    patient,date,field("title","Başlık","text",required),field("clinician","Hekim"),field("weight","Kilo (kg)","number",{min:0.001,step:0.001}),
    field("temperature","Vücut sıcaklığı (°C)","number",{min:0,step:0.1}),
    field("pulse","Nabız (atım/dk)","number",{min:1,step:1}),field("respiratory","Solunum (nefes/dk)","number",{min:1,step:1}),
    field("status","Muayene durumu","select",{values:["Muayenede","Tamamlandı","İptal"]}),field("symptoms","Semptomlar","textarea",wide),field("complaint","Şikâyet / anamnez","textarea",wide),
    field("findings","Muayene bulguları","textarea",wide),field("assessment","Değerlendirme / tanı","textarea",wide),
    field("tests","Tetkikler ve sonuçları","textarea",wide),field("plan","Tedavi / izlem planı","textarea",wide),field("next","Kontrol tarihi","date"),field("nextTime","Kontrol saati","time"),
  ]},
  labs:{label:"Tetkikler",singular:"Tetkik",action:"Yeni tetkik",description:"Laboratuvar ve görüntüleme istemleri ile hasta dosyasına bağlı sonuçlar.",columns:["date","patient","title","kind","status","result"],fields:[
    patient,date,field("title","Tetkik adı","text",required),field("kind","Tür","select",{values:["Hemogram","Biyokimya","Kan gazı","İdrar tahlili","Röntgen","Ultrason","MR","Tomografi","Mikroskop","Laboratuvar","Diğer"]}),
    field("status","Durum","select",{values:["Planlandı","Bekliyor","Tamamlandı","İptal"]}),field("result","Sonuç ve değerlendirme","textarea",wide),
  ]},
  treatments:{label:"Tedavi İşlemleri",singular:"Tedavi işlemi",action:"Yeni işlem",description:"Uygulanan tedavi, ilaç ve girişimlerin hasta bazlı kayıtları.",columns:["date","patient","title","clinician","status"],fields:[
    patient,date,field("title","İşlem adı","text",required),field("clinician","Uygulayan hekim"),
    field("status","Durum","select",{values:["Planlandı","Tamamlandı","İptal"]}),field("plan","Uygulama ve izlem notu","textarea",wide),
  ]},
  followups:{label:"Aşı ve Takip",singular:"Takip",action:"Yeni takip",description:"Aşı, parazit uygulaması ve kontrol hatırlatmaları.",columns:["patient","title","kind","date","done","status"],fields:[
    patient,field("kind","Takip türü","select",{required:true,values:["Aşı","Parazit","Kontrol","Diğer"]}),
    field("vaccine","Aşı listesinden seç","ref",{ref:"vaccineCatalog"}),field("title","Uygulama / takip adı","text",required),field("date","Planlanan tarih","date",required),
    field("status","Durum","select",{required:true,values:["Planlandı","Tamamlandı","İptal"]}),
    field("done","Uygulama tarihi","date"),field("clinician","Uygulayan hekim"),field("previousWeight","Önceki kilo (kg)","number",{min:0.001,step:0.001}),field("weight","Yeni kilo (kg)","number",{min:0.001,step:0.001}),field("batch","Seri / lot numarası"),field("next","Sonraki uygulama tarihi","date"),field("notes","Notlar","textarea",wide),
  ]},
  prescriptions:{label:"Reçeteler",singular:"Reçete",action:"Yeni reçete",description:"Hasta dosyasına bağlı ilaç kaydı, uygulama talimatı ve isteğe bağlı stok düşümü.",columns:["date","patient","drug","dose","frequency","stockMode"],fields:[
    patient,date,field("kind","Reçete sınıfı","select",{required:true,values:["Ayaktan tedavi","Yatış tedavisi","Diğer"]}),
    field("diagnosis","Tanı / reçete nedeni"),field("drug","İlaç adı","text",required),field("dose","Doz ve birim","text",required),
    field("route","Uygulama yolu"),field("frequency","Uygulama sıklığı"),field("duration","Tedavi süresi"),field("clinician","Hekim"),
    field("stockMode","Stoktan düşülsün mü?","select",{required:true,values:["Hayır","Evet"]}),field("product","Stok ürünü","ref",{ref:"products"}),
    quantity,field("notes","Uygulama talimatı","textarea",wide),
  ]},
  stays:{label:"Yatış ve Konaklama",singular:"Konaklama",action:"Yeni konaklama",description:"Hospitalizasyon ve pansiyon kayıtları, oda takibi ve taburcu bilgileri.",columns:["start","patient","kind","room","end","status"],fields:[
    patient,field("kind","Konaklama tipi","select",{required:true,values:["Hospitalizasyon","Pansiyon"]}),field("room","Oda / kafes","text",required),
    field("status","Durum","select",{required:true,values:["Planlandı","Yatışta","Taburcu","İptal"]}),
    field("start","Giriş tarihi ve saati","datetime-local",required),field("end","Çıkış tarihi ve saati","datetime-local"),
    field("clinician","Sorumlu personel"),field("food","Kullandığı mama"),field("belongings","Eşyaları"),field("medications","Kullandığı ilaçlar","textarea",wide),
    field("allergies","Bilinen hastalıklar ve alerjiler","textarea",wide),field("notes","Yatış ve taburcu notları","textarea",wide),
  ]},
  suppliers:{label:"Tedarikçiler",singular:"Tedarikçi",action:"Yeni tedarikçi",description:"Ürün alışlarının bağlı olduğu tedarikçi kayıtları.",columns:["name","phone","email"],fields:[
    field("name","Firma adı","text",required),field("phone","Telefon","tel"),field("email","E-posta","email"),field("notes","Notlar","textarea",wide),
  ]},
  purchases:{label:"Alışlar",singular:"Alış",action:"Yeni alış",description:"Ürün girişlerini stoğa ekleyin, tedarikçi borçlarını ve fatura numaralarını izleyin.",columns:["date","supplier","product","quantity","invoice","amount","balance"],fields:[
    date,field("supplier","Tedarikçi","ref",{required:true,ref:"suppliers"}),field("product","Stok ürünü","ref",{required:true,ref:"products"}),
    quantity,field("invoice","Fatura numarası"),field("expiry","Parti SKT","date"),field("serial","Seri / lot numarası"),field("clinician","Kaydı açan personel"),amount,field("notes","Alış notları","textarea",wide),
  ]},
  collections:{label:"Tahsilatlar",singular:"Tahsilat",action:"Yeni tahsilat",description:"Açık satış bakiyesine kısmi veya tam tahsilat işleyin.",columns:["date","client","sale","amount","method"],fields:[
    field("sale","Satış ve kalan bakiye","ref",{required:true,ref:"sales"}),date,amount,method,field("notes","Tahsilat notları","textarea",wide),
  ]},
  payments:{label:"Tedarikçi Ödemeleri",singular:"Ödeme",action:"Yeni ödeme",description:"Tedarikçi ödemelerini ilgili alış kaydına ve kasa hareketlerine bağlayın.",columns:["date","supplier","purchase","amount","method"],fields:[
    field("purchase","Alış ve kalan borç","ref",{required:true,ref:"purchases"}),date,amount,method,field("notes","Ödeme notları","textarea",wide),
  ]},
  products:{label:"Ürün ve Stok",singular:"Ürün",action:"Yeni ürün",description:"Stok seviyeleri, kritik stok seviyeleri ve son kullanma tarihleri.",columns:["name","sku","barcode","category","brand","stock","min","expiry","price"],fields:[
    field("category","Ürün türü","select",{values:["Ürün","Mama","İlaç","Aşı","Sarf","Aksesuar","Hizmet","Diğer"]}),
    field("name","Ürün / hizmet adı","text",required),field("sku","Stok kodu","text",required),field("barcode","Barkod kodu"),
    field("price","Birim satış fiyatı (₺)","number",{required:true,min:0,step:0.01}),field("vat","KDV oranı (%)","number",{min:0,max:100,step:0.01}),
    field("taxMode","Fiyat tipi","select",{values:["KDV Hariç","KDV Dahil"]}),field("unit","Birim","select",{values:["Adet","Paket","Kutu","Şişe","Doz","Kg","ml","Seans"]}),
    field("track","Stok takibi","select",{values:["Evet","Hayır"]}),field("stock","Başlangıç / mevcut stok","number",{required:true,min:0,step:1}),
    field("min","Kritik Stok","number",{required:true,min:0,step:1}),field("brand","Marka"),field("family","Kategori"),
    field("pack","Paket içeriği"),field("batch","Seri / lot numarası"),field("registrySerial","Tarbil seri numarası"),field("expiry","Son kullanma tarihi","date"),
  ]},
  sales:{label:"Satış ve Tahsilat",singular:"Satış",action:"Yeni satış",description:"Ürün ve hizmet satışları, tahsilatlar ve açık bakiyeler.",columns:["date","client","detail","amount","paid","balance","method"],fields:[
    date,field("clinician","Personel"),field("client","Müşteri","ref",{ref:"clients"}),{...patient,required:false},
    field("invoice","Fatura numarası"),field("detail","Satış açıklaması"),field("paid","İlk tahsilat (₺)","number",{required:true,min:0,step:0.01}),method,
    field("privateNotes","Klinik içi satış notu","textarea",wide),field("publicNotes","Müşteri çıktısı notu","textarea",wide),
  ]},
  expenses:{label:"Kasa ve Muhasebe",singular:"Kasa hareketi",action:"Yeni kasa hareketi",description:"Tahsilatlar ve elle girilen gelir-gider hareketleri.",columns:["date","type","detail","amount"],fields:[
    date,method,field("type","Hareket türü","select",{required:true,values:["Gider","Gelir"]}),field("detail","Açıklama","text",required),amount,
  ]},
  templates:{label:"Mesaj Şablonları",singular:"Mesaj şablonu",action:"Yeni şablon",description:"Toplu SMS ve WhatsApp gönderimi için müşteriye, hastaya ve kliniğe ait alanları ekleyin.",columns:["name","channel","message"],fields:[
    field("name","Şablon adı","text",required),field("channel","Kanal","select",{values:["SMS","WhatsApp"]}),field("message","Mesaj metni","textarea",{...required,...wide}),
  ]},
  messages:{label:"SMS ve WhatsApp",singular:"İletişim taslağı",action:"Yeni taslak",description:"SMS ve WhatsApp mesajlarını hazırlayın ve klinik içinde saklayın.",columns:["date","client","patient","channel","message"],fields:[
    field("client","Hasta sahibi","ref",{required:true,ref:"clients"}),field("patient","Hasta","ref",{ref:"patients"}),field("channel","Kanal","select",{values:["SMS","WhatsApp"]}),
    field("template","Şablon","ref",{ref:"templates"}),field("message","Mesaj metni","textarea",{...required,...wide}),
  ]},
  dealers:{label:"Bayilikler",singular:"Bayilik",action:"Yeni bayilik",description:"Klinik ve bayi bilgilerini takip edin.",columns:["name","contact","status"],fields:[
    field("name","Klinik / bayi adı","text",required),field("contact","Yetkili"),field("status","Durum","select",{values:["Aktif","Pasif"]}),
  ]},
  branches:{label:"Şubeler",singular:"Şube",action:"Yeni şube",description:"Kayıtları şubeye göre ayırın ve şubeler arasında geçiş yapın.",columns:["name","city","dealer","status"],fields:[
    field("name","Şube adı","text",required),field("city","İl","text",required),field("phone","Klinik iletişim telefonu","tel"),field("dealer","Bağlı bayi","ref",{ref:"dealers"}),field("status","Durum","select",{values:["Aktif","Pasif"]}),
  ]},
  users:{label:"Ekip Planı",singular:"Ekip kaydı",action:"Yeni ekip kaydı",description:"Şube ekibini ve planlanan görevleri listeleyin. Erişim VetZimo hesabıyla sağlanır.",columns:["name","email","role"],fields:[
    field("name","Ad soyad","text",required),field("email","E-posta","email",required),field("role","Görev","select",{values:["Yönetici","Veteriner Hekim","Resepsiyon","Stok ve Kasa"]}),
  ]},
};

export const clockMinutes = value => Number(value?.slice(0,2))*60 + Number(value?.slice(3,5));
export const clock = minutes => String(Math.floor(minutes/60)).padStart(2,"0") + ":" + String(minutes%60).padStart(2,"0");
export const weekStart = date => addDays(date,-((new Date(date+"T12:00:00Z").getUTCDay()+6)%7));
export const tracksStock = product => product && product.track !== "Hayır" && product.category !== "Hizmet";

export const cents = value => Math.round(Number(value || 0) * 100);

export function linkedTotal(items, key, id, excluded) {
  return items.filter(item => item[key] === id && item.id !== excluded).reduce((total,item) => total + cents(item.amount),0);
}

export function balance(state, type, row, excluded) {
  return type === "sales"
    ? cents(row.amount) - cents(row.paid) - linkedTotal(state.collections,"sale",row.id,excluded)
    : cents(row.amount) - linkedTotal(state.payments,"purchase",row.id,excluded);
}

export function saleLines(row) {
  if (row?.items) {
    try { const lines = JSON.parse(row.items); return Array.isArray(lines) ? lines : []; } catch { return []; }
  }
  if (!row?.amount) return [];
  const quantity = Number(row.quantity) || 1;
  const unitPrice = Math.round(cents(row.amount)/quantity)/100;
  return [{product:row.product || "",name:row.detail || "",quantity:String(quantity),price:String(unitPrice),
    legacyAmount:row.amount,vat:"0",taxMode:"KDV Hariç",discount:"0",stock:row.product ? "Evet" : "Hayır"}];
}

function lineAmounts(line) {
  const raw = line.legacyAmount ? cents(line.legacyAmount) : cents(line.price)*Number(line.quantity);
  const rate = Number(line.vat || 0)/100;
  const base = line.taxMode === "KDV Dahil" ? Math.round(raw/(1+rate)) : raw;
  // Keep the prior rounding rule for existing sales when their pricing inputs are unchanged.
  const exactInclusive = line.taxMode==="KDV Dahil" && line.discountAmount!==undefined && line.legacyTaxRounding!=="Evet";
  const gross = exactInclusive ? raw : base + Math.round(base*rate);
  if (line.discountAmount !== undefined) {
    const applied = Math.min(gross,Math.max(0,cents(line.discountAmount)));
    const net = applied ? Math.round((gross-applied)/(1+rate)) : base;
    return {base,rate,gross,after:gross-applied,net};
  }
  const net = base-Math.round(base*Number(line.discount || 0)/100);
  return {base,rate,gross,after:net+Math.round(net*rate),net};
}

export function lineDiscountCents(line) {
  const amounts=lineAmounts(line);
  return amounts.gross-amounts.after;
}

export function saleTotals(lines, discount, discountType) {
  const amounts = lines.map(lineAmounts);
  const subtotal = amounts.reduce((total,line) => total+line.base,0);
  const gross = amounts.reduce((total,line) => total+line.gross,0);
  const afterLines = amounts.reduce((total,line) => total+line.net,0);
  const beforeDiscount = amounts.reduce((total,line) => total+line.after,0);
  const fromGross = discountType === "GenelToplamTL";
  const extra = fromGross
    ? Math.min(beforeDiscount,Math.max(0,cents(discount)))
    : Math.min(afterLines,discountType === "Yüzde" ? Math.round(afterLines*Number(discount || 0)/100) : cents(discount));
  let remaining = extra;
  let remainingBase = fromGross ? beforeDiscount : afterLines;
  let net=0,vat=0;
  for (const line of amounts) {
    const weight=fromGross ? line.after : line.net;
    const share=remainingBase ? Math.round(remaining*weight/remainingBase) : 0;
    remaining-=share;
    remainingBase-=weight;
    if (fromGross) {
      const final=line.after-share;
      const netLine=share ? Math.round(final/(1+line.rate)) : line.net;
      net+=netLine;
      vat+=final-netLine;
    } else {
      net+=line.net-share;
      vat+=Math.round((line.net-share)*line.rate);
    }
  }
  const total=net+vat;
  return {subtotal,gross,discount:gross-total,overallDiscount:beforeDiscount-total,beforeDiscount,net,vat,total};
}

function prepareSale(state,row,prior) {
  if (row.patient) {
    const patient = state.patients.find(item => item.id === row.patient && item.branch === row.branch);
    if (!patient || (row.client && patient.owner !== row.client)) throw Error("Hasta, seçilen müşteriye bağlı olmalı.");
    row.client = patient.owner || "";
  }
  if (row.items === undefined) return; // Earlier single-item records remain editable.
  const lines = saleLines(row);
  if (!lines.length || lines.length > 30) throw Error("1 ile 30 arasında ürün veya hizmet kalemi ekleyin.");
  const oldLines = saleLines(prior);
  for (const line of lines) {
    if (!line || typeof line !== "object" || typeof line.name !== "string") throw Error("Satış kalemi geçersiz.");
    const quantity = Number(line.quantity);
    const price = cents(line.price);
    if (!line.name.trim() || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 ||
        !String(line.price ?? "").trim() || !Number.isSafeInteger(price) || price < 0 || price > 100000000 || !Number.isFinite(Number(line.vat || 0)) ||
        !Number.isFinite(Number(line.discount || 0)) || [line.vat,line.discount].some(value => Number(value) < 0 || Number(value) > 100)) {
      throw Error("Kalem adı, adet, fiyat, indirim veya KDV bilgisini kontrol edin.");
    }
    const product = state.products.find(item => item.id === line.product && item.branch === row.branch);
    if (line.product && !product) throw Error("Satış ürünü bu şubede bulunamadı.");
    const previous = oldLines.find(item => item.product === line.product);
    line.stock = product && (previous ? previous.stock === "Evet" : tracksStock(product)) ? "Evet" : "Hayır";
    if (line.legacyAmount && !oldLines.some(item => item.legacyAmount === line.legacyAmount && item.quantity === line.quantity && item.price === line.price)) delete line.legacyAmount;
    if (line.discountAmount !== undefined && (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(line.discountAmount) || cents(line.discountAmount)>lineAmounts(line).gross)) {
      throw Error("Kalem indirimi, kalemin KDV dahil tutarını aşamaz.");
    }
  }
  if (!Number.isFinite(Number(row.discount || 0)) || Number(row.discount) < 0 || (row.discountType === "Yüzde" && Number(row.discount) > 100)) throw Error("Toplam indirim geçersiz.");
  row.items = JSON.stringify(lines);
  const totals = saleTotals(lines,row.discount,row.discountType);
  if (row.discountType==="GenelToplamTL" && (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(row.discount) || cents(row.discount)>totals.beforeDiscount)) {
    throw Error("Genel indirim, indirim öncesi toplamı aşamaz.");
  }
  row.amount = (totals.total/100).toFixed(2);
  row.detail ||= lines.map(line => line.name).join(", ").slice(0,180);
  row.product = "";
  row.quantity = "";
}

function stockLines(state,type,row) {
  if (!row) return [];
  if (type === "sales") return saleLines(row).filter(line => line.stock === "Evet");
  if (type === "prescriptions" && row.stockMode !== "Evet") return [];
  if (!row.product) return [];
  const product = state.products.find(item => item.id === row.product && item.branch === row.branch);
  if (type === "prescriptions" && !product) throw Error("Reçeteye bağlı ürün bulunamadı.");
  return [{product:row.product,quantity:row.quantity}];
}

export function weightChange(previous,current) {
  const base=Math.round(Number(previous)*1000), measured=Math.round(Number(current)*1000);
  if (base<3000 || measured<=0 || !Number.isFinite(base) || !Number.isFinite(measured)) return null;
  const difference=measured-base;
  return Math.abs(difference)*10>=base ? difference/base*100 : null;
}

export function patientWeights(state,patient,excludedFollowup) {
  const manual=(state.weights || []).filter(item=>item.patient===patient.id && item.branch===patient.branch);
  const exams=state.exams.filter(item=>item.patient===patient.id && item.branch===patient.branch && item.status!=="İptal" && Number(item.weight)>0);
  const fallback=manual.length || exams.length || !patient.registered ? [] : [{date:patient.registered,weight:patient.weight}];
  const followups=(state.followups||[]).filter(item=>item.id!==excludedFollowup && item.patient===patient.id && item.branch===patient.branch && item.status==="Tamamlandı")
    .reverse().map(item=>({date:item.done,weight:item.weight}));
  return [...fallback,...manual.slice().reverse(),...exams.slice().reverse(),...followups].filter(item=>item.date && Number(item.weight)>0)
    .map(item=>({date:item.date,weight:Number(item.weight)})).sort((a,b)=>a.date.localeCompare(b.date));
}

export const protocolNumber = (type,id) => (type === "clients" ? "HS-" : "HT-") + id;

export function propose(state, type, row, prior, todayDate) {
  const next = {...empty(),...structuredClone(state)};
  const duplicate = (table, key, value, allBranches = false) => value && next[table].some(item =>
    item.id !== row.id && (allBranches || item.branch === row.branch) && norm(item[key]) === norm(value));
  if (["clients","patients"].includes(type)) {
    row.protocol = prior?.protocol || protocolNumber(type,row.id);
    if (row.birth && row.birth > todayDate) throw Error("Doğum tarihi ileri bir tarih olamaz.");
    if (duplicate(type,"protocol",row.protocol)) throw Error("Bu protokol numarası şubede zaten kullanılıyor.");
  }
  if (type === "patients") {
    if (row.chipDate && !row.chip) throw Error("Çip takılma tarihi için mikroçip numarasını da girin.");
    if (row.chipDate && row.chipDate > todayDate) throw Error("Çip takılma tarihi ileri bir tarih olamaz.");
    if (row.chipDate && row.birth && row.chipDate < row.birth) throw Error("Çip takılma tarihi doğumdan önce olamaz.");
    if (duplicate("patients","passport",row.passport,true)) throw Error("Bu pasaport numarası başka bir hastada kayıtlı.");
    if (row.weight && (!Number.isFinite(Number(row.weight)) || Number(row.weight)<=0)) throw Error("Kilo pozitif olmalı.");
    if (row.weight && Number(row.weight)!==Number(prior?.weight)) {
      if (prior?.weight && prior.registered && !patientWeights(next,prior).some(item=>item.date!==prior.registered || item.weight!==Number(prior.weight)) &&
          !next.weights.some(item=>item.patient===row.id)) {
        next.weights.unshift({id:crypto.randomUUID(),patient:row.id,branch:row.branch,date:prior.registered,weight:prior.weight});
      }
      next.weights.unshift({id:crypto.randomUUID(),patient:row.id,branch:row.branch,date:todayDate,weight:row.weight});
    }
    if (duplicate("patients","chip",row.chip,true)) throw Error("Bu mikroçip numarası başka bir hastada kayıtlı.");
  }
  if (type === "vaccineCatalog") {
    if (next.vaccineCatalog.some(item=>item.id!==row.id && item.branch===row.branch && norm(item.name)===norm(row.name) && norm(item.species||"Tümü")===norm(row.species||"Tümü"))) throw Error("Bu tür için aynı aşı adı zaten kayıtlı.");
    for (const key of ["offsetDays","renewEvery"]) {
      const days=Number(row[key] || 0);
      if (!Number.isInteger(days) || days<0 || days>(key==="renewEvery"?365:3650)) throw Error("Gün ve yenileme aralığını kontrol edin.");
    }
    if (Number(row.renewEvery)>0 && !["Gün","Hafta","Ay","Yıl"].includes(row.renewUnit)) throw Error("Yenileme birimini seçin.");
  }
  if (type === "products" && (duplicate("products","sku",row.sku) || duplicate("products","barcode",row.barcode))) throw Error("Bu stok veya barkod kodu şubede zaten kullanılıyor.");
  if (type === "appointments") {
    if (prior?.controlExamId && !["date","time","patient","clinician"].every(key=>(row[key]||"")===(prior[key]||""))) {
      throw Error("Kontrol randevusunun tarihini, saatini veya hekimini bağlı muayeneden değiştirin.");
    }
    const patient = next.patients.find(item => item.id === row.patient && item.branch === row.branch);
    if (row.patient && (!patient || (row.client && patient.owner !== row.client))) throw Error("Hasta, seçilen müşteriye bağlı olmalı.");
    if (patient?.owner) row.client = patient.owner;
    if (row.endTime && row.endTime <= row.time) throw Error("Bitiş saati, başlangıçtan sonra olmalı.");
    const until = item => item.endTime ? clockMinutes(item.endTime) : clockMinutes(item.time)+Number(next.preferences.slot || 30);
    if (!["Tamamlandı","İptal"].includes(row.status) && next.appointments.some(item =>
      item.id !== row.id && item.branch === row.branch && item.date === row.date && !["Tamamlandı","İptal"].includes(item.status) &&
      ((row.patient && item.patient === row.patient) || (row.clinician && norm(row.clinician) === norm(item.clinician))) &&
      clockMinutes(row.time) < until(item) && clockMinutes(item.time) < until(row))) {
      throw Error("Bu saatte hasta veya personel için çakışan bir randevu var.");
    }
  }
  if (type === "sales") {
    prepareSale(next,row,prior);
    if (!Number.isSafeInteger(cents(row.paid)) || cents(row.paid)<0) throw Error("Tahsilat tutarı geçersiz.");
  }
  if (type === "followups") {
    if (row.status === "Tamamlandı") {
      row.done ||= todayDate;
      const catalog=next.vaccineCatalog.find(item=>item.id===row.vaccine && item.branch===row.branch && item.status!=="Pasif");
      const manual=row.nextAuto==="Elle" || (row.nextAuto!=="Evet" && Boolean(row.next));
      if (!manual) {
        const custom=Object.hasOwn(row,"renewEvery");
        row.next=custom?renewalDate(row.done,Number(row.renewEvery),row.renewUnit):
          catalog?renewalDate(row.done,Number(catalog.renewEvery),catalog.renewUnit):"";
        row.nextAuto=row.next ? "Evet" : "";
      } else row.nextAuto="Elle";

      if (row.done > todayDate) throw Error("Uygulama tarihi ileri bir tarih olamaz.");
      if (row.next && row.next <= row.done) throw Error("Sonraki uygulama tarihi, uygulama tarihinden sonra olmalı.");
    }
    for (const key of ["previousWeight","weight"]) {
      if (row[key] && (!Number.isFinite(Number(row[key])) || Number(row[key])<=0)) throw Error("Kilo sıfırdan büyük olmalı.");
    }
    const linked = next.followups.find(item => item.previousId === row.id);
    if (row.status === "Tamamlandı" && row.next) {
      const plan = {branch:row.branch,patient:row.patient,date:row.next,kind:row.kind,title:row.title,vaccine:row.vaccine || "",status:"Planlandı",previousId:row.id,...(Object.hasOwn(row,"renewEvery")?{renewEvery:row.renewEvery,renewUnit:row.renewUnit}:{})};
      const duplicatePlan=next.followups.some(item=>item.id!==row.id && item.id!==linked?.id && item.branch===row.branch &&
        item.patient===row.patient && item.date===row.next && item.kind===row.kind && norm(item.title)===norm(row.title) && item.status!=="İptal");
      if (duplicatePlan && linked?.status==="Planlandı") next.followups=next.followups.filter(item=>item.id!==linked.id);
      else if (!duplicatePlan && !linked) next.followups.unshift({...plan,id:crypto.randomUUID()});
      else if (!duplicatePlan && linked.status === "Planlandı") Object.assign(linked,plan);
    } else if (linked?.status === "Planlandı") {
      next.followups = next.followups.filter(item => item.id !== linked.id);
    }
  }
  if (type === "exams" && row.next && row.next < row.date) throw Error("Kontrol tarihi muayeneden önce olamaz.");
  if (type === "messages" && row.patient && !next.patients.some(p => p.id === row.patient && p.owner === row.client)) {
    throw Error("Bu hasta seçilen sahibe bağlı değil.");
  }
  if (type === "stays" && row.status !== "İptal") {
    if (row.end && row.end <= row.start) throw Error("Çıkış, giriş tarihinden sonra olmalı.");
    if (row.status === "Taburcu" && !row.end) throw Error("Taburcu kaydı için çıkış tarihi ve saati gerekli.");
    const conflict = next.stays.some(item => item.id !== row.id && item.branch === row.branch && item.status !== "İptal" &&
      (norm(item.room) === norm(row.room) || item.patient === row.patient) &&
      (!row.end || item.start < row.end) && (!item.end || row.start < item.end));
    if (conflict) throw Error("Bu hasta veya oda için çakışan bir konaklama var.");
  }
  if (["sales","purchases"].includes(type) && balance(next,type,row) < 0) {
    throw Error("Kayıt tutarı mevcut ödemelerin toplamından düşük olamaz.");
  }
  if (prior && ["sales","purchases"].includes(type)) {
    const isSale = type === "sales";
    const party = isSale ? "client" : "supplier";
    const movements = isSale ? next.collections.filter(item => item.sale === row.id) : next.payments.filter(item => item.purchase === row.id);
    if (movements.length && prior[party] !== row[party]) throw Error("Ödeme hareketi bulunan kaydın tarafı değiştirilemez.");
    if (movements.some(item => item.date < row.date)) throw Error("Kayıt tarihi, bağlı ödeme tarihini geçemez.");
  }
  if (["collections","payments"].includes(type)) {
    const target = type === "collections" ? "sales" : "purchases";
    const key = type === "collections" ? "sale" : "purchase";
    const parent = next[target].find(item => item.id === row[key] && item.branch === row.branch);
    if (!parent) throw Error("İşleme bağlı kayıt bu şubede bulunamadı.");
    const amount = cents(row.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance(next,target,parent,row.id)) {
      throw Error("Girilen tutar pozitif olmalı ve açık bakiyeyi aşmamalı.");
    }
    if (row.date < parent.date) throw Error("İşlem tarihi, bağlı kaydın tarihinden önce olamaz.");
  }
  if (type === "purchases" && !tracksStock(next.products.find(item => item.id===row.product && item.branch===row.branch)) &&
      prior?.product!==row.product) throw Error("Alış için stok takibi açık bir ürün seçin.");
  if (type==="products") {
    if (!Number.isSafeInteger(Number(row.stock)) || Number(row.stock)<0) throw Error("Stok miktarı geçersiz.");
    if (prior && Number(row.stock)!==Number(prior.stock)) throw Error("Stok sayısını ürün kartındaki stok işlemlerinden güncelleyin.");
    if (prior && productLots(next,prior).length && !tracksStock(row)) throw Error("Stok partisi olan ürünün takibi kapatılamaz.");
  }
  if (type==="prescriptions" && row.stockMode==="Evet" &&
      !tracksStock(next.products.find(product=>product.id===row.product && product.branch===row.branch)) &&
      !(prior?.stockMode==="Evet" && prior.product===row.product)) throw Error("Stoktan düşmek için takibi açık bir ürün seçin.");
  if (type==="purchases") applyInventoryPurchase(next,row,prior,todayDate);
  if (["sales","prescriptions"].includes(type)) allocateInventory(next,type,row,prior,stockLines(next,type,prior),stockLines(next,type,row),todayDate);
  if (type === "exams") {
    if (row.weight && row.status!=="İptal") {
      const patient=next.patients.find(p=>p.id===row.patient && p.branch===row.branch);
      if (!patient || !Number.isFinite(Number(row.weight)) || Number(row.weight)<=0) throw Error("Hasta veya kilo ölçümü geçersiz.");
      if (!next.weights.some(item=>item.patient===row.patient) && patient.registered && Number(patient.weight)>0 &&
          !next.exams.some(item=>item.patient===row.patient && Number(item.weight)>0)) {
        next.weights.unshift({id:crypto.randomUUID(),patient:row.patient,branch:row.branch,date:patient.registered,weight:patient.weight});
      }
      const latestWeighing = next.exams.some(exam => exam.patient === row.patient && exam.id !== row.id && exam.weight && exam.date > row.date);
      if (!latestWeighing && !next.weights.some(item=>item.patient===row.patient && item.date>row.date)) patient.weight = row.weight;
    }
    for (const key of ["previousWeight","weight"]) {
      if (row[key] && (!Number.isFinite(Number(row[key])) || Number(row[key])<=0)) throw Error("Kilo sıfırdan büyük olmalı.");
    }
    const timingChanged = (prior?.next || "") !== (row.next || "") || (prior?.nextTime || "") !== (row.nextTime || "") ||
      ((prior?.status === "İptal") !== (row.status === "İptal") && Boolean(row.nextTime || prior?.nextTime)) || (row.nextTime && prior?.clinician !== row.clinician);
    if (timingChanged) {
      const cancelled = row.status === "İptal";
      if (!cancelled && Boolean(row.next) !== Boolean(row.nextTime)) throw Error("Kontrol tarihi ve saatini birlikte girin.");
      const linked = next.followups.find(item => item.examId === row.id);
      if (["Planlandı","İptal"].includes(linked?.status)) {
        if (!cancelled && row.next) Object.assign(linked,{date:row.next,status:"Planlandı"});
        else linked.status = "İptal";
      }
      const appointment = next.appointments.find(item => item.controlExamId === row.id && item.branch === row.branch &&
        !["Tamamlandı","Gelmedi"].includes(item.status));
      if (!cancelled && row.next && row.nextTime) {
        if (row.next < row.date) throw Error("Kontrol tarihi muayene tarihinden önce olamaz.");
        const patient = next.patients.find(item => item.id === row.patient && item.branch === row.branch);
        const updated = {
          ...appointment,id:appointment?.id || crypto.randomUUID(),controlExamId:row.id,branch:row.branch,
          patient:row.patient,client:patient?.owner || "",date:row.next,time:row.nextTime,endTime:"",
          service:"Muayene sonrası kontrol",clinician:row.clinician || "",
          status:appointment?.status === "Onaylandı" ? "Onaylandı" : "Planlandı",
        };
        next.appointments = propose(next,"appointments",updated,null,todayDate).appointments;
      } else if (appointment) {
        appointment.status = "İptal";
      }
    }
    if (row.appointmentId) {
      const appointment = next.appointments.find(item => item.id === row.appointmentId);
      if (appointment) appointment.status = row.status === "İptal" ? "Onaylandı" : row.status || "Tamamlandı";
    }
  }
  if (["clients","patients"].includes(type)) row.registered ||= todayDate;
  const list = next[type];
  const index = list.findIndex(item => item.id === row.id);
  if (index < 0) list.unshift(row);
  else list[index] = row;
  if (type === "exams" && row.billItems) {
    const previousSale = next.sales.find(item => item.examId === row.id);
    const patient = next.patients.find(item => item.id === row.patient);
    return propose(next,"sales",{
      ...previousSale,id:previousSale?.id || crypto.randomUUID(),examId:row.id,branch:row.branch,patient:row.patient,client:patient?.owner || "",
      date:row.date,detail:row.title,items:row.billItems,discount:row.billDiscount || "0",discountType:row.billDiscountType || "Tutar",
      clinician:row.clinician || "",paid:previousSale?.paid || "0",method:previousSale?.method || "Kart",
    },previousSale,todayDate);
  }
  return next;
}
