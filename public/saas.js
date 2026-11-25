import {sitePalettes,validPalette} from "./theme.js";

const menu=document.querySelector(".nav-toggle");
menu.addEventListener("click",()=>menu.setAttribute("aria-expanded",String(menu.getAttribute("aria-expanded")!=="true")));
const theme=document.querySelector(".theme");
const html=document.documentElement, sitePalette=html.dataset.sitePalette, locked=html.dataset.themeLock==="true";
for (const [key,label] of [["","Site varsayılanı"],...sitePalettes]) {
  theme.add(new Option(label,key));
}
function applyMarketTheme(value) {
  const local=value==="light"?"orchid":validPalette(value)?value:"";
  const current=(!locked&&local)||(validPalette(sitePalette)?sitePalette:"")||"prizma";
  html.dataset.theme=current;
  theme.value=locked?current:local;
  theme.disabled=locked;
}
let local="";
try {local=localStorage.getItem("vetnet-market-theme")||"";} catch {}
applyMarketTheme(local);
theme.addEventListener("change",()=>{
  try {localStorage.setItem("vetnet-market-theme",theme.value);} catch {}
  applyMarketTheme(theme.value);
});
for (const button of document.querySelectorAll("[data-period]")) {
  button.addEventListener("click",()=>{
    const period=button.dataset.period;
    for (const item of document.querySelectorAll("[data-period]")) item.setAttribute("aria-pressed",String(item===button));
    for (const price of document.querySelectorAll("[data-price]")) price.hidden=price.dataset.price!==period;
    for (const link of document.querySelectorAll("[data-plan-link]")) {
      const url=new URL(link.href);url.searchParams.set("donem",period);link.href=url.href;
    }
  });
}
const form=document.querySelector("[data-application]");
if (form) {
  const query=new URLSearchParams(location.search);
  if (query.has("plan")) form.elements.plan.value=query.get("plan");
  if (["monthly","yearly"].includes(query.get("donem"))) form.elements.billing.value=query.get("donem");
  const feedback=form.querySelector(".feedback"), submit=form.querySelector("button[type=submit]");
  let lastPayload, requestId;
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if (submit.disabled) return;
    const data=Object.fromEntries(new FormData(form));
    const payload=JSON.stringify(data);
    if (payload!==lastPayload) {lastPayload=payload;requestId=crypto.randomUUID();}
    submit.disabled=true;
    feedback.textContent="Başvuru kaydediliyor…";
    try {
      const response=await fetch("/api/saas/applications",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,requestId})
      });
      const result=await response.json();
      if (!response.ok) throw Error(result.error||"Başvuru kaydedilemedi.");
      if (result.verify) {
        const {mountDemoVerify}=await import("./demo-verify.js?v=2");
        await mountDemoVerify(form,{reference:result.reference,phone:result.phone});
        return;
      }
      feedback.textContent="Başvurunuz kaydedildi. Takip numarası: "+result.reference;
      form.reset();
      lastPayload=null;
    } catch(error) {
      feedback.textContent=error.message||"Bağlantı kurulamadı. Tekrar deneyin.";
    } finally {submit.disabled=false;}
  });
}

const notice=document.querySelector("#application-notice");
if (notice) {
  const scroll=notice.querySelector(".notice-scroll"), read=notice.querySelector("[data-notice-read]");
  const confirm=notice.querySelector("[data-notice-confirm]"), message=notice.querySelector("[data-notice-status]");
  const formRead=form?.elements.read;
  function sync(value) {
    read.checked=value;
    if (formRead) formRead.checked=value;
    confirm.disabled=!value;
    message.textContent=value?"Bilgilendirme işaretlendi.":"Onay için metnin sonuna ilerleyin.";
  }
  function atEnd() {
    if (notice.open&&scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<=3) sync(true);
  }
  function openNotice() {
    if (notice.open) return;
    sync(Boolean(formRead?.checked));
    notice.showModal();
    scroll.scrollTop=0;
    scroll.focus();
    atEnd();
  }
  for (const link of document.querySelectorAll("[data-notice-open]")) {
    link.addEventListener("click",event=>{event.preventDefault();openNotice();});
  }
  scroll.addEventListener("scroll",atEnd);
  for (const button of notice.querySelectorAll("[data-notice-close],[data-notice-confirm]")) {
    button.addEventListener("click",()=>notice.close());
  }
  formRead?.addEventListener("change",()=>{
    if (!formRead.checked) {sync(false);return;}
    formRead.checked=false;
    openNotice();
  });
}

const featureDialog=document.querySelector("#feature-dialog");
const featureBody=featureDialog.querySelector(".feature-dialog-body");
let featureRequest;
featureDialog.querySelector("[data-feature-close]").addEventListener("click",()=>featureDialog.close());
featureDialog.addEventListener("close",()=>featureRequest?.abort());
featureDialog.addEventListener("click",event=>{if(event.target===featureDialog) featureDialog.close();});
document.addEventListener("click",async event=>{
  const link=event.target.closest("a[data-feature-open]");
  if (!link||(event.button??0)!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey) return;
  const url=new URL(link.href);
  if (url.origin!==location.origin||!/^\/platform\/ozellikler\/[a-z0-9-]+\/?$/.test(url.pathname)) return;
  event.preventDefault();
  featureRequest?.abort();
  const request=new AbortController();
  featureRequest=request;
  featureBody.textContent="Özellik yükleniyor…";
  if (!featureDialog.open) featureDialog.showModal();
  try {
    const response=await fetch(url,{signal:request.signal});
    if (!response.ok) throw Error();
    const page=new DOMParser().parseFromString(await response.text(),"text/html").querySelector("main");
    if (!page?.querySelector(".feature-detail")) throw Error();
    if (!request.signal.aborted) {
      featureBody.replaceChildren(...page.children);
      featureBody.scrollTop=0;
    }
  } catch {
    if (!request.signal.aborted) {
      const open=document.createElement("a");
      open.href=url.href;open.textContent="Özellik sayfasını aç";
      featureBody.replaceChildren(open);
    }
  }
});
