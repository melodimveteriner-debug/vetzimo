const MAX_STOPS=25;
const loadOptions=async(kind,id,target,signal)=>{
  target.replaceChildren(new Option("Seçin",""));
  if(!id)return;
  const response=await fetch("/api/evde-hizmet/konum?"+new URLSearchParams({kind,parent:id}),{signal});
  if(!response.ok)throw Error("Adres seçenekleri yüklenemedi.");
  const {items}=await response.json();
  if(!signal?.aborted)for(const [value,name] of items)target.add(new Option(name,value));
};
for(const form of document.querySelectorAll("form.visit-form")){
  const {province,district,neighborhood}=form.elements;
  if(!province||!district||!neighborhood)continue;
  const feedback=form.querySelector("[data-location-feedback]");
  let districts,neighborhoods;
  province.addEventListener("change",async()=>{
    districts?.abort();
    neighborhoods?.abort();
    districts=new AbortController();
    const {signal}=districts;
    feedback.textContent="";
    neighborhood.replaceChildren(new Option("Seçin",""));
    try{await loadOptions("districts",province.value,district,signal);}
    catch(error){if(!signal.aborted)feedback.textContent=error.message;}
  });
  district.addEventListener("change",async()=>{
    neighborhoods?.abort();
    neighborhoods=new AbortController();
    const {signal}=neighborhoods;
    feedback.textContent="";
    try{await loadOptions("neighborhoods",district.value,neighborhood,signal);}
    catch(error){if(!signal.aborted)feedback.textContent=error.message;}
  });
}
for(const picker of document.querySelectorAll("[data-region-picker]")){
  const province=picker.querySelector("[name=region_province]");
  const district=picker.querySelector("[name=region_district]");
  const value=picker.querySelector("[data-region-value]");
  const list=picker.querySelector("[data-region-list]");
  const feedback=picker.querySelector("[data-region-feedback]");
  let loading;
  const sync=()=>{
    value.value=Array.from(list.querySelectorAll("[data-region-remove]"),button=>button.dataset.regionRemove).join("\n");
  };
  picker.querySelector("[data-region-controls]").hidden=false;
  const entire=picker.querySelector("[data-add-province]");
  district.disabled=true;
  province.addEventListener("change",async()=>{
    loading?.abort();
    loading=new AbortController();
    const {signal}=loading;
    district.disabled=true;
    if (entire) entire.disabled=true;
    feedback.textContent="";
    try{
      await loadOptions("districts",province.value,district,signal);
      if(!signal.aborted){district.disabled=!province.value;if(entire) entire.disabled=!province.value||district.options.length<2;}
    }catch{
      if(!signal.aborted)feedback.textContent="İlçeler yüklenemedi. İli yeniden seçin.";
    }
  });
  const addDistrict=()=>{
    if(!province.value||!district.value)return;
    const code=province.value+":"+district.value;
    const label=province.selectedOptions[0].text+" / "+district.selectedOptions[0].text;
    district.value="";
    if(Array.from(list.querySelectorAll("[data-region-remove]")).some(button=>button.dataset.regionRemove===code)){
      feedback.textContent=label+" zaten seçili.";
      return;
    }
    const item=document.createElement("li");
    const name=document.createElement("span");
    name.textContent=label;
    const remove=document.createElement("button");
    remove.type="button";
    remove.dataset.regionRemove=code;
    remove.setAttribute("aria-label",label+" kaldır");
    remove.textContent="×";
    item.append(name,remove);
    list.append(item);
    sync();
    feedback.textContent=label+" eklendi.";
  };
  district.addEventListener("change",addDistrict);
  entire?.addEventListener("click",()=>{
    for(const option of Array.from(district.options).slice(1)){
      district.value=option.value;
      addDistrict();
    }
    feedback.textContent=province.selectedOptions[0].text+" ilçeleri listeye eklendi.";
  });
  list.addEventListener("click",event=>{
    const button=event.target.closest("[data-region-remove]");
    if(!button)return;
    const item=button.closest("li");
    const next=(item.nextElementSibling||item.previousElementSibling)?.querySelector("button");
    feedback.textContent=item.querySelector("span").textContent+" kaldırıldı.";
    item.remove();
    sync();
    (next||province).focus();
  });
}
for(const button of document.querySelectorAll("[data-locate]")){
  button.addEventListener("click",()=>{
    const root=button.closest("[data-itinerary],form");
    const status=button.closest("details")?.querySelector("[data-location-feedback]")||root.querySelector("[data-location-feedback]");
    if(!navigator.geolocation){status.textContent="Konumu elle girebilirsiniz.";return;}
    navigator.geolocation.getCurrentPosition(({coords})=>{
      root.querySelector("[name=latitude]").value=coords.latitude.toFixed(5);
      const longitude=root.querySelector("[name=longitude]");
      longitude.value=coords.longitude.toFixed(5);
      longitude.dispatchEvent(new Event("change",{bubbles:true}));
      status.textContent=root.matches("[data-itinerary]")?"Başlangıç konumu alındı.":"Konum alındı. Yazılı adresi ayrıca kontrol edin.";
    },()=>{status.textContent="Konum alınamadı. Başlangıç noktasını veya koordinatları elle girebilirsiniz.";},{timeout:8000,maximumAge:0});
  });
}
for(const button of document.querySelectorAll("[data-copy]")){
  button.addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(button.parentElement.querySelector("[data-copy-value]").textContent);
      button.textContent="Kopyalandı";
    }catch{button.textContent="IBAN’ı seçip kopyalayın";}
  });
}
const board=document.querySelector("[data-itinerary]");
if (board) {
  const all=JSON.parse(board.dataset.stops);
  const list=board.querySelector("[data-route-list]");
  const feedback=board.querySelector("[data-route-feedback]");
  const figure=board.querySelector("[data-road-figure]");
  const canvas=board.querySelector("[data-road-map]");
  const planButton=board.querySelector("[data-plan]");
  const val=name=>board.querySelector("[name="+name+"]").value.trim();
  const clean=value=>String(value??"").toLocaleLowerCase("tr");
  const km=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:1});
  const drive=seconds=>Math.round(seconds/60)+" dk";
  let stops=[],matrix=null,roadPlan=null,worker=null,active=0,nextRequest=0;
  function origin() {
    const rawLat=val("latitude").replace(",",".");
    const rawLon=val("longitude").replace(",",".");
    if (!rawLat||!rawLon) return null;
    const lat=Number(rawLat),lon=Number(rawLon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon}:null;
  }
  function link(label,url) {
    const anchor=document.createElement("a");
    anchor.textContent=label;
    anchor.href=url;
    return anchor;
  }
  function drawRoadMap() {
    figure.hidden=!roadPlan?.positions.length;
    if (figure.hidden) return;
    const {positions,roadLines,snaps,date}=roadPlan;
    board.querySelector("[data-road-date]").textContent="Yol verisi: "+date;
    const width=canvas.clientWidth,height=canvas.clientHeight,ratio=Math.min(window.devicePixelRatio||1,2);
    if (!width||!height) return;
    canvas.width=width*ratio;
    canvas.height=height*ratio;
    const ctx=canvas.getContext("2d");
    ctx.scale(ratio,ratio);
    ctx.fillStyle="#eff5f6";
    ctx.fillRect(0,0,width,height);
    let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity;
    for (const [lat,lon] of positions) {
      minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);
      minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);
    }
    const lonFactor=Math.cos((minLat+maxLat)/2000000*Math.PI/180);
    const scale=Math.min((height-76)/Math.max(1200,maxLat-minLat),(width-76)/Math.max(1200,(maxLon-minLon)*lonFactor));
    const project=(lat,lon)=>[width/2+(lon-(minLon+maxLon)/2)*lonFactor*scale,height/2-(lat-(minLat+maxLat)/2)*scale];
    for (const priority of [0,1]) {
      ctx.beginPath();
      for(const [la,lo,lb,lp,major] of roadLines) {
        if (priority!==major) continue;
        ctx.moveTo(...project(la,lo));
        ctx.lineTo(...project(lb,lp));
      }
      ctx.strokeStyle=priority?"#a7bdc7":"#c8d7dc";
      ctx.lineWidth=priority?1.65:1;
      ctx.stroke();
    }
    ctx.lineJoin=ctx.lineCap="round";
    for (const [color,size] of [["#fff",8],["#006b68",4.5]]) {
      ctx.beginPath();
      stops.forEach((stop,i)=>{
        const path=matrix[i===0?0:stops[i-1].index+1][stop.index]?.path;
        path?.forEach((point,j)=>{
          const xy=project(...positions[point]);
          if (j===0) ctx.moveTo(...xy);
          else ctx.lineTo(...xy);
        });
      });
      ctx.strokeStyle=color;
      ctx.lineWidth=size;
      ctx.stroke();
    }
    const numbered=[{point:snaps[0],label:"B"},...stops.map((stop,i)=>({point:snaps[stop.index+1],label:String(i+1)}))];
    const groups=new Map();
    for (const {point,label} of numbered) {
      if (!point) continue;
      const key=String(point);
      if (!groups.has(key)) groups.set(key,{point,labels:[]});
      groups.get(key).labels.push(label);
    }
    ctx.font="700 13px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    for (const {point,labels} of groups.values()) {
      const [x,y]=project(...point),label=labels.length<=2?labels.join("·"):labels[0]+"+";
      ctx.beginPath();
      ctx.arc(x,y,14,0,Math.PI*2);
      ctx.fillStyle="#165360";
      ctx.fill();
      ctx.strokeStyle="#fff";
      ctx.lineWidth=2;
      ctx.stroke();
      ctx.fillStyle="#fff";
      ctx.fillText(label,x,y);
    }
  }
  window.addEventListener("resize",drawRoadMap);
  function render(message="") {
    list.replaceChildren();
    const start=origin();
    const hasPlan=matrix!==null;
    const legs=hasPlan?stops.map((stop,i)=>matrix[i===0?0:stops[i-1].index+1][stop.index]):[];
    const complete=hasPlan&&legs.every(Boolean);
    if (complete) {
      const totals=legs.reduce((sum,leg)=>[sum[0]+leg.meters,sum[1]+leg.seconds],[0,0]);
      feedback.textContent=stops.length+" durak · "+km.format(totals[0]/1000)+" km araç yolu · Yaklaşık "+drive(totals[1]);
      const tight=stops.some((stop,i)=>{
        const previous=stops[i-1];
        if (!previous?.end||!stop.end) return false;
        return Date.parse(previous.day+"T"+previous.end+"+03:00")+legs[i].seconds*1000>Date.parse(stop.day+"T"+stop.time+"+03:00");
      });
      if (tight) feedback.textContent+=" · Bazı planlı randevu saatleri bu yol sırasına uymuyor.";
    } else if (hasPlan) {
      feedback.textContent="Bazı yol etapları alınamadı. Eksik etapların mesafesi ve toplam gösterilmiyor.";
    } else {
      feedback.textContent=message||(stops.length?stops.length+" ziyaret bulundu. "+(!start?"Rota için başlangıç konumunu seçin.":"Yol planını oluşturabilirsiniz."):"Bu filtrelere uyan konumlu ziyaret bulunamadı.");
    }
    const reorder=(from,to)=>{
      const [item]=stops.splice(from,1);
      stops.splice(to,0,item);
      render();
      list.children[to]?.querySelector("button:not(:disabled)")?.focus();
    };
    stops.forEach((stop,i)=>{
      const row=document.createElement("li");
      const title=link(stop.name+" · "+stop.label,"?talep="+encodeURIComponent(stop.id));
      const details=document.createElement("p");
      details.textContent=[stop.day,stop.time,stop.district,stop.neighborhood,stop.address].filter(Boolean).join(" · ");
      row.append(title,details);
      if (hasPlan) {
        const leg=document.createElement("p");
        leg.className="road-leg";
        leg.textContent=(i===0?"Başlangıçtan: ":"Önceki duraktan: ")+(legs[i]?km.format(legs[i].meters/1000)+" km · "+drive(legs[i].seconds):"Yol bulunamadı. Durak konumunu ve kapsama alanını kontrol edin.");
        row.append(leg);
      }
      const actions=document.createElement("div");
      actions.className="vis-actions";
      if (stop.phone) actions.append(link(stop.phone,"tel:"+stop.phone));
      if (hasPlan) {
        const query=new URLSearchParams({api:"1",destination:stop.lat+","+stop.lon,travelmode:"driving",dir_action:"navigate"});
        const maps=link("Durak "+(i+1)+" · Google Haritalar","https://www.google.com/maps/dir/?"+query);
        maps.target="_blank";
        maps.rel="noopener noreferrer";
        maps.className="visit-link";
        actions.append(maps);
        for(const [label,url] of [["Apple Haritalar","https://maps.apple.com/?daddr="+stop.lat+","+stop.lon+"&dirflg=d"],["Yandex","https://yandex.com.tr/maps/?rtext=~"+stop.lat+","+stop.lon+"&rtt=auto"]]){
          const a=link(label,url);a.target="_blank";a.rel="noopener noreferrer";a.className="visit-link visit-link-alt";actions.append(a);
        }
      }
      if (hasPlan) for(const [delta,label] of [[-1,"Yukarı"],[1,"Aşağı"]]) {
        const button=document.createElement("button");
        button.type="button";
        button.textContent=label;
        button.disabled=i+delta<0||i+delta>=stops.length;
        button.addEventListener("click",()=>reorder(i,i+delta));
        actions.append(button);
      }
      row.append(actions);
      list.append(row);
    });
    drawRoadMap();
    planButton.disabled=!start||!stops.length||stops.length>MAX_STOPS||Boolean(active);
    if (!message&&stops.length>MAX_STOPS) feedback.textContent=stops.length+" ziyaret bulundu. Rota için filtrelerle listeyi "+MAX_STOPS+" veya daha az durağa indirin.";
    if (complete) list.after(routeTools(start));
    else board.querySelector("[data-route-tools]")?.remove();
  }
  function reset() {
    active=0;
    matrix=null;
    roadPlan=null;
    const status=val("status")||"open";
    const closed=["completed","closed","cancelled","unavailable"];
    const mode=val("strategy")||"near";
    stops=all.filter(s=>(!val("province")||s.province===val("province"))&&(!val("day")||s.day===val("day"))&&(status==="all"||(status==="open"?!closed.includes(s.status):s.status===status))
      &&["branch","services","person"].every(k=>clean(s[k]).includes(clean(val(k))))
      &&["province","district","neighborhood"].some(k=>clean(s[k]).includes(clean(val("area")))))
      .sort((a,b)=>((mode==="district"||mode==="neighborhood")?a[mode].localeCompare(b[mode],"tr"):0)
        ||(a.day+a.time).localeCompare(b.day+b.time))
      .map((stop,index)=>({...stop,index}));
    render();
  }
  function closestOrder(roads,visits) {
    const remaining=[...visits], ordered=[];
    let source=0;
    while (remaining.length) {
      let closest=-1;
      for (let i=0;i<remaining.length;i++) {
        const leg=roads[source][remaining[i].index];
        if (leg&&(closest===-1||leg.meters<roads[source][remaining[closest].index].meters)) closest=i;
      }
      if (closest===-1) return [...ordered,...remaining];
      const [next]=remaining.splice(closest,1);
      ordered.push(next);
      source=next.index+1;
    }
    return ordered;
  }
  // 2-opt: en yakın komşu sırasındaki çapraz etapları ters çevirerek toplam sürüyü kısaltır (başlangıçtan açık yol).
  function twoOpt(roads,order) {
    const cost=list=>list.reduce((sum,stop,i)=>{const leg=roads[i===0?0:list[i-1].index+1][stop.index];return sum+(leg?leg.seconds:1e9)},0);
    let best=order.slice(),bestCost=cost(best),improved=true,rounds=0;
    while (improved&&rounds++<50) {
      improved=false;
      for (let i=0;i<best.length-1;i++) for (let k=i+1;k<best.length;k++) {
        const next=[...best.slice(0,i),...best.slice(i,k+1).reverse(),...best.slice(k+1)];
        const c=cost(next);
        if (c+1<bestCost) { best=next; bestCost=c; improved=true; }
      }
    }
    return best;
  }
  // Tüm rotayı haritada açma ve paylaşma (ücretsiz bağlantılar; Google en çok 9 ara durak kabul eder, rota parçalanır).
  function routeTools(start) {
    board.querySelector("[data-route-tools]")?.remove();
    const box=document.createElement("div");
    box.className="vis-route-tools";box.dataset.routeTools="";
    const points=stops.map(s=>s.lat+","+s.lon);
    const chunks=[];
    for (let i=0;i<points.length;i+=10) chunks.push(points.slice(i,i+10));
    chunks.forEach((chunk,n)=>{
      const from=n===0?start.lat+","+start.lon:points[n*10-1];
      const query=new URLSearchParams({api:"1",origin:from,destination:chunk.at(-1),travelmode:"driving"});
      if (chunk.length>1) query.set("waypoints",chunk.slice(0,-1).join("|"));
      const a=link(chunks.length>1?"Rota "+(n+1)+". bölüm · Google Haritalar":"Tüm rotayı Google Haritalar'da aç","https://www.google.com/maps/dir/?"+query);
      a.target="_blank";a.rel="noopener noreferrer";a.className="visit-link visit-link-main";box.append(a);
    });
    const text=()=>["Eve Hizmet rotası · "+stops.length+" durak",...stops.map((s,i)=>(i+1)+". "+[s.name,s.time,s.district,s.neighborhood,s.address].filter(Boolean).join(" · ")+"\nhttps://www.google.com/maps/dir/?api=1&destination="+s.lat+","+s.lon)].join("\n");
    const copy=document.createElement("button");copy.type="button";copy.textContent="Rota listesini kopyala";
    copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(text());copy.textContent="Kopyalandı";}catch{copy.textContent="Kopyalanamadı";}setTimeout(()=>{copy.textContent="Rota listesini kopyala"},2000)});
    const wa=link("WhatsApp ile paylaş","https://wa.me/?text="+encodeURIComponent(text()));wa.target="_blank";wa.rel="noopener noreferrer";wa.className="visit-link";
    box.append(copy,wa);
    return box;
  }
  function ensureWorker() {
    if (worker) return worker;
    worker=new Worker("/visit-road-worker.js?v=49");
    worker.addEventListener("message",({data})=>{
      if (data.request!==active) return;
      active=0;
      if (data.error) {
        worker.terminate();
        worker=null;
        render(data.error);
        return;
      }
      roadPlan=data;
      matrix=data.matrix;
      if (!val("strategy")||val("strategy")==="near") stops=twoOpt(matrix,closestOrder(matrix,stops));
      render();
    });
    worker.addEventListener("error",()=>{
      active=0;
      worker.terminate();
      worker=null;
      render("Rota hesaplama başlatılamadı. Sayfayı yenileyip tekrar deneyin.");
    });
    return worker;
  }
  planButton.addEventListener("click",()=>{
    const start=origin();
    if (!start||active||!stops.length||stops.length>MAX_STOPS) return;
    active=++nextRequest;
    matrix=null;
    roadPlan=null;
    render("Bölgenin yol ağı hazırlanıyor, ziyaret rotası hesaplanıyor…");
    try {
      ensureWorker().postMessage({request:active,points:[start,...stops.map(stop=>({lat:Number(stop.lat),lon:Number(stop.lon)}))]});
    } catch {
      active=0;
      render("Bu tarayıcı yol hesabını başlatamadı. Güncel bir tarayıcıyla yeniden deneyin.");
    }
  });
  board.addEventListener("change",reset);
  reset();
}

const quoteCurrency=new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"});
for(const summary of document.querySelectorAll("[data-quote-summary]")){
  const form=summary.closest("form");
  const extras=[...form.querySelectorAll('select[name^="extra_product["]')];
  const charges=[...form.querySelectorAll('input[name^="rates["],input[name="travel"],input[name="transfer"],input[name="extras"]')];
  const {discount,tax}=form.elements;
  const subtotalOutput=summary.querySelector("[data-quote-subtotal]");
  const totalOutput=summary.querySelector("[data-quote-total]");
  const hint=summary.querySelector("[data-quote-hint]");
  const toCents=field=>{
    const raw=field.value.trim().replace(",",".");
    if(!raw)return 0;
    if(!/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/.test(raw))return NaN;
    const [whole,fraction=""]=raw.split(".");
    const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
    return cents<=100000000?cents:NaN;
  };
  const recalculate=()=>{
    const additional=extras.reduce((sum,select,i)=>{
      if (!select.value) return sum;
      const quantity=Number(form.elements["extra_qty["+i+"]"].value);
      return Number.isInteger(quantity)&&quantity>0?sum+quantity*toCents(form.elements["extra_rate["+i+"]"]):NaN;
    },0);
    const subtotal=charges.reduce((sum,field)=>sum+toCents(field),additional);
    const deduction=toCents(discount);
    const total=subtotal-deduction+toCents(tax);
    subtotalOutput.textContent=Number.isFinite(subtotal)?quoteCurrency.format(subtotal/100):"—";
    totalOutput.textContent=Number.isFinite(total)?quoteCurrency.format(total/100):"—";
    hint.textContent=!Number.isFinite(total)?"Tutarları 250,50 biçiminde girin.":
      deduction>subtotal?"İndirim ara toplamı aşamaz.":total<=0?"Teklif toplamı sıfırdan büyük olmalıdır.":"";
  };
  form.addEventListener("input",recalculate);
  form.addEventListener("change",recalculate);
  recalculate();
}

for (const form of document.querySelectorAll("#ziyaret-plani form")) {
  const {clinician,assistant}=form.elements;
  const sync=()=>{
    if (assistant.value===clinician.value) assistant.value="";
    for (const option of assistant.options) option.disabled=option.value!==""&&option.value===clinician.value;
  };
  clinician.addEventListener("change",sync);
  sync();
}

if (document.documentElement.classList.contains("clinic-visit-panel") && window.parent!==window) {
  const path=location.pathname;
  const sendHeight=()=>{
    const height=document.querySelector("main").getBoundingClientRect().bottom+window.scrollY;
    window.parent.postMessage({type:"clinic-module-height",height},location.origin);
  };
  new ResizeObserver(sendHeight).observe(document.querySelector("main"));
  document.addEventListener("click",event=>{
    const anchor=event.target.closest("a[href]");
    if (!anchor || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url=new URL(anchor.href,location.href);
    if (url.origin!==location.origin) return;
    if (url.pathname===path && (url.search!==location.search || !url.hash)) {
      url.searchParams.set("panel","1");
      anchor.href=url.href;
    } else if (url.pathname!==path) anchor.target="_top";
  },true);
  document.addEventListener("submit",event=>{
    const form=event.target;
    const url=new URL(form.getAttribute("action")||location.href,location.href);
    if (url.origin!==location.origin || url.pathname!==path) return;
    if (form.method.toLowerCase()==="get") {
      if (!form.elements.panel) {
        const input=document.createElement("input");
        Object.assign(input,{type:"hidden",name:"panel",value:"1"});
        form.append(input);
      }
    } else {
      url.searchParams.set("panel","1");
      form.setAttribute("action",url.href);
    }
  },true);
}

const mailFeedback=document.querySelector("[data-mail-feedback]");
if (mailFeedback) {
  const queue=mailFeedback.closest("section");
  const pollInterval=5000;
  async function readMailState(url,options) {
    const response=await fetch(url,{...options,credentials:"same-origin",redirect:"error",
      headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Sunucu isteği tamamlayamadı. Sayfayı yenileyip tekrar deneyin.");
    }
    const result=await response.json();
    if (!response.ok) throw new Error(result.error||"Yeniden deneme başlatılamadı.");
    return result;
  }
  queue.addEventListener("submit",async event=>{
    const form=event.target;
    if (form.elements.action?.value!=="retry") return;
    event.preventDefault();
    const button=form.querySelector("button");
    if (button.disabled) return;
    const row=form.closest("tr");
    const state=row.querySelector("[data-mail-state]");
    const detail=row.querySelector("[data-mail-detail]");
    const body=new URLSearchParams(new FormData(form));
    const url=new URL(form.getAttribute("action")||location.href,location.href);
    url.searchParams.set("format","mail-status");
    const statusUrl=new URL(url);
    for (const key of ["source","job","audience"]) statusUrl.searchParams.set(key,body.get(key));
    button.disabled=true;
    button.textContent="Kontrol ediliyor…";
    mailFeedback.textContent="";
    try {
      let result=await readMailState(url,{method:"POST",body});
      if (result.state==="queued") {
        state.textContent="Sırada";
        detail.textContent="Gönderim sonucu bekleniyor.";
      }
      for (let count=0;result.state==="queued";count++) {
        if (count===36) detail.textContent="E-posta hâlâ gönderim kuyruğunda. Durum kontrolü sürüyor.";
        await new Promise(resolve=>setTimeout(resolve,count<36&&!document.hidden?pollInterval:30000));
        result=await readMailState(statusUrl,{cache:"no-store"});
      }
      if (result.state==="sent") {
        const focused=row.contains(document.activeElement);
        row.remove();
        mailFeedback.textContent="E-posta gönderildi ve bekleyenler listesinden kaldırıldı.";
        if (!queue.querySelector("tbody tr")) {
          queue.querySelector(".notification-table")?.remove();
          const empty=document.createElement("p");
          empty.className="notification-empty";
          empty.textContent="Bekleyen bildirim yok.";
          queue.append(empty);
        }
        if (focused) {
          mailFeedback.tabIndex=-1;
          mailFeedback.focus({preventScroll:true});
        }
      } else if (result.state==="failed") {
        state.textContent="Gönderilemedi";
        detail.textContent=result.message;
        mailFeedback.textContent="E-posta gönderilemedi. Bildirim listede duruyor.";
      } else throw new Error("Gönderim durumu okunamadı.");
    } catch (error) {
      mailFeedback.textContent=error instanceof TypeError||error.name==="TimeoutError"?
        "Gönderim sonucu alınamadı. Sayfayı yenileyip durumu kontrol edin.":error.message;
    } finally {
      button.disabled=false;
      button.textContent="Yeniden dene";
    }
  });
}
