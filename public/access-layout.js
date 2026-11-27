import {mountLanguageSelect,uiText,uiLabel} from "./ui-locale.js?v=20261123-r64";
import {defaultAppearance,paletteColor,sitePalettes,validPalette} from "./theme.js?v=2";

const themeKey="vetnet-access-theme";
const icons={
  arrow:'<path d="M5 19 19 5M9 5h10v10"/>',
  phone:'<path d="M7 3h3l2 5-2 2a14 14 0 0 0 4 4l2-2 5 2v3c0 2-2 3-4 3A17 17 0 0 1 4 7c0-2 1-4 3-4Z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-12 5h2m3 0h2"/>',
  shield:'<path d="M12 22s7-3 7-10V6l-7-3-7 3v6c0 7 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4 1 1 0 0 1 0-2h2a5 5 0 0 0 5-5c0-4-4-7-9-7Z"/><path d="M7 10h.01m3-3h.01m4 0h.01m3 3h.01"/>',
};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const screens={
  phone:["KLİNİK ÇALIŞMA ALANI","Kliniğiniz","Genel Bakış"],
  center:["MERKEZ ÇALIŞMA ALANI","VetZimo Merkez","Merkez Paneli"],
  owner:["HASTA SAHİBİ PORTALI","Patili dostlarınız","Portalım"],
};
const glyphs={
  home:'<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar:icons.calendar,
  inbox:'<path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5M16 11a3 3 0 1 0-1-5.8M21 19c-.4-2.4-1.8-3.8-3.7-4.4"/>',
  paw:'<circle cx="6.5" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><circle cx="17.5" cy="10" r="1.8"/><path d="M12 12c-2.8 0-5 3.2-5 5.3 0 1.5 1.2 2.2 2.6 2.2 1 0 1.6-.5 2.4-.5s1.4.5 2.4.5c1.4 0 2.6-.7 2.6-2.2 0-2.1-2.2-5.3-5-5.3z"/>',
  syringe:'<path d="m18 2 4 4M17 7l-9.5 9.5L4 20M14 4l6 6M9 11l2 2M12 8l2 2"/>',
  cart:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.5L21 8H6.2"/>',
  box:'<path d="m21 8-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  chart:'<path d="M4 20V10m6 10V4m6 16v-7m5 7H3"/>',
  lock:'<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path class="access-shackle" d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 15v2.5"/>',
  shield:icons.shield,
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bolt:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  devices:'<rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M6 18h6"/><rect x="17" y="8" width="5" height="12" rx="1.2"/>',
};
const glyph=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]||icons[name]}</svg>`;
const menus={
  phone:[["ÇALIŞMA ALANI",[["home","Genel Bakış"],["calendar","Randevular"],["inbox","Sohbet"]]],["KLİNİK İŞLEMLERİ",[["users","Müşteriler"],["paw","Hastalar"],["syringe","Aşı Takvimi"]]],["TİCARİ İŞLEMLER",[["cart","Satışlar"],["box","Ürünler"],["chart","Raporlar"]]]],
  center:[["YÖNETİM",[["home","Panel"],["users","Bayiler"],["box","Paketler ve satış"]]],["İŞLEMLER",[["cart","Ödemeler"],["chart","Finans ve raporlar"],["inbox","İletişim"]]]],
  owner:[["PORTALIM",[["home","Genel Bakış"],["paw","Hayvanlarım"],["syringe","Aşı takvimi"],["calendar","Randevularım"],["shield","Onam formlarım"]]]],
};
const stats={
  phone:[["calendar","Bugünkü randevular","12"],["paw","Kayıtlı hastalar","1.284"],["syringe","Yaklaşan aşılar","37"],["cart","Bugünkü satış","₺8.450"]],
  center:[["users","Etkin bayiler","148"],["box","Abonelikler","132"],["cart","Bu ay tahsilat","₺96K"],["inbox","Yeni mesajlar","5"]],
  owner:[["paw","Hayvanlarım","2"],["syringe","Yaklaşan aşı","1"],["calendar","Randevu","1"],["shield","Onam formu","0"]],
};
const agenda={
  phone:[["09:30","Luna · Karma aşı","ok"],["11:00","Paşa · Kontrol muayenesi","ok"],["14:30","Boncuk · Web randevusu","new"]],
  center:[["Bugün","3 yeni demo başvurusu","new"],["Bugün","2 havale bildirimi","ok"],["Yarın","5 abonelik yenilemesi","ok"]],
  owner:[["Pzt","Luna · Kuduz aşısı","new"],["Cum","Paşa · Kontrol","ok"],["—","Aşı karnesi güncel","ok"]],
};
function greeting() {
  const h=new Date().getHours();
  return h<6?"İyi geceler":h<12?"Günaydın":h<18?"İyi günler":"İyi akşamlar";
}
function drawStage(kind) {
  const [,clinicName,page]=screens[kind];
  let date="";
  try { date=new Date().toLocaleDateString(document.documentElement.lang||"tr-TR",{weekday:"long",day:"numeric",month:"long"}); } catch {}
  const nav=menus[kind].map(([label,items])=>`<p class="access-nav-label">${uiLabel(label)}</p>${items.map(([g,t],i)=>`<span class="access-nav-item${label===menus[kind][0][0]&&i===0?" is-active":""}">${glyph(g)}<span>${uiLabel(t)}</span>${glyph("lock")}</span>`).join("")}`).join("");
  const cards=stats[kind].map(([g,t,v],i)=>`<div class="access-stat" style="--i:${i}"><i>${glyph(g)}</i><small>${uiLabel(t)}</small><b>${v}</b><svg class="access-spark" viewBox="0 0 120 30" preserveAspectRatio="none"><path d="M0 24 C14 22 18 10 32 13 S52 26 66 17 S88 4 100 9 S114 14 120 6"/></svg></div>`).join("");
  const rows=agenda[kind].map(([t,l,s])=>`<div class="access-agenda-row"><b>${t}</b><span>${uiLabel(l)}</span><em class="is-${s}">${uiLabel(s==="new"?"Yeni":"Onaylı")}</em></div>`).join("");
  return `<div class="access-stage" aria-hidden="true">
    <nav class="access-rail">${nav}</nav>
    <div class="access-board">
      <div class="access-search">${glyph("search")}<span>${uiLabel("Hasta, müşteri, telefon veya ürün…")}</span><kbd>/</kbd></div>
      <section class="access-hero"><p>${uiLabel(page).toLocaleUpperCase("tr-TR")}</p><h2>${uiLabel(greeting())}${kind==="owner"?"":", "+uiLabel(clinicName)}</h2><span>${date}</span><div class="access-pets"><span>🐶</span><span>🐱</span></div></section>
      <div class="access-stats">${cards}</div>
      <section class="access-agenda"><h3>${glyph("calendar")}${uiLabel(kind==="center"?"Yapılacaklar":"Bugünün akışı")}</h3>${rows}</section>
    </div>
  </div>`;
}
const trust=[["shield","Şifreli bağlantı"],["devices","Telefon, tablet ve bilgisayar"],["bolt","Saniyeler içinde açılır"]];

export function mountAccessLayout(view,{appearance=defaultAppearance,kind="phone",clinic,captcha,allowLanguage=true}={}) {
  if (view.closest(".access-layout")) return;
  const main=view.closest("main");
  const wrapper=document.createElement("div");
  wrapper.className="access-layout";
  const top=document.createElement("header");
  top.className="access-header";
  top.innerHTML=`<div class="access-header-inner">
    <a class="access-brand" href="/platform"><img class="access-brand-mark" src="/vetzimo-mark.png" width="42" height="42" alt=""><span><strong>VetZimo <small>v2.2</small></strong><span dir="auto">${uiText("platform")}</span></span></a>
    <div class="access-header-actions">
      <label class="access-theme">${icon("palette")}<select aria-label="${uiLabel("Giriş teması")}"></select></label>
      <a class="access-contact" href="/platform/iletisim">${icon("phone")}<span dir="auto">${uiText("contact")}</span></a>
    </div>
  </div>`;
  if (clinic?.phone && /^[+()\d -]{7,24}$/.test(clinic.phone)) {
    const contact=top.querySelector(".access-contact");
    contact.href="tel:"+clinic.phone.replace(/[^+\d]/g,"");
    contact.querySelector("span").textContent=clinic.phone;
  }
  const select=top.querySelector("select");
  if (allowLanguage) mountLanguageSelect(top.querySelector(".access-header-actions"));
  for (const [key,label] of [["","Site varsayılanı"],...sitePalettes]) select.add(new Option(uiLabel(label),key));
  function apply(value) {
    const local=validPalette(value)?value:"";
    const theme=(!appearance.locked&&local)||appearance.palette||"blue";
    select.value=appearance.locked?theme:local;
    select.disabled=appearance.locked;
    document.body.dataset.accessTheme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",
      paletteColor(theme));
  }
  let preference;
  try { preference=localStorage.getItem(themeKey); } catch {}
  apply(preference);
  select.addEventListener("change",()=>{
    apply(select.value);
    try { localStorage.setItem(themeKey,select.value); } catch {}
  });
  const [eyebrow]=screens[kind];
  wrapper.classList.add("access-locked");
  const stage=document.createElement("div");
  stage.className="access-stage-wrap";
  stage.innerHTML=drawStage(kind);
  view.before(wrapper);
  const column=document.createElement("div");
  column.className="access-form-column";
  const badge=document.createElement("div");
  badge.className="access-lock";
  badge.innerHTML=`<span class="access-lock-icon">${glyph("lock")}</span><span><b>${uiLabel(eyebrow)}</b><small>${uiLabel("Çalışma alanınız hazır; devam etmek için kilidi açın.")}</small></span>`;
  const chips=document.createElement("ul");
  chips.className="access-trust";
  chips.innerHTML=trust.map(([g,t])=>`<li>${glyph(g)}<span>${uiLabel(t)}</span></li>`).join("");
  column.append(badge,view);
  if (captcha) column.append(captcha);
  column.append(chips);
  wrapper.append(stage,column);
  // Gönderimde kilit açılır ve arka plan netleşir; hata olursa geri kilitlenir.
  view.addEventListener("submit",()=>{
    wrapper.classList.add("access-unlocking");
    clearTimeout(wrapper._lockTimer);
    wrapper._lockTimer=setTimeout(()=>wrapper.classList.remove("access-unlocking"),6000);
  },true);
  const status=document.getElementById("status");
  if (status) new MutationObserver(()=>{ if (status.dataset.tone==="error"&&status.textContent.trim()) wrapper.classList.remove("access-unlocking"); })
    .observe(status,{attributes:true,childList:true,characterData:true,subtree:true});
  main.before(top);
  document.body.classList.add("login-surface");
}

export function unmountAccessLayout(view) {
  const wrapper=view.closest(".access-layout");
  if (!wrapper) return;
  wrapper.before(view);
  wrapper.remove();
  document.querySelector(".access-header")?.remove();
  document.body.classList.remove("login-surface");
  delete document.body.dataset.accessTheme;
  const meta=document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content="#edf4ee";
}
