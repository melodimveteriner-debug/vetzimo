// Satış sitesi · Uygulama indir: QR kodlar, cihaza göre öneri, güncel dosya bilgisi ve mağaza bağlantıları.
import {qrSvg} from "./qr.js?v=1";

const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const origin = location.origin;
const PAGE = "/platform/uygulama-indir";

function detect() {
  const ua = navigator.userAgent || "", touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "";
}

// İndirme sayfası için kısa adres (/indir); dosyalar için doğrudan indirme adresi.
const target = path => path === PAGE ? origin + "/indir" : new URL(path, origin).href;
function drawQr(box) {
  const url = target(box.dataset.dlQr);
  try { box.innerHTML = qrSvg(url, {size: box.closest(".big") ? 196 : 112, label: url}); } catch { box.textContent = url; }
  const cap = box.parentElement.querySelector("figcaption");
  if (box.dataset.dlQr === PAGE && cap && box.closest(".big")) cap.textContent = location.host + "/indir";
}

const size = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
async function refreshFiles() {
  try {
    const r = await fetch("/indir/manifest.json", {cache: "no-cache"});
    if (!r.ok) return;
    const {files = {}} = await r.json();
    for (const a of $$("[data-dl-file]")) {
      const f = files[a.dataset.dlFile];
      if (!f) { a.hidden = true; continue; }
      a.href = f.url;
      const meta = a.querySelector("[data-dl-meta]");
      if (meta) meta.textContent = [f.version ? "v" + f.version : "", size(f.size)].filter(Boolean).join(" · ");
    }
    for (const card of $$("[data-dl-card]")) {
      const box = card.querySelector("[data-dl-qr]"), first = card.querySelector("[data-dl-file]:not([hidden])");
      if (box && first && box.dataset.dlQr !== first.getAttribute("href")) { box.dataset.dlQr = first.getAttribute("href"); drawQr(box); }
    }
  } catch { /* çevrimdışı: sayfadaki bilgiler geçerli */ }
}

// Uygulama Yönetimi'nde yayımlanan mağaza bağlantıları (Google Play, App Store, Mac).
async function stores() {
  await Promise.all($$("[data-dl-store]").map(async a => {
    try {
      const r = await fetch("/api/app/release?platform=" + encodeURIComponent(a.dataset.dlStore), {credentials: "omit"});
      if (!r.ok) return;
      const url = (await r.json())?.latest?.url;
      if (!url || !/^https:\/\//.test(url)) return;
      a.href = url; a.hidden = false; a.rel = "noopener";
      const card = a.closest("[data-dl-card]");
      card?.querySelectorAll("[data-dl-wait]").forEach(n => { n.hidden = true; });
      const box = card?.querySelector("[data-dl-qr]");
      if (box && !card.querySelector("[data-dl-file]:not([hidden])")) { box.dataset.dlQr = url; drawQr(box); }
    } catch { /* bağlantı yoksa bekleme metni kalır */ }
  }));
}

function recommend() {
  const p = detect();
  if (!p) return;
  const word = {android: "android", ios: "ios", windows: "windows", macos: "macos", linux: "linux"}[p];
  for (const chip of $$(".dl-chips span")) if (chip.textContent.toLowerCase().includes(word)) chip.classList.add("on");
  const card = document.querySelector(`[data-dl-card="${p}"]`);
  if (!card) return;
  card.classList.add("is-recommended");
  card.querySelector(".dl-rec").hidden = false;
  card.parentElement.prepend(card);
}

$$("[data-dl-qr]").forEach(drawQr);
recommend();
if (document.querySelector("[data-dl-card]")) { refreshFiles(); stores(); }
