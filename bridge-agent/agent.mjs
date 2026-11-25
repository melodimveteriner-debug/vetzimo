// VetZimo Bakanlık köprüsü ajanı.
// Klinik bilgisayarında arka planda çalışır; VetZimo'daki "Bakanlığa gönder" kuyruğunu alır ve Bakanlık ekranlarını
// veterinerin KENDİ e-Devlet oturumunda, kliniğin bir kez öğrettiği adımlarla doldurur. e-Devlet şifresi görülmez ve saklanmaz.
// Yerel panel: http://127.0.0.1:5199

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";
import {createWhatsApp} from "./whatsapp.mjs";
import {createDevices} from "./devices.mjs";

const VERSION = "1.3.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.VZ_BRIDGE_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "VetZimoKopru");
const PORT = Number(process.env.VZ_BRIDGE_PORT || 5199);
fs.mkdirSync(HOME, {recursive: true});
const FILES = {config: path.join(HOME, "config.json"), session: path.join(HOME, "oturum.json"), log: path.join(HOME, "gunluk.txt")};
const DEFAULT_MINISTRY = "https://vetbis.tarimorman.gov.tr";

// ---------------- Ayarlar ve günlük ----------------
// Portallar: Bakanlık (e-Devlet ile), GİB e-Arşiv, e-Fatura entegratörü (Uyumsoft, Ödeal...), e-SMM (GİB, İşNet/banka).
const DEFAULT_PORTALS = {gib: "https://earsivportal.efatura.gov.tr/intragiris.html", efatura: "", esmm: ""};
const PORTALS = ["ministry", "gib", "efatura", "esmm"];
const PORTAL_OF = {prescription: "ministry", vaccine: "ministry", session: "ministry", earsiv: "gib", session_gib: "gib", efatura: "efatura", session_efatura: "efatura", esmm: "esmm", session_esmm: "esmm"};
const PORTAL_NAME = {ministry: "Bakanlık", gib: "GİB e-Arşiv", efatura: "e-Fatura portalı", esmm: "e-SMM portalı"};
let config = {server: "", token: "", name: os.hostname(), ministryUrl: DEFAULT_MINISTRY, portals: {...DEFAULT_PORTALS}};
// Paketle gelen config.json (VetZimo adresi) varsayılandır; eşleştirme sonrası ayarlar kullanıcı klasöründe tutulur.
try { config = {...config, ...JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8")), token: ""}; } catch {}
try { config = {...config, ...JSON.parse(fs.readFileSync(FILES.config, "utf8"))}; } catch {}
const saveConfig = () => fs.writeFileSync(FILES.config, JSON.stringify(config, null, 2), {mode: 0o600});
const logs = [];
function log(message) {
  const line = new Date().toISOString().replace("T", " ").slice(0, 19) + "  " + message;
  logs.push(line); if (logs.length > 500) logs.shift();
  try { fs.appendFileSync(FILES.log, line + "\n"); } catch {}
  console.log(line);
}
config.portals = {...DEFAULT_PORTALS, ...(config.portals || {})};
const state = {online: false, ministry: "unknown", portals: {gib: "unknown", efatura: "unknown", esmm: "unknown"}, busy: false, current: null, queued: 0, lastError: "", teach: null, lastBeat: 0};
const portalState = p => p === "ministry" ? state.ministry : state.portals[p];
const setPortal = (p, v) => { if (p === "ministry") state.ministry = v; else state.portals[p] = v; };
const portalUrl = p => p === "ministry" ? config.ministryUrl : (config.portals[p] || "");

// ---------------- VetZimo sunucusu ----------------
async function api(op, body = {}) {
  if (!config.server) throw new Error("Sunucu adresi ayarlanmadı.");
  const headers = {"Content-Type": "application/json"};
  if (config.token) { headers.Authorization = "Bearer " + config.token; headers["X-Bridge-Token"] = config.token; }
  const res = await fetch(config.server.replace(/\/$/, "") + "/api/bridge/agent/" + op, {method: "POST", headers, body: JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Sunucu hatası " + res.status); e.status = res.status; throw e; }
  return data;
}

// ---------------- Tarayıcı ----------------
// Windows'ta Microsoft Edge her zaman vardır; yoksa Chrome denenir. Test için VZ_BROWSER ile yol verilebilir.
async function launch(headless) {
  const options = {headless: process.env.VZ_HEADLESS === "1" ? true : headless, args: ["--disable-blink-features=AutomationControlled"]};
  if (process.env.VZ_DEBUG_PORT && !headless) options.args.push("--remote-debugging-port=" + process.env.VZ_DEBUG_PORT); // yalnız otomatik test
  if (process.env.VZ_BROWSER) return chromium.launch({...options, executablePath: process.env.VZ_BROWSER});
  for (const channel of ["msedge", "chrome"]) {
    try { return await chromium.launch({...options, channel}); } catch {}
  }
  throw new Error("Microsoft Edge ya da Google Chrome bulunamadı.");
}
// WhatsApp Web için kalıcı profil (bağlı cihaz oturumu bu bilgisayarda kalır). Otomatik çalışmada pencere simge durumunda açılır.
async function launchPersistent(dir, visible) {
  const options = {headless: process.env.VZ_HEADLESS === "1", viewport: null, args: ["--disable-blink-features=AutomationControlled", ...(visible ? [] : ["--start-minimized"])]};
  if (process.env.VZ_BROWSER) return chromium.launchPersistentContext(dir, {...options, executablePath: process.env.VZ_BROWSER});
  for (const channel of ["msedge", "chrome"]) {
    try { return await chromium.launchPersistentContext(dir, {...options, channel}); } catch {}
  }
  throw new Error("Microsoft Edge ya da Google Chrome bulunamadı.");
}
// Veri yalnız kamu (gov.tr), bilinen e-belge entegratörleri ve panelde girilen portal adreslerindeki sayfalara yazılır.
const INTEGRATORS = /(^|\.)(gov\.tr|uyumsoft\.com\.tr|uyum\.com\.tr|odeal\.com|isnet\.net\.tr|isbank\.com\.tr|efinans\.com\.tr|qnbefinans\.com|edmbilisim\.com\.tr|izibiz\.com\.tr|logo\.com\.tr|mysoft\.com\.tr|nesbilgi\.com\.tr|turkcell\.com\.tr|kolaysoft\.com\.tr|faturaport\.com\.tr)$/i;
const allowedHost = url => { try { const u = new URL(url); if (INTEGRATORS.test(u.hostname) || ["127.0.0.1", "localhost"].includes(u.hostname)) return true;
  return Object.values(config.portals || {}).some(p => { try { return p && new URL(p).hostname === u.hostname && u.protocol === "https:"; } catch { return false; } }); } catch { return false; } };
const onLoginPage = url => /giris\.turkiye\.gov\.tr|turkiye\.gov\.tr\/giris|\/login|\/giris|intragiris|\/oturum|signin/i.test(url);

async function sessionContext(browser) {
  let storageState;
  try { storageState = JSON.parse(fs.readFileSync(FILES.session, "utf8")); } catch {}
  return browser.newContext({storageState, locale: "tr-TR", viewport: {width: 1366, height: 900}});
}
async function keepSession(context) {
  const s = await context.storageState();
  fs.writeFileSync(FILES.session, JSON.stringify(s), {mode: 0o600});
}

let recipes = {};
async function loadRecipes() {
  try { recipes = Object.fromEntries(Object.entries((await api("recipes")).recipes || {}).map(([k, v]) => [k, v.recipe])); } catch (e) { log("Tarifler alınamadı: " + e.message); }
}
function sessionRecipe(portal = "ministry") {
  return recipes[portal === "ministry" ? "session" : "session_" + portal] || {steps: [{action: "goto", url: portalUrl(portal)}], loggedIn: null};
}

/** Bakanlık oturumunu dener: başsız tarayıcıda Bakanlık adresi açılır, giriş sayfasına yönleniyorsa oturum kapalıdır. */
async function checkSession(portal = "ministry") {
  if (!portalUrl(portal)) { setPortal(portal, "closed"); return; }
  const browser = await launch(true);
  try {
    const context = await sessionContext(browser);
    const page = await context.newPage();
    const recipe = sessionRecipe(portal);
    const url = recipe.steps.find(s => s.action === "goto")?.url || portalUrl(portal);
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 45000});
    await page.waitForTimeout(1500);
    let open = !onLoginPage(page.url());
    if (open && recipe.loggedIn) open = await find(page, recipe.loggedIn, 4000).then(() => true, () => false);
    setPortal(portal, open ? "open" : "closed");
    if (open) await keepSession(context);
    log(PORTAL_NAME[portal] + " oturumu: " + (open ? "açık" : "kapalı"));
  } catch (e) {
    setPortal(portal, "unknown");
    log("Oturum kontrolü yapılamadı: " + e.message);
  } finally { await browser.close(); }
}

/** e-Devlet girişi: görünür bir pencere açılır, girişi veteriner kendisi yapar. Giriş bitince oturum saklanır. */
let loginRunning = false;
async function login(portal = "ministry") {
  if (loginRunning) return;
  if (!portalUrl(portal)) { log(PORTAL_NAME[portal] + " adresi girilmemiş. Panelde portal adresini yazın."); return; }
  loginRunning = true;
  setPortal(portal, "waiting");
  log(PORTAL_NAME[portal] + " giriş penceresi açıldı. Girişi bu bilgisayardan siz yapın; şifreniz ajana kaydedilmez.");
  const browser = await launch(false);
  try {
    const context = await sessionContext(browser);
    const page = await context.newPage();
    const recipe = sessionRecipe(portal);
    await page.goto(recipe.steps.find(s => s.action === "goto")?.url || portalUrl(portal), {waitUntil: "domcontentloaded"});
    const deadline = Date.now() + 10 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline && !ok && browser.isConnected()) {
      await page.waitForTimeout(2000).catch(() => {});
      const url = page.url();
      if (allowedHost(url) && !onLoginPage(url)) {
        ok = recipe.loggedIn ? await find(page, recipe.loggedIn, 1500).then(() => true, () => false) : !/turkiye\.gov\.tr/.test(new URL(url).hostname);
      }
    }
    if (ok) { await page.waitForTimeout(1500); await keepSession(context); setPortal(portal, "open"); log(PORTAL_NAME[portal] + " oturumu açıldı."); }
    else { setPortal(portal, "closed"); log("Giriş tamamlanmadı."); }
  } catch (e) { log("Giriş penceresi: " + e.message); }
  finally { loginRunning = false; await browser.close().catch(() => {}); }
}

// ---------------- Tarif çalıştırıcı ----------------
function value(template, data) {
  return String(template ?? "").replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => {
    let v = data;
    for (const k of key.split(".")) v = v?.[k];
    return v == null ? "" : String(v);
  });
}
async function find(page, selectors, timeout = 15000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const s of list) {
      const loc = s.startsWith("label=") ? page.getByLabel(s.slice(6), {exact: false}) : page.locator(s);
      const first = loc.first();
      if (await first.isVisible().catch(() => false)) return first;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Ekranda bulunamadı: " + list[0]);
}
async function runSteps(page, steps, data, job) {
  for (const step of steps) {
    if (onLoginPage(page.url())) { const e = new Error("Portal oturumu kapanmış; ajan panelinden yeniden giriş yapın."); e.session = true; throw e; }
    if (step.action === "repeat") {
      for (const [index, item] of (data[step.over || "items"] || []).entries()) await runSteps(page, step.steps || [], {...data, item, index: index + 1}, job);
      continue;
    }
    if (step.action !== "goto" && !allowedHost(page.url())) throw new Error("Güvenlik: izin verilen portallar dışındaki bir sayfaya veri yazılmaz.");
    const v = value(step.value, data);
    switch (step.action) {
      case "goto":
        if (!allowedHost(step.url)) throw new Error("Güvenlik: yalnızca kamu ve tanınan e-belge portallarına gidilir.");
        await page.goto(step.url, {waitUntil: "domcontentloaded", timeout: 45000}); break;
      case "fill": { const el = await find(page, step.selectors); await el.fill(""); await el.fill(v); break; }
      case "pick": { // Otomatik tamamlamalı alan: yaz, listeden metni içeren seçeneği seç.
        const el = await find(page, step.selectors); await el.fill(""); await el.type(v, {delay: 40});
        const option = page.locator(step.option || '[role="option"], .ui-menu-item, .autocomplete li, li').filter({hasText: value(step.match || step.value, data)}).first();
        await option.waitFor({state: "visible", timeout: 10000}); await option.click(); break; }
      case "select": { const el = await find(page, step.selectors); await el.selectOption({label: v}).catch(() => el.selectOption(v)); break; }
      case "check": { const el = await find(page, step.selectors); if (v === "0") await el.uncheck(); else await el.check(); break; }
      case "press": { const el = await find(page, step.selectors); await el.press(step.key || "Enter"); break; }
      case "click": { const el = await find(page, step.selectors); await el.click(); await page.waitForLoadState("domcontentloaded").catch(() => {}); break; }
      case "wait": if (step.selectors) await find(page, step.selectors, step.timeout || 20000); else await page.waitForTimeout(Math.min(step.ms || 1000, 15000)); break;
      case "submit": {
        // Geri dönüşü olmayan adım: önce sunucuya "kaydediliyor" bildirilir, sonra basılır.
        const el = await find(page, step.selectors);
        await api("progress", {id: job.id, phase: "submitting"});
        job.submitted = true;
        await el.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        break; }
      case "read": {
        const until = Date.now() + (step.timeout || 30000);
        while (Date.now() < until) {
          if (step.errorSelectors) {
            const err = await find(page, step.errorSelectors, 300).catch(() => null);
            if (err) { const e = new Error((await err.innerText()).trim().slice(0, 400) || "Bakanlık kaydı reddetti."); e.rejected = true; throw e; }
          }
          const el = await find(page, step.selectors, 500).catch(() => null);
          if (el) {
            const text = ((await el.innerText().catch(() => "")) || (await el.inputValue().catch(() => ""))).trim();
            const m = text.match(new RegExp(step.pattern || "[A-Z0-9][A-Z0-9/-]{4,}"));
            if (m) { job.documentNo = m[1] || m[2] || m[0]; break; }
          }
          await page.waitForTimeout(500);
        }
        if (!job.documentNo) throw new Error("Belge numarası okunamadı.");
        break; }
      case "end": return;
      default: throw new Error("Bilinmeyen adım: " + step.action);
    }
  }
}

async function runJob(job, recipe) {
  state.current = {id: job.id, summary: job.payload.summary};
  log("İş alındı: " + job.payload.summary);
  if (!recipe) {
    await api("result", {id: job.id, outcome: "error", error: "Bu işlem türü için ekran tarifi öğretilmemiş. Ajan panelinden 'Öğret' ile bir kez öğretin."});
    return;
  }
  const browser = await launch(true);
  const run = {id: job.id, submitted: false, documentNo: ""};
  try {
    const context = await sessionContext(browser);
    const page = await context.newPage();
    await api("progress", {id: job.id, phase: "filling"});
    await runSteps(page, recipe.steps, job.payload, run);
    await keepSession(context);
    if (!run.documentNo && run.submitted) throw new Error("Kaydedildi ama belge numarası okunamadı.");
    await api("result", {id: job.id, outcome: "done", documentNo: run.documentNo});
    log("Tamamlandı: " + run.documentNo);
  } catch (e) {
    if (e.session) setPortal(PORTAL_OF[job.kind] || "ministry", "closed");
    log("Hata: " + e.message);
    // Kaydet'e basılmadıysa kayıt oluşmamıştır: oturum sorunu ise kuyruğa döner, diğerleri hata olur.
    // Basıldıysa yalnız Bakanlık açık bir ret gösterdiyse "hata"; aksi halde "belirsiz" (asla otomatik tekrar yok).
    const outcome = !run.submitted ? (e.session ? "retry" : "error") : (e.rejected ? "error" : "uncertain");
    await api("result", {id: job.id, outcome, error: e.message, rejected: !!e.rejected}).catch(x => log("Sonuç bildirilemedi: " + x.message));
  } finally {
    await browser.close().catch(() => {});
    state.current = null;
  }
}

// ---------------- Ana döngü ----------------
async function tick() {
  if (!config.token || state.busy || state.teach) return;
  state.busy = true;
  try {
    const beat = await api("heartbeat", {version: VERSION, ministry: state.ministry});
    state.online = true; state.queued = beat.queued; state.lastBeat = Date.now(); state.lastError = "";
    if (beat.command === "check-session") await checkSession();
    if (beat.command === "login") login();
    if (/^login:(gib|efatura|esmm)$/.test(beat.command || "")) login(beat.command.slice(6));
    if (beat.queued > 0 && !loginRunning) {
      // Yalnız oturumu kapalı olmayan portalların işleri istenir; bilinmeyen portal iş gelince denetlenir.
      const portals = PORTALS.filter(p => portalUrl(p) && !["closed", "waiting"].includes(portalState(p)));
      if (portals.length) {
        await loadRecipes();
        const claim = await api("claim", {portals});
        if (claim.job) {
          const portal = PORTAL_OF[claim.job.kind] || "ministry";
          if (portalState(portal) === "unknown") await checkSession(portal);
          if (portalState(portal) === "open") await runJob(claim.job, claim.recipe);
          else await api("result", {id: claim.job.id, outcome: "retry", error: PORTAL_NAME[portal] + " oturumu kapalı; ajan panelinden giriş yapın."});
        }
      }
    }
  } catch (e) {
    state.online = false; state.lastError = e.message;
    if (e.status === 401) { log("Ajan erişimi kaldırılmış; yeniden eşleştirin."); config.token = ""; saveConfig(); }
  } finally { state.busy = false; }
}
setInterval(tick, 15000);
setTimeout(tick, 1500);
// WhatsApp (kliniğin kendi numarası): klinik panelinde "Otomatik WhatsApp" seçiliyse çalışır.
const whatsapp = createWhatsApp({launchPersistent, home: HOME, api, log});
async function waTick() {
  if (!config.token) return;
  try { await whatsapp.tick(); }
  catch (e) { if (e.status === 401) { log("Ajan erişimi kaldırılmış; yeniden eşleştirin."); config.token = ""; saveConfig(); } }
}
setInterval(waTick, Number(process.env.VZ_WA_TICK_MS || 20000));
// Laboratuvar ve görüntüleme cihazları: klinik panelinde eklenen cihazlar dinlenir, sonuçlar sunucuda hastayla eşleşir.
async function uploadChunk(id, index, total, name, type, bytes) {
  const headers = {"Content-Type": "application/octet-stream", "X-Upload-Id": id, "X-Chunk-Index": String(index), "X-Chunk-Total": String(total), "X-File-Name": encodeURIComponent(name), "X-File-Type": type};
  if (config.token) { headers.Authorization = "Bearer " + config.token; headers["X-Bridge-Token"] = config.token; }
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(config.server.replace(/\/$/, "") + "/api/bridge/agent/device-file", {method: "POST", headers, body: bytes}).catch(e => ({ok: false, status: 0, json: async () => ({error: e.message})}));
    if (res.ok) return res.json();
    if (res.status && res.status < 500) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Dosya yüklenemedi " + res.status); }
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error("Dosya yüklenemedi (bağlantı)");
}
const devices = createDevices({api, upload: uploadChunk, home: HOME, log});
async function deviceTick() {
  if (!config.token) return;
  try { await devices.refresh(); }
  catch (e) { if (e.status === 401) { devices.stopAll(); log("Ajan erişimi kaldırılmış; yeniden eşleştirin."); config.token = ""; saveConfig(); } }
}
setInterval(deviceTick, Number(process.env.VZ_DEVICE_TICK_MS || 30000));
setTimeout(deviceTick, 3000);
setTimeout(waTick, 4000);
// Oturum yaklaşık saatte bir sessizce denetlenir (Bakanlık oturumu zamanla düşer).
setInterval(() => { if (config.token && !state.busy && !state.teach && !loginRunning) checkSession(); }, 60 * 60 * 1000);

// ---------------- Öğretme modu ----------------
async function teachStart(kind, url) {
  if (state.teach) throw new Error("Öğretme zaten açık.");
  const browser = await launch(false);
  const context = await sessionContext(browser);
  const steps = [];
  let lastUrl = "";
  await context.exposeFunction("__vzRecord", step => {
    if (!allowedHost(step.url)) return;
    if (step.action === "fill" || step.action === "select") {
      const prev = steps.at(-1);
      if (prev && prev.action === step.action && JSON.stringify(prev.selectors) === JSON.stringify(step.selectors)) { prev.value = step.value; return; }
    }
    if (step.url !== lastUrl && !steps.length) steps.push({action: "goto", url: step.url.split("#")[0]});
    lastUrl = step.url;
    if (step.action === "loggedIn") { state.teach.loggedIn = step.selectors; return; }
    steps.push({action: step.action, selectors: step.selectors, value: step.value, label: step.label || ""});
  });
  await context.addInitScript({path: path.join(HERE, "recorder.js")});
  const page = await context.newPage();
  const portal = PORTAL_OF[kind] || "ministry";
  const start = url || sessionRecipe(portal).steps[0]?.url || portalUrl(portal);
  if (!start) throw new Error(PORTAL_NAME[portal] + " adresini panelde girin.");
  await page.goto(start, {waitUntil: "domcontentloaded"});
  state.teach = {kind, browser, context, page, steps};
  browser.on("disconnected", () => { if (state.teach?.browser === browser) state.teach.closed = true; });
  log("Öğretme modu açıldı: " + kind);
}
async function teachMark(mode) {
  const t = state.teach;
  if (!t) return;
  const target = t.context.pages().at(-1) || t.page;
  await target.evaluate(m => { window.__vzMarkMode = m; document.documentElement.style.cursor = "crosshair"; }, mode === "read" ? "read" : mode === "loggedIn" ? "loggedIn" : "submit");
}
async function teachSave(edited) {
  const t = state.teach;
  if (!t) throw new Error("Öğretme açık değil.");
  const steps = (edited || t.steps).filter(s => !s.removed).map(({removed, ...s}) => s);
  const isSession = t.kind.startsWith("session");
  if (!isSession && !steps.some(s => s.action === "submit")) throw new Error("Kaydet düğmesini işaretleyin.");
  // Belge numarası alanı işaretlenmediyse sayfa metninde numara kalıbı aranır (e-Arşiv: GIB2026000000001, ETTN, makbuz no).
  if (!isSession && !steps.some(s => s.action === "read")) steps.push({action: "read", selectors: ["body"],
    pattern: ["earsiv", "efatura", "esmm"].includes(t.kind) ? "(?:Fatura|Belge|Makbuz)\\s*(?:No|Numarası)\\s*[:：]?\\s*([A-Z0-9]{3}20[0-9]{2}[0-9]{9}|[A-Z0-9][A-Z0-9/-]{5,})|([A-Z]{3}20[0-9]{11})" : "(?:Reçete|Belge|Aşı|Kayıt)\\s*(?:No|Numarası)\\s*[:：]?\\s*([A-Z0-9][A-Z0-9/-]{4,})"});
  const recipe = {steps, taughtAt: new Date().toISOString(), loggedIn: t.loggedIn || null};
  await api("recipe", {kind: t.kind, recipe});
  if (isSession) { await keepSession(t.context); setPortal(PORTAL_OF[t.kind] || "ministry", "open"); }
  recipes[t.kind] = recipe;
  await t.browser.close().catch(() => {});
  state.teach = null;
  log("Tarif kaydedildi: " + t.kind + " (" + steps.length + " adım)");
}
async function teachCancel() { if (state.teach) { await state.teach.browser.close().catch(() => {}); state.teach = null; } }

// ---------------- Yerel panel ----------------
function send(res, code, body, type = "application/json") {
  res.writeHead(code, {"Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"});
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(HERE, "panel.html"), "utf8"), "text/html");
    if (req.method === "GET" && url.pathname === "/durum") {
      return send(res, 200, {version: VERSION, paired: !!config.token, server: config.server, name: config.name, ministryUrl: config.ministryUrl,
        online: state.online, ministry: state.ministry, queued: state.queued, current: state.current, lastError: state.lastError, login: loginRunning,
        recipes: Object.keys(recipes), whatsapp: whatsapp.state(), devices: devices.status(), portals: Object.fromEntries(["gib", "efatura", "esmm"].map(p => [p, {url: config.portals[p] || "", state: state.portals[p]}])), teach: state.teach ? {kind: state.teach.kind, steps: state.teach.steps, closed: !!state.teach.closed} : null, logs: logs.slice(-60)});
    }
    if (req.method === "GET" && url.pathname === "/gunluk") return send(res, 200, logs.join("\n"), "text/plain");
    if (req.method !== "POST") return send(res, 404, {error: "Bulunamadı"});
    // Başka sitelerin yerel panele istek atmasını engelle.
    const origin = req.headers.origin || "";
    if (req.headers["x-vz-local"] !== "1" || (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))) return send(res, 403, {error: "İzin yok"});
    let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 500000) break; }
    const body = raw ? JSON.parse(raw) : {};
    switch (url.pathname) {
      case "/eslestir": {
        const server = String(body.server || "").trim().replace(/\/$/, "");
        if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(server) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(server)) throw new Error("Sunucu adresi https:// ile başlamalı.");
        config.server = server; config.token = "";
        const r = await api("pair", {code: body.code, name: config.name, version: VERSION});
        config.token = r.token; saveConfig(); log("Eşleştirme tamamlandı."); setTimeout(tick, 500);
        return send(res, 200, {ok: true}); }
      case "/ayar": {
        if (body.ministryUrl && allowedHost(body.ministryUrl)) config.ministryUrl = body.ministryUrl;
        for (const p of ["gib", "efatura", "esmm"]) {
          const v = body.portals?.[p];
          if (typeof v !== "string") continue;
          if (v && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(v) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(v)) throw new Error(PORTAL_NAME[p] + " adresi https:// ile başlamalı.");
          if (config.portals[p] !== v) { config.portals[p] = v; state.portals[p] = "unknown"; }
        }
        saveConfig(); return send(res, 200, {ok: true}); }
      case "/giris": login(PORTALS.includes(body.portal) ? body.portal : "ministry"); return send(res, 200, {ok: true});
      case "/whatsapp/bagla": whatsapp.link().catch(e => log("WhatsApp bağlanamadı: " + e.message)); return send(res, 200, {ok: true});
      case "/whatsapp/kaldir": await whatsapp.logout(); return send(res, 200, {ok: true});
      case "/kontrol": { const p = PORTALS.includes(body.portal) ? body.portal : "ministry"; await checkSession(p); return send(res, 200, {ok: true, state: portalState(p)}); }
      case "/ogret/baslat": await teachStart(body.kind, body.url); return send(res, 200, {ok: true});
      case "/ogret/isaretle": await teachMark(body.mode); return send(res, 200, {ok: true});
      case "/ogret/kaydet": await teachSave(body.steps); return send(res, 200, {ok: true});
      case "/ogret/vazgec": await teachCancel(); return send(res, 200, {ok: true});
      default: return send(res, 404, {error: "Bulunamadı"});
    }
  } catch (e) { return send(res, 400, {error: e.message}); }
});
server.on("error", e => {
  if (e.code === "EADDRINUSE") { console.log("Ajan bu bilgisayarda zaten çalışıyor: http://127.0.0.1:" + PORT); process.exit(0); }
  throw e;
});
server.listen(PORT, "127.0.0.1", () => log(`VetZimo Bakanlık köprüsü ${VERSION} çalışıyor · panel: http://127.0.0.1:${PORT}`));
