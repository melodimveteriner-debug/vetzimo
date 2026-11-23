import {waveChart} from "./wave-chart.js";
import {marketArrangeHome,marketEditableHTML,marketExtraSections,marketShared} from "./saas-site-content.js";
const base="/platform";
const escape=value=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
export const unlimitedTerm="unlimited";
export const termValue=value=>value===unlimitedTerm?"SINIRSIZ":value??"Görüşmede";
export const saasNotice="basvuru-v1";
export const saasStages={new:"Yeni",contacted:"Görüşüldü",qualified:"Değerlendiriliyor",won:"Olumlu sonuçlandı",lost:"Olumsuz sonuçlandı"};
export const saasTerms=[
  ["users","Kullanıcı",100000],["branches","Şube",100000],["patients","Hasta kaydı",10000000],
  ["storage","Depolama (GB)",100000],["sms","SMS kredisi",10000000],["whatsapp","WhatsApp mesajı",10000000],
  ["okc","ÖKC hakkı",100000],["edoc","E-dönüşüm hakkı",100000],
  ["support","Destek kapsamı"],["trial","Deneme süresi (gün)",365],["discount","Yıllık indirim (%)",100],
];
export const saasKinds={demo:"Demo",trial:"Demo",contact:"İletişim"};

const features=[
  ["hasta-yonetimi","Hasta yönetimi","Klinik","Hayvanın kimliğini, aşılarını, kilosunu ve klinik geçmişini hasta kaydından izleyin."],
  ["hasta-sahibi-yonetimi","Hasta sahibi yönetimi","Klinik","İletişim bilgilerini ve aynı hasta sahibine bağlı hayvanları bir arada tutun."],
  ["randevu","Entegre randevu sistemi","Klinik","Web sitenizden gelen randevu talepleri VetZimo ekranınıza düşsün. Uygun saatleri ve gelen talepleri tek takvimde yönetin."],
  ["web-site-tasarlayici","Web Site Tasarlayıcı","Web sitesi","Dört temadan birini seçip kliniğinizin sitesini yayınlayın. Hizmetlerinizi tanıtın ve ziyaretçileri doğrudan randevuya yönlendirin."],
  ["evden-takip","Evden Takip","Klinik","Hasta sahipleri beslenme, ilaç ve günlük gözlemlerini portaldan kaydetsin. Ekibiniz hasta kaydına bağlı bildirimleri değerlendirsin."],
  ["asi","Aşı takvimi","Klinik","Uygulanan, yaklaşan ve geciken aşıları takip edin."],
  ["muayene-tedavi","Muayene ve tedavi","Klinik","Muayene ve tedavi kayıtlarını hastanın klinik geçmişiyle ilişkilendirin."],
  ["ameliyat","Ameliyat yönetimi","Klinik","Operasyon ve anestezi çizelgeleri, onam ve postoperatif takibin birleşeceği modül.","Planlanıyor"],
  ["hospitalizasyon","Hospitalizasyon","Klinik","Yatış ve takip kayıtlarını klinik çalışma alanından yönetin."],
  ["laboratuvar","Laboratuvar","Klinik","Laboratuvar dosyalarını ve girilen sonuçları hasta dosyasına bağlayın. Cihaz bağlantısı ayrı değerlendirilir."],
  ["radyoloji","Radyoloji ve PACS","Klinik","Görüntü arşivi ve DICOM erişimi için cihaz ve sağlayıcı bağlantısı gereklidir.","Entegrasyon bekliyor"],
  ["recete","Reçete yönetimi","Klinik","Klinik reçete kayıtlarını ilgili hasta üzerinden takip edin."],
  ["stok","İlaç ve stok takibi","İşletme","Ürün, lot, son kullanma tarihi ve stok hareketlerini izleyin."],
  ["satis","Satış ve tahsilat","İşletme","Ürün ve hizmet satışlarını, tahsilatları ve hasta sahibi hesabıyla bağlantısını takip edin."],
  ["muhasebe","Muhasebe","İşletme","Klinik gelir ve gider kayıtlarını bir araya getirin."],
  ["raporlama","Raporlama","İşletme","Mevcut klinik kayıtlarından özetleri ve satış göstergelerini inceleyin."],
  ["personel","Personel yönetimi","İşletme","Ekip üyelerini ve kurum içi erişim kapsamlarını tanımlayın."],
  ["cok-subeli","Çok şubeli yönetim","İşletme","Bayi ve şube bağlamlarını ayrı yetkilerle yönetin."],
  ["hasta-sahibi-portali","Hasta sahibi portalı","Klinik","Hasta sahipleri, hesabıyla ilişkilendirilmiş hayvanları ve aşı durumlarını görebilir."],
  ["okc","Yazar kasa POS","Entegrasyon","Ödeme akışı simülatörde doğrulanıyor. Fiziksel cihaz bağlantısı için üretici onayı ve cihaz testi gerekiyor.","Entegrasyon bekliyor"],
  ["sms","Netgsm SMS","Entegrasyon","Şablon ve alıcı seçimiyle SMS gönderimi hazırlayın. Canlı gönderim yetkili Netgsm bağlantısı gerektirir.","Entegrasyon bekliyor"],
  ["whatsapp","WhatsApp Business","Entegrasyon","Klinik adına onaylı şablonlarla mesajlaşmak için işletme hesabı ve yetkili bağlantı gereklidir.","Entegrasyon bekliyor"],
  ["e-donusum","E-dönüşüm","Entegrasyon","e-Fatura ve e-Arşiv akışları için yetkili entegratör bağlantısı gereklidir.","Entegrasyon bekliyor"],
  ["hizmetler","Hizmet kataloğu","İşletme","Muayene ve görüntüleme gibi stok dışı hizmetleri ayrı katalogda düzenleyip satışa ekleyin."],
];
const solutions=[
  ["muayenehane","Veteriner muayenehaneleri","Günlük randevuları, hasta sahiplerini ve aşı kayıtlarını tek çalışma alanında toplayın."],
  ["klinik","Veteriner klinikleri","Muayene, aşı, satış ve stok akışlarını ekibinizle ortak bir panelde takip edin."],
  ["poliklinik","Veteriner poliklinikleri","Hekim, personel ve şube erişimlerini operasyonunuzun yapısına göre planlayın."],
  ["hastane","Hayvan hastaneleri","Hasta geçmişi, yatış kayıtları ve laboratuvar ihtiyaçlarını birlikte değerlendirin."],
  ["cok-subeli","Çok şubeli işletmeler","Şube bağlamına göre erişimi ve operasyonel kayıtların paylaşımını yönetin."],
  ["pet-otel","Pet otel ve pansiyon","Konaklama iş akışı ve günlük takip için ihtiyaç değerlendirmesi isteyin.","Planlanıyor"],
  ["buyuk-hayvan","Çiftlik ve büyük hayvan takibi","Sürü, saha ve çiftlik yönetimi gereksinimlerinizi iletin.","Planlanıyor"],
];
const faqs=[
  ["Mevcut kayıtlarımı aktarabilir miyim?","Demo başvurusunda kullandığınız yazılımı belirtin. Alan eşlemesi ve örnek aktarım doğrulandıktan sonra kapsam belirlenir."],
  ["Şubelerimin kayıtlarını ayrı tutabilir miyim?","Ekip erişimleri bayi ve şube yetkilerine göre değerlendirilir. Mevcut paylaşım seçenekleri demoda incelenebilir."],
  ["Yazar kasa POS cihazım çalışır mı?","Cihazın marka, model ve bağlantı türünü iletin. Canlı kullanım üretici onayı, aktivasyon ve cihaz testine bağlıdır."],
  ["Başvuru aboneliği veya ödeme işlemini başlatır mı?","Başvurunuz satış ekibinin inceleme kuyruğuna kaydedilir. Abonelik ve ödeme bu aşamada ayrı değerlendirilir."],
  ["Hasta sahipleri uygulamaya nasıl girer?","Yetkilendirilmiş hasta sahipleri telefon numarasıyla giriş yaparak kendi kayıtlarını görüntüler."],
];
const posts=[
  ["klinik-gecisi","Klinik yazılımı geçişinde ilk üç kontrol","Geçişten önce hasta ve sahip kayıtlarının nasıl eşleştiğini kontrol edin. Sonra şube erişimini örnek personel hesaplarıyla deneyin. Canlı geçiş tarihini, örnek veri aktarımı ve geri dönüş provası tamamlandığında belirleyin."],
  ["asi-takibi","Aşı takibinde uygulama ve planlama ayrımı","Uygulama tarihini ve bir sonraki planlanan tarihi ayrı tutun. Böylece hasta sahibine geçmiş uygulamayı gösterebilir, yaklaşan ve geciken aşıları takvimde ayrı inceleyebilirsiniz."],
];
const link=(path,label,cls="")=>`<a href="${base}${path}" class="${cls}">${label}</a>`;
const intro=(tag,title,body)=>`<header class="intro"><span class="eyebrow">${tag}</span><h1>${title}</h1><p>${body}</p></header>`;
const faq=()=>faqs.map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join("");
const cards=(items,prefix)=>`<div class="cards">${items.map(([id,name,...rest])=>`<a class="card" href="${base}${prefix}/${id}" ${prefix==="/ozellikler"?'data-feature-open':""}><span class="eyebrow">${prefix==="/ozellikler"?rest[0]:(prefix==="/blog"?"Rehber":rest[1]||"Çözüm")}</span><h3>${name}</h3><p>${rest[prefix==="/ozellikler"?1:0]}</p><span class="arrow" aria-hidden="true">↗</span></a>`).join("")}</div>`;

const featureExamples={
  "hasta-yonetimi":["Hasta dosyası", "Pamuk · Kedi", "Aşılar · Kilo · Muayeneler", "Bir hasta seçerek kimlik bilgileri, aşı geçmişi ve klinik kayıtları aynı dosyada inceleyin."],
  "hasta-sahibi-yonetimi":["Müşteri kartı", "Örnek hasta sahibi", "Bağlı hastalar · İletişim · Tahsilatlar", "İletişim bilgileri ve bağlı hayvanları müşteri kartından bulun. Yetkili kullanıcılar bakiye ve tahsilat geçmişini inceleyebilir."],
  "randevu":["Web sitesinden klinik takvimine", "10.30 · Kontrol muayenesi", "Uygun saat seçimi · Randevu talebi · Klinik takvimi", "Ziyaretçi veya kayıtlı hasta sahibi web sitenizden şube ve uygun saat seçer. Talep VetZimo’e düşer. Kayıtlı hasta sahipleri, yaklaşan web randevularını kendi panellerinden değiştirebilir veya iptal edebilir."],
  "web-site-tasarlayici":["Klinik web sitenizi yayınlayın", "Klinik adı · Tema seçimi", "Ana sayfa · Blog · İletişim", "Logo ve ana sayfa fotoğrafını ekleyin, çalışma saatlerini ve haritanızı gösterin. Dilerseniz DNS ve HTTPS kurulumu sonrası kendi alan adınızı bağlayın. Web Site Tasarlayıcı, özelliğin açık olduğu paketlerde kullanılır."],
  "evden-takip":["Muayene sonrasında takip", "Örnek hasta · Ev gözlemi", "Beslenme · İlaç · Aranma isteği", "Hasta sahibi portaldan günlük gözlemini kaydeder veya aranma isteği bırakır. Klinik ekibi gelen kayıtları şubesinde görür, ilgili hasta üzerinden inceler."],
  "asi":["Aşı sihirbazı", "Mia · Kuduz", "Planlanan tarih · Uygulama tarihi · Yenileme", "Hasta ve aşıyı seçin. Uygulama tarihini kaydedin ve bir sonraki takibi planlayın."],
  "muayene-tedavi":["Muayene kaydı", "Luna · Kontrol muayenesi", "Bulgular · Tedavi · Takip", "Muayeneyi hastaya bağlayın. Bulguları ve tedavi planını kaydedin. Gerekirse muayeneye satış kalemi ekleyin."],
  "ameliyat":["Operasyon planı", "Luna · Kısırlaştırma", "Hazırlık · İşlem · Takip", "Ameliyat ve anestezi gereksinimlerinizi demo görüşmesinde değerlendirebilirsiniz."],
  "hospitalizasyon":["Yatış ve konaklama", "Örnek yatış kaydı", "Giriş · İzlem · Taburcu", "Yatışı hasta kaydına bağlayın ve tamamlandığında taburcu durumunu kaydedin."],
  "laboratuvar":["Tetkik kaydı", "Hemogram · Örnek dosya", "Değerler · Referans aralığı · Ek", "Tetkik sonucunu hastayla ilişkilendirin, sonuç dosyasını ekleyin ve referans aralıklarını kaydedin."],
  "radyoloji":["Görüntü arşivi gereksinimi", "Örnek DICOM iş akışı", "Cihaz · Depolama · Erişim", "Görüntüleme cihazınızı ve arşiv ihtiyaçlarınızı görüşmede belirtin."],
  "recete":["Klinik içi reçete", "Örnek hasta · Reçete", "İlaç · Kullanım notu · Stok tercihi", "Reçeteyi hasta dosyasına kaydedin. Takipli ürünlerde stok düşümü tercih edilebilir."],
  "stok":["Ürün kartı", "Mama · Örnek stok", "Lot · SKT · Kritik stok", "Stoklu ürünleri, lotları ve tarihleri izleyin. Hizmet kalemleri ayrı katalogdan yönetilir."],
  "satis":["Satış kaydı", "Muayene · Röntgen", "Kalemler · KDV · Tahsilat", "Bir ürün veya hizmeti katalogdan seçin. Vergi, indirim, ödeme ve bakiye satış kaydında birlikte izlenir."],
  "muhasebe":["Kasa görünümü", "Örnek tahsilat", "Gelir · Gider · Tarih filtresi", "Kasa hareketlerini dönem ve ödeme yöntemine göre filtreleyin. Bağlı satışlara tahsilat ekleyin."],
  "raporlama":["Rapor görünümü", "Bu ayki hareketler", "Satış · Tahsilat · Gelir ve gider", "Tarih aralığını seçin ve eğilimleri grafiklerden inceleyin."],
  "personel":["Klinik hesapları", "Örnek ekip hesabı", "Rol · Şube · Modül izinleri", "Ekip hesabını oluşturun. Görüntüleme ve düzenleme haklarını modüle göre belirleyin."],
  "cok-subeli":["Şube düzeni", "Merkez · İkinci şube", "Ortak kayıt · Bağımsız kayıt", "Şube oluştururken kasa, stok, hasta ve müşteri kayıtlarının paylaşım düzenini seçin."],
  "hasta-sahibi-portali":["Hasta sahibi ekranı", "Mia · Aşı kaydı", "Hayvanlarım · Aşı geçmişi · Klinik bağlantısı", "Hasta sahibi kendi hesabıyla giriş yaparak yetki verilen hasta bilgilerini görür."],
  "okc":["Ödeme ekranı", "Örnek satış · POS", "Cihaz seçimi · Tahsilat · Sonuç", "Satış kalemlerinden cihaz ödemesine geçin. Fiziksel cihaz için üreticiye uygun bağlantı ve doğrulama gerekir."],
  "sms":["SMS işlemleri", "Aşı hatırlatma taslağı", "Alıcı · Şablon · Teslimat", "Şablonu ve alıcıları seçin. Gönderim için yetkili Netgsm bağlantısı ve kredi gerekir."],
  "whatsapp":["WhatsApp gönderimi", "Örnek hatırlatma şablonu", "Alıcı · Onaylı şablon · Gönderim", "Yetkili işletme hesabı ve onaylı şablonlarla hatırlatma akışı hazırlayın."],
  "e-donusum":["Belge iş akışı", "Örnek e-Arşiv senaryosu", "Alıcı · Belge · Entegratör", "E-dönüşüm için kullandığınız yetkili entegratörü ve belge gereksinimlerini belirtin."],
  "hizmetler":["Hizmet kataloğu", "Muayene · Ultrason", "Birim fiyat · KDV · Satış", "Diğer menüsünde yeni hizmet oluşturun. Satışta hizmeti adıyla arayarak kaleme ekleyin."],
};

function featureDetail(id) {
  const [screen,sample,steps,details]=featureExamples[id];
  return `<section class="feature-detail" data-edit-area="Özellik örneği">
    <div><span class="eyebrow">KULLANIM SENARYOSU</span><h2>${screen}</h2><p>${details}</p></div>
    <figure class="feature-illustration"><figcaption>Örnek görünüm</figcaption><div class="feature-screen">
      <span aria-hidden="true">◉ ◉ ◉</span><strong>${sample}</strong><div>${steps.split(" · ").map(step=>`<span>${step}</span>`).join("")}</div>
      <svg viewBox="0 0 240 40" role="img" aria-label="Örnek uygulama kartı"><path d="M0 8h148M0 20h204M0 32h181" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="5"/></svg>
    </div></figure>
  </section>`;
}

function saasShowcase() {
  const today=new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",day:"2-digit",month:"short",year:"numeric"}).format(new Date());
  const chart=waveChart([["Pzt",11,8],["Sal",19,13],["Çar",16,14],["Per",26,19],["Cum",34,24],["Cmt",31,28]],
    [["Randevu","blue"],["Aşı","teal"]],value=>String(value),escape,{compact:true,label:"Örnek haftalık randevu ve aşı grafiği"});
  return `<div class="showcase" data-edit-area="Örnek çalışma alanı">
    <div class="show-top"><span class="show-dots" aria-hidden="true">● ● ●</span><span>VetZimo çalışma alanı</span><span class="demo-badge">Örnek ekran</span></div>
    <div class="show-body"><div class="show-rail" aria-hidden="true"><b>V</b><span>◫</span><span>⊞</span><span>✚</span><span>▤</span></div>
    <div class="show-work"><small>KLİNİK GENEL BAKIŞ</small><strong>Günün Özeti</strong>
      <div class="show-metrics"><div><small>Kayıtlı Hasta</small><b>3659</b></div><div><small>Kayıtlı Müşteri</small><b>2987</b></div><div><small>Aylık Kazanç</small><b>567.900 ₺</b></div></div>
      <div class="show-chart"><small>Haftalık randevu görünümü</small>${chart}</div>
      <div class="show-row"><small>Aşılama</small><div class="show-tags"><b>Mia</b><b>Kuduz</b><time>${today}</time><b class="show-status">YAPILDI</b></div></div>
      <div class="show-row"><small>Kontrol muayenesi</small><div class="show-tags"><b>LUNA</b><b>Kısırlaştırma</b><time>${today}</time><b class="show-status pending">Beklemede</b></div></div>
    </div></div>
  </div>`;
}
function home() {
  return `<section class="hero" data-edit-area="Karşılama"><div class="hero-copy"><span class="eyebrow"><span class="dot"></span> VETERİNER KLİNİK YÖNETİM PLATFORMU</span>
    <h1>Kliniğinizin tüm işi <em>tek çalışma alanında.</em></h1>
    <p>Kliniğinizin sitesini yayınlayın, web randevularını takvime alın ve muayene sonrasında hasta sahipleriyle iletişimi sürdürün.</p>
    <div class="actions">${link("/demo","Demo talep edin","button primary")}${link("/ozellikler","Özellikleri keşfedin","button outline")}</div>
    <div class="hero-notes"><span>✓ Klinik web sitesi</span><span>✓ Entegre randevu</span><span>✓ Evden Takip</span></div>
    </div>${saasShowcase()}</section>
    <section class="band" data-edit-area="Klinik, işletme ve iletişim"><div><span>01</span><strong>Klinik</strong><small>Hasta, randevu ve aşı</small></div><div><span>02</span><strong>İşletme</strong><small>Satış, stok ve şubeler</small></div><div><span>03</span><strong>İletişim</strong><small>Portal ve hatırlatmalar</small></div></section>
    <section class="block" data-edit-area="Öne çıkan modüller"><div class="section-title"><div><span class="eyebrow">MODÜLLER</span><h2>İlk randevudan muayene sonrasına</h2></div>${link("/ozellikler","Tüm özellikler ↗")}</div>
    ${cards(["web-site-tasarlayici","randevu","evden-takip","hasta-yonetimi","hasta-sahibi-portali","satis"].map(id=>features.find(row=>row[0]===id)),"/ozellikler")}</section>
    <section class="callout" data-edit-area="Paket çağrısı"><div><span class="eyebrow">PAKETLER VE DENEME</span><h2>Kliniğinize uygun kapsamı birlikte belirleyelim.</h2></div><div class="actions">${link("/paketler","Paketleri karşılaştırın","button outline")}${link("/deneme","Ücretsiz Demo","button primary")}</div></section>
    <section class="block split" data-edit-area="Sık sorulanlar"><div><span class="eyebrow">SIK SORULANLAR</span><h2>İlk görüşmeden önce</h2></div><div>${faq()}</div></section>
    <section class="block" data-edit-area="Klinik rehberi"><div class="section-title"><div><span class="eyebrow">REHBER</span><h2>Klinik işletimi üzerine</h2></div>${link("/blog","Tüm yazılar ↗")}</div>${cards(posts,"/blog")}</section>`;
}
const price=value=>value===null?"Teklif isteyin":new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
function packages(plans) {
  return intro("PAKETLER VE FİYATLAR","Kliniğiniz için doğru kapsam","Aylık ve yıllık seçenekleri karşılaştırın. Fiyatı belirlenmemiş paketler için teklif isteyebilirsiniz.")+
  `<div class="toggle" role="group" aria-label="Faturalama dönemi"><button type="button" data-period="monthly" aria-pressed="true">Aylık</button><button type="button" data-period="yearly" aria-pressed="false">Yıllık</button></div>
  <!-- vetnet-package-catalog -->${plans.length?`<div class="cards plans">${plans.map(plan=>`<article class="card"><span class="eyebrow">VetZimo</span><h2>${escape(plan.name)}</h2><p>${escape(plan.description)}</p>
  <div data-price="monthly"><strong>${price(plan.monthly)}</strong><small>${plan.monthly===null?"Görüşme sonrası fiyat":plan.vat==="included"?"Aylık · KDV dahil":"Aylık · KDV hariç"}</small></div>
  <div data-price="yearly" hidden><strong>${price(plan.yearly)}</strong><small>${plan.yearly===null?"Görüşme sonrası fiyat":plan.vat==="included"?"Yıllık · KDV dahil":"Yıllık · KDV hariç"}</small></div>
  <a class="button outline" data-plan-link href="${base}/deneme?plan=${encodeURIComponent(plan.id)}&amp;donem=monthly">Bilgi isteyin ↗</a></article>`).join("")}</div>
  <h2>Paket karşılaştırması</h2><div class="table-scroll" tabindex="0" role="region" aria-label="Paket karşılaştırması"><table><thead><tr><th scope="col">Kapsam</th>${plans.map(p=>`<th scope="col">${escape(p.name)}</th>`).join("")}</tr></thead><tbody>
  ${saasTerms.map(([key,label])=>`<tr><th scope="row">${label}</th>${plans.map(p=>`<td>${escape(termValue(p.terms[key]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`:"<p>Şu anda yayında paket yok.</p>"}<!-- /vetnet-package-catalog -->`;
}
function application(kind,url,preview) {
  const [title,copy]={
    demo:["VetZimo’i birlikte inceleyelim","Kliniğinizin günlük akışını paylaşın. Görüşmede ihtiyaçlarınıza göre uygun modülleri ele alalım."],
    trial:["Ücretsiz Demo","İşletmenizi ve beklentinizi yazın. Başvurunuz yönetim ekibinin inceleme kuyruğuna alınır."],
    contact:["VetZimo ile iletişim","Paket, veri geçişi veya entegrasyon konusunda ekibimize ulaşın."],
  }[kind];
  const plan=url.searchParams.get("plan")||"";
  return `<div class="split form-layout"><div>${intro("VetZimo · İLETİŞİM",title,copy)}${preview?"<p class=\"demo-note\">Test ortamında örnek iletişim bilgileri kullanın.</p>":""}</div>
  <form class="card application" method="post" action="/api/saas/applications" data-application>
    <input type="hidden" name="kind" value="${kind}"><input type="hidden" name="notice" value="${saasNotice}">
    <input type="hidden" name="plan" value="${escape(plan)}"><input type="hidden" name="billing" value="${url.searchParams.get("donem")==="yearly"?"yearly":"monthly"}">
    <div class="form-grid"><label>Ad soyad<input name="name" maxlength="120" autocomplete="name" required></label>
    <label>Klinik veya işletme<input name="clinic" maxlength="160" autocomplete="organization" required></label>
    <label>E-posta adresi (zorunlu)<input name="email" type="email" maxlength="254" autocomplete="email" required></label>
    <label>Telefon${kind==="contact"?" (isteğe bağlı)":""}<input name="phone" type="tel" maxlength="24" autocomplete="tel" placeholder="+90" ${kind!=="contact"?"required":""}></label></div>
    ${kind!=="contact"?'<label>Aktif kullandığınız hasta takip programı var mı?<input name="currentProgram" maxlength="160" placeholder="Program adı veya Yok"></label>':""}
    <label>${kind==="contact"?"Mesajınız":"Klinik ihtiyaçlarınız"}<textarea name="message" rows="4" maxlength="2000" placeholder="Örneğin iki şubede aşı ve stok takibi"></textarea></label>
    <div hidden><label>Web sitesi<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="consent"><input type="checkbox" name="read" id="notice-read" required><label for="notice-read">Başvuru bilgilendirmesini okudum.</label> <a href="/platform/gizlilik" data-notice-open>Başvuru bilgilendirmesi</a></div>
    <button class="button primary" type="submit">Başvuruyu gönder ↗</button><p class="feedback" role="status" aria-live="polite"></p>
  </form></div>`;
}
const nav=`${link("","Ana sayfa")}${link("/ozellikler","Özellikler")}${link("/cozumler","Çözümler")}${link("/entegrasyonlar","Entegrasyonlar")}${link("/paketler","Paketler ve fiyatlar")}`;
const noticeIntro="Başvuruya yazdığınız iletişim ve işletme bilgileri, talebin kaydedilmesi ve değerlendirilmesi için yetkili yönetim ekibine iletilir.";
const noticeBody=`<p>${noticeIntro}</p>
  <h3>Başvurunun değerlendirilmesi</h3><p>Ad, klinik adı, e-posta, telefon, seçilen paket, mevcut hasta takip programı ve iletiniz başvuru kaydında yer alır. Yönetim ekibi bu bilgilerle sizinle iletişime geçebilir ve başvurunun durumunu güncelleyebilir.</p>
  <h3>Demo hesabı</h3><p>Olumlu değerlendirilen demo isteğinde yetkili yönetici, telefon numaranızı kontrol ederek klinik erişimini açabilir. Ödeme bildirimi ayrıca incelenir.</p>
  <h3>Başvuru hakkında iletişim</h3><p>Formu doldururken hasta kayıtları, kimlik numaraları veya ödeme bilgileri paylaşmayın. Başvurunuzla ilgili talepler için iletişim formunu kullanabilirsiniz.</p>`;
function noticeDialog() {
  return `<dialog class="notice-dialog" id="application-notice" aria-labelledby="notice-title">
    <header><div><span class="eyebrow">VETZIMO · ${saasNotice}</span><h2 id="notice-title">Başvuru bilgilendirmesi</h2></div>
      <button type="button" class="button outline" data-notice-close aria-label="Bilgilendirmeyi kapat">Kapat</button></header>
    <div class="notice-scroll" tabindex="0">${noticeBody}</div>
    <div class="notice-footer"><label><input type="checkbox" data-notice-read disabled> Metnin sonuna ulaştım.</label>
      <span data-notice-status aria-live="polite">Onay için metnin sonuna ilerleyin.</span></div>
    <button type="button" class="button primary" data-notice-confirm disabled>Başvuruya dön</button>
  </dialog>`;
}

function marketHeader() {
  return `<a class="skip" href="#icerik">İçeriğe geç</a><header class="site-header"><div class="header-inner"><a class="brand" href="${base}"><img class="vetzimo-wordmark" src="/vetzimo-logo.webp" alt="VetZimo" width="156" height="44"><small>v2.2</small></a>
  <button class="nav-toggle" type="button" aria-controls="main-nav" aria-expanded="false">Menü</button><nav id="main-nav" aria-label="Ana menü">${nav}</nav>
  <div class="head-actions"><select class="theme" aria-label="Site teması"></select>${link("/deneme","Ücretsiz Demo","button primary head-trial")}</div></div></header>`;
}
function marketFooter() {
  return `<footer><div class="wrap footer-inner"><div><a class="brand" href="${base}"><img class="vetzimo-wordmark" src="/vetzimo-logo.webp" alt="VetZimo" width="156" height="44"></a><p>Veteriner klinik yönetim platformu</p></div>
  <nav aria-label="Alt menü">${link("/hakkimizda","Hakkımızda")}${link("/blog","Blog")}${link("/sss","Sık sorulanlar")}${link("/iletisim","İletişim")}${link("/demo","Demo talebi")}<a href="/platform/gizlilik" data-notice-open>Başvuru bilgilendirmesi</a></nav></div></footer>`;
}
function layout({title,body,preview,site,collect}) {
  const shared=site.shared||{}, page=site.page||{}, local=page.seo||{}, global=shared.seo||{};
  const pageTitle=local.title||(title==="Veteriner klinik yönetim platformu"&&global.title?global.title:title+" · "+(global.title||"VetZimo"));
  const desc=local.description||global.description||title+" · VetZimo veteriner klinik yönetim platformu.";
  const keywords=local.keywords||global.keywords||"";
  const appearance=site.appearance||{}, sections=site.sections||[];
  const content=marketEditableHTML(body,page.copy,collect?.page);
  const arranged=title==="Veteriner klinik yönetim platformu"?marketArrangeHome(content,page.layout,sections):content;
  return `<!doctype html><html lang="tr" data-site-palette="${escape(appearance.palette)}" data-theme-lock="false" data-theme="${escape(appearance.palette||"classic")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(pageTitle)}</title><meta name="description" content="${escape(desc)}">
  ${keywords?'<meta name="keywords" content="'+escape(keywords)+'">':""}
  ${preview?'<meta name="robots" content="noindex,nofollow">':""}<link rel="icon" href="/favicon.ico?v=51" type="image/x-icon"><link rel="stylesheet" href="/saas.css"><link rel="stylesheet" href="/wave-chart.css"><link rel="stylesheet" href="/themes.css"><script src="/saas.js" type="module"></script></head>
  <body>${marketEditableHTML(marketHeader(shared.branding),shared.copy,collect?.shared,"Üst menü ve marka")}
  <main id="icerik" class="wrap">${marketExtraSections(sections,"before")}${arranged}${marketExtraSections(sections,"after")}</main>
  ${marketEditableHTML(marketFooter(shared.branding),shared.copy,collect?.shared,"Alt alan")}${marketEditableHTML(noticeDialog(),site.notice?.copy,collect?.notice,"Başvuru penceresi")}
  <dialog class="notice-dialog feature-dialog" id="feature-dialog" aria-labelledby="feature-dialog-title">
    <header><h2 id="feature-dialog-title">Özellik ayrıntısı</h2><button type="button" class="button outline" data-feature-close>Kapat</button></header>
    <div class="feature-dialog-body" aria-live="polite"></div>
  </dialog></body></html>`;
}

export const marketPages=[
  [marketShared,"Site geneli · Üst menü ve alt alan"],["/","Ana sayfa"],
  ["/ozellikler","Özellikler"],...features.map(([id,name])=>["/ozellikler/"+id,name]),
  ["/cozumler","Çözümler"],...solutions.map(([id,name])=>["/cozumler/"+id,name]),
  ["/blog","Klinik rehberi"],...posts.map(([id,name])=>["/blog/"+id,name]),
  ["/paketler","Paketler ve fiyatlar"],["/entegrasyonlar","Entegrasyonlar"],["/sss","Sık sorulan sorular"],
  ["/hakkimizda","Hakkımızda"],["/gizlilik","Başvuru bilgilendirmesi"],["/demo","Demo talebi"],["/deneme","Ücretsiz Demo"],["/iletisim","İletişim"],
];
export function marketFields(path) {
  const fields={shared:new Map(),page:new Map(),notice:new Map()};
  const url=new URL(base+(path===marketShared||path==="/"?"":path),"https://example.invalid");
  const samplePlan={id:"baslangic",name:"",description:"",monthly:null,yearly:100,vat:"included",terms:{}};
  saasRender(url,path==="/paketler"?[samplePlan]:[],false,{},fields);
  const selected=path===marketShared?fields.shared:fields.page;
  if (path==="/gizlilik") for (const [key,value] of fields.notice) selected.set(key,value);
  return [...selected.values()];
}

export function saasRender(url,plans,preview,site={},collect) {
  const path=url.pathname.slice(base.length).replace(/\/$/,"");
  const [,group,id,...extra]=path.split("/");
  let title="Veteriner klinik yönetim platformu", body, status=200;
  const topics={ozellikler:[features,"Özellikler"],cozumler:[solutions,"Çözümler"],blog:[posts,"Klinik rehberi"]};
  if (!path) body=home();
  else if (!extra.length&&Object.hasOwn(topics,group)) {
    const [items,label]=topics[group];
    const selected=id?items.find(row=>row[0]===id):null;
    if (selected) {
      title=selected[1];
      const feature=group==="ozellikler";
      body=intro(feature?selected[2]:label,title,selected[feature?3:2])+(feature?featureDetail(id):"")+`<section class="callout"><div><span class="eyebrow">${feature?selected[2]:selected[3]||"VetZimo"}</span><h2>${group==="blog"?"Kliniğinizdeki akışı değerlendirelim":"Kendi kliniğiniz için inceleyin"}</h2></div>${link("/demo","Demo talep edin","button primary")}</section>`;
    } else if (!id) {
      title=label;
      body=intro("VetZimo",label,group==="blog"?"Hasta takibi ve klinik yazılımı hakkında kısa rehberler.":"Günlük çalışma düzeninize uygun VetZimo modüllerini keşfedin.")+cards(items,"/"+group);
    }
  } else if (path==="/paketler") {title="Paketler ve fiyatlar";body=packages(plans);}
  else if (path==="/entegrasyonlar") {title="Entegrasyonlar";body=intro("BAĞLANTILAR",title,"Her bağlantı için sağlayıcı erişimi, test ve devreye alma ayrı izlenir.")+cards(features.filter(row=>row[2]==="Entegrasyon"),"/ozellikler");}
  else if (path==="/sss") {title="Sık sorulan sorular";body=intro("DESTEK",title,"Başvuru, veri geçişi ve bağlantılar hakkında.")+`<section class="faq">${faq()}</section>`;}
  else if (path==="/hakkimizda") {title="Hakkımızda";body=intro("VetZimo",title,"Veteriner kliniklerinin hasta geçmişini, ekip erişimini ve işletme akışını tek merkezden yönetmesi için geliştiriyoruz.")+`<section class="callout"><h2>Kliniğinizin çalışma düzenini konuşalım.</h2>${link("/demo","Demo talep edin","button primary")}</section>`;}
  else if (path==="/gizlilik") {title="Başvuru bilgilendirmesi";body=intro("BAŞVURU · "+saasNotice,title,"")+`<section class="faq">${noticeBody}</section>`;}
  else if (["/demo","/deneme","/iletisim"].includes(path)) {
    const kind={"/demo":"demo","/deneme":"trial","/iletisim":"contact"}[path];
    title=saasKinds[kind]+" başvurusu";body=application(kind,url,preview);
  }
  if (!body) {status=404;title="Sayfa bulunamadı";body=intro("404",title,"Aradığınız içerik taşınmış olabilir.")+link("","Ana sayfaya dön","button primary");}
  return {status,html:layout({title,body,preview,site:status===404?{shared:site.shared,appearance:site.appearance}:site,collect})};
}
