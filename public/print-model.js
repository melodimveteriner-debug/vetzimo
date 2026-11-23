export const printCategories={owner:"Hasta sahibi",patient:"Hasta",sale:"Satış",exam:"Muayene",stay:"Konaklama",purchase:"Alış"};
export const printPermissions={owner:"clients",patient:"patients",sale:"sales",exam:"patients",stay:"patients",purchase:"products"};
export const printFields={
  klinik:"Klinik adı",sube:"Şube",klinik_telefon:"Klinik telefonu",klinik_adres:"Klinik adresi",
  musteri:"Hasta sahibi adı",musteri_telefon:"Hasta sahibi telefonu",musteri_eposta:"Hasta sahibi e-postası",musteri_adres:"Hasta sahibi adresi",
  hasta:"Hasta adı",tur:"Tür",irk:"Irk",cinsiyet:"Cinsiyet",dogum:"Doğum tarihi",kilo:"Kilo",protokol:"Hasta protokolü",cip:"Mikroçip",
  islem:"İşlem",tarih:"Belge tarihi",not:"Ek açıklama",hekim:"Hekim",
  asi:"Aşı adı",asi_tarihi:"Planlanan aşı tarihi",uygulama_tarihi:"Aşı uygulama tarihi",sonraki_asi:"Sonraki aşı",lot:"Lot / seri",asi_durum:"Aşı durumu",
  muayene_tarihi:"Muayene tarihi",sikayet:"Şikâyet / anamnez",bulgular:"Bulgular",tani:"Değerlendirme",plan:"İzlem planı",kontrol:"Kontrol tarihi",
  satis_tarihi:"Satış tarihi",belge_no:"Belge numarası",kalemler:"Satış kalemleri",toplam:"Toplam tutar",tahsilat:"Tahsilat",odeme:"Ödeme yöntemi",
  yatis:"Yatış tarihi",cikis:"Çıkış tarihi",oda:"Oda / kafes",tedarikci:"Tedarikçi",urun:"Ürün",adet:"Miktar",
};

const feeTable="\n\n| İşlem / malzeme | Adet | Birim fiyat | Tutar |\n| ______ | ___ | ______ | ______ |\n| ______ | ___ | ______ | ______ |\n\n";
const signatures="\n\nHasta sahibi imzası ____________________    Hekim / görevli imzası ____________________";
const vaccine="**{{asi}}** · {{asi_durum}}\nPlanlanan {{asi_tarihi}} · Uygulanan {{uygulama_tarihi}}\nLot {{lot}} · Sonraki aşı {{sonraki_asi}}\nVeteriner hekim {{hekim}}";
const exam="## Klinik değerlendirme\nMuayene tarihi {{muayene_tarihi}} · Hekim {{hekim}}\nŞikâyet ve anamnez · {{sikayet}}\nBulgular · {{bulgular}}\nDeğerlendirme · {{tani}}\nİzlem ve tedavi planı · {{plan}}\nKontrol tarihi · {{kontrol}}";
const sale="Belge no {{belge_no}} · Satış tarihi {{satis_tarihi}}\n\n## Satış kalemleri\n{{kalemler}}\n\n**Toplam {{toplam}}** · Tahsilat {{tahsilat}} · Yöntem {{odeme}}\nMüşteriye iletilecek not · {{not}}";
export const builtInPrintTemplates=[
  ["vaccine","Aşı Kartı / 1 · Uygulama","patient","## Aşı uygulama kaydı\n"+vaccine+"\n\nEk açıklama · {{not}}"],
  ["vaccine-schedule","Aşı Kartı / 2 · Planlama","patient","## Aşı randevusu\n"+vaccine+"\n\nRandevu saati ____________________\nKlinik iletişim {{klinik_telefon}}"],
  ["vaccine-followup","Aşı Kartı / 3 · Takip","patient","## Aşı takip bilgisi\n"+vaccine+"\n\n## İzlem notları\n{{not}}"],
  ["vaccine-exam","Aşılama ve Muayene Formu","patient",exam+"\n\n## Aşı bilgisi\n"+vaccine+"\n\n{{not}}"],
  ["epicrisis","Epikriz Raporu · Hasta","patient",exam+"\n\n## Klinik seyir ve taburculuk özeti\n{{not}}"],
  ["deceased","Hasta Kapanış Raporu","patient","## Kayıt kapanış bilgileri\nİşlem ve tarih · {{islem}} / {{tarih}}\nHekim · {{hekim}}\nKlinik seyir ve kayıt açıklaması · {{not}}\n\nDüzenleyen ____________________"],
  ["exam","Hasta Muayene Formu","exam",exam+"\n\n## Ek kayıtlar\n{{not}}"],
  ["exam-epicrisis","Epikriz Raporu · Muayene","exam",exam+"\n\n## Sonuç ve izlem\n{{not}}"],
  ["exam-card","Muayene Kartı","exam",exam],
  ["euthanasia","Ötenazi Görüşme ve Onam Taslağı","patient","## Hekim görüşmesi\nKlinik değerlendirme ve gerekçe · {{tani}}\nGörüşülen seçenekler ve sorular · {{not}}\nHasta sahibi kararı ____________________"+signatures],
  ["fee","İşlem ve Ücret Bilgilendirme","owner","## Planlanan hizmet\nİşlem · {{islem}}\nİşlem ve tahmini ücret bilgisi · {{not}}"+feeTable+"Ödeme koşulları ____________________\nHasta sahibine aktarılan bilgiler ____________________"+signatures],
  ["treatment","Tedavi İzni ve Ücret Bilgilendirme Taslağı","exam","## Tedavi görüşmesi\nİşlem · {{islem}}\nHekim · {{hekim}}\nİzlem planı · {{plan}}\nÜcret kalemleri ve görüşülen seçenekler · {{not}}"+feeTable+"Hasta sahibi kararı ____________________"+signatures],
  ["anesthesia","Anestezi Onam Taslağı","owner","## Anestezi görüşmesi\nPlanlanan işlem · {{islem}}\nVeteriner hekim · {{hekim}}\nDeğerlendirme, açıklanan riskler ve sorular · {{not}}\nHasta sahibi kararı ____________________"+signatures],
  ["acceptance","Hasta Kabul ve Bilgilendirme","owner","## Başvuru bilgisi\nBaşvuru nedeni · {{islem}}\nİletişim bilgisi · {{musteri_telefon}}\nGörüşülen seçenekler ve notlar · {{not}}"+signatures],
  ["privacy","Kişisel Veriler Bilgilendirme ve Rıza Taslağı","owner","## Kliniğin dolduracağı alanlar\nVeri sorumlusu · {{klinik}}\nİletişim · {{klinik_telefon}} / {{klinik_adres}}\nBilgilendirme metni ve varsa ayrı onay seçenekleri · {{not}}\nBeyan ve tarih ____________________"+signatures],
  ["sales","Satış Bilgi Kartı","sale",sale],
  ["sales-patient","Satış Kartı · Hasta Bilgili","sale","Hasta {{hasta}} · Protokol {{protokol}}\n\n"+sale],
  ["stay","Yatış ve Konaklama Formu","stay","## Konaklama bilgileri\nYatış {{yatis}} · Çıkış {{cikis}}\nOda / kafes {{oda}} · Sorumlu {{hekim}}\nTeslim alınan eşyalar ve özel ihtiyaçlar · {{not}}"+signatures],
  ["purchase","Alış ve Teslim Alma Formu","purchase","## Teslimat kaydı\nTedarikçi {{tedarikci}} · Belge {{belge_no}}\nÜrün {{urun}} · Miktar {{adet}}\nLot {{lot}} · Toplam {{toplam}}\nTeslim notu · {{not}}\nTeslim alan ____________________"],
].map(([id,title,category,body])=>({id:"system-"+id,title,category,body,active:1,system:true}));

export function fillPrintTemplate(body,fields) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(_,key)=>Object.hasOwn(printFields,key)?(fields[key]||"—"):"—");
}
