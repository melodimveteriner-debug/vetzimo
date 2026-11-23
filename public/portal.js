import {petPortrait} from "./pet-portrait.js";
import {applyTheme,loadAppearance,paletteColor} from "./theme.js";
import {mountAccessLayout,unmountAccessLayout} from "./access-layout.js";
const appearance=await loadAppearance();
const view=document.getElementById("portal-content");
const escape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const readRoute=()=>location.hash.slice(1).split("/");
const api=async (action,body)=>{
  const response=await fetch("/api/portal/"+action,body===undefined?{}:{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
  });
  const result=await response.json();
  if (!response.ok) throw Error(result.error || "İşlem tamamlanamadı.");
  return result;
};
const password=(name,label,autocomplete,min="")=>`<label class="form-field">${label}<input type="password" name="${name}" autocomplete="${autocomplete}" required ${min || 'maxlength="128"'}></label>`;
function login(code) {
  mountAccessLayout(view,{kind:"owner",appearance});
  view.innerHTML=`<span class="access-form-kicker">Hasta sahibi portalı</span><h1>Hasta sahibi girişi</h1><p>Telefon numaranız ve uygulama şifrenizle giriş yapın.</p>
    ${/^[a-f0-9]{32}$/.test(code||"")?`<form data-action="login"><label class="form-field">Cep telefonu<input name="phone" type="tel" autocomplete="username" required></label>
    ${password("password","Şifre","current-password")}<button type="submit" class="button primary">Giriş yap</button><p id="portal-error" role="alert"></p></form>`:
    '<p class="callout">Kliniğinizden aldığınız müşteri giriş bağlantısını açın.</p>'}`;
}
function setup() {
  mountAccessLayout(view,{kind:"owner",appearance});
  view.innerHTML=`<span class="access-form-kicker">Hesap aktivasyonu</span><h1>Şifrenizi oluşturun</h1><p>En az 6 karakter kullanın.</p><form data-action="setup">
  ${password("password","Yeni şifre","new-password",'minlength="6" maxlength="128"')}${password("confirm","Şifre tekrar","new-password",'minlength="6" maxlength="128"')}
  <button type="submit" class="button primary">Şifreyi oluştur</button><p id="portal-error" role="alert"></p></form>`;
}
async function render() {
  const [action,code]=readRoute();
  if (action==="setup") { setup();return; }
  try {
    const account=await api("me");
    if (!account.authenticated) { login(code);return; }
    unmountAccessLayout(view);
    if (appearance.palette) {
      document.body.dataset.clinicPalette=appearance.palette;
      applyTheme(paletteColor(appearance.palette));
    }
    const pets=account.pets.map(pet=>{
      const portrait=petPortrait(pet);
      return `<li class="portal-pet">${portrait?`<img src="${escape(portrait.src)}" alt="${escape(portrait.label)}" loading="lazy" width="64" height="64">`:""}<div><strong>${escape(pet.name)}</strong><p>${escape([pet.species,pet.breed].filter(Boolean).join(" · "))}</p>${portrait?.sample?"<small>Temsili görsel</small>":""}</div></li>`;
    }).join("");
    const vaccines=account.vaccines.map(item=>`<li>${escape(item.date.split("-").reverse().join("."))} · ${escape(account.pets.find(pet=>pet.id===item.patient)?.name)} · ${escape(item.title)}</li>`).join("");
    view.innerHTML=`<h1>Hoş geldiniz, ${escape(account.name)}</h1>
      <div class="portal-detail"><h2>Hayvanlarım</h2>${pets?`<ul class="portal-pet-grid">${pets}</ul>`:"<p>Bağlı hasta kaydı yok.</p>"}</div>
      <div class="portal-detail"><h2>Yaklaşan aşılar</h2>${vaccines?`<ul>${vaccines}</ul>`:"<p>Planlanan aşı kaydı yok.</p>"}</div>
      <form data-action="logout"><button class="button">Çıkış yap</button><p id="portal-error" role="alert"></p></form>`;
  } catch(error) { view.textContent=error.message; }
}
view.addEventListener("submit",async event=>{
  const form=event.target, action=form.dataset.action;
  if (!action) return;
  event.preventDefault();
  const [mode,code]=readRoute();
  const values=Object.fromEntries(new FormData(form));
  const button=form.querySelector("button"), error=document.getElementById("portal-error");
  button.disabled=true;error.textContent="";
  try {
    if (action==="setup") {
      if (values.password!==values.confirm) throw Error("Şifreler eşleşmiyor.");
      const result=await api("setup",{token:code,password:values.password});
      history.replaceState(null,"","/portal#login/"+result.code);
      login(result.code);
      view.querySelector("p").textContent="Şifreniz hazır. Telefon numaranızla giriş yapın.";
    } else if (action==="login" && mode==="login") {
      await api("login",{code,phone:values.phone,password:values.password});await render();
    } else if (action==="logout") { await api("logout",{});await render(); }
  } catch(problem) { error.textContent=problem.message; }
  finally { button.disabled=false; }
});
window.addEventListener("hashchange",render);
void render();
