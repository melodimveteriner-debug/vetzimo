import {waveChart} from './wave-chart.js';
import {sitePalettes,darkPalette,loadAppearance} from './theme.js';
import {paginate} from './paged.js';
let opsFeatureFields={};
export async function opsFetch(path,body,scope){
 const headers=scope?{'X-VeTNet-Scope':scope}:{};
 const response=await fetch(path,body?{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)}:{headers});
 const data=await response.json();if(!response.ok)throw Error(data.error||'İşlem tamamlanamadı.');return data;
}
export async function mountCenterSuite(ui,session){
 const {uiText,uiLabel,mountLanguageSelect,view,el,heading,field,makeForm,status,logoutButton}=ui;
 const tabs=[
  ['genel','Genel Bakış',overview],['analiz','Gelişmiş Panel',analytics],['bayiler','Bayiler ve Yetkiler',list],
  ['muhasebe','Muhasebe',()=>finance('all')],['satislar','Satışlardan Alınan Ödemeler',()=>finance('sales')],
  ['tahsilatlar','Ek Tahsilatlar',()=>finance('collections')],['raporlar','Mali Raporlar',()=>finance('summary')],
  ['basvurular','Demo İstek-Değerlendirme',crm],['paketler','Yazılım Paketleri',plans],
  ['abonelikler','Bayi Abonelikleri',subscriptions],['destek','Destek Talepleri',support],
  ['uygulamalar','Uygulama Yönetimi',nativeApps],['tema','Ayarlar ve Tema',theme],['bildirimler','Bildirim Merkezi',notifications],['guvenlik','Güvenlik',security],['kayitlar','İşlem Günlüğü',audit],
  ['odemeler','Ödeme Onayları',()=>manage('payments')],['odeme-kanallari','Ödeme Kanalları',paymentChannels],['magaza-banka','Mağaza Havale Ayarları',()=>manage('shop_bank')],['site','Satış Sitesi Stüdyosu',marketEditor],['yasal','Yasal Metinler',legalDocs],
  ['duyurular','Duyurular',()=>manage('announcements')],['reklam','Reklam Yönetimi',()=>manage('ads')],
  ['degisiklikler','Son Değişiklikler',()=>manage('releases')],
  ['yedekleme','Yedekleme',()=>backup(false)],['aktarim','Klinik Verisi İçe Aktar',()=>backup(true)],
  ['okc','Entegrasyonlar · ÖKC',()=>manage('okc')],['evde-hizmet','Evde Hizmet Paketleri',visitPackages]
 ];
 const localizedTabs={genel:'overview',muhasebe:'accounting',raporlar:'reports',paketler:'pricing',basvurular:'demo',tema:'settings'};
 for (const item of tabs) item[1]=localizedTabs[item[0]] ? uiText(localizedTabs[item[0]],item[1]) : uiLabel(item[1]);
 const params=new URLSearchParams(location.search);
 const tab=tabs.find(([key])=>key===params.get('tab'))||tabs[0];
 const url=(key,extra={})=>'/yonetim?'+new URLSearchParams({tab:key,...extra});
 const call=(action,body)=>opsFetch('/api/cpanel-center/'+action,body,session.scopeId);
 const applyAppearance=appearance=>{
  const palette=appearance.palette||'prizma';
  document.body.dataset.centerPalette=palette;
  document.body.classList.toggle('center-dark',darkPalette(palette));
 };
 document.body.classList.add('center-suite');
 try{document.body.classList.toggle('center-compact',localStorage.getItem('vetnet-cpanel-compact')==='1');}catch{}
 applyAppearance(await loadAppearance());
 heading('Merkez Yönetimi');
 view.firstChild.className='visually-hidden';
 const shell=el('div','',{className:'center-shell'});
 const sidebar=el('aside','',{className:'center-sidebar'});
 const nav=el('nav','',{id:'center-navigation'});
 nav.setAttribute('aria-label','Yönetim menüsü');
 const menu=el('button','☰ Menü',{type:'button',className:'center-menu-toggle'});
 menu.setAttribute('aria-controls',nav.id);
 const mobile=matchMedia('(max-width:850px)');
 const setMenu=open=>{nav.hidden=!open;menu.setAttribute('aria-expanded',String(open));};
 setMenu(!mobile.matches);
 menu.addEventListener('click',()=>setMenu(nav.hidden));
 mobile.addEventListener('change',()=>setMenu(!mobile.matches));
 nav.append(el('p','VetZimo Yönetim',{className:'center-kicker'}),el('small','Merkez paneli · R20'));
 const groups=[
  ['Çalışma alanı',['genel','analiz','bayiler','paketler','abonelikler','basvurular']],
  ['Finans',['muhasebe','satislar','tahsilatlar','raporlar','odemeler']],
  ['Satış sitesi ve yayınlar',['site','yasal','duyurular','reklam','degisiklikler','evde-hizmet']],
  ['Uygulamalar ve destek',['uygulamalar','destek','bildirimler']],
  ['Ayarlar',[]]
 ];
 const assigned=groups.flatMap(([,keys])=>keys);
 for(const [label,keys] of groups){
  const entries=keys.length?keys:tabs.map(([key])=>key).filter(key=>!assigned.includes(key));
  const group=el('details','',{className:'center-nav-group',open:entries.includes(tab[0])});
  group.append(el('summary',label));
  for(const key of entries){
   const match=tabs.find(entry=>entry[0]===key);
   if(!match)continue;
   const item=el('a',match[1],{href:url(key),className:'center-nav-item'});
   if(key===tab[0]) {item.classList.add('active');item.setAttribute('aria-current','page');}
   group.append(item);
  }
  if(label==='Satış sitesi ve yayınlar') group.append(
    el('a','Web Sitesi Yönetimi',{href:'/yonetim/web-siteleri',className:'center-nav-item'}));
  nav.append(group);
 }
 sidebar.append(menu,nav);
 const main=el('div','',{className:'center-main'}),top=el('header','',{className:'center-top'});
 const account=el('div','',{className:'center-toolbar'});
 const reauthUrl=url('guvenlik',{returnTab:tab[0]});
 account.append(el('span',session.identifier||session.name||'Merkez yöneticisi'));
 if(session.reauthRequired) account.append(el('a','İşlemler için doğrula',{href:reauthUrl}));
 account.append(logoutButton());
 mountLanguageSelect(account);
 top.append(el('h2',tab[1],{className:'center-title'}),account);
 const content=el('section','',{className:'center-card'});
 const button=(text,fn)=>{
  const b=el('button',text,{type:'button',className:'secondary'});
  b.addEventListener('click',async()=>{
   b.disabled=true;status.textContent='';delete status.dataset.tone;
   try{await fn();}catch(error){status.dataset.tone='error';status.textContent=error.message;}
   finally{b.disabled=false;}
  });
  return b;
 };
 // Bulunulan grubun sayfaları üstte sekme olarak: sayfalar arası geçiş tek dokunuş.
 const currentGroup=groups.find(([,keys])=>keys.includes(tab[0]))||groups.find(([,keys])=>!keys.length);
 const groupKeys=currentGroup[1].length?currentGroup[1]:tabs.map(([key])=>key).filter(key=>!assigned.includes(key));
 const subtabs=el('nav','',{className:'center-subtabs'});
 subtabs.setAttribute('aria-label',currentGroup[0]);
 for(const key of groupKeys){const m=tabs.find(entry=>entry[0]===key);if(!m)continue;const a=el('a',m[1],{href:url(key)});if(key===tab[0])a.setAttribute('aria-current','page');subtabs.append(a);}
 main.append(top,...(groupKeys.length>1?[subtabs]:[]),content);
 shell.append(sidebar,main);
 view.append(shell,status);
 function visitPackages(){
  const frame=el('iframe','',{className:'center-visit-frame',title:'Evde Hizmet Paket Yetkileri',src:'/yonetim/evde-hizmet?panel=1'});
  content.replaceChildren(frame);
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='clinic-module-height')return;
    const height=Number(event.data.height);
    if(Number.isFinite(height)&&height>=100)frame.style.height=Math.min(50000,Math.ceil(height))+'px';
  });
 }
 const table=(headers,rows)=>{if(!rows.length)return el('p','Kayıt bulunamadı.',{className:'muted'});const wrap=el('div','',{className:'center-table-wrap'}),t=el('table','',{className:'center-table'}),head=t.createTHead().insertRow();for(const h of headers)head.append(el('th',h));const body=t.createTBody();for(const cells of rows){const row=body.insertRow();for(const value of cells){const td=row.insertCell();td.append(value instanceof Node?value:document.createTextNode(String(value??'—')));}}wrap.append(t);return wrap;};
 const labels={partners:'Toplam bayi',active:'Etkin bayi',team:'Etkin ekip üyeliği',
  subscriptions:'Geçerli abonelik',applications:'Yeni başvuru',support:'Açık destek talebi',receipts:'Bugünkü klinik tahsilatı'};
 const roleLabels={dealer:'Bayi yöneticisi',branch:'Şube yöneticisi',staff:'Personel',customer:'Hasta sahibi'};
 async function nativeApps(){
  const m=await import('./center-apps.js?v=2');
  await m.mountApps(content,{fetch:opsFetch,scope:session.scopeId,reauth:session.reauthRequired,tr:uiLabel});
 }
 const statuses={active:'Etkin',pending:'Beklemede',revoked:'Kapalı'};
 const moduleLabels={appointments:'Randevular',clients:'Müşteriler',patients:'Hastalar ve klinik kayıtlar',
  followups:'Aşı ve takip',sales:'Satışlar',products:'Ürünler ve stok',expenses:'Muhasebe',
  reports:'Raporlar',messages:'Mesajlar ve şablonlar',support:'Destek',esmm:'e-SMM ayarları',
  overviewClients:'Genel bakış · Müşteri grafiği',overviewPatients:'Genel bakış · Hasta grafiği',
  vaccines:'Aşı kayıtları',shares:'Bildirimler',exam:'Muayene özetleri',lab:'Laboratuvar fotoğrafları',xray:'Röntgen fotoğrafları'};
 const number=new Intl.NumberFormat('tr-TR');
 async function overview(){
  const {metrics,day,daily,stages:stageCounts}=await call('overview');
  const cards=el('div','',{className:'center-metrics'});
  const destinations={partners:'bayiler',active:'bayiler',team:'bayiler',subscriptions:'abonelikler',applications:'basvurular',support:'destek',receipts:'muhasebe'};
  for(const [key,label] of Object.entries(labels)){
   const card=el('a','',{className:'center-metric',href:url(destinations[key])});
   card.append(el('small',label),el('strong',key==='receipts'?currency(metrics[key]):number.format(metrics[key])));cards.append(card);
  }
  const counts=new Map(daily.map(row=>[row.day,Number(row.total)]));
  const days=Array.from({length:30},(_,index)=>{
   const date=new Date(day+'T12:00:00Z');
   date.setUTCDate(date.getUTCDate()-29+index);
   const key=date.toISOString().slice(0,10);
   return [key,counts.get(key)||0];
  });
  const countsByStage=new Map(stageCounts.map(row=>[row.stage,Number(row.total)]));
  const steps=Object.entries(stages).map(([key,label])=>[label,countsByStage.get(key)||0]);
  content.replaceChildren(cards);
  if(Number(metrics.applications)>0){
   content.append(el('a',number.format(metrics.applications)+' yeni başvuruyu incele',
    {className:'center-alert center-demo-alert',href:url('basvurular',{stage:'new'})}));
  }
  content.append(chart('Son 30 gün · Günlük başvurular',days,'blue'),chart('Değerlendirme aşamalarına göre',steps,'teal'));
 }
 const currency=cents=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(cents)/100);
 const financeLabels={sales:'Satışta alınan ödeme',collections:'Ek tahsilat',sales_void:'Satış iptali',collections_void:'Tahsilat iptali',payments:'Tedarikçi ödemesi',payments_void:'Tedarikçi ödeme iptali',cash_adjust_income:'Kasa gelir düzeltmesi',cash_adjust_expense:'Kasa gider düzeltmesi',expenses:'Gelir / gider',purchases:'Ürün alışı'};
 function chart(title,points,tone){
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const section=el('section');
  const plot=el('div');
  plot.innerHTML=waveChart(points,[['Başvuru',tone]],value=>number.format(value),esc,{label:title});
  section.append(el('h3',title),plot);
  return section;
 }
 async function finance(mode){
  const current=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:'Europe/Istanbul'}).formatToParts();
  const part=name=>current.find(item=>item.type===name).value;
  const month=params.get('month')||part('year')+'-'+part('month');
  const {totals,entries}=await call('finance?'+new URLSearchParams({month}));
  const monthPicker=makeForm([field('month','Ay',{type:'month',value:month,min:'2000-01',max:'2099-12'})],'Ayı göster',values=>{
   location.assign(url(tab[0],values));
  });
  const visible=row=>mode==='all'||mode==='summary'||(row.source_type===mode||row.source_type===mode+'_void');
  content.replaceChildren(monthPicker,table(['Hareket türü','İşlem adedi','Tutar'],totals.filter(visible)
   .map(row=>[financeLabels[row.source_type],row.quantity,currency(row.cents)])));
  if(mode!=='summary')content.append(el('h3','Son hareketler'),paginate(entries.filter(visible),rows=>table(
   ['Tarih','Bayi','Hareket türü','Tutar'],rows.map(row=>[row.entry_date,row.name,financeLabels[row.source_type],currency(row.amount_cents)]))));
 }
 async function analytics(){
  const m=await import('./center-analytics.js?v=2');
  await m.mountAnalytics(content,{call,el,status,openPartner:id=>detail(id)});
 }
 async function paymentChannels(){
  // Abonelik satışı: kart (PayTR iFrame) ve havale. Kart ödemesi PayTR bildirimiyle otomatik onaylanır.
  const [cfg,{rows}]=await Promise.all([call('paytr'),call('saas-orders')]);
  const enabled=el('label','Kartla ödemeyi aç (PayTR)');enabled.prepend(el('input','',{type:'checkbox',name:'enabled',checked:cfg.enabled}));
  const test=el('label','Test modu (gerçek para çekilmez)');test.prepend(el('input','',{type:'checkbox',name:'test',checked:cfg.test}));
  const guide=el('ol','',{className:'center-guide'});
  for(const t of ['PayTR mağaza panelinde Bilgi sayfasından Mağaza No, Mağaza Parola (merchant_key) ve Mağaza Gizli Anahtar (merchant_salt) bilgilerini kopyalayın.',
   'PayTR panelinde Destek & Kurulum › Ayarlar › Bildirim URL alanına aşağıdaki adresi yazın.','Önce test modunda bir deneme ödemesi yapın, sipariş "Ödendi" olunca test modunu kapatın.'])guide.append(el('li',t));
  const callback=el('p','',{className:'center-callback'});callback.append(el('strong','Bildirim URL: '),el('code',cfg.callback));
  const form=makeForm([enabled,test,field('merchantId','PayTR Mağaza No',{required:false,value:cfg.merchantId,inputMode:'numeric',maxLength:12}),
   field('key','Mağaza Parola (merchant_key)'+(cfg.hasKey?' · kayıtlı, değiştirmek için yazın':''),{required:false,type:'password',autocomplete:'off',maxLength:64}),
   field('salt','Mağaza Gizli Anahtar (merchant_salt)'+(cfg.hasSalt?' · kayıtlı, değiştirmek için yazın':''),{required:false,type:'password',autocomplete:'off',maxLength:64})],'Ödeme ayarlarını kaydet',async values=>{
   await call('paytr',{enabled:values.enabled==='on',test:values.test==='on',merchantId:values.merchantId,key:values.key,salt:values.salt});
   status.textContent='Ödeme ayarları kaydedildi.';await paymentChannels();
  });
  const labels={pending:'Ödeme bekleniyor',review:'Havale kontrolü',paid:'Ödendi · abonelik açıldı',failed:'Başarısız',rejected:'Reddedildi'};
  const list=table(['Tarih','Bayi','Paket','Tutar','Yöntem','Durum','Dönem','İşlem'],rows.map(r=>[new Date(r.created_at*1000).toLocaleString('tr-TR'),r.partner_name||r.partner_id,r.plan_name+' · '+(r.period==='yearly'?'Yıllık':'Aylık'),currency(r.amount),
   r.method==='card'?'Kredi kartı':'EFT / Havale',labels[r.status]||r.status,r.starts_on?r.starts_on+' → '+r.ends_on:'—',
   r.method==='bank'&&['pending','review'].includes(r.status)?(()=>{const box=el('div','',{className:'center-package-actions'});
    if(r.reference)box.append(el('small','Ref: '+r.reference));
    box.append(button('Tutarı doğruladım · onayla',async()=>{await call('saas-orders',{id:r.id,action:'approved',verified:true});await paymentChannels()}),
     button('Reddet',async()=>{await call('saas-orders',{id:r.id,action:'rejected'});await paymentChannels()}));return box})():'']));
  content.replaceChildren(el('h3','Kartla ödeme · PayTR'),guide,callback,form,
   el('p','Havale ile satış için "Mağaza Havale Ayarları" sekmesinden IBAN girin ve açın.',{className:'muted'}),
   el('h3','Abonelik siparişleri'),list);
 }
 async function plans(){
  const {plans:catalog,termFields,featureFields}=await call('plans');opsFeatureFields=featureFields||{};
  content.replaceChildren(button('Yeni paket',()=>editPackage({name:'',description:'',vat:'included',published:false,modules:{}},termFields)),el('p','Paket fiyatlarını, satış sitesindeki özellikleri ve bayi erişimini buradan yönetin.'),el('a','Satış sitesindeki paketleri aç',{href:'/platform/paketler'}),table(['Paket','İçerik','Aylık','Yıllık','İşlemler'],catalog.map(plan=>[
   plan.name,plan.description,plan.monthly==null?'Teklif ile':currency(plan.monthly),plan.yearly==null?'Teklif ile':currency(plan.yearly),packageActions(plan,termFields,async()=>{
    const {partners}=await call('partners');
    const {locations}=await call('branch-directory');
    const search=field('search','Bayi veya şube ara',{type:'search',required:false});
    const choice=selectField('partner','Bayi',[]);
    const select=choice.querySelector('select');select.required=true;
    const draw=()=>{
     const query=search.querySelector('input').value.trim().toLocaleLowerCase('tr');
     select.replaceChildren(el('option','Bayi seçin',{value:''}));
     const matches=partners.filter(row=>[row.name,...(locations[row.id]||[]).map(branch=>branch.name)]
      .some(name=>name.toLocaleLowerCase('tr').includes(query)));
     for(const row of matches)select.append(el('option',[row.name,...(locations[row.id]||[]).map(branch=>branch.name)].join(' · '),{value:row.id}));
     if(matches.length===1)select.value=matches[0].id;
    };
    search.addEventListener('input',draw);draw();
    content.replaceChildren(button('Paketlere dön',plans),el('h3',plan.name),
     el('p','Şube adıyla bağlı bayiyi bulabilirsiniz. Abonelik bayi hesabına uygulanır.'),
     makeForm([search,choice],'Abonelik dönemini aç',values=>subscription(values.partner,plan.id)));
   })])));
 }
 function packageActions(plan,termFields,assign){
  const actions=el('div','',{className:'center-package-actions'});
  actions.append(button('Düzenle',()=>editPackage(plan,termFields)),button('Bayilere bağla',assign));
  return actions;
 }
 function editPackage(plan,termFields,featureFields=opsFeatureFields){
  const create=!plan.id;
  const terms=el('fieldset','',{className:'center-package-permissions'});
  terms.append(el('legend','Paket kapsamı'));
  for(const [key,[label,max]] of Object.entries(termFields)){
   terms.append(field('term_'+key,label,{required:false,maxLength:max===null?160:12,
    placeholder:max===null?'Destek açıklaması':['trial','discount'].includes(key)?'Sayı':'Sayı veya sınırsız',
    value:plan.terms?.[key]==='unlimited'?'sınırsız':plan.terms?.[key]??''}));
  }
  const description=el('label','Satış sitesi açıklaması');
  description.append(el('textarea','',{name:'description',rows:3,maxLength:800,required:true,value:plan.description}));
  const features=el('label','Satış sitesinde gösterilecek özellikler (satır başına bir özellik)');
  features.append(el('textarea','',{name:'features',rows:5,maxLength:2500,value:(plan.features||[]).join('\n')}));
  const published=el('label','Satış sitesinde yayınla');
  published.prepend(el('input','',{type:'checkbox',name:'published',checked:plan.published!==false}));
  const vat=selectField('vat','KDV',[['included','Dahil'],['excluded','Hariç']]);
  vat.querySelector('select').value=plan.vat;
  const permissions=el('fieldset','',{className:'center-package-permissions'});
  permissions.append(el('legend','Bayi ve ekip modül sınırları'));
  const options=Object.keys(moduleLabels).filter(key=>!['vaccines','shares','exam','lab','xray'].includes(key));
  for(const key of options){
   const choice=selectField('module_'+key,moduleLabels[key],[['none','Kapalı'],['read','Görüntüleme'],['write','Görüntüleme ve düzenleme']]);
   choice.querySelector('select').value=plan.modules?.[key]||(!plan.modules?'write':'none');
   permissions.append(choice);
  }
  const caps=el('fieldset','',{className:'center-package-permissions center-package-caps'});
  caps.append(el('legend','Pakette açık özellikler'),el('p','İşaretlenmeyen özellik bu paketteki bayilerin menüsünde görünmez ve sunucu tarafından reddedilir. Bayi yöneticisi açık özellikleri şube yöneticisi ve personeline ayrıca verebilir.',{className:'muted'}));
  const capKeys=Object.keys(featureFields||{});
  const capTools=el('div','',{className:'actions'});
  const capAll=on=>()=>caps.querySelectorAll('input[type=checkbox]').forEach(x=>{x.checked=on});
  capTools.append(button('Tümünü aç',capAll(true)),button('Tümünü kapat',capAll(false)));
  caps.append(capTools);
  for(const key of capKeys){const row=el('label',featureFields[key],{className:'center-cap'});row.prepend(el('input','',{type:'checkbox',name:'cap_'+key,checked:plan.capabilities?plan.capabilities[key]!==false:true}));caps.append(row)}
  const price=key=>field(key,(key==='monthly'?'Aylık':'Yıllık')+' fiyat (₺, boşsa teklif)',{type:'number',min:0,max:9999999.99,step:'0.01',required:false,value:plan[key]==null?'':plan[key]/100});
  const form=makeForm([...(create?[field('id','Paket kodu',{pattern:'[a-z0-9][a-z0-9-]{0,31}',maxLength:32})]:[]),field('name','Paket adı',{value:plan.name,maxLength:120}),description,features,price('monthly'),price('yearly'),vat,published,terms,caps,permissions],
   'Paketi kaydet',async values=>{
    const scope=Object.fromEntries(Object.entries(termFields).map(([key,[label,max]])=>{
     const value=values['term_'+key].trim();
     if(!value||max===null)return [key,value];
     if(value.toLocaleLowerCase('tr')==='sınırsız'&&!['trial','discount'].includes(key))return [key,'unlimited'];
     if(!/^\d+$/.test(value)||Number(value)>max)throw Error(label+' için geçerli bir sayı girin.');
     return [key,Number(value)];
    }));
    await call('plans',{id:plan.id||values.id,create,terms:scope,name:values.name,description:values.description,features:values.features,
     published:values.published==='on',vat:values.vat,
     monthly:values.monthly===''?null:Math.round(Number(values.monthly)*100),
     yearly:values.yearly===''?null:Math.round(Number(values.yearly)*100),
     modules:Object.fromEntries(options.map(key=>[key,values['module_'+key]])),capabilities:Object.fromEntries(capKeys.map(key=>[key,values['cap_'+key]==='on']))});
    await plans();
    status.textContent='Paket kaydedildi.';
   });
  form.classList.add('center-package-form');
  content.replaceChildren(button('Paketlere dön',plans),el('h3',plan.name||'Yeni paket'),
   el('p','Yetki sınırları bu pakete bağlı etkin aboneliklere uygulanır. Personelin kendi rol izinleri de geçerlidir.'),form);
 }
 async function subscriptions(){
  const {terms}=await call('subscriptions');
  content.replaceChildren(el('a','Paket atamak için bayi seçin',{href:url('bayiler')}),
   paginate(terms,rows=>table(['Bayi','Paket','Tür','Başlangıç','Bitiş','İşlem'],rows.map(term=>[
    term.name,term.plan_name,term.kind==='trial'?'Deneme':'Yönetici ataması',term.starts_on,term.ends_on,
    button('Dönemleri aç',()=>subscription(term.partner_id))]))));
 }
 function security(){
  const form=makeForm([
   field('password','Mevcut merkez yönetici şifresi',{type:'password',autocomplete:'current-password'}),
   field('otp','Yeni doğrulama kodu',{inputMode:'numeric',autocomplete:'one-time-code',pattern:'[0-9]{6}',maxLength:6})
  ],'Kimliği doğrula',async (values,form)=>{
   await call('reauth',values);
   form.reset();
   account.querySelector('a')?.remove();
   status.textContent='Kimliğiniz doğrulandı. Yönetim işlemlerini beş dakika boyunca yapabilirsiniz.';
  });
  const target=tabs.find(([key])=>key===params.get('returnTab'))||tabs[0];
  content.replaceChildren(el('h3','Kimliği yeniden doğrula'),el('p',
   'Telefonunuzdaki doğrulama uygulamasının yeni altı haneli kodunu kullanın. Girişte bir kod kullandıysanız uygulamada sonraki kodu bekleyin.'),form,
   el('a','Önceki bölüme dön',{href:url(target[0])}));
 }
 const managementFields={
  shop_bank:[['enabled','Havale ile satış'],['beneficiary','Alıcı adı'],['iban','Türkiye IBAN']],
  payments:[['partner','Bayi'],['reference','Dekont / işlem referansı'],['amount','Tutar (₺)'],['note','Not'],['plan','Abonelik paketi'],['starts_on','Başlangıç'],['ends_on','Bitiş']],
  market:[['path','Satış sayfası yolu'],['title','Başlık'],['description','Arama sonucu açıklaması'],['section_title','Ek bölüm başlığı'],['section_text','Ek bölüm metni'],['section_url','Ek bölüm HTTPS bağlantısı']],
  announcements:[['partner','Hedef bayi'],['title','Başlık'],['text','Duyuru']],
  ads:[['partner','Hedef bayi'],['title','Başlık'],['text','Reklam metni'],['url','HTTPS bağlantısı']],
  releases:[['title','Sürüm veya değişiklik başlığı'],['text','Değişiklik açıklaması']],
  okc:[['partner','Bayi'],['branch','Şube'],['brand','Marka'],['model','Model'],['serial','Seri numarası'],['note','Bağlantı notu']]
 };
 async function publicationImage(file){
  if(file.size>8000000||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('En fazla 8 MB boyutunda JPEG, PNG veya WebP seçin.');
  const image=await createImageBitmap(file);
  try{
   const ratio=Math.min(1,1000/Math.max(image.width,image.height));
   const canvas=el('canvas','',{width:Math.max(1,Math.round(image.width*ratio)),height:Math.max(1,Math.round(image.height*ratio))});
   const context=canvas.getContext('2d');
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
   context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.65,.48,.32]){
    const encoded=canvas.toDataURL('image/jpeg',quality);
    if(encoded.length<=165000)return encoded;
   }
   throw Error('Görsel sıkıştırıldıktan sonra boyut sınırını aşıyor.');
  }finally{image.close();}
 }
 async function manage(kind,editing=null){
  const fields=managementFields[kind];
  const [{rows},{partners}]=await Promise.all([call(kind),call('partners')]);
  const paymentPlans=kind==='payments'?(await call('plans')).plans:[];
  const names=new Map(partners.map(partner=>[partner.id,partner.name]));
  const optionalPartner=['announcements','ads'].includes(kind);
  const controls=fields.map(([name,label])=>{
   let control;
   if(name==='channel') control=selectField(name,label,[['sms','SMS'],['whatsapp','WhatsApp']]);
   else if(name==='enabled') control=selectField(name,label,[['no','Kapalı'],['yes','Açık']]);
   else if(name==='partner') control=selectField(name,label,[['',optionalPartner?'Tüm bayiler':'Bayi seçin'],...names]);
   else if(name==='plan') control=selectField(name,label,[['','Yalnız ödeme kaydı'],...paymentPlans.map(plan=>[plan.id,plan.name])]);
   else if(name==='starts_on'||name==='ends_on') control=field(name,label,{type:'date',required:false});
   else if(name==='branch') control=selectField(name,label,[['','Önce bayi seçin']]);
   else if(name==='brand') control=selectField(name,label,['Beko','Ingenico','Hugin','Paygo','inPOS'].map(brand=>[brand,brand]));
   else if(name==='section_text'){control=textArea(name,label,1500);control.querySelector('textarea').required=false;}
   else if(name==='text'||name==='description') control=textArea(name,label,kind==='releases'?1500:kind==='announcements'?1600:kind==='ads'?500:350);
   else control=field(name,label,{required:!['url','note','section_title','section_url'].includes(name),value:editing?.[name]||(name==='path'?'/platform':'')});
   if(editing && name!=='branch') control.querySelector('input,select,textarea').value=editing[name]??'';
   if(editing && name==='path') control.querySelector('input').readOnly=true;
   if(optionalPartner && ['title','text'].includes(name))control.querySelector('input,textarea').required=false;
   return control;
  });
  if(optionalPartner){
   const slot=selectField('slot','Yayın konumu',[
    ['1','Kutu 1'],['2','Kutu 2'],['3','Kutu 3'],...(kind==='announcements'?[['0','Üst duyuru']]:[])
   ]);
   slot.querySelector('select').value=String(editing?.slot??1);
   const active=field('active','Yayında',{type:'checkbox',required:false,checked:editing?.active??true});
   const image=field('imageFile','Görsel ekle',{type:'file',accept:'image/jpeg,image/png,image/webp',required:false});
   controls.push(slot,active,image,
    field('startLocal','Yayın başlangıcı · Türkiye saati',{type:'datetime-local',required:false,value:editing?.startLocal||''}),
    field('endLocal','Yayın bitişi · Türkiye saati',{type:'datetime-local',required:false,value:editing?.endLocal||''}));

   if(editing?.image)controls.push(field('removeImage','Mevcut görseli kaldır',{type:'checkbox',required:false}));
  }
  const form=makeForm(controls,'Kaydet',async values=>{
   if(optionalPartner){
    const {imageFile,removeImage,...publication}=values;
    values={...publication,slot:Number(values.slot),active:values.active==='on'};
    if(removeImage==='on')values.image='';
    if(imageFile?.size)values.image=await publicationImage(imageFile);
   }
   await call(kind,{...values,id:editing?.id||''});
   await manage(kind);
   status.textContent='Kayıt kaydedildi.';
  });
  if(kind==='okc'){
   const partner=form.elements.partner;
   const branch=form.elements.branch;
   const refresh=async()=>{
    const id=partner.value;
    branch.replaceChildren(el('option','Şube seçin',{value:''}));
    if(!id)return;
    const data=await call('partner?'+new URLSearchParams({id}));
    if(id!==partner.value)return;
    for(const item of data.branches)branch.append(el('option',item.name,{value:item.id}));
    if(id===editing?.partner)branch.value=editing.branch;
   };
   partner.addEventListener('change',()=>refresh().catch(error=>{status.textContent=error.message;}));
   await refresh();
  }
  const actions=row=>{
   const group=el('div','',{className:'center-toolbar'});
   const act=action=>async()=>{
    if(!confirm('İşlem uygulansın mı?'))return;
    await call(kind,{id:row.id,action});await manage(kind);
   };
   if(kind==='payments'){
    if(row.status==='pending')group.append(button('Dekontu incele',()=>{
     const verified=field('verified','Bankadaki başarılı işlemi ve tutarı kontrol ettim',{type:'checkbox',required:true});
     const amount=field('verifiedAmount','Dekonttaki tutar (₺)',{inputMode:'decimal'});
     content.replaceChildren(button('Ödemelere dön',()=>manage(kind)),el('h3',row.reference),
      el('p',(names.get(row.partner)||'Bayi')+' · '+row.amount+' ₺'),
      makeForm([amount,verified],row.plan?'Onayla ve abonelik dönemini aç':'Onayla',async values=>{
       await call(kind,{id:row.id,action:'approved',verified:values.verified==='on',verifiedAmount:values.verifiedAmount});
       await manage(kind);status.textContent='Ödeme incelemesi kaydedildi.';
      }));
    }),button('Reddet',act('rejected')));
   }else group.append(button('Düzenle',()=>manage(kind,row)),button('Sil',act('delete')));
   return group;
  };
  const extra=kind==='payments'?['Durum','İnceleyen']:optionalPartner?['Konum','Durum','Başlangıç','Bitiş','Görsel']:[];
  const entries=paginate(rows,page=>table([...fields.map(([,label])=>label),...extra,'İşlem'],page.map(row=>[
   ...fields.map(([key])=>key==='partner'?names.get(row.partner)||(row.partner?'Bayi bulunamadı':'Tüm bayiler'):row[key]),
   ...(kind==='payments'?[{pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi'}[row.status],row.reviewedBy]:optionalPartner?[row.slot===0?'Üst duyuru':'Kutu '+(row.slot??1),row.active===false?'Taslak':Number(row.startsAt)>Date.now()/1000?'Planlandı':'Yayında',row.startLocal||'Hemen',row.endLocal||'Süresiz',row.image?el('img','',{src:row.image,alt:'Yayın görseli',width:100}):'—']:[]),actions(row)
  ])));
  content.replaceChildren();
  if(optionalPartner){
   const summary=el('div','',{className:'center-metrics'});
   const slots=kind==='announcements'?[0,1,2,3]:[1,2,3];
   for(const slot of slots){
    const published=rows.filter(row=>(row.slot??1)===slot&&row.active!==false&&!(Number(row.startsAt)>Date.now()/1000));
    const card=el('section','',{className:'center-metric'});
    card.append(el('strong',slot===0?'Üst duyuru':'Kutu '+slot),el('small',published.length+' yayında'));
    if(!published.length)card.append(el('p','Boş'));
    for(const row of published){
     card.append(button((row.title||row.text||'Görsel yayın').slice(0,85),()=>manage(kind,row)),
      el('small',row.partner?(names.get(row.partner)||'Bayi'):'Tüm bayiler'));
    }
    summary.append(card);
   }
   content.append(summary);
  }

  if(kind==='payments')content.append(el('p','Banka dekontunu kontrol ederek onaylayın. Paket ve tarihler seçildiyse onayla birlikte abonelik dönemi oluşturulur.'));
  if(kind==='okc')content.append(el('p','Bayi ve şubeye göre cihaz envanteri. Mali işlem başlatmak için üreticinin etkin bağlantısı gerekir.'));
  content.append(entries,el('h3',editing?'Kaydı düzenle':'Yeni kayıt'),form);
  if(editing)content.append(button('Düzenlemeyi iptal et',()=>manage(kind)));
 }
 async function backup(importing){
  const {partners}=await call('partners');
  const partner=selectField('partner','Bayi',[['','Bayi seçin'],...partners.map(item=>[item.id,item.name])]);
  partner.querySelector('select').required=true;
  const branch=selectField('branch',importing?'Hedef şube':'Şube',[['','Önce bayi seçin']]);
  const select=branch.querySelector('select');
  const target=partner.querySelector('select');
  const lookup=field('search','Bayi veya şube ara',{type:'search',required:false});
  const input=lookup.querySelector('input');
  const {locations}=await call('branch-directory');
  let selectedBranches=[];
  function showBranches(){
   const prior=select.value;
   const query=input.value.trim().toLocaleLowerCase('tr');
   const matching=selectedBranches.filter(row=>row.name.toLocaleLowerCase('tr').includes(query));
   const choices=matching.length?matching:selectedBranches;
   select.replaceChildren(el('option',importing?'Şube seçin':'Tüm bayi',{value:''}));
   for(const item of choices)select.append(el('option',item.name,{value:item.id}));
   branch.hidden=selectedBranches.length===1;
   select.value=branch.hidden?selectedBranches[0].id:choices.some(row=>row.id===prior)?prior:(matching.length===1&&query?matching[0].id:'');
  }
  target.addEventListener('change',()=>{
   selectedBranches=(locations[target.value]||[]).filter(row=>!importing||row.status!=='Pasif'&&!row.sharedWith);
   showBranches();
  });
  input.addEventListener('input',()=>{
   const query=input.value.trim().toLocaleLowerCase('tr');
   const prior=target.value;
   const filtered=partners.filter(item=>[item.name,...(locations[item.id]||[]).map(row=>row.name)].some(name=>name.toLocaleLowerCase('tr').includes(query)));
   target.replaceChildren(el('option','Bayi seçin',{value:''}));
   for(const item of filtered)target.append(el('option',item.name,{value:item.id}));
   target.value=filtered.some(item=>item.id===prior)?prior:filtered.length===1?filtered[0].id:'';
   target.dispatchEvent(new Event('change'));
  });
  if(!importing){
   content.replaceChildren(el('p','Bayi çalışma alanını veya seçilen şubenin kayıtlarını JSON olarak indirin. Ortak şubelerde paylaşılan veri alanı kullanılır.'),
    makeForm([lookup,partner,branch],'JSON yedeğini indir',async values=>{
     const data=await call('backup?'+new URLSearchParams({id:values.partner,branch:values.branch}));
     const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
     el('a','',{href,download:['VetZimo',values.partner,values.branch,'yedek.json'].filter(Boolean).join('-')}).click();
     setTimeout(()=>URL.revokeObjectURL(href),1000);
    }));
   return;
  }
  const upload=field('backup','VetZimo JSON yedeği',{type:'file',accept:'.json,application/json'});
  const file=upload.querySelector('input');
  const result=el('div');
  const form=makeForm([lookup,partner,branch,upload],'Önizle',async values=>{
   result.replaceChildren();
   if(!file.files[0]||file.files[0].size>1250000)throw Error('En fazla 1,25 MB boyutunda JSON dosyası seçin.');
   const data=JSON.parse(await file.files[0].text());
   if(data.format==='vetnet-kolayvet-v1'){
    if(!values.branch)throw Error('Hedef şubeyi seçin.');
    const path='external-import?'+new URLSearchParams({id:values.partner});
    const payload={data,branch:values.branch};
    const preview=await call(path,{...payload,preview:true});
    const names={clients:'Müşteriler',patients:'Hastalar',suppliers:'Tedarikçiler',products:'Ürünler ve hizmetler',
     vaccineCatalog:'Aşı tanımları',followups:'Aşı kayıtları',stockLots:'Stok partileri',stockMoves:'Stok hareketleri'};
    result.append(table(['Kayıt türü','Yeni','Güncellenecek','Aynı'],Object.entries(preview.counts).map(([key,row])=>
     [names[key],row.added,row.updated,row.unchanged])));
    if(Object.values(preview.counts).some(row=>row.added||row.updated))result.append(button('Aktar veya güncelle',async()=>{
     await call(path,{...payload,revision:preview.revision});
     result.textContent='Aktarım kaydedildi.';
    }));
    return;
   }
   const path='import?'+new URLSearchParams({id:values.partner});
   const {added}=await call(path,{backup:data,preview:true});
   result.append(el('p',added.clients+' yeni müşteri ve '+added.patients+' yeni hasta bulundu.'));
   if(added.clients+added.patients>0)result.append(button('İçe aktarmayı onayla',async()=>{
    const saved=await call(path,{backup:data});
    result.textContent=saved.added.clients+' müşteri ve '+saved.added.patients+' hasta eklendi.';
   }));
  });
  form.addEventListener('change',()=>result.replaceChildren());
  content.replaceChildren(el('p','VetZimo JSON yedeğini veya Kolayvet dışa aktarımından hazırlanmış VetZimo aktarım JSON dosyasını seçin.'),form,result);
 }
 async function list(){
  content.replaceChildren();
  const search=field('search','Bayi ara',{type:'search',required:false,maxLength:120}),results=el('div');
  const state=selectField('status','Bayi durumu',[['','Tümü'],['active','Etkin'],['closed','Kapalı']]);
  const filter=state.querySelector('select');
  const input=search.querySelector('input');
  const summary=el('p','',{className:'muted'});
  summary.setAttribute('role','status');
  let sequence=0,timer;
  async function draw(page=1){
   const request=++sequence;
   summary.textContent='Bayiler yükleniyor…';
   try {
    const data=await call('partners?'+new URLSearchParams({page,q:input.value.trim(),status:filter.value}));
    if(request!==sequence||!results.isConnected)return;
    results.replaceChildren(table(['Bayi','Şube','Kullanıcı','Müşteri','Hasta','Durum'],data.partners.map(p=>[
     button(p.name,()=>detail(p.id)),p.branches,p.users,p.clients,p.patients,Number(p.active)?'Etkin':'Kapalı'
    ])));
    summary.textContent=data.total===0?'Aramanıza uyan bayi yok.':data.total+' bayi · Sayfa '+data.page+' / '+data.pages;
    if(data.pages>1){
     const controls=el('nav','',{className:'center-toolbar'});
     controls.setAttribute('aria-label','Bayi liste sayfaları');
     const previous=button('Önceki sayfa',()=>draw(data.page-1));
     const next=button('Sonraki sayfa',()=>draw(data.page+1));
     previous.disabled=data.page<=1;
     next.disabled=data.page>=data.pages;
     controls.append(previous,next);results.append(controls);
    }
   } catch(error) {
    if(request!==sequence||!results.isConnected)return;
    summary.textContent=error.message;
    results.replaceChildren(button('Yeniden dene',()=>draw(page)));
   }
  }
  input.addEventListener('input',()=>{
   ++sequence;clearTimeout(timer);timer=setTimeout(()=>draw(),250);
  });
  filter.addEventListener('change',()=>{clearTimeout(timer);draw();});
  const controls=el('div','',{className:'center-columns'});controls.append(search,state);content.append(controls,summary,results);
  const add=el('details');add.append(el('summary','+ Bayi oluştur'));
  add.append(makeForm([field('name','Bayi / klinik adı',{maxLength:160}),field('phone','Yetkili cep telefonu',{type:'tel'}),field('email','Bayi e-postası',{type:'email'})],'Bayi oluştur',async values=>{
   const result=await call('partners',values);await list();
   // Hoş geldin mesajı: kullanıcı adı + tek kullanımlık bağlantı (şifre belirleme ve VetZimo Kullanım Sözleşmesi imzası).
   const box=el('div','',{className:'center-welcome'});
   const text=el('textarea','',{rows:7,readOnly:true,value:result.welcome});
   const copy=button('Mesajı kopyala',async()=>{try{await navigator.clipboard.writeText(result.welcome);status.textContent='Mesaj kopyalandı.'}catch{text.select()}});
   const wa=el('a','WhatsApp ile gönder',{className:'button',target:'_blank',rel:'noopener',href:'https://wa.me/'+String(result.phone||'').replace(/\D/g,'')+'?text='+encodeURIComponent(result.welcome)});
   box.append(el('h3','Bayi oluşturuldu · hoş geldin mesajı'),el('p',result.mail==='accepted'?'Mesaj bayinin e-posta adresine gönderildi. Ayrıca WhatsApp veya SMS ile iletebilirsiniz.':'Bu mesajı yalnızca kimliği doğrulanan bayi yetkilisine iletin. Bağlantı 72 saat geçerlidir; sözleşme imzalanmadan hesap açılmaz.',{className:'muted'}),text,copy,wa);
   content.prepend(box);status.textContent='Bayi oluşturuldu.';
  }));content.append(add);await draw();
 }
 async function detail(id){
  const [data,subscriptionData]=await Promise.all([
   call('partner?'+new URLSearchParams({id})),call('subscription?'+new URLSearchParams({id}))
  ]);
  const p=data.partner;
  const actions=el('div','',{className:'center-toolbar'});
  actions.append(button('Bayi listesine dön',list),button('Paket ve abonelik',()=>subscription(id)));
  const active=Boolean(Number(p.active));
  actions.append(button(active?'Bayiyi kapat':'Bayiyi etkinleştir',async()=>{
   if(active&&!confirm('Bu bayinin aktif oturumları kapatılacak. Devam edilsin mi?'))return;
   await call('status',{partnerId:id,active:!active});await detail(id);
  }));
  const current=subscriptionData.current;
  const branches=selectField('branch','Şube',[['','Tüm şubeler'],...data.branches.map(b=>[b.id,b.name])]);
  const roles=selectField('role','Üyelik türü',[['','Tüm roller'],...Object.entries(roleLabels)]);
  const filters=el('div','',{className:'center-columns'});filters.append(branches,roles);
  const results=el('div');
  const draw=()=>{
   const branch=branches.querySelector('select').value;
   const role=roles.querySelector('select').value;
   const rows=data.members.filter(m=>(!branch||m.branch_id===branch)&&(!role||m.role===role));
   results.replaceChildren(paginate(rows,page=>table(['Ad','Telefon','Rol','Şube','Durum','İzinler'],page.map(m=>[
    m.name,m.phone,roleLabels[m.role],data.branches.find(b=>b.id===m.branch_id)?.name,statuses[m.status],
    m.role!=='dealer'&&m.status!=='revoked'?button('Yetkileri düzenle',()=>permissions(id,m)):'—'
   ]))));
  };
  filters.addEventListener('change',draw);
  const signs=data.agreements||[];
  const agreementBox=el('section','',{className:'center-agreement'});
  agreementBox.append(el('h4','VetZimo Kullanım Sözleşmesi'),signs.length?table(['İmzalayan','Unvan','Tarih','Sürüm','IP','İmza'],signs.map(r=>[r.signer_name,r.signer_title||'—',new Date(r.signed_at*1000).toLocaleString('tr-TR'),'v'+r.version,r.ip||'—',el('img','',{src:r.signature,alt:'İmza',style:'max-height:48px;background:#fff;border-radius:6px'})])):el('p','Henüz imzalanmadı · bayi ilk girişte imzalamadan çalışma alanı açılmaz.',{className:'muted'}));
  content.replaceChildren(actions,el('h3',p.name),el('p',[p.code,p.phone,p.email,active?'Etkin':'Kapalı'].join(' · ')),
   el('p',current?current.plan_name+' · '+current.ends_on+' tarihine kadar':'Geçerli abonelik bulunmuyor.'),
   el('h3','Şubeler'),table(['Şube','Durum','Veri düzeni'],data.branches.map(b=>[b.name,b.status,b.sharedWith?'Ortak':'Bağımsız'])),
   agreementBox,el('h3','Üyelikler'),filters,results);
  const finance=el('section','',{className:'center-card'});
  const report=el('div');
  const period=selectField('period','Dönem',[['day','Günlük'],['week','Haftalık'],['month','Aylık'],['all','Tüm zamanlar'],['custom','Tarih aralığı']]);
  period.querySelector('select').value='month';
  const from=field('from','Başlangıç',{type:'date',required:false});
  const to=field('to','Bitiş',{type:'date',required:false});
  from.hidden=to.hidden=true;
  period.addEventListener('change',()=>{from.hidden=to.hidden=period.querySelector('select').value!=='custom';});
  const showFinance=async values=>{
   const data=await call('partner-finance?'+new URLSearchParams({id,...values}));
   const income=Number(data.totals.income), expense=Number(data.totals.expense);
   report.replaceChildren(table(['Gelir','Gider','Net'],[[currency(income),currency(expense),currency(income-expense)]]),
    paginate(data.entries,page=>table(['Tarih','Şube','Hareket türü','Tutar'],page.map(row=>[
     row.entry_date,dataBranches.get(row.branch_id)||row.branch_id,financeLabels[row.source_type],currency(row.amount_cents)
    ]))));
  };
  const dataBranches=new Map(data.branches.map(row=>[row.id,row.name]));
  finance.append(el('h3','Bayi gelir ve gideri'),makeForm([period,from,to],'Raporu göster',showFinance),report);
  content.prepend(finance);
  await showFinance({period:'month'}).catch(error=>{report.textContent=error.message;});
  draw();
 }
 function permissions(id,member){
  const keys=member.role==='customer'?['vaccines','appointments','shares','exam','lab','xray']:Object.keys(moduleLabels).filter(key=>!['vaccines','shares','exam','lab','xray'].includes(key));
  const choices=[['none','İzin yok'],['read','Görüntüleme']];
  if(member.role!=='customer')choices.push(['write','Görüntüleme ve düzenleme']);
  const grants=JSON.parse(member.modules||'{}');
  const selects=keys.map(key=>{
   const wrapper=selectField(key,moduleLabels[key],choices);
   const select=wrapper.querySelector('select');
   select.setAttribute('aria-label',moduleLabels[key]);select.value=grants[key]||'none';
   return select;
  });
  const form=makeForm([],'Yetkileri kaydet',async values=>{
   if(!confirm('Yeni yetkilerin uygulanması için üyenin açık oturumları kapatılacak. Devam edilsin mi?'))return;
   await call('permissions',{partnerId:id,membershipId:member.id,modules:values});
   await detail(id);status.textContent='Üyelik yetkileri kaydedildi.';
  });
  form.prepend(table(['Modül','Erişim düzeyi'],keys.map((key,index)=>[moduleLabels[key],selects[index]])));
  content.replaceChildren(button('Bayiye dön',()=>detail(id)),el('h3',member.name),el('p',roleLabels[member.role]),form);
 }
 const stages={new:'Yeni',contacted:'Görüşüldü',qualified:'Değerlendiriliyor',won:'Olumlu',lost:'Olumsuz'};
 function textArea(name,label,maxLength){
  const wrapper=el('label',label);
  wrapper.append(el('textarea','',{name,maxLength,required:true,rows:5}));
  return wrapper;
 }
 function selectField(name,label,options){
  const select=el('select','',{name});
  for(const [value,title] of options) select.append(el('option',title,{value}));
  const wrapper=el('label',label);
  wrapper.append(select);
  return wrapper;
 }
 async function legalDocs(){
  const module=await import('./legal-admin.js?v=1');
  await module.mountLegalAdmin(content,{call,reauthUrl:url('guvenlik',{returnTab:'yasal'})});
 }
 async function marketEditor(){
  // Satış Sitesi Stüdyosu: sayfalar (canlı önizleme, SEO, ek bölüm), uygulama indirmeleri ve QR, otomatik demo.
  const module=await import('./center-market.js?v=1');
  await module.mountMarketStudio(content,{call,url,params});
 }
 async function notifications(){
  const settings=await call('notifications');
  const entry=(key,label,options={})=>field(key,label,{value:settings[key]??'',required:false,...options});
  const check=(key,label)=>field(key,label,{type:'checkbox',required:false,checked:settings[key]===true});
  const port=selectField('port','SMTP portu',[['465','465 · TLS'],['587','587 · STARTTLS']]);
  port.querySelector('select').value=settings.port;
  const groups=el('div','',{className:'center-columns'});
  const card=(title,fields)=>{
   const section=el('section','',{className:'center-card'});
   section.append(el('h2',title),...fields);
   groups.append(section);
  };
  card('E-posta · SMTP',[
   check('smtpEnabled','Demo başvurularında e-posta gönder'),
   entry('admin','Yönetici bildirim alıcısı',{type:'email'}),
   entry('host','SMTP sunucusu'),entry('username','SMTP kullanıcı adı'),
   entry('sender','Gönderen e-posta',{type:'email'}),port,
   entry('password',settings.hasPassword?'SMTP parolası · boş bırakılırsa korunur':'SMTP parolası',{type:'password',value:'',autocomplete:'new-password'}),
   check('clearPassword','Kayıtlı SMTP parolasını kaldır')
  ]);
  card('WhatsApp Business',[
   check('waEnabled','Yeni demo başvurularını WhatsApp’a bildir'),
   entry('recipient','Alıcı numara (ülke koduyla, ör. 905…)'),
   entry('phoneId','Gönderen Phone Number ID'),entry('apiVersion','Graph API sürümü'),
   entry('template','Onaylı, parametresiz şablon adı'),entry('language','Şablon dil kodu'),
   entry('token',settings.hasToken?'Erişim belirteci · boş bırakılırsa korunur':'Erişim belirteci',{type:'password',value:'',autocomplete:'new-password'}),
   check('clearToken','Kayıtlı belirteci kaldır')
  ]);
  const form=makeForm([groups],'Bildirim ayarlarını kaydet',async values=>{
   for(const key of ['smtpEnabled','waEnabled','clearPassword','clearToken']) values[key]=values[key]==='on';
   await call('notifications',values);
   await notifications();
   status.textContent='Bildirim ayarları kaydedildi.';
  });
  const test=(label,channel)=>button(label,async()=>{
   await call('notification-test',{channel});
   status.textContent='Test isteğini sağlayıcı kabul etti. Alıcıda teslimi kontrol edin.';
  });
  content.replaceChildren(form,test('SMTP test e-postası gönder','smtp'),test('WhatsApp test şablonu gönder','whatsapp'));
 }
 async function theme(){
  const [current,mail]=await Promise.all([call('appearance'),call('mail-settings')]);
  const palette=selectField('palette','Varsayılan tema',[['default','Sistem teması'],...sitePalettes.map(([key,label])=>[key,label])]);
  palette.querySelector('select').value=current.palette||'default';
  const lock=selectField('lock','Kullanıcı tema seçimi',[['open','Kullanıcı seçebilir'],['locked','Merkez teması zorunlu']]);
  lock.querySelector('select').value=current.locked?'locked':'open';
  content.replaceChildren(el('h2','Tema ayarları'),makeForm([palette,lock],'Kaydet',async values=>{
   const saved=await call('appearance',{palette:values.palette==='default'?'':values.palette,locked:values.lock==='locked'});
   applyAppearance(saved);
   status.textContent='Tema ayarları kaydedildi.';
  }));
  const mailForm=makeForm([
   field('company','Şirket adı',{value:mail.company,maxLength:160,required:false}),
   field('email','İmza e-postası',{type:'email',value:mail.email,required:false}),
   field('phone','İmza telefonu',{type:'tel',value:mail.phone,maxLength:40,required:false}),
   field('admin','Yönetici bildirim adresi',{type:'email',value:mail.admin,required:false}),
   field('sender','Gönderen e-posta adresi',{type:'email',value:mail.sender,required:false})
  ],'E-posta ayarlarını kaydet',async values=>{
   await call('mail-settings',values);
   status.textContent='E-posta ayarları kaydedildi.';
  });
  content.append(el('h2','Demo e-posta imzası'),mailForm,
   el('a','SMTP ve WhatsApp ayarlarını aç',{href:url('bildirimler')}));
  let compact=false;
  try{compact=localStorage.getItem('vetnet-cpanel-compact')==='1';}catch{}
  const preference=field('compact','Kompakt görünüm',{type:'checkbox',required:false,checked:compact});
  preference.addEventListener('change',event=>{
   document.body.classList.toggle('center-compact',event.target.checked);
   try{localStorage.setItem('vetnet-cpanel-compact',event.target.checked?'1':'0');}catch{}
  });
  content.append(el('h2','Panel görünümü'),preference);
 }
 const leadKinds={demo:'Demo',trial:'Deneme',contact:'İletişim'};
 async function crm(){
  const {leads}=await call('crm');
  const search=field('query','Klinik, telefon veya program ara',{type:'search',required:false});
  const filter=selectField('stage','Başvuru durumu',[['','Tümü'],...Object.entries(stages)]);
  const kinds=selectField('kind','Başvuru türü',[['','Tümü'],...Object.entries(leadKinds)]);
  const programs=selectField('program','Kullanılan program',[['','Tümü'],...Array.from(new Set(
   leads.map(lead=>lead.current_program).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'tr')).map(name=>[name,name])]);
  filter.querySelector('select').value=Object.hasOwn(stages,params.get('stage'))?params.get('stage'):'';
  const controls=el('div','',{className:'center-columns'});controls.append(search,filter,kinds,programs);
  const stats=el('div','',{className:'center-metrics'});
  for(const [stage,label] of Object.entries(stages)){
   const card=el('div','',{className:'center-metric'});
   card.append(el('small',label),el('strong',number.format(leads.filter(lead=>lead.stage===stage).length)));stats.append(card);
  }
  const results=el('div');
  const draw=()=>{
   const term=search.querySelector('input').value.trim().toLocaleLowerCase('tr-TR');
   const stage=filter.querySelector('select').value;
   const kind=kinds.querySelector('select').value;
   const program=programs.querySelector('select').value;
   const shown=leads.filter(lead=>(!stage||lead.stage===stage)&&(!kind||lead.kind===kind)&&
    (!program||lead.current_program===program)&&
    [lead.id,lead.clinic,lead.name,lead.email,lead.phone,lead.current_program].join(' ').toLocaleLowerCase('tr-TR').includes(term));
   results.replaceChildren(el('p',shown.length+' eşleşen başvuru'),paginate(shown,rows=>table(
    ['Klinik','Başvuran','Tür','Mevcut program','Tarih','Durum','İşlem'],
    rows.map(lead=>[lead.clinic,lead.name,leadKinds[lead.kind],lead.current_program||'—',lead.created_at,stages[lead.stage],
     button('Başvuruyu aç',()=>leadDetail(lead.id))]))));
  };
  controls.addEventListener('input',draw);
  content.replaceChildren(el('p','Son 200 başvuru'),stats,controls,results);draw();
 }
 async function leadDetail(id){
  const [{lead,history},{plans}]=await Promise.all([call('crm?'+new URLSearchParams({id})),call('plans')]);
  const version=String(history[0]?.id??'0');
  const stage=selectField('stage','Görüşme durumu',Object.entries(stages));
  stage.querySelector('select').value=lead.stage;
  const note=textArea('note','İç görüşme notu',1200);note.querySelector('textarea').required=false;
  const save=async values=>{
   const result=await call('crm',{...values,id,version});
   await leadDetail(id);
   status.textContent='Başvuru değerlendirmesi kaydedildi.';
   if(result.activation){
    const activation=el('div','',{className:'center-edit'});
    activation.append(el('h3','Demo hesabı açıldı'),el('p','Tek kullanımlık bağlantı 15 dakika geçerlidir. Kimliğini doğruladığınız başvuru sahibine iletin.'),
     el('input','',{value:new URL(result.activation,location.origin).href,readOnly:true,ariaLabel:'Demo aktivasyon bağlantısı'}));
    activation.append(el('p',({
     accepted:'Onay e-postasını SMTP sunucusu kabul etti.',
     failed:'Onay e-postası gönderilemedi. Bağlantıyı elle iletebilirsiniz.',
     disabled:'SMTP kapalı. Bağlantıyı elle iletebilirsiniz.'
    })[result.mail]||''));
    content.prepend(activation);
   }
  };
  content.replaceChildren(button('Başvurulara dön',crm),el('h2',lead.clinic),table(['Bilgi','Değer'],[
   ['Başvuran',lead.name],['E-posta',lead.email],['Telefon',lead.phone],['Tür',leadKinds[lead.kind]],
   ['Paket',plans.find(plan=>plan.id===lead.plan_id)?.name||lead.plan_id||'—'],
   ['Faturalama',lead.billing==='yearly'?'Yıllık':'Aylık'],['Kullanılan program',lead.current_program||'—'],
   ['Mesaj',lead.message||'—'],['Takip numarası',lead.id],['Başvuru zamanı',lead.created_at]
  ]),makeForm([stage,note],'Durumu ve notu kaydet',save));
  const trial=history.find(event=>event.trial_partner);
  if(trial)content.append(button('Açılan abonelik dönemini göster',()=>subscription(trial.trial_partner)));
  else if(['demo','trial'].includes(lead.kind)&&lead.stage!=='lost'&&lead.phone&&plans.length){
   const {partners}=await call('partners');
   const digits=value=>String(value??'').replace(/[^0-9]/g,'').slice(-10);
   const matching=partners.filter(partner=>Number(partner.active)&&digits(partner.phone)===digits(lead.phone));
   const target=selectField('target','Demo hesabı',[['new','Yeni demo hesabı aç'],...matching.map(item=>[item.id,item.name])]);
   const plan=selectField('plan','Demo paketi',plans.map(item=>[item.id,item.name]));
   if(plans.some(item=>item.id===lead.plan_id))plan.querySelector('select').value=lead.plan_id;
   const form=makeForm([target,plan,field('days','Süre (gün)',{type:'number',min:1,max:90,value:14}),
    field('verified','Başvuru sahibinin kimliğini doğruladım',{type:'checkbox',required:true})],
    'Onayla ve demoyu aç',({target,verified,...values})=>save({...values,partnerId:target,
     action:target==='new'?'demo':'trial',stage:'won',verified:verified==='on'}));
   content.prepend(el('h3','Demo onayı'),form);
  }
  content.append(el('h3','Başvuru geçmişi'),paginate(history,rows=>table(['Zaman','Yönetici','İşlem','İç not'],rows.map(row=>[
   row.created_at,row.actor,row.trial_partner?'Deneme başlatıldı':stages[row.stage],row.note||'—'
  ]))));
 }
 async function subscription(id,selectedPlan){
  const {terms,plans,day}=await call('subscription?'+new URLSearchParams({id}));
  const years=selectField('years','Abonelik süresi',[
   ['','Bitiş tarihini elle seç'],...Array.from({length:10},(_,i)=>[String(i+1),(i+1)+' yıl'])
  ]);
  const start=field('starts_on','Başlangıç',{type:'date',value:day});
  const end=field('ends_on','Bitiş',{type:'date'});
  const updateEnd=()=>{
   const value=start.querySelector('input').value;
   const duration=Number(years.querySelector('select').value);
   const input=end.querySelector('input');input.readOnly=Boolean(duration);
   if(!value||!duration)return;
   const [year,month,day]=value.split('-').map(Number);
   const target=year+duration;
   const lastDay=new Date(Date.UTC(target,month,0)).getUTCDate();
   const date=new Date(Date.UTC(target,month-1,Math.min(day,lastDay)));
   date.setUTCDate(date.getUTCDate()-1);
   input.value=date.toISOString().slice(0,10);
  };
  start.addEventListener('input',updateEnd);years.addEventListener('change',updateEnd);
  const packageField=selectField('plan','Paket',plans.map(plan=>[plan.id,plan.name]));
  if(selectedPlan)packageField.querySelector('select').value=selectedPlan;
  content.replaceChildren(button('Bayiye dön',()=>detail(id)),el('h3','Paket ve abonelik'),
   table(['Paket','Başlangıç','Bitiş','Durum'],terms.map(term=>[
    term.plan_name,term.starts_on,term.ends_on,({active:'Etkin',expired:'Süresi doldu',scheduled:'Planlandı'})[term.status]
   ])),
   makeForm([packageField,
    selectField('kind','Dönem türü',[['assigned','Yönetici ataması'],['trial','Deneme']]),
    years,start,end
   ],'Paketi ve dönemi kaydet',async ({years,...values})=>{
    await call('subscription',{...values,partnerId:id});await subscription(id);
    status.textContent='Abonelik dönemi kaydedildi.';
   })
  );
 }
 const supportCall=(path='',body)=>opsFetch('/api/support'+path,body,session.scopeId);
 async function support(){
  const {tickets}=await supportCall();
  const search=field('query','Konu, bayi veya şube ara',{type:'search',required:false});
  const filter=selectField('state','Talep durumu',[['','Tümü'],['Açık','Açık'],['Çözüldü','Çözüldü']]);
  const controls=el('div','',{className:'center-columns'});controls.append(search,filter);
  const results=el('div');
  const draw=()=>{
   const query=search.querySelector('input').value.trim().toLocaleLowerCase('tr-TR');
   const state=filter.querySelector('select').value;
   const shown=tickets.filter(ticket=>(!state||ticket.status===state)&&
    [ticket.subject,ticket.partner_name,ticket.branch_name].join(' ').toLocaleLowerCase('tr-TR').includes(query));
   results.replaceChildren(paginate(shown,rows=>table(['Talep','Bayi / Şube','Departman','Öncelik','Son yanıt','Durum'],
    rows.map(ticket=>[button(ticket.subject,()=>supportDetail(ticket.id)),
     [ticket.partner_name,ticket.branch_name].join(' · '),ticket.department,ticket.urgency,ticket.last_reply_at,ticket.status]))));
  };
  controls.addEventListener('input',draw);
  content.replaceChildren(controls,results);draw();
 }
 async function supportDetail(id){
  const path='/'+encodeURIComponent(id);
  const {ticket,replies}=await supportCall(path);
  content.replaceChildren(button('Taleplere dön',support),el('h2',ticket.subject),el('p',[ticket.status,ticket.department,ticket.urgency,ticket.last_reply_at].filter(Boolean).join(' · ')));
  for(const reply of replies) {
   const message=el('article','',{className:'center-edit center-reply'});
   message.append(el('strong',reply.author+' · '+reply.side),el('p',reply.body),el('small',reply.created_at));
   for(const file of reply.files||[]) {
    const download=el('a',file.name+' · '+Math.ceil(file.size_bytes/1000)+' KB',
      {className:'button small',href:'/api/support'+path+'/attachment/'+encodeURIComponent(file.id),download:''});
    message.append(download);
   }
   content.append(message);
  }
  if(ticket.status==='Açık'){
   content.append(makeForm([textArea('body','Yanıt',5000)],'Yanıtla',async values=>{
    await supportCall(path,values);await supportDetail(id);
   }),button('Talebi kapat',async()=>{await supportCall(path,{action:'close'});await supportDetail(id);}));
  }
 }
 async function audit(){const {events}=await call('audit');content.replaceChildren(el('h2','Son 100 yönetim işlemi'),paginate(events,rows=>table(['Tarih','İşlem','Hedef'],rows.map(e=>[e.created_at,e.action,e.target_id]))));}
 await tab[2]();
}
