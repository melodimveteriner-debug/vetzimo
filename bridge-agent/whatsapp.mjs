// VetZimo · WhatsApp Web modülü (klinik bilgisayarındaki ajan).
// Kliniğin KENDİ WhatsApp numarası, WhatsApp Web'e "bağlı cihaz" olarak bir kez QR ile bağlanır. Klinik panelinde
// "Otomatik WhatsApp" seçildiyse hatırlatma, toplu mesaj ve gelen kutusu yanıtları bu numaradan gider; gelen mesajlar
// VetZimo gelen kutusuna aktarılır. Hız sınırları sunucuda, insan benzeri bekleme süreleri burada uygulanır.
import fs from "node:fs";
import path from "node:path";

const READY = ["#pane-side", "[data-testid='chat-list']", "div[aria-label='Sohbet listesi']", "div[aria-label='Chat list']"];
const QR = ["canvas[aria-label*='QR' i]", "div[data-ref]", "[data-testid='qrcode']"];
const COMPOSE = ["footer div[contenteditable='true'][role='textbox']", "footer div[contenteditable='true']", "div[contenteditable='true'][data-tab='10']"];
const INVALID = /geçersiz|invalid|isn.t on whatsapp|whatsapp.ta kayıtlı değil|whatsapp kullanmıyor|not on whatsapp/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

export function createWhatsApp({launchPersistent, home, api, log}) {
  const base = (process.env.VZ_WA_URL || "https://web.whatsapp.com").replace(/\/$/, "");
  const profile = path.join(home, "whatsapp-profil");
  const pendingFile = path.join(home, "whatsapp-sonuclar.json");
  const wa = {state: "off", mode: "off", context: null, page: null, busy: false, visible: false, error: "", lastInbound: 0, sentToday: 0};
  let pending = [];
  try { pending = JSON.parse(fs.readFileSync(pendingFile, "utf8")); } catch {}
  const keep = () => { try { fs.writeFileSync(pendingFile, JSON.stringify(pending)); } catch {} };

  async function any(page, selectors, timeout = 0) {
    const deadline = Date.now() + timeout;
    do {
      for (const s of selectors) { const el = await page.$(s).catch(() => null); if (el) return el; }
      if (timeout) await sleep(400);
    } while (Date.now() < deadline);
    return null;
  }

  async function open(visible) {
    if (wa.context && wa.visible === visible) return;
    await close();
    fs.mkdirSync(profile, {recursive: true});
    wa.context = await launchPersistent(profile, visible);
    wa.visible = visible;
    wa.page = wa.context.pages()[0] || await wa.context.newPage();
    wa.context.on("close", () => { wa.context = null; wa.page = null; if (wa.state !== "off") wa.state = "closed"; });
    await wa.page.goto(base, {waitUntil: "domcontentloaded", timeout: 60000});
    await detect(45000);
  }

  async function close() {
    const c = wa.context; wa.context = null; wa.page = null;
    if (c) await c.close().catch(() => {});
  }

  async function detect(timeout = 5000) {
    if (!wa.page) { wa.state = "closed"; return wa.state; }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await any(wa.page, READY)) { wa.state = "ready"; return wa.state; }
      if (await any(wa.page, QR)) { wa.state = "qr"; if (timeout < 60000) return wa.state; }
      await sleep(700);
    }
    if (wa.state !== "qr") wa.state = "error";
    return wa.state;
  }

  /** Klinik çalışanı QR kodunu telefonundaki WhatsApp › Bağlı cihazlar ile okutur. */
  async function link() {
    await open(true);
    if (wa.state === "ready") { log("WhatsApp zaten bağlı."); return; }
    log("WhatsApp Web penceresi açıldı. Kliniğin telefonunda WhatsApp › Ayarlar › Bağlı cihazlar › Cihaz bağla ile QR kodunu okutun.");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline && wa.context) {
      if (await any(wa.page, READY)) { wa.state = "ready"; log("WhatsApp bağlandı. Mesajlar artık kliniğin kendi numarasından gidebilir."); return; }
      await sleep(1500);
    }
    if (wa.state !== "ready") log("QR kodu 5 dakika içinde okutulmadı.");
  }

  async function logout() {
    await close();
    fs.rmSync(profile, {recursive: true, force: true});
    wa.state = "off";
    log("WhatsApp oturumu bu bilgisayardan kaldırıldı.");
  }

  async function send(job) {
    const page = wa.page;
    const digits = String(job.phone).replace(/\D/g, "");
    await page.goto(`${base}/send?phone=${digits}&text=${encodeURIComponent(job.body)}`, {waitUntil: "domcontentloaded", timeout: 60000});
    const deadline = Date.now() + 45000;
    let box = null;
    while (Date.now() < deadline) {
      const dialog = await page.$("div[role='dialog'], [data-animate-modal-popup='true']").catch(() => null);
      if (dialog && INVALID.test(await dialog.innerText().catch(() => ""))) throw Object.assign(new Error("Bu numara WhatsApp kullanmıyor."), {permanent: true});
      box = await any(page, COMPOSE);
      if (box && (await box.innerText().catch(() => "")).trim()) break;
      await sleep(500);
    }
    if (!box) throw new Error("WhatsApp yazma alanı açılmadı.");
    const before = await page.$$eval("[data-id^='true_'], .message-out", els => els.length).catch(() => 0);
    await sleep(rand(800, 2200)); // insan benzeri kısa bekleme
    const button = await any(page, ["button[aria-label='Gönder']", "button[aria-label='Send']", "span[data-icon='send']", "span[data-icon='wds-ic-send-filled']"]);
    if (button) await button.click(); else await box.press("Enter");
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const after = await page.$$eval("[data-id^='true_'], .message-out", els => els.length).catch(() => before);
      if (after > before) {
        // Saat simgesi (gönderiliyor) kaybolana kadar kısa süre bekle.
        for (let i = 0; i < 20; i++) {
          const clock = await page.$("[data-id^='true_']:last-of-type span[data-icon='msg-time'], .message-out:last-of-type span[data-icon='msg-time']").catch(() => null);
          if (!clock) break;
          await sleep(500);
        }
        return;
      }
      await sleep(500);
    }
    throw new Error("Mesajın gönderildiği doğrulanamadı.");
  }

  /** Okunmamış bireysel sohbetlerdeki gelen mesajları toplar (grup sohbetleri alınmaz). */
  async function inbound() {
    const page = wa.page, out = [];
    const unread = await page.$$("#pane-side [aria-label*='okunmamış' i], #pane-side [aria-label*='unread' i]").catch(() => []);
    for (const badge of unread.slice(0, 8)) {
      const row = await badge.evaluateHandle(el => el.closest("[role='listitem'], [role='row'], div[tabindex='-1']") || el.parentElement).catch(() => null);
      if (!row) continue;
      await row.asElement().click().catch(() => {});
      await sleep(rand(1200, 2000));
      const name = await page.$eval("#main header span[dir='auto'], header span[title]", el => el.getAttribute("title") || el.textContent).catch(() => "");
      const messages = await page.$$eval("[data-id^='false_']", els => els.slice(-20).map(el => ({
        id: el.getAttribute("data-id"),
        body: (el.querySelector(".selectable-text, .copyable-text span, span[dir]")?.innerText || el.innerText || "").trim(),
        pre: el.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || ""}))).catch(() => []);
      for (const m of messages) {
        const match = /^false_(\d{8,15})@c\.us_/.exec(m.id || "");
        if (!match || !m.body) continue; // grup (@g.us) ve numarası gizli (@lid) sohbetler atlanır
        out.push({id: m.id, phone: match[1], name: (name || "").trim(), body: m.body.slice(0, 4000)});
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    return out;
  }

  /** Ajanın ana döngüsünden yaklaşık 20 saniyede bir çağrılır. */
  async function tick() {
    if (wa.busy) return;
    wa.busy = true;
    try {
      if (wa.mode === "auto" && !wa.context && fs.existsSync(profile)) await open(process.env.VZ_WA_VISIBLE === "1");
      if (wa.context) await detect(3000);
      let incoming = [];
      if (wa.mode === "auto" && wa.state === "ready" && Date.now() - wa.lastInbound > 60000) {
        incoming = await inbound().catch(e => { log("WhatsApp gelen mesajlar okunamadı: " + e.message); return []; });
        wa.lastInbound = Date.now();
      }
      const reply = await api("wa-sync", {state: wa.context ? wa.state : (fs.existsSync(profile) ? "closed" : "off"), error: wa.error, results: pending, inbound: incoming});
      pending = []; keep();
      wa.mode = reply.mode || "off";
      if (incoming.length) log(incoming.length + " WhatsApp mesajı VetZimo gelen kutusuna aktarıldı.");
      if (wa.mode !== "auto" && wa.context && !wa.visible) await close();
      for (const job of reply.jobs || []) {
        try {
          await send(job);
          pending.push({id: job.id, status: "sent"});
          log("WhatsApp gönderildi → " + String(job.phone).slice(0, -4) + "••••");
        } catch (e) {
          pending.push({id: job.id, status: "failed", error: e.message.slice(0, 280)});
          log("WhatsApp gönderilemedi: " + e.message);
        }
        keep();
        const delay = Number(process.env.VZ_WA_DELAY_MS || 0) || rand(1500, 4000); // asıl aralığı sunucu belirler (Telefon Bağlantısı ayarı)
        await sleep(delay);
      }
      wa.error = "";
    } catch (e) {
      wa.error = e.message;
      if (e.status === 401) throw e;
    } finally { wa.busy = false; }
  }

  return {state: () => ({state: wa.context ? wa.state : (fs.existsSync(profile) ? "closed" : "off"), mode: wa.mode, error: wa.error, visible: wa.visible}), tick, link, logout, close};
}
