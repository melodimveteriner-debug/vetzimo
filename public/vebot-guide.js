import {norm,cents} from "./model.js";

const guide=[
  {terms:"randevu takvim saat ertele iptal",title:"Randevu planlama",page:"appointments",steps:["Randevular → Randevu Takvimi’ni aç.","Gün ve saat seç. Hasta ve muayene bilgisini gir.","Randevuyu kaydet. Durumu aynı kayıttan güncelleyebilirsin."]},
  {terms:"aşı kuduz karma parazit aşılama sihirbaz yenile",title:"Aşı uygulaması ve takip",page:"vaccine-wizard",steps:["Aşı Takvimi → Aşı Sihirbazı’nı aç ve hastayı seç.","Aşı ile planlanan tarihi gir. Uygulama yapıldıysa gerçek uygulama tarihini kaydet.","Gerekiyorsa yenileme aralığını seç ve oluşan takibi kontrol et."]},
  {terms:"hizmet muayene röntgen ultrason fiyat kdv katalog",title:"Hizmeti kataloğa ve satışa ekleme",page:"services",steps:["Diğer → Hizmetler → Yeni hizmet’i aç.","Ad, birim fiyat, KDV oranı ve fiyatın KDV durumunu kaydet.","Yeni satışta hizmeti adıyla ara veya katalogdan seç. Hizmet kalemi stok düşürmez."]},
  {terms:"satış kasa ödeme tahsilat muhasebe indirim bakiye",title:"Satış ve tahsilat",page:"sales",steps:["Satışlar → Yeni satış’tan ürün veya hizmetleri ekle.","KDV ve indirimi kontrol et. Alınan ödemeyi tahsilat alanına yaz.","Sonradan alınan ödeme için satış satırındaki Tahsilat işlemini kullan. Kasa raporunda tarih ve ödeme türüne göre filtreleyebilirsin."]},
  {terms:"şablon çıktı yazdır pdf epikriz form",title:"Çıktı şablonu",page:"/sablonlar",steps:["Diğer → Çıktı Şablonları’nı aç.","Şablon, müşteri ve hastayı seç.","Önizlemeyi kontrol et ve Yazdır / PDF olarak kaydet seçeneğini kullan."]},
  {terms:"hasta sahip müşteri çip kaydı protokol",title:"Hasta dosyası",page:"patients",steps:["Hastalar → Yeni Hasta Ekle’yi aç.","Kayıtlı sahibi seç veya yeni bir müşteri oluştur.","Hasta kimliği ve varsa mikroçip bilgisini girip kaydet."]},
  {terms:"stok ürün lot skt tedarikçi depo",title:"Stok ve lot izleme",page:"products",steps:["Ürünler’den stok takibi açık bir ürün kartı oluştur.","Alış veya stok girişinde miktarı, lotu ve son kullanma tarihini gir.","Kritik stok ve yaklaşan SKT filtreleriyle kayıtları izle."]},
  {terms:"sms whatsapp kredi gönderim mesaj",title:"Mesaj kredileri ve gönderim",page:"/kredi-magazasi",steps:["Muhasebe → SMS / WhatsApp kredi mağazası’ndan bakiyeyi veya siparişi kontrol et.","Yetkili gönderim bağlantısını kontrol et.","İzinli alıcı ve uygun şablon seçerek mesajı hazırla."]},
  {terms:"rapor grafik dışa aktar excel",title:"Raporlar",page:"reports",steps:["Raporlar’da ilgilendiğin modülü seç.","Tarih aralığı ve mevcut filtreleri ayarla.","Grafikleri ve tablodaki rakamları incele, gerekirse Excel çıktısı al."]},
  {terms:"tema görünüm karanlık renk kişisel",title:"Kişisel tema",page:"settings",steps:["Diğer → Genel Ayarlar’ı aç.","Kişisel tema bölümünde bir tema seç ve kaydet.","Merkez varsayılanına dönmek için Ana tema seçeneğini kaydet."]},
  {terms:"yetki kullanıcı personel şube davet bayi",title:"Klinik erişim izinleri",page:"/merkezi-hesaplar",steps:["Diğer → Şube · Kullanıcı · Hasta sahibi yetkileri’ni aç.","Kurum, rol ve varsa şubeyi seç.","Görüntüleme ve düzenleme izinlerini verip kaydet."]},
  {terms:"destek bildirim talep hata",title:"Destek talebi",page:"bayi-destek",steps:["Diğer → Destek Talepleri’ni aç ve yeni talep oluştur.","Ekran adı ve tekrar edilebilen adımları yaz.","Yanıtlar için Bildirim e-postası bölümünden adresini doğrula."]},
];
const stop=new Set(["nasıl","nerede","hangi","yapılır","istiyorum","icin","için","lütfen","hakkında","yaparım","yapabilirim"]);
const words=text=>[...new Set(norm(text).split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>=3&&!stop.has(word)))];
const countFormat=new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"});
const amount=number=>countFormat.format(number/100);

function discountEstimate(question) {
  const text=norm(question);
  const match=text.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)\s*(?:tl|₺)\s*(?:tutar(?:a|ından)?\s*)?%\s*(\d+(?:[.,]\d{1,2})?)\s*indirim/u);
  if (!match) return "";
  const price=cents(match[1].replace(",",".")), rate=Number(match[2].replace(",","."));
  if (!Number.isSafeInteger(price)||price>100_000_000_000||rate<0||rate>100) return "";
  const discount=Math.round(price*rate/100);
  return "İndirim "+amount(discount)+"\nİndirim sonrası toplam "+amount(price-discount);
}

export function guideAnswer(question,fileText,mayOpen=()=>true) {
  const query=words(question);
  if (!fileText) {
    const estimate=discountEstimate(question);
    if (estimate) return {text:estimate};
  }
  const ranked=guide.map(entry=>{
    const terms=words(entry.terms);
    const score=query.reduce((sum,word)=>sum+(terms.includes(word)?3:word.length>=4&&terms.some(term=>term.startsWith(word)||word.startsWith(term))?1:0),0);
    return {...entry,score};
  }).filter(entry=>entry.score>=3).sort((a,b)=>b.score-a.score);
  const found=ranked.filter(entry=>entry.score>=ranked[0].score*.55).slice(0,2);
  const report=fileText?fileText.split(/\r?\n/).map(line=>line.trim()).filter(Boolean):[];
  if (report.length) {
    const relevant=report.map((line,i)=>({line,i,score:query.filter(word=>norm(line).includes(word)).length})).sort((a,b)=>b.score-a.score||a.i-b.i);
    return {text:"Dosyada "+report.length+" dolu satır var. "+(relevant[0].score?"Soruyla en çok eşleşen satırlar":"İlk satırlardan kısa önizleme")+"\n\n"+
      relevant.slice(0,6).map(row=>"• Satır "+(row.i+1)+" · "+row.line.slice(0,240)).join("\n")+
      (found[0]?"\n\nİlgili VeTNeT işlemi: "+found[0].title:""),links:found.filter(item=>mayOpen(item.page))};
  }
  if (!found.length) return null;
  return {text:found.map(item=>item.title+"\n"+item.steps.map((step,i)=>(i+1)+". "+step).join("\n")).join("\n\n"),
    links:found.filter(item=>mayOpen(item.page))};
}
