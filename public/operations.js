import {paginateTable} from "./paged.js";
import {waveChart} from "./wave-chart.js";
import {fileZone} from "./file-zone.js";
import {accessModules,permitted,clinicFetch} from "./access.js";

export async function operationApi(path,payload) {
  const response=await clinicFetch("/api/"+path,payload===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const result=await response.json();
  if (!response.ok) throw Error(result.error || "İşlem tamamlanamadı.");
  return result;
}

export function chartBars(entries,format,esc) {
  return waveChart(entries.slice(0,12),[["Değer","blue"]],format,esc);
}

export function chartTrend(points,format,esc,labels=["Gelir","Gider"]) {
  return waveChart(points,[[labels[0],"teal"],[labels[1],"coral"]],format,esc);
}

const options=values=>values.map(value=>`<option>${value}</option>`).join("");
const supportTime=new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",dateStyle:"medium",timeStyle:"short"});
const timeLabel=value=>value&&Number.isFinite(Date.parse(value))?supportTime.format(new Date(value)):"—";
const photoPicker=fileZone({name:"photo",label:"Destek fotoğrafı ekle"});
const escapeForm = '<button class="button primary" type="submit">Gönder</button><p class="operation-error" role="alert"></p>';

export async function mountSupport(root,id,{actor,branch,esc,photo,toast}) {
  try {
    const writable=permitted(actor,"support",true);
    if (id && id!=="new") {
      const {ticket,replies,attachments}=await operationApi("support/"+encodeURIComponent(id));
      if (!root.isConnected) return;
      const replyAllowed=ticket.status==="Açık"&&writable;
      const meta=[
        ["Durum",ticket.status],["Son yanıt",timeLabel(replies.at(-1)?.created_at)],
        ["Departman",ticket.department],["Aciliyet",ticket.urgency],
      ];
      root.innerHTML=`<section class="panel operation-panel support-detail">
        <div class="support-back"><a class="button small" href="#bayi-destek">← Taleplerim</a></div>
        <header class="operation-heading"><div><div class="eyebrow">DESTEK KONUŞMASI</div><h1>${esc(ticket.subject)}</h1><p>${esc([ticket.partner_name,ticket.branch_name].filter(Boolean).join(" · "))}</p></div>
        ${replyAllowed?'<div class="suite-tabs"><button class="button" type="button" data-thread-close>Talebi kapat</button><button class="button primary" type="button" data-thread-reply>Yanıt yaz</button></div>':""}</header>
        <dl class="support-meta">${meta.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
        <div class="support-thread-title"><h2>Konuşma geçmişi</h2><span class="suite-pill">${replies.length} ileti</span></div>
        <div class="thread-list">${replies.map(row=>`<article class="thread-message ${row.side==="Yönetim"?"management":""}"><header><div><strong>${esc(row.author)}</strong> <span class="suite-pill">${esc(row.side)}</span></div><time datetime="${esc(row.created_at)}">${esc(timeLabel(row.created_at))}</time></header><p>${esc(row.body)}</p>${row.has_photo?`<button type="button" class="button small" data-thread-photo="${esc(row.id)}">Eki görüntüle</button>`:""}</article>`).join("")}</div>
        ${replyAllowed?`<form class="operation-form support-reply"><label class="form-field"><span>Yanıtınız</span><textarea name="body" maxlength="5000" rows="4" placeholder="Talebe eklemek istediğiniz bilgileri yazın…"></textarea></label>${attachments===false?'':photoPicker}<div class="actions">${escapeForm}</div></form>`:""}</section>`;
      root.addEventListener("click",async event=>{
        const button=event.target.closest("button");
        if (button?.dataset.threadPhoto) {
          try {
            const result=await operationApi("support/"+encodeURIComponent(id)+"?photo="+encodeURIComponent(button.dataset.threadPhoto));
            const image=document.createElement("img");
            image.alt="Talebe eklenen fotoğraf";image.className="attachment-preview";image.src=result.photo;
            button.replaceWith(image);
          } catch(error) { toast(error.message); }
        } else if (button?.hasAttribute("data-thread-reply")) {
          root.querySelector("textarea")?.focus();
        } else if (button?.hasAttribute("data-thread-close")) {
          if (!window.confirm("Bu destek talebi çözüldü olarak kapatılsın mı?")) return;
          button.disabled=true;
          try { await operationApi("support/"+encodeURIComponent(id),{action:"close"});toast("Konuşma kapatıldı.");await mountSupport(root,id,{actor,branch,esc,photo,toast}); }
          catch(error) { toast(error.message);button.disabled=false; }
        }
      },{signal:replaceSignal(root)});
      bindOperation(root,"support/"+encodeURIComponent(id),photo,async()=>mountSupport(root,id,{actor,branch,esc,photo,toast}));
      return;
    }
    const {tickets,branches,owner,attachments}=await operationApi("support");
    if (!root.isConnected) return;
    if (id==="new" && !owner && writable) {
      root.innerHTML=`<section class="panel operation-panel"><a class="button small" href="#bayi-destek">← Taleplere dön</a><h1>Yeni destek talebi</h1>
        <form class="operation-form"><div class="operation-fields">
        <label class="form-field"><span>Şube</span><select name="branch" required>${branches.map(item=>`<option value="${esc(item.id)}" ${item.id===branch?"selected":""}>${esc(item.name)}</option>`).join("")}</select></label>
        <label class="form-field"><span>Departman</span><select name="department">${options(["Muhasebe","Satış","Destek / Yazılım"])}</select></label>
        <label class="form-field"><span>Aciliyet</span><select name="urgency">${options(["Düşük","Orta","Yüksek"])}</select></label></div>
        <label class="form-field"><span>Konu başlığı</span><input name="subject" maxlength="160" required></label>
        <label class="form-field"><span>Sorunu açıklayın</span><textarea name="body" maxlength="5000" required rows="5"></textarea></label>
        ${attachments===false?'':photoPicker}<div class="actions">${escapeForm}</div></form></section>`;
      bindOperation(root,"support",photo,result=>{location.hash="bayi-destek/"+result.id;});
      return;
    }
    const counts=[["Toplam",tickets.length],["Açık",tickets.filter(ticket=>ticket.status==="Açık").length],["Çözüldü",tickets.filter(ticket=>ticket.status==="Çözüldü").length]];
    root.innerHTML=`<section class="panel operation-panel support-list"><header class="operation-heading"><div><div class="eyebrow">KLİNİK DESTEK</div><h1>${owner?"Bayi Destek Merkezi":"Destek Talepleri"}</h1><p>Destek taleplerini takip edin ve yanıt geçmişini görüntüleyin.</p></div>${!owner&&writable?'<a class="button primary" href="#bayi-destek/new">+ Yeni destek talebi</a>':""}</header>
      <div class="suite-metrics">${counts.map(([label,count])=>`<button type="button" class="panel suite-metric" data-support-status="${label==="Toplam"?"":label}" aria-pressed="false"><strong>${count}</strong><span>${label}</span></button>`).join("")}</div>
      <div class="operation-fields support-filters">
      <label class="form-field"><span>Talep ara</span><input type="search" data-ticket-search placeholder="Konu, kişi veya şube"></label>
      <label class="form-field"><span>Departman</span><select data-ticket-filter="department"><option value="">Tümü</option>${options(["Muhasebe","Satış","Destek / Yazılım"])}</select></label>
      <label class="form-field"><span>Durum</span><select data-ticket-filter="status"><option value="">Tümü</option>${options(["Açık","Çözüldü"])}</select></label>
      <label class="form-field"><span>Aciliyet</span><select data-ticket-filter="urgency"><option value="">Tümü</option>${options(["Düşük","Orta","Yüksek"])}</select></label>
      <label class="form-field"><span>Sıralama</span><select data-ticket-order><option value="new">Son yanıt · yeni</option><option value="old">Son yanıt · eski</option><option value="urgent">Önce açık ve acil</option><option value="subject">Konu · A–Z</option></select></label></div>
      <div class="ticket-list" aria-live="polite"></div></section>`;
    const draw=()=>{
      const filters=[...root.querySelectorAll("[data-ticket-filter]")];
      const term=root.querySelector("[data-ticket-search]").value.trim().toLocaleLowerCase("tr-TR");
      const order=root.querySelector("[data-ticket-order]").value;
      const chosen=filters.find(filter=>filter.dataset.ticketFilter==="status").value;
      root.querySelectorAll("[data-support-status]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.supportStatus===chosen)));
      const priority={Yüksek:3,Orta:2,Düşük:1};
      const last=ticket=>ticket.last_reply_at||ticket.created_at;
      const newest=(a,b)=>String(last(b)).localeCompare(String(last(a)));
      const shown=tickets.filter(ticket=>filters.every(filter=>!filter.value || ticket[filter.dataset.ticketFilter]===filter.value)&&
        (!term||[ticket.subject,ticket.author,ticket.branch_name,ticket.partner_name].some(value=>String(value||"").toLocaleLowerCase("tr-TR").includes(term))));
      shown.sort((a,b)=>order==="old"?newest(b,a):order==="subject"?a.subject.localeCompare(b.subject,"tr"):
        order==="urgent"?(Number(b.status==="Açık")-Number(a.status==="Açık")||(priority[b.urgency]||0)-(priority[a.urgency]||0)||newest(a,b)):newest(a,b));
      const list=root.querySelector(".ticket-list");
      list.innerHTML=shown.length?`<div class="suite-table"><table><thead><tr><th scope="col">Konu / Departman</th><th scope="col">Son yanıt</th><th scope="col">Durum</th><th scope="col">İşlemler</th></tr></thead><tbody>
        ${shown.map(ticket=>`<tr><td><strong>${esc(ticket.subject)}</strong><small>${esc([ticket.department,ticket.branch_name].filter(Boolean).join(" · "))}</small></td>
          <td><time datetime="${esc(last(ticket))}">${esc(timeLabel(last(ticket)))}</time><small>${esc(ticket.reply_count||0)} ileti</small></td>
          <td><span class="suite-pill" data-state="${ticket.status==="Açık"?"open":"resolved"}">${esc(ticket.status)}</span><small>${esc(ticket.urgency)} öncelik</small></td>
          <td><a class="button small ${ticket.status==="Açık"&&writable?"primary":""}" href="#bayi-destek/${esc(ticket.id)}">${ticket.status==="Açık"&&writable?"Aç ve yanıtla":"Görüntüle"}</a></td></tr>`).join("")}</tbody></table></div>`:"<p class='chart-empty'>Bu seçimde destek talebi bulunamadı.</p>";
      if (shown.length) paginateTable(list.querySelector("table"),15);
    };
    const signal=replaceSignal(root);
    root.querySelector(".support-filters").addEventListener("input",draw,{signal});
    root.querySelector(".suite-metrics").addEventListener("click",event=>{
      const button=event.target.closest("[data-support-status]");
      if (!button) return;
      root.querySelector('[data-ticket-filter="status"]').value=button.dataset.supportStatus;
      draw();
    },{signal});
    draw();
  } catch(error) { if(root.isConnected) root.innerHTML=`<p class="callout warning">${esc(error.message)}</p>`; }
}

const signals=new WeakMap();
function replaceSignal(root) {
  signals.get(root)?.abort();
  const controller=new AbortController();
  signals.set(root,controller);
  return controller.signal;
}
function bindOperation(root,path,photo,onSuccess) {
  const form=root.querySelector("form");
  if (!form) return;
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled=true;
    const errorNode=form.querySelector(".operation-error");
    errorNode.textContent="";
    try {
      const values=Object.fromEntries(new FormData(form));
      values.photo=values.photo?.size?await photo(values.photo):"";
      const result=await operationApi(path,values);
      await onSuccess(result);
    } catch(error) { errorNode.textContent=error.message; }
    finally { submit.disabled=false; }
  });
}

export async function mountStaff(root,{esc,toast}) {
  try {
    const {users,branches}=await operationApi("staff");
    if (!root.isConnected) return;
    const render=user=>{
      root.innerHTML=`<section class="panel operation-panel"><header class="operation-heading"><div><h1>Şube ve kullanıcı yetkileri</h1><p>Kullanıcının görebileceği şubeleri ve modülleri seçin.</p></div><button class="button" type="button" data-staff="">+ Yeni ekip üyesi</button></header>
      <div class="staff-list">${users.map(item=>`<button class="button" type="button" data-staff="${esc(item.email)}">${esc(item.name)} · ${item.active?"Aktif":"Pasif"}</button>`).join("")}</div>
      <form class="operation-form"><div class="operation-fields">
      <label class="form-field"><span>Ad soyad</span><input name="name" value="${esc(user?.name)}" required maxlength="160"></label>
      <label class="form-field"><span>ChatGPT hesap e-postası</span><input name="email" type="email" value="${esc(user?.email)}" ${user?"readonly":""} required></label>
      <label class="check-field"><input type="checkbox" name="active" ${!user||user.active?"checked":""}> Hesap aktif</label></div>
      <fieldset class="staff-branches"><legend>İzin verilen şubeler</legend>${branches.map(item=>`<label class="check-field"><input type="checkbox" name="branches" value="${esc(item.id)}" ${user?.branches.includes(item.id)?"checked":""}> ${esc(item.name)}</label>`).join("")}</fieldset>
      <div class="operation-fields">${Object.entries(accessModules).map(([key,[label]])=>`<label class="form-field"><span>${esc(label)}</span><select name="module-${key}"><option value="">Kapalı</option><option value="read" ${user?.modules[key]==="read"?"selected":""}>Görüntüleme</option><option value="write" ${user?.modules[key]==="write"?"selected":""}>Görüntüleme ve düzenleme</option></select></label>`).join("")}</div>
      <div class="actions"><button class="button primary" type="submit">Yetkileri kaydet</button><p class="operation-error" role="alert"></p></div></form></section>`;
      root.querySelectorAll("[data-staff]").forEach(button=>button.addEventListener("click",()=>render(users.find(item=>item.email===button.dataset.staff))));
      const form=root.querySelector("form");
      form.addEventListener("submit",async event=>{
        event.preventDefault();
        const submit=event.submitter;
        submit.disabled=true;
        try {
          const data=new FormData(form);
          await operationApi("staff",{name:data.get("name"),email:data.get("email"),active:data.has("active"),branches:data.getAll("branches"),
            modules:Object.fromEntries([...data].filter(([key,value])=>key.startsWith("module-")&&value).map(([key,value])=>[key.slice(7),value]))});
          toast("Yetkiler kaydedildi.");
          await mountStaff(root,{esc,toast});
        } catch(error) { form.querySelector(".operation-error").textContent=error.message; }
        finally { submit.disabled=false; }
      });
    };
    render(null);
  } catch(error) { if(root.isConnected) root.innerHTML=`<p class="callout warning">${esc(error.message)}</p>`; }
}
