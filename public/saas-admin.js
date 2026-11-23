import {waveChart} from "./wave-chart.js";
import {saasKinds,saasStages,saasTerms,unlimitedTerm,termValue} from "./saas-market.js";

import {termDate,termKind,termStatus} from "./saas-subscription.js";

const escapeChart=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

export async function mountSaasAdmin({area,tab,params,write,mayAssign,mayUseFinance,mayReviewFinance,el,field,selectField,makeForm,link,section,tablePage,call}) {
  const href=(values={})=>"/yonetim?"+new URLSearchParams({tab,...values});
  const shownDate=value=>new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Istanbul"}).format(new Date(value));
  const select=(name,label,options,value)=>{
    const wrapper=selectField(name,label,options,name!=="program");
    wrapper.querySelector("select").value=value;
    return wrapper;
  };
  const apply=async(path,data)=>{
    await call(path,data);
    location.reload();
  };
  if (tab==="abonelikler") {
    const partner=params.get("partner")||"";
    const data=await call("subscriptions?"+new URLSearchParams({partner}));
    const card=section("Bayi abonelikleri","Deneme başvuruları Demo İstek-Değerlendirme ekranından onaylanır. Ücretli yıllık dönemler, merkez muhasebesinde kapanan satışlardan etkinleştirilir.");
    const partners=[["","Bayi seçin"],...data.partners.map(row=>[row.id,row.name])];
    const picker=select("partner","Bayi",partners,partner);
    picker.querySelector("select").addEventListener("change",event=>{location.href=href({partner:event.target.value});});
    card.append(picker);
    if (data.state) {
      card.append(link("Bayi profiline dön","/yonetim?"+new URLSearchParams({tab:"bayiler",partner})),
        el("p","Bayi durumu · "+termStatus[data.state.status]),
        el("p","Kullanılan paket · "+(data.state.current?.plan_name||"Etkin dönem yok")));
      card.append(tablePage(["Paket","Tür","Başlangıç","Bitiş","Durum"],data.state.terms.map(row=>[
        row.plan_name,termKind[row.kind],termDate(row.starts_on),termDate(row.ends_on),termStatus[row.status],
      ])));
      if (data.upgrade) {
        const order=data.upgrade;
        const money=new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"});
        const review=section("Pro ödeme bildirimi",order.plan_name+" · "+money.format(order.amount/100));
        review.append(el("p","Banka referansı: "+order.reference),
          el("p",{pending:"İnceleme bekliyor",approved:"Onaylandı",rejected:"Reddedildi"}[order.state]));
        if (mayAssign&&mayReviewFinance&&order.state==="pending") {
          review.append(makeForm([
            field("reference","Bankada görünen işlem referansı",{maxLength:100}),
            field("amount","Bankada görünen tutar (TL)",{inputMode:"decimal"}),
            field("day","İşlem tarihi",{type:"date",value:data.state.day,max:data.state.day}),
            field("verified","Banka hareketini ve ödeme tutarını doğruladım",{type:"checkbox",required:true}),
          ],"Ödemeyi onayla ve Pro’yu aç",values=>apply("demo-payments/"+order.id,{
            decision:"approved",reference:values.reference,day:values.day,verified:values.verified==="on",
            verifiedAmount:/^\d{1,9}(?:[.,]\d{1,2})?$/.test(values.amount)?Math.round(Number(values.amount.replace(",","."))*100):null
          })));
          review.append(makeForm([field("confirm","Bildirimi reddetmeyi onaylıyorum",{type:"checkbox",required:true})],
            "Bildirimi reddet",()=>apply("demo-payments/"+order.id,{decision:"rejected"})));
        }
        area.append(review);
      }
      if (mayAssign&&mayUseFinance) {
        if (data.eligible.length&&data.plans.length) {
          const money=new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"});
          card.append(makeForm([
            select("plan","Yayımdaki paket",data.plans.map(row=>[row.id,row.name]),data.plans.find(row=>row.id===params.get("plan"))?.id||data.plans.find(row=>row.id===data.state.current?.plan_id)?.id||data.plans[0].id),
            select("invoice","Kapanmış yıllık satış",data.eligible.map(row=>[row.id,
              row.description+" · "+termDate(row.term_start)+" — "+termDate(row.term_end)+" · "+money.format(row.total/100),
            ]),data.eligible[0].id),
            field("review","Bayi, paket ve yıllık tahsilat eşleşmesini kontrol ettim",{type:"checkbox",required:true}),
          ],"Ücretli dönemi etkinleştir",values=>apply("subscriptions",{partner,plan:values.plan,invoice:values.invoice,review:values.review==="on"})));
        } else card.append(el("p","Bu bayi için eşleştirilebilir kapanmış yıllık satış veya yayında paket bulunamadı."));
      }
    }
    area.append(card);
    return;
  }
  if (tab==="paketler") {
    const {plans}=await call("plans");
    const card=section("Yazılım paketleri","Fiyatlar kuruş olarak girilir. Boş fiyat alanı satış sitesinde teklif seçeneğini gösterir. Sınırsız kullanıcı ve şube seçenekleri aktif ücretli aboneliğe uygulanır. Bayiye özel kapatma ayarları korunur.");
    card.append(link("Satış sitesinde paketleri görüntüle","/platform/paketler"));
    for (const plan of plans) {
      const detail=el("details"), summary=el("summary",plan.name+" · "+(plan.published?"Yayında":"Taslak"));
      detail.append(summary,el("p",plan.description));
      if (write) {
        const num=(key,label,value,max)=>field(key,label,{type:"number",min:0,max,step:1,required:false,value:value??""});
        const options=[["unset","Fiyat belirlenmedi"],["included","KDV dahil"],["excluded","KDV hariç"]];
        const limits=saasTerms.map(([key,label,max])=>{
          const box=el("div","",{className:"plan-limit"});
          const raw=plan.terms[key], isUnlimited=raw===unlimitedTerm;
          const value=max?num(key,label,isUnlimited?"":raw,max):
            field(key,label,{required:false,maxLength:120,value:isUnlimited?"":raw||""});
          const toggle=field("unlimited_"+key,"SINIRSIZ",{type:"checkbox",required:false,checked:isUnlimited});
          const choice=toggle.querySelector("input");
          const input=value.querySelector("input");
          const sync=()=>{input.disabled=choice.checked;};
          choice.addEventListener("change",sync);sync();
          box.append(value,toggle);return box;
        });
        const form=makeForm([
          field("name","Paket adı",{value:plan.name,maxLength:80}),
          field("description","Kısa açıklama",{value:plan.description,maxLength:360}),
          field("published","Satış sitesinde göster",{type:"checkbox",required:false,checked:Boolean(plan.published)}),
          num("monthly","Aylık fiyat (kuruş)",plan.monthly,100000000000),num("yearly","Yıllık fiyat (kuruş)",plan.yearly,100000000000),
          select("vat","KDV durumu",options,plan.vat),
          field("card_link","Bir yıllık iyzico ödeme bağlantısı",{type:"url",value:plan.card_link||"",maxLength:1024,required:false}),
          ...limits,
        ],"Paketi kaydet",data=>{
          const numberOrNull=value=>value===""?null:Number(value);
          const terms=Object.fromEntries(saasTerms.map(([key,,max])=>[key,data["unlimited_"+key]==="on"?unlimitedTerm:max?numberOrNull(data[key]):data[key]]));
          return apply("plans",{id:plan.id,version:plan.version,name:data.name,description:data.description,published:data.published==="on",
            monthly:numberOrNull(data.monthly),yearly:numberOrNull(data.yearly),vat:data.vat,card_link:data.card_link,terms});
        });
        detail.append(form);
      } else {
        const money=value=>value===null?"Teklif":new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
        detail.append(el("p","Aylık "+money(plan.monthly)+" · Yıllık "+money(plan.yearly)));
        const list=el("ul");
        for (const [key,label] of saasTerms) if (Object.hasOwn(plan.terms,key)) list.append(el("li",label+" · "+termValue(plan.terms[key])));
        detail.append(list);
      }
      card.append(detail);
    }
    area.append(card);
    return;
  }
  const id=params.get("lead");
  const stage=params.get("stage")||"new", page=params.get("page")||"1";
  const filterValues={stage,page,kind:params.get("kind")||"demo",q:params.get("q")||"",program:params.get("program")||""};
  const dateOnly=value=>value?new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeZone:"Europe/Istanbul"}).format(new Date(value+"T12:00:00Z")):"—";
  const stages=Object.entries(saasStages);
  if (id) {
    const {lead,events,mail}=await call("applications/"+encodeURIComponent(id));
    const card=section(lead.clinic,saasKinds[lead.kind]+" · "+saasStages[lead.stage]+" · "+shownDate(lead.created_at));
    card.append(link("Başvuru listesine dön",href(filterValues)),
      tablePage(["Bilgi","Değer"],[
        ["Ad soyad",lead.name],["E-posta",lead.email],["Telefon",lead.phone||"—"],["Mesaj",lead.message||"—"],
        ["Kullanılan hasta takip programı",lead.current_program||"Belirtilmedi"],["Demo bitişi",dateOnly(lead.demo_end)],
        ["Paket",lead.plan||"—"],["Dönem",lead.billing==="yearly"?"Yıllık":"Aylık"],["Takip numarası",lead.id],
      ]));
    if (write) card.append(makeForm([
      select("stage","Görüşme durumu",stages,lead.stage),field("note","İç görüşme notu",{required:false,maxLength:1200}),
    ],"Durumu ve notu kaydet",data=>apply("applications/"+encodeURIComponent(id),{...data,version:lead.version})));
    if (mayAssign && lead.kind==="trial" && lead.stage==="qualified") {
      const options=await call("subscriptions");
      const plans=options.plans.filter(row=>row.trial>0);
      const trial=section("Denemeyi etkinleştir","Başvuru telefonu, etkin bayi yöneticisinin doğrulanmış telefonuyla eşleşmelidir. Süre seçilen paketten alınır.");
      if (options.partners.length&&plans.length) {
        trial.append(makeForm([
          select("partner","Doğrulanmış bayi", [["","Seçin"],...options.partners.map(row=>[row.id,row.name])],""),
          select("plan","Paket ve deneme süresi",plans.map(row=>[row.id,row.name+" · "+(row.trial===unlimitedTerm?"SINIRSIZ":row.trial+" gün")]),plans.find(row=>row.id===lead.plan_id)?.id||plans[0].id),
        ],"Deneme dönemini başlat",values=>apply("applications/"+encodeURIComponent(id)+"/trial",{...values,version:lead.version})));
      } else trial.append(el("p","Bir etkin bayi ve deneme süresi tanımlanmış yayındaki paket gerekli."));
      card.append(trial);
    }
    if (mayAssign && ["demo","trial"].includes(lead.kind) && lead.stage==="won" && !lead.trial_partner) {
      const demo=section("Demoyu aç ve yetkilendir","Telefon, kullanıcı adı olur. Yeni hesabın şifre oluşturma bağlantısı onay e-postasında yer alır. Demo süresi paketten alınır. Paket süresi belirtilmemişse 14 gün kullanılır.");
      const options=await call("subscriptions");
      if (options.plans.length&&lead.phone) {
        demo.append(makeForm([
          select("plan","Demo paketi",options.plans.map(row=>[row.id,row.name+" · "+(row.trial===unlimitedTerm?"SINIRSIZ":(row.trial||14)+" gün")]),lead.plan_id||options.plans[0].id),
          field("verified","Başvuru sahibinin telefonunu ve demo hesabı açma yetkisini doğruladım",{type:"checkbox",required:true}),
        ],"Demoyu aç ve yetkilendir",async values=>{
          await apply("applications/"+encodeURIComponent(id)+"/demo",{...values,verified:values.verified==="on",version:lead.version});
        }));
      } else demo.append(el("p","Başvuruda telefon ve yayında bir paket gerekli."));
      card.append(demo);
    }
    if (lead.trial_partner) card.append(link("Etkinleştirilen bayi dönemini aç","/yonetim?"+new URLSearchParams({tab:"abonelikler",partner:lead.trial_partner})));
    const history=section("Başvuru geçmişi");
    history.append(tablePage(["Zaman","İşlem","İç not"],events.map(row=>[
      shownDate(row.created_at),({submitted:"Form kaydedildi",trial_started:"Deneme başlatıldı",demo_provisioned:"Demo bayi açıldı",demo_upgraded:"Ücretli bayiye geçildi"})[row.action]||saasStages[row.action],row.note||"—",
    ])));
    area.append(card);
    if (mail.length) {
      const notices=section("E-posta gönderimleri","Gönderim sonucunu kontrol edin. Başarısız bildirimleri yeniden deneyebilirsiniz.");
      const messages={received:"Müşteriye başvuru alındı",admin:"Yöneticiye yeni başvuru",approved:"Müşteriye demo onayı"};
      const states={pending:"Kuyrukta",sending:"Gönderiliyor",accepted:"Sağlayıcıya iletildi",failed:"Gönderim başarısız",
        unconfigured:"E-posta bağlantısı kapalı",no_address:"Alıcı adresi eksik",expired:"Şifre oluşturma bağlantısının süresi doldu"};
      notices.append(tablePage(["Bildirim","Gönderim durumu","Güncellendi"],mail.map(row=>[
        messages[row.event],states[row.status]||row.status,shownDate(row.updated_at),
      ])));
      if (write) for (const row of mail.filter(item=>!["accepted","sending","expired"].includes(item.status))) {
        const note=el("p","",{role:"status"});
        const button=el("button",messages[row.event]+" · Yeniden dene",{type:"button",className:"secondary"});
        button.addEventListener("click",async()=>{
          button.disabled=true;
          try {
            const result=await call("applications/"+encodeURIComponent(id)+"/mail",{event:row.event});
            note.textContent=states[result.status]||result.status;
            if (result.status==="accepted") {location.reload();return;}
          } catch(error) {note.textContent=error.message;}
          button.disabled=false;
        });
        notices.append(button,note);
      }
      if (mayAssign&&mail.some(row=>row.setup_pending)) {
        const output=el("div","",{className:"center-toolbar"});
        const button=el("button","Tek kullanımlık giriş bağlantısını göster",{type:"button",className:"secondary"});
        button.addEventListener("click",async()=>{
          button.disabled=true;
          try {
            const result=await call("applications/"+encodeURIComponent(id)+"/setup-link",{});
            const url=el("input","",{type:"text",value:result.link,readOnly:true,ariaLabel:"Tek kullanımlık giriş bağlantısı"});
            output.replaceChildren(url);
            url.focus();url.select();
            output.append(el("small","Bu bağlantıyı yalnızca kimliği doğrulanan başvuru sahibine iletin."));
          } catch(error) {output.textContent=error.message;}
          finally {button.disabled=false;}
        });
        notices.append(button,output);
      }
      area.append(notices);
    }
    area.append(history);
    return;
  }
  const data=await call("applications?"+new URLSearchParams(filterValues));
  const {report}=data;
  const overview=section("Demo performansı","Son 30 gün · Başvuru tarihi ve ilk ücretli aboneliğe geçiş tarihi ayrı ayrı sayılır.");
  const stats=el("div","",{className:"center-metrics"});
  for (const [label,value] of [["Yeni başvuru",report.status.new],["Aktif demo",report.status.active],
    ["30 günde başvuru",report.applications],["30 günde ücretliye geçiş",report.sales]]) {
    const metric=el("article","",{className:"center-metric"});
    metric.append(el("span",label,{className:"center-kicker"}),el("strong",String(value)));
    stats.append(metric);
  }
  const chart=el("div","",{className:"saas-chart"});
  const shortDate=new Intl.DateTimeFormat("tr-TR",{day:"numeric",month:"short",timeZone:"Europe/Istanbul"});
  chart.innerHTML=waveChart(report.trend.map(row=>[shortDate.format(new Date(row.day+"T12:00:00Z")),row.applications,row.sales]),
    [["Demo başvurusu","purple"],["Ücretli aboneliğe geçiş","teal"]],String,escapeChart,{label:"Başvuru ve ücretliye geçiş karşılaştırması"});
  overview.append(stats,chart);
  const card=section("Demo İstek-Değerlendirme",data.total+" eşleşen kayıt");
  const filter=el("form","",{method:"get",action:"/yonetim",className:"crm-filters"});
  filter.append(el("input","",{type:"hidden",name:"tab",value:tab}),
    field("q","Başvuru ara",{type:"search",value:data.q,required:false,maxLength:160,placeholder:"Klinik, program, e-posta, telefon"}),
    select("stage","Durum",[["all","Tümü"],...stages],data.stage),
    select("kind","Tür",[["demo","Demo"],["contact","İletişim"],["all","Tümü"]],data.kind));
  const programs=[["","Tüm programlar"],...data.programs.map(row=>[row.name,row.name+" · "+row.count])];
  if (data.program&&!programs.some(([value])=>value===data.program)) programs.push([data.program,data.program]);
  filter.append(select("program","Kullanılan program",programs,data.program),el("button","Filtrele",{type:"submit"}));
  card.append(filter,tablePage(["Klinik / başvuran","Tür","Kullanılan program","Durum","Başvuru tarihi","Demo bitişi"],data.rows.map(row=>{
    const person=el("div");
    person.append(link(row.clinic,href({...filterValues,lead:row.id})),el("small",row.name,{className:"crm-applicant"}));
    return [person,saasKinds[row.kind],row.current_program||"—",saasStages[row.stage],shownDate(row.created_at),dateOnly(row.demo_end)];
  })));
  const pages=el("nav","",{className:"center-toolbar",ariaLabel:"Başvuru sayfaları"});
  if (data.page>1) pages.append(link("← Önceki",href({...filterValues,page:data.page-1})));
  pages.append(el("span",data.page+" / "+Math.max(1,Math.ceil(data.total/25))));
  if (data.page*25<data.total) pages.append(link("Sonraki →",href({...filterValues,page:data.page+1})));
  card.append(pages);
  area.append(overview,card);
}

export async function mountSaasOverview({area,el,section,metric,link,call,grants}) {
  const data=await call("overview");
  const number=value=>new Intl.NumberFormat("tr-TR").format(value);
  const stats=new Map(data.stages.map(row=>[row.stage,row.count]));
  const card=section("Satış performansı","Başvuru ve dönem kayıtlarından hesaplanır.");
  const metrics=el("div","",{className:"center-metrics"});
  metrics.append(metric("YENİ BAŞVURULAR",number(stats.get("new")||0)),
    metric("AKTİF DENEMELER",number(data.subscriptions.trials)),
    metric("AKTİF ÜCRETLİ BAYİLER",number(data.subscriptions.active-data.subscriptions.trials)));
  const chart=el("div","",{className:"saas-chart",role:"group",ariaLabel:"Son 30 günün günlük başvuru grafiği"});
  const graph=el("div");
  graph.innerHTML=waveChart(data.trend.map(row=>[row.day,row.count]),[["Başvurular","purple"]],number,escapeChart);
  const disclosure=el("details"), values=el("div","",{className:"saas-chart-values"});
  for (const row of data.trend) values.append(el("span",row.day+" · "+number(row.count)));
  disclosure.append(el("summary","Günlük değerleri göster"),values);
  chart.append(el("strong","Son 30 gün · Günlük başvurular"),graph,disclosure);
  const stages=el("div","",{className:"saas-stages"});
  stages.append(el("strong","Değerlendirme aşamalarına göre"));
  const stagePlot=el("div");
  stagePlot.innerHTML=waveChart(Object.entries(saasStages).map(([stage,label])=>[label,stats.get(stage)||0]),
    [["Başvuru","teal"]],number,escapeChart);
  stages.append(stagePlot);
  const links=el("div","",{className:"center-toolbar"});
  links.append(link("Demo İstek-Değerlendirme ekranını aç","/yonetim?tab=crm"));
  if (grants.partners) links.append(link("Bayi aboneliklerini aç","/yonetim?tab=abonelikler"));
  card.append(metrics,chart,stages,links);
  area.append(card);
}
