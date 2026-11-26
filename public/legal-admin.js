// Merkez yönetimi · Yasal metinler: KVKK, gizlilik, kullanım şartları, çerez politikası ve şirket bilgileri.
// Sunucudaki SiteLegal::render ile aynı sade biçimi canlı önizler; her kayıt yeni bir sürüm olarak saklanır.
const css='/legal-admin.css?v=2';
function ensureCss(){if(!document.querySelector(`link[href="${css}"]`)){const l=document.createElement('link');l.rel='stylesheet';l.href=css;document.head.append(l);}}
const h=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v===true)n.setAttribute(k,'');else n.setAttribute(k,v);}for(const c of kids.flat())if(c!=null&&c!==false)n.append(c);return n;};
const MONTHS=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const longDate=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||'');return m?`${+m[3]} ${MONTHS[+m[2]-1]} ${m[1]}`:d||'';};
const today=()=>{const d=new Date(Date.now()+3*3600e3);return d.toISOString().slice(0,10);};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

export function renderLegal(body,company){
  // SiteLegal::render ile birebir aynı kurallar: boş alan içeren satır gösterilmez.
  let html='',list=false;
  const inline=text=>{let missing=false;const out=text.replace(/\{([a-z_]+)\}/g,(m,k)=>{if(!(k in company))return m;if(company[k]===''){missing=true;return'';}return'\u0001'+k+'\u0002';});
    if(missing)return null;return esc(out).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\u0001([a-z_]+)\u0002/g,(m,k)=>esc(company[k]));};
  for(const raw of String(body).split(/\r?\n/)){
    const line=raw.replace(/\s+$/,'');let kind='p',text=line;
    if(line.startsWith('### ')){kind='h3';text=line.slice(4);}else if(line.startsWith('## ')){kind='h2';text=line.slice(3);}
    else if(line.startsWith('- ')){kind='li';text=line.slice(2);}else if(line.startsWith('> ')){kind='note';text=line.slice(2);}
    if(kind!=='li'&&list){html+='</ul>';list=false;}
    if(!text.trim())continue;
    const inner=inline(text.trim());if(inner==null)continue;
    if(kind==='li'){if(!list){html+='<ul>';list=true;}html+=`<li>${inner}</li>`;}
    else if(kind==='note')html+=`<p class="lga-note">${inner}</p>`;
    else html+=`<${kind}>${inner}</${kind}>`;
  }
  if(list)html+='</ul>';
  return html;
}

export async function mountLegalAdmin(root,{call,reauthUrl}){
  ensureCss();
  root.replaceChildren(h('p',{class:'lga-muted',text:'Yükleniyor…'}));
  let data=await call('legal');
  let current=data.docs[0].slug,dirty=false;
  const msg=h('p',{class:'lga-msg',role:'status','aria-live':'polite'});
  const say=(text,tone='')=>{msg.textContent=text;msg.dataset.tone=tone;};
  const fail=error=>{const text=error.message||String(error);say(text,'error');
    if(/doğrula/i.test(text)&&reauthUrl){msg.append(' ',h('a',{href:reauthUrl,text:'Kimliğinizi doğrulayın'}));}};
  const tabs=h('div',{class:'lga-tabs',role:'tablist','aria-label':'Yasal metinler'});
  const pane=h('div',{class:'lga-pane'});
  root.replaceChildren(
    h('div',{class:'lga-head'},h('div',{},h('h3',{text:'Yasal metinler'}),h('p',{class:'lga-muted',text:'Satış sitesinin alt alanında görünen KVKK, gizlilik, kullanım ve çerez metinleri ile tüm kliniklerin ortak yasal metin şablonları. Klinik şablonları her kliniğin kendi şirket bilgileri ve logosuyla yayımlanır; metni kendine göre düzenleyen klinikler kendi metnini kullanır. Her kayıt yeni bir sürüm oluşturur.'})),
      h('a',{class:'lga-btn ghost',href:'/platform/yasal',target:'_blank',rel:'noopener',text:'Yasal sayfaları aç ↗'})),
    tabs,msg,pane);
  const confirmLeave=()=>!dirty||window.confirm('Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?');
  function drawTabs(){
    const tab=d=>h('button',{type:'button',role:'tab','aria-selected':String(current===d.slug),class:'lga-tab'+(d.clinic?' lga-clinic':''),onclick:()=>{if(current!==d.slug&&confirmLeave()){current=d.slug;draw();}}},
      h('b',{text:d.title}),h('small',{text:`${longDate(d.effective_on)} · Sürüm ${d.version}`}));
    tabs.replaceChildren(h('span',{class:'lga-group',text:'Satış sitesi (VetZimo)'}),...data.docs.map(tab),
      h('button',{type:'button',role:'tab','aria-selected':String(current==='company'),class:'lga-tab',onclick:()=>{if(current!=='company'&&confirmLeave()){current='company';draw();}}},
        h('b',{text:'Şirket bilgileri'}),h('small',{text:'Tüm metinlerde kullanılır'})),
      ...(data.clinicDocs?.length?[h('span',{class:'lga-group',text:'Klinik metin şablonları (tüm kliniklerde ortak)'}),...data.clinicDocs.map(tab)]:[]));
  }
  const allDocs=()=>[...data.docs,...(data.clinicDocs||[])];
  function draw(){dirty=false;say('');drawTabs();current==='company'?drawCompany():drawDoc(allDocs().find(d=>d.slug===current));}

  function drawCompany(){
    const form=h('form',{class:'lga-company'});
    for(const f of data.companyFields){
      form.append(h('label',{},h('span',{text:f.label+` · {${f.key}}`}),h('input',{name:f.key,value:data.company[f.key]||'',maxlength:String(f.max),oninput:()=>{dirty=true;}})));
    }
    form.append(h('p',{class:'lga-muted lga-wide',text:'Boş bırakılan alanları içeren satırlar metinlerde gösterilmez (örneğin MERSİS numarası girilmediyse o satır gizlenir). Alt alandaki telif satırı marka, unvan ve adresten oluşturulur.'}),
      h('div',{class:'lga-actions lga-wide'},h('button',{type:'submit',class:'lga-btn',text:'Şirket bilgilerini kaydet'})));
    form.addEventListener('submit',async e=>{e.preventDefault();const btn=form.querySelector('button[type=submit]');btn.disabled=true;
      try{const company=Object.fromEntries(new FormData(form));const r=await call('legal-company',{company});data.company=r.company;dirty=false;say('Şirket bilgileri kaydedildi; tüm yasal sayfalar ve alt alan güncellendi.','ok');}
      catch(err){fail(err);}finally{btn.disabled=false;}});
    pane.replaceChildren(form);
  }

  function drawDoc(doc){
    const company=doc.clinic?data.clinicSample:data.company,fieldList=doc.clinic?data.clinicFields:data.companyFields;
    const title=h('input',{value:doc.title,maxlength:'160',required:true});
    const summary=h('textarea',{rows:'3',maxlength:'400'});summary.value=doc.summary||'';
    const date=h('input',{type:'date',value:today()});
    const body=h('textarea',{class:'lga-body',rows:'24',spellcheck:'true'});body.value=doc.body;
    const note=h('input',{maxlength:'300',placeholder:'Örneğin: Yurt dışı aktarım bölümü güncellendi'});
    const preview=h('div',{class:'lga-preview'});
    const stats=h('span',{class:'lga-muted'});
    const refresh=()=>{preview.innerHTML=`<p class="lga-stamp"><b>Düzenlenme tarihi:</b> ${esc(longDate(date.value||today()))} · Sürüm ${doc.version+1}</p><h1>${esc(title.value)}</h1>${summary.value?`<p class="lga-note">${renderLegal(summary.value,company).replace(/^<p>|<\/p>$/g,'')}</p>`:''}${renderLegal(body.value,company)}`;
      const words=(body.value.match(/\S+/g)||[]).length;stats.textContent=`${words.toLocaleString('tr-TR')} kelime · yaklaşık ${Math.max(1,Math.round(words/200))} dk okuma`;};
    for(const n of [title,summary,date,body,note])n.addEventListener('input',()=>{dirty=true;refresh();});
    const wrap=(before,after='')=>{const s=body.selectionStart,e=body.selectionEnd,sel=body.value.slice(s,e);body.setRangeText(before+sel+after,s,e,'end');body.focus();dirty=true;refresh();};
    const prefix=p=>{const s=body.selectionStart;const start=body.value.lastIndexOf('\n',s-1)+1;body.setRangeText(p,start,start,'end');body.focus();dirty=true;refresh();};
    const fieldPick=h('select',{'aria-label':'Şirket alanı ekle',onchange:()=>{if(fieldPick.value){wrap('{'+fieldPick.value+'}');fieldPick.value='';}}},
      h('option',{value:'',text:'Alan ekle…'}),...fieldList.map(f=>h('option',{value:f.key,text:f.label})));
    const tools=h('div',{class:'lga-tools'},
      h('button',{type:'button',onclick:()=>prefix('## '),title:'Bölüm başlığı (## )',text:'Başlık'}),
      h('button',{type:'button',onclick:()=>prefix('### '),title:'Ara başlık (### )',text:'Ara başlık'}),
      h('button',{type:'button',onclick:()=>prefix('- '),title:'Madde (- )',text:'• Madde'}),
      h('button',{type:'button',onclick:()=>prefix('> '),title:'Vurgulu not (> )',text:'Not'}),
      h('button',{type:'button',onclick:()=>wrap('**','**'),title:'Kalın (**metin**)',text:'Kalın'}),fieldPick);
    const save=h('button',{type:'button',class:'lga-btn',text:'Kaydet ve yayınla'});
    const reset=h('button',{type:'button',class:'lga-btn ghost',text:'Varsayılan metne dön'});
    save.addEventListener('click',async()=>{
      if(!title.value.trim()||!body.value.trim()){say('Başlık ve metin boş bırakılamaz.','error');return;}
      save.disabled=true;
      try{const r=await call('legal-save',{slug:doc.slug,title:title.value,summary:summary.value,body:body.value,note:note.value,effectiveOn:date.value,version:doc.version});
        data=await call('legal');dirty=false;draw();say(`${r.doc.title} yayınlandı · Sürüm ${r.doc.version} · Düzenlenme tarihi ${longDate(r.doc.effective_on)}.`,'ok');}
      catch(err){fail(err);}finally{save.disabled=false;}});
    reset.addEventListener('click',async()=>{
      try{const r=await call('legal-revision?slug='+encodeURIComponent(doc.slug));const first=r.revisions.at(-1);
        if(!first){say('Bu metin henüz hiç değiştirilmedi; şu an varsayılan metin yayında.');return;}
        title.value=first.title;summary.value=first.summary;body.value=first.body;note.value='Varsayılan metne dönüldü';dirty=true;refresh();say('Varsayılan metin düzenleyiciye yüklendi. Yayınlamak için kaydedin.');}
      catch(err){fail(err);}});
    const history=h('ol',{class:'lga-history'});
    const revs=doc.revisions||[];
    if(!revs.length)history.append(h('li',{},h('b',{text:'Sürüm 1'}),h('span',{text:longDate(doc.effective_on)}),h('em',{text:'Varsayılan metin yayında'})));
    for(const r of revs)history.append(h('li',{},h('b',{text:'Sürüm '+r.version}),h('span',{text:longDate(r.effective_on)}),h('em',{text:[r.note,r.created_by].filter(Boolean).join(' · ')}),
      h('button',{type:'button',class:'lga-link',text:'Düzenleyiciye yükle',onclick:async()=>{try{const all=await call('legal-revision?slug='+encodeURIComponent(doc.slug));const x=all.revisions.find(v=>v.version===r.version);if(!x)return;
        title.value=x.title;summary.value=x.summary;body.value=x.body;note.value='Sürüm '+r.version+' geri yüklendi';dirty=true;refresh();say('Sürüm '+r.version+' düzenleyiciye yüklendi. Yayınlamak için kaydedin.');}catch(err){fail(err);}}})));
    pane.replaceChildren(
      h('div',{class:'lga-info'},h('span',{},h('b',{text:'Yayındaki sürüm: '}),`${doc.version} · ${longDate(doc.effective_on)}`,doc.updated_by?` · ${doc.updated_by}`:'',doc.stored?'':' · varsayılan metin'),
        doc.clinic?h('span',{class:'lga-muted',text:'Önizleme örnek klinik bilgileriyle gösterilir. Her klinik kendi şirket bilgileriyle yayımlar; metni kendine göre düzenleyen kliniklere bu şablon değişikliği yansımaz.'}):h('a',{href:doc.url,target:'_blank',rel:'noopener',text:'Sitede görüntüle ↗'})),
      h('div',{class:'lga-grid'},
        h('div',{class:'lga-editor'},
          h('label',{},h('span',{text:'Başlık'}),title),
          h('label',{},h('span',{text:'Giriş özeti (sayfa başında görünür)'}),summary),
          h('div',{class:'lga-row'},h('label',{},h('span',{text:'Düzenlenme tarihi'}),date),h('label',{},h('span',{text:'Değişiklik notu (sürüm geçmişinde görünür)'}),note)),
          h('div',{class:'lga-bodyhead'},h('span',{text:'Metin'}),stats),tools,body,
          h('p',{class:'lga-muted',text:doc.clinic?'Biçim: "## " bölüm başlığı, "### " ara başlık, "- " madde, "> " vurgulu not, **kalın**. {klinik}, {unvan}, {adres}, {telefon}, {eposta}, {kvkk_eposta}, {vergi}, {mersis}, {kep}, {web} alanları her kliniğin kendi şirket bilgileriyle doldurulur; boş alan içeren satır gösterilmez.':'Biçim: "## " bölüm başlığı, "### " ara başlık, "- " madde, "> " vurgulu not, **kalın**. {unvan}, {adres}, {kvkk_eposta} gibi alanlar Şirket bilgileri sekmesindeki değerlerle doldurulur.'}),
          h('div',{class:'lga-actions'},save,reset)),
        h('div',{class:'lga-side'},h('h4',{text:'Canlı önizleme'}),preview,h('h4',{text:'Sürüm geçmişi'}),history)));
    refresh();
  }
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  draw();
}
