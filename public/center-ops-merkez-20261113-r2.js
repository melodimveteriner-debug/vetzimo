import {sitePalettes,darkPalette,loadAppearance} from './theme.js';
import {paginate} from './paged.js';
export async function opsFetch(path,body,scope){
 const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json',...(scope?{'X-VeTNet-Scope':scope}:{})},body:JSON.stringify(body)}:{});
 const data=await response.json();if(!response.ok)throw Error(data.error||'İşlem tamamlanamadı.');return data;
}
export async function mountCenterSuite(ui,session){
 const {view,el,heading,field,makeForm,status,logoutButton}=ui;
 const tabs=[
  ['genel','Genel Bakış',overview],['bayiler','Bayiler ve Yetkiler',list],
  ['basvurular','Demo ve Başvurular',crm],['destek','Destek Talepleri',support],
  ['tema','Tema Ayarları',theme],['kayitlar','İşlem Günlüğü',audit]
 ];
 const params=new URLSearchParams(location.search);
 const tab=tabs.find(([key])=>key===params.get('tab'))||tabs[0];
 const url=(key,extra={})=>'/yonetim?'+new URLSearchParams({tab:key,...extra});
 const call=(action,body)=>opsFetch('/api/cpanel-center/'+action,body,session.scopeId);
 const applyAppearance=appearance=>{
  const palette=appearance.palette||'classic';
  document.body.dataset.centerPalette=palette;
  document.body.classList.toggle('center-dark',darkPalette(palette));
 };
 document.body.classList.add('center-suite');
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
 nav.append(el('p','VeTNeT Yönetim',{className:'center-kicker'}),el('small','Merkez paneli · R2'));
 for(const [key,label] of tabs){
  const item=el('a',label,{href:url(key),className:'center-nav-item'});
  if(key===tab[0]) {item.classList.add('active');item.setAttribute('aria-current','page');}
  nav.append(item);
 }
 sidebar.append(menu,nav);
 const main=el('div','',{className:'center-main'}),top=el('header','',{className:'center-top'});
 const account=el('div','',{className:'center-toolbar'});
 account.append(el('span',session.identifier||session.name||'Merkez yöneticisi'),
  el('a','Kimliği yeniden doğrula',{href:'/yonetim?reauth=1&returnTab='+encodeURIComponent(tab[0])}),logoutButton());
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
 main.append(top,content);
 shell.append(sidebar,main);
 view.append(shell,status);
 const table=(headers,rows)=>{if(!rows.length)return el('p','Kayıt bulunamadı.',{className:'muted'});const wrap=el('div','',{className:'center-table-wrap'}),t=el('table','',{className:'center-table'}),head=t.createTHead().insertRow();for(const h of headers)head.append(el('th',h));const body=t.createTBody();for(const cells of rows){const row=body.insertRow();for(const value of cells){const td=row.insertCell();td.append(value instanceof Node?value:document.createTextNode(String(value??'—')));}}wrap.append(t);return wrap;};
 const labels={partners:'Toplam bayi',active:'Etkin bayi',team:'Etkin ekip üyeliği',
  subscriptions:'Geçerli abonelik',applications:'Yeni başvuru',support:'Açık destek talebi'};
 const roleLabels={dealer:'Bayi yöneticisi',branch:'Şube yöneticisi',staff:'Personel',customer:'Hasta sahibi'};
 const statuses={active:'Etkin',pending:'Beklemede',revoked:'Kapalı'};
 const moduleLabels={appointments:'Randevular',clients:'Müşteriler',patients:'Hastalar ve klinik kayıtlar',
  followups:'Aşı ve takip',sales:'Satışlar',products:'Ürünler ve stok',expenses:'Muhasebe',
  reports:'Raporlar',messages:'Mesajlar ve şablonlar',support:'Destek',esmm:'e-SMM ayarları',
  overviewClients:'Genel bakış · Müşteri grafiği',overviewPatients:'Genel bakış · Hasta grafiği',
  vaccines:'Aşı kayıtları',shares:'Paylaşılan belgeler'};
 const number=new Intl.NumberFormat('tr-TR');
 async function overview(){
  const {metrics,activity,month}=await call('overview');
  const cards=el('div','',{className:'center-metrics'});
  const destinations={partners:'bayiler',active:'bayiler',team:'bayiler',subscriptions:'bayiler',applications:'basvurular',support:'destek'};
  for(const [key,label] of Object.entries(labels)){
   const card=el('a','',{className:'center-metric',href:url(destinations[key])});
   card.append(el('small',label),el('strong',number.format(metrics[key])));cards.append(card);
  }
  const chart=el('div','',{className:'center-chart'});
  const points=new Map(activity.map(point=>[point.month,point]));
  const [year,calendarMonth]=month.split('-').map(Number);
  const format=new Intl.DateTimeFormat('tr-TR',{month:'short',year:'numeric',timeZone:'UTC'});
  const max=Math.max(1,...activity.map(point=>Number(point.total)));
  for(let offset=5;offset>=0;offset--){
   const date=new Date(Date.UTC(year,calendarMonth-1-offset,1));
   const label=format.format(date);
   const point=points.get(date.toISOString().slice(0,7))||{total:0,won:0};
   const meter=el('meter','',{max,value:Number(point.total)});
   meter.setAttribute('aria-label',label+' başvuru sayısı');
   const row=el('div','',{className:'center-chart-row'});
   row.append(el('span',label),meter,el('span',point.total+' başvuru · '+point.won+' olumlu'));
   chart.append(row);
  }
  content.replaceChildren(cards);
  if(Number(metrics.applications)>0){
   content.append(el('a',number.format(metrics.applications)+' yeni başvuruyu incele',
    {className:'center-alert center-demo-alert',href:url('basvurular',{stage:'new'})}));
  }
  content.append(el('h3','Son 6 ayın başvuruları'),chart);
 }
 async function list(){
  const {partners}=await call('partners');content.replaceChildren();
  const search=field('search','Bayi ara',{type:'search',required:false}),results=el('div');
  const state=selectField('status','Bayi durumu',[['','Tümü'],['active','Etkin'],['closed','Kapalı']]);
  const filter=state.querySelector('select');
  const draw=()=>{const term=search.querySelector('input').value.trim().toLocaleLowerCase('tr-TR');const rows=partners.filter(p=>[p.name,p.code,p.phone,p.email].join(' ').toLocaleLowerCase('tr-TR').includes(term)&&(filter.value===''||Boolean(Number(p.active))===(filter.value==='active')));results.replaceChildren(paginate(rows,page=>table(['Bayi','Şube','Kullanıcı','Müşteri','Hasta','Durum'],page.map(p=>[button(p.name,()=>detail(p.id)),p.branches,p.users,p.clients,p.patients,p.active?'Etkin':'Kapalı']))));};
  search.addEventListener('input',draw);filter.addEventListener('change',draw);
  const controls=el('div','',{className:'center-columns'});controls.append(search,state);content.append(controls,results);draw();
  const add=el('details');add.append(el('summary','+ Bayi oluştur'));
  add.append(makeForm([field('name','Bayi / klinik adı',{maxLength:160}),field('phone','Yetkili cep telefonu',{type:'tel'}),field('email','Bayi e-postası',{type:'email'})],'Bayi oluştur',async values=>{
   const result=await call('partners',values);await list();const link=el('a','Tek kullanımlık aktivasyon bağlantısı',{href:result.link});status.replaceChildren('Bayi oluşturuldu. Bu bağlantıyı yalnızca kimliği doğrulanan bayi yetkilisine iletin; 15 dakika geçerlidir. ',link);
  }));content.append(add);
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
  content.replaceChildren(actions,el('h3',p.name),el('p',[p.code,p.phone,p.email,active?'Etkin':'Kapalı'].join(' · ')),
   el('p',current?current.plan_name+' · '+current.ends_on+' tarihine kadar':'Geçerli abonelik bulunmuyor.'),
   el('h3','Şubeler'),table(['Şube','Durum','Veri düzeni'],data.branches.map(b=>[b.name,b.status,b.sharedWith?'Ortak':'Bağımsız'])),
   el('h3','Üyelikler'),filters,results);
  draw();
 }
 function permissions(id,member){
  const keys=member.role==='customer'?['vaccines','appointments','shares']:Object.keys(moduleLabels).filter(key=>!['vaccines','shares'].includes(key));
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
 async function theme(){
  const current=await call('appearance');
  const palette=selectField('palette','Varsayılan tema',[['default','Sistem teması'],...sitePalettes.map(([key,label])=>[key,label])]);
  palette.querySelector('select').value=current.palette||'default';
  const lock=selectField('lock','Kullanıcı tema seçimi',[['open','Kullanıcı seçebilir'],['locked','Merkez teması zorunlu']]);
  lock.querySelector('select').value=current.locked?'locked':'open';
  content.replaceChildren(el('h2','Tema ayarları'),makeForm([palette,lock],'Kaydet',async values=>{
   const saved=await call('appearance',{palette:values.palette==='default'?'':values.palette,locked:values.lock==='locked'});
   applyAppearance(saved);
   status.textContent='Tema ayarları kaydedildi.';
  }));
 }
 async function crm(){
  const {leads}=await call('crm');
  const search=field('query','Klinik, telefon veya program ara',{type:'search',required:false});
  const filter=selectField('stage','Başvuru durumu',[['','Tümü'],...Object.entries(stages)]);
  filter.querySelector('select').value=Object.hasOwn(stages,params.get('stage'))?params.get('stage'):'';
  const controls=el('div','',{className:'center-columns'});controls.append(search,filter);
  const results=el('div');
  const draw=()=>{
   const term=search.querySelector('input').value.trim().toLocaleLowerCase('tr-TR');
   const stage=filter.querySelector('select').value;
   const shown=leads.filter(lead=>(!stage||lead.stage===stage)&&
    [lead.clinic,lead.name,lead.email,lead.phone,lead.current_program].join(' ').toLocaleLowerCase('tr-TR').includes(term));
   results.replaceChildren(paginate(shown,rows=>table(['Klinik','Başvuran','Mevcut program','Tarih','Durum','İşlem'],
    rows.map(lead=>[lead.clinic,lead.name,lead.current_program||'—',lead.created_at,stages[lead.stage],
     button('Başvuruyu aç',()=>leadDetail(lead))]))));
  };
  controls.addEventListener('input',draw);
  content.replaceChildren(controls,results);draw();
 }
 function leadDetail(lead){
  const stage=selectField('stage','Görüşme durumu',Object.entries(stages));
  stage.querySelector('select').value=lead.stage;
  content.replaceChildren(button('Başvurulara dön',crm),el('h2',lead.clinic),
   el('p',[lead.name,lead.email,lead.phone].filter(Boolean).join(' · ')),
   el('p',lead.plan_id ? lead.plan_id+' · '+(lead.billing==='yearly'?'Yıllık':'Aylık') : 'Paket seçilmedi'),
   el('p',lead.current_program),el('p',lead.message),
   makeForm([stage],'Durumu kaydet',async values=>{await call('crm',{id:lead.id,stage:values.stage});await crm();})
  );
 }
 async function subscription(id){
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
  content.replaceChildren(button('Bayiye dön',()=>detail(id)),el('h3','Paket ve abonelik'),
   table(['Paket','Başlangıç','Bitiş','Durum'],terms.map(term=>[
    term.plan_name,term.starts_on,term.ends_on,({active:'Etkin',expired:'Süresi doldu',scheduled:'Planlandı'})[term.status]
   ])),
   makeForm([selectField('plan','Paket',plans.map(plan=>[plan.id,plan.name])),
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
   content.append(message);
  }
  if(ticket.status==='Açık'){
   content.append(makeForm([textArea('body','Yanıt',5000)],'Yanıtla',async values=>{
    await supportCall(path,values);await supportDetail(id);
   }),button('Talebi kapat',async()=>{await supportCall(path,{action:'close'});await supportDetail(id);}));
  }
 }
 async function audit(){const {events}=await call('audit');content.replaceChildren(el('h2','Son 100 yönetim işlemi'),paginate(events,rows=>table(['Tarih','İşlem','Hedef'],rows.map(e=>[e.created_at,e.action,e.target_id]))));}
 if(params.get('reauth')==='1'){
  const form=makeForm([field('password','Merkez yönetici şifresi',{type:'password',autocomplete:'current-password'}),
   field('otp','Yeni doğrulama kodu',{inputMode:'numeric',autocomplete:'one-time-code',pattern:'[0-9]{6}'})],
   'Kimliği doğrula',async values=>{
    await opsFetch('/api/identity/center/login',values);
    const target=tabs.find(([key])=>key===params.get('returnTab'))||tabs[0];
    location.assign(url(target[0]));
   });
  content.replaceChildren(el('h3','Kimliği yeniden doğrula'),form);
 }else await tab[2]();
}
