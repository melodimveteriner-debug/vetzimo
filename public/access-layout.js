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
  phone:["KLİNİK ÇALIŞMA ALANI","Kliniğinizin günü tek ekranda","Hasta kayıtlarını, randevuları ve klinik işlerini size açılan çalışma alanından takip edin."],
  center:["MERKEZ ÇALIŞMA ALANI","Bayi operasyonları tek ekranda","Bayileri, abonelikleri, tahsilatları ve destek taleplerini merkez panelinden yönetin."],
  owner:["HASTA SAHİBİ PORTALI","Kliniğinizle bağlantıda kalın","Hayvanlarınızın aşı takvimini, randevularını ve kliniğinizin paylaştığı bilgileri görüntüleyin."],
};
const features=[
  ["calendar","Takvim ve takip","Randevular ve aşılar"],
  ["layers","Kurum ve şube","Rolünüze uygun erişim"],
  ["shield","Hesap işlemleri","Giriş ve şifre yenileme"],
];

function drawPreview(kind) {
  const items=kind==="center"?["Bayi başvuruları","Abonelik dönemleri","Tahsilat takibi"]:
    kind==="owner"?["Hayvanlarım","Aşı takvimi","Randevularım"]:["Bugünkü randevular","Hasta kayıtları","Aşı takvimi"];
  return `<div class="access-art" aria-hidden="true">
    <div class="access-orbit"></div>
    <div class="access-mock">
      <div class="access-mock-top"><span><i></i><i></i><i></i></span><b>VetZimo</b><small>${uiLabel("ÖRNEK")}</small></div>
      <div class="access-mock-body">
        <div class="access-mock-rail"><b>V</b><i></i><i></i><i></i><i></i></div>
        <div class="access-mock-main"><div class="access-mock-caption">${uiLabel("GENEL BAKIŞ")}</div>
          <div class="access-mock-title">${uiLabel(kind==="center"?"Merkez paneli":kind==="owner"?"Hasta sahibi paneli":"Klinik paneli")}</div>
          ${items.map((text,index)=>`<div class="access-mock-row"><i>${icon(["calendar","layers","shield"][index])}</i><span>${uiLabel(text)}<b></b></span><em></em></div>`).join("")}
        </div>
      </div>
    </div>
    <div class="access-float">${icon(kind==="center"?"shield":"calendar")}</div>
  </div>`;
}

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
  const [eyebrow,title,body]=screens[kind];
  const aside=document.createElement("aside");
  aside.className="access-aside";
  aside.setAttribute("aria-label","VetZimo hakkında");
  aside.innerHTML=`<div class="access-showcase">
    <div class="access-showcase-copy"><p class="access-eyebrow"><span></span>${uiLabel(eyebrow)}</p><h2>${uiLabel(title)}</h2><p>${uiLabel(body)}</p><a href="/platform">${uiLabel("Platformu keşfedin")} ${icon("arrow")}</a></div>
    ${drawPreview(kind)}
    </div>
    <div class="access-features">${features.map(([glyph,label,description])=>`<div class="access-feature"><i>${icon(glyph)}</i><div><strong>${uiLabel(label)}</strong><span>${uiLabel(description)}</span></div></div>`).join("")}</div>`;
  view.before(wrapper);
  const column=document.createElement("div");
  column.className="access-form-column";
  column.append(view);
  if (captcha) column.append(captcha);
  wrapper.append(column,aside);
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
