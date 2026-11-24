// Klinik web sitesi · ziyaretçi asistanı. Yalnızca sayfada zaten yayımlanan bilgileri kullanır;
// hiçbir yere veri göndermez, konuşma yalnızca bu sekmede tutulur.
const source = document.getElementById("site-assistant-data");
let info = null;
try { info = JSON.parse(source?.textContent || "null"); } catch { info = null; }

if (info && typeof info === "object" && !document.querySelector(".sa-launcher")) mount(info);

function fold(text) {
  return String(text ?? "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const has = (text, ...words) => words.some(word => new RegExp("(^|\\s)" + word).test(text));
const days = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const urgentWords = ["zehir", "nefes alam", "nefes darligi", "solunum", "bayild", "bilinc", "kriz", "nobet", "kasilma", "kanama", "kaniyor", "kan kus", "kanli", "carpti", "araba carp", "dustu", "yuksekten", "kirik", "dogum", "doguramiyor", "sancisi", "karin sis", "karni sis", "idrar yapamiyor", "cis yapamiyor", "surekli kus", "durmadan kus", "yutmus", "yuttu", "sicak carp", "yanik", "isirdi", "goz yaral", "felc", "yuruyemiyor", "uyanmiyor", "tepki vermiyor", "yuksek ates"];

function istanbulNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"})
    .formatToParts(new Date()).map(({type, value}) => [type, value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1};
}
const ranges = (hours, day) => Array.isArray(hours?.[day]) ? hours[day].filter(range => Array.isArray(range) && range.length === 2) : [];
function openState(branch) {
  const now = istanbulNow();
  const holiday = (info.holidays || []).includes(now.date);
  const today = holiday ? [] : ranges(branch.hours, now.weekday);
  const open = today.some(([from, to]) => from <= now.time && now.time < to);
  let next = "";
  if (!open) {
    const later = today.find(([from]) => from > now.time);
    if (later) next = "Bugün " + later[0] + "’da açılıyor.";
    else for (let step = 1; step <= 7; step++) {
      const day = (now.weekday - 1 + step) % 7 + 1;
      const first = ranges(branch.hours, day)[0];
      if (first) { next = (step === 1 ? "Yarın" : days[day - 1]) + " " + first[0] + "’da açılıyor."; break; }
    }
  }
  return {open, holiday, today, next};
}

function engine(text) {
  const t = fold(text);
  const phone = info.phone || info.branches.find(branch => branch.phone)?.phone || "";
  const tel = number => "tel:" + String(number).replace(/[^\d+]/g, "");
  const callLinks = () => [
    phone ? ["Hemen ara", tel(phone)] : null,
    info.whatsapp ? ["WhatsApp", "https://wa.me/" + info.whatsapp.replace(/\D/g, "")] : null,
  ].filter(Boolean);
  const contactLinks = () => [...callLinks(), info.links.contact ? ["İletişim sayfası", info.links.contact] : null].filter(Boolean);

  if (urgentWords.some(word => t.includes(word))) {
    return {urgent: true, text: "Bu durum acil olabilir.", note: phone
      ? "Lütfen beklemeden kliniği arayın ve hayvanınızı en kısa sürede getirin. Klinik kapalıysa ve ulaşamıyorsanız en yakın 7/24 açık veteriner kliniğine başvurun. Bu asistan tanı koymaz."
      : "Lütfen beklemeden bir veteriner hekime başvurun; klinik kapalıysa en yakın 7/24 açık veteriner kliniğine gidin. Bu asistan tanı koymaz.", links: callLinks()};
  }
  if (!t || has(t, "merhaba", "selam", "yardim", "ne yapabilir", "iyi gunler", "gunaydin")) return help();

  if (has(t, "acik mi", "acikmi", "kapali", "saat", "kacta", "kaca kadar", "calisma", "mesai", "pazar", "cumartesi", "bayram", "tatil")) {
    if (!info.branches.some(branch => Object.keys(branch.hours || {}).length)) return {text: "Çalışma saatleri sitede yayımlanmamış.", note: "Güncel saatler için kliniği arayın.", links: contactLinks()};
    const rows = info.branches.filter(branch => Object.keys(branch.hours || {}).length).map(branch => {
      const state = openState(branch);
      const today = state.holiday ? "Bugün tatil" : state.today.length ? "Bugün " + state.today.map(range => range.join("–")).join(" / ") : "Bugün kapalı";
      return {branch, state, today};
    });
    const one = rows.length === 1 ? rows[0] : null;
    return {
      text: one ? (one.state.open ? "Şu an açığız." : "Şu an kapalıyız." + (one.state.next ? " " + one.state.next : "")) : "Şubelerimizin durumu:",
      items: rows.map(({branch, state, today}) => [branch.name, (state.open ? "Açık · " : "Kapalı · ") + today]),
      table: rows.length === 1 ? days.map((day, index) => [day, ranges(one.branch.hours, index + 1).map(range => range.join("–")).join(" / ") || "Kapalı"]) : null,
      links: info.links.booking ? [["Randevu al", info.links.booking]] : contactLinks(),
    };
  }
  if (has(t, "adres", "nerede", "nerde", "konum", "yol tarif", "harita", "nasil gel", "otopark", "ulasim")) {
    const items = info.branches.filter(branch => branch.address).map(branch => [branch.name, branch.address, branch.directions || ""]);
    if (!info.address && !items.length) return {text: "Adres bilgisi sitede yayımlanmamış.", links: contactLinks()};
    return {text: info.address ? "Adresimiz: " + info.address : "Şube adreslerimiz:", items: info.address && items.length < 2 ? null : items,
      note: has(t, "otopark", "ulasim") && info.note ? info.note : "",
      links: [info.directions ? ["Yol tarifi al", info.directions] : null, ...callLinks()].filter(Boolean)};
  }
  if (has(t, "randevu", "muayene ol", "getirebilir", "gelebilir", "rezervasyon")) {
    return info.links.booking
      ? {text: "Online randevu alabilirsiniz. Uygun saati seçip formu doldurmanız yeterli.", links: [["Randevu al", info.links.booking], ...callLinks()]}
      : {text: "Randevu için kliniği arayabilir veya mesaj gönderebilirsiniz.", links: contactLinks()};
  }
  if (has(t, "fiyat", "ucret", "ne kadar", "kac para", "kac tl", "tutar", "kampanya", "indirim", "odeme", "taksit", "kredi kart")) {
    return info.note
      ? {text: "Kliniğimizin paylaştığı bilgi:", note: info.note, links: contactLinks()}
      : {text: "Ücretler hayvanın türüne, kilosuna ve yapılacak işleme göre değişir.", note: "Güncel fiyat bilgisi için kliniği arayın.", links: contactLinks()};
  }
  if (has(t, "telefon", "numara", "ara", "iletisim", "whatsapp", "mail", "e posta", "eposta", "ulas", "mesaj")) {
    return {text: "Bize şu yollarla ulaşabilirsiniz:", items: [
      phone ? ["Telefon", phone, tel(phone)] : null, info.whatsapp ? ["WhatsApp", info.whatsapp, "https://wa.me/" + info.whatsapp.replace(/\D/g, "")] : null,
      info.email ? ["E-posta", info.email, "mailto:" + info.email] : null,
      ...info.branches.filter(branch => branch.phone).map(branch => [branch.name, branch.phone, tel(branch.phone)]),
    ].filter(Boolean), links: info.links.contactForm ? [["Mesaj gönder", info.links.contact]] : info.links.contact ? [["İletişim sayfası", info.links.contact]] : []};
  }
  if (has(t, "mikrocip", "cip", "petvet", "kimlik", "kayit ettir", "pasaport")) {
    return {text: "Mikroçip ve PETVET kaydı", note: "Kedi, köpek ve gelinciklerin mikroçip takılarak PETVET sistemine kaydedilmesi yasal zorunluluktur. Çip takma ve kayıt işlemi veteriner kliniğinde birkaç dakikada yapılır; kimlik bilgilerinizi yanınızda getirin. Yurt dışı seyahati için ayrıca pet pasaportu ve kuduz antikor testi gerekebilir.", links: info.links.booking ? [["Randevu al", info.links.booking], ...callLinks()] : contactLinks()};
  }
  if (has(t, "asi", "karma", "kuduz", "parazit", "pire", "kene", "ic parazit", "dis parazit", "yavru")) {
    return {text: "Aşı ve parazit takvimi hakkında genel bilgi", items: [
      ["Yavru köpek", "6–8 haftalıkken karma aşıya başlanır, 16 haftalık olana dek 2–4 haftada bir tekrarlanır."],
      ["Yavru kedi", "6–8 haftalıkken karma aşıya başlanır, 16 haftalık olana dek 3–4 haftada bir tekrarlanır."],
      ["Kuduz", "Genellikle 3 aylıktan sonra yapılır ve her yıl tekrarlanır."],
      ["Parazit", "İç ve dış parazit uygulamaları yaşa ve yaşam koşullarına göre düzenli aralıklarla yapılır."],
    ], note: "Takvimi hayvanınızın yaşına, sağlığına ve geçmiş aşılarına göre hekimimiz belirler. Aşı karnenizi gelirken yanınızda getirin.", links: info.links.booking ? [["Aşı randevusu al", info.links.booking]] : contactLinks()};
  }
  if (has(t, "kayip", "kayboldu", "kacti", "bulamiyorum", "sokakta buldum", "buldum")) {
    return {text: has(t, "buldum") ? "Bulduğunuz hayvan için" : "Kaybolan dostunuz için", items: has(t, "buldum")
      ? [["1", "Hayvanı güvenli bir yere alın, su verin."], ["2", "Kliniğe getirin; mikroçip okutarak sahibine ulaşmaya çalışalım."], ["3", "Yaralıysa beklemeden kliniği arayın."]]
      : [["1", "Mikroçip kaydındaki telefonunuzun güncel olduğundan emin olun."], ["2", "Çevredeki veteriner kliniklerine, belediyenin hayvan barınağına ve mahalle gruplarına fotoğrafıyla haber verin."], ["3", "Kaybolduğu yerin yakınına onun kokusunu taşıyan eşyalar bırakın ve çevreyi sakin saatlerde arayın."]],
      links: callLinks()};
  }
  if (has(t, "ameliyat", "operasyon", "kisirlas", "dikis", "yaka", "koni", "narkoz", "taburcu")) {
    return {text: "Ameliyat sonrası genel bakım", items: [
      ["Yara", "Dikiş yerini kuru ve temiz tutun; yalamasını önlemek için koruyucu yakalığı çıkarmayın."],
      ["Beslenme", "Narkozdan sonraki ilk saatlerde az miktarda su ve hekiminizin önerdiği zamanda hafif mama verin."],
      ["Hareket", "Dikişler alınana kadar zıplama, koşma ve banyodan kaçının."],
      ["İlaçlar", "Verilen ilaçları hekiminizin söylediği doz ve saatte uygulayın."],
    ], note: "Kanama, belirgin şişlik, akıntı, kusma, iştahsızlık veya halsizlik görürseniz hemen kliniği arayın.", links: [...callLinks(), info.links.homeCare ? ["Evden takip", info.links.homeCare] : null].filter(Boolean)};
  }
  if (has(t, "evde", "eve gel", "adrese", "ev ziyaret", "transfer")) {
    return info.links.homeVisit
      ? {text: "Evde hizmet için talep gönderebilirsiniz; klinik size dönüş yapar.", links: [["Evde hizmet talep et", info.links.homeVisit]]}
      : {text: "Evde hizmet için kliniği arayarak bilgi alabilirsiniz.", links: contactLinks()};
  }
  if (has(t, "takip", "evden takip", "gozlem", "foto gonder")) {
    return info.links.homeCare ? {text: "Tedavi sürecindeki gözlemlerinizi ve fotoğraflarınızı Evden Takip sayfasından kliniğe iletebilirsiniz.", links: [["Evden takip", info.links.homeCare]]} : null;
  }
  const services = info.services || [];
  const words = t.split(" ").filter(word => word.length > 3 && !["var", "mi", "mu", "yapiyor", "musunuz", "misiniz", "hizmet", "hizmetler", "hizmetleriniz", "neler"].includes(word));
  const matched = services.filter(service => words.some(word => fold(service).includes(word.slice(0, Math.max(4, word.length - 2)))));
  if (has(t, "hizmet", "neler yap", "tedavi", "cerrahi", "ultrason", "rontgen", "tahlil", "laboratuvar", "dis ", "tirnak", "tiras", "bakim", "pansiyon", "otel") || matched.length) {
    if (matched.length) return {text: "Evet, bu hizmet listemizde var:", items: matched.slice(0, 8).map(service => [service, ""]), links: info.links.booking ? [["Randevu al", info.links.booking], ...callLinks()] : contactLinks()};
    if (services.length) return {text: words.length && !has(t, "hizmetler", "neler yap") ? "Bu hizmeti listemizde göremedim. Hizmetlerimiz:" : "Hizmetlerimiz:", items: services.slice(0, 20).map(service => [service, ""]),
      note: words.length ? "Listede olmayan bir işlem için kliniği arayarak bilgi alabilirsiniz." : "", links: contactLinks()};
    return {text: "Hizmet listesi sitede yayımlanmamış.", links: [info.links.about ? ["Hakkımızda", info.links.about] : null, ...contactLinks()].filter(Boolean)};
  }
  return {text: "Bu konuda en doğru bilgiyi kliniğimiz verebilir.", note: "Çalışma saatleri, adres, randevu, hizmetler, aşı takvimi, mikroçip, kayıp hayvan ve ameliyat sonrası bakım hakkında sorabilirsiniz.", links: contactLinks()};
}

function help() {
  return {text: "Merhaba! " + (info.clinic ? info.clinic + " ziyaretçi asistanıyım." : "Ziyaretçi asistanıyım.") + " Size nasıl yardımcı olabilirim?",
    note: "Sorularınız yalnızca bu sayfada yanıtlanır, hiçbir yere gönderilmez. Acil bir durumda lütfen kliniği arayın."};
}

function mount() {
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) if (child != null && child !== false) node.append(child);
    return node;
  };
  const safeHref = href => /^(https?:|tel:|mailto:|\/)/i.test(String(href || "")) ? href : "";
  const launcher = el("button", {type: "button", className: "sa-launcher", innerHTML: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><circle cx="9" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="10.5" r="1" fill="currentColor"/><circle cx="15" cy="10.5" r="1" fill="currentColor"/></svg>'});
  launcher.setAttribute("aria-label", "Sorunuz mu var? Asistanı açın");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "saPanel");
  const log = el("div", {className: "sa-log"});
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const input = el("input", {type: "text", className: "sa-input", maxLength: 300, placeholder: "Sorunuzu yazın", autocomplete: "off", enterKeyHint: "send"});
  input.setAttribute("aria-label", "Asistana sorunuz");
  const send = el("button", {type: "submit", className: "sa-send", innerHTML: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>'});
  send.setAttribute("aria-label", "Gönder");
  const form = el("form", {className: "sa-form"}, input, send);
  const chips = el("div", {className: "sa-chips"});
  const close = el("button", {type: "button", className: "sa-close", textContent: "×"});
  close.setAttribute("aria-label", "Asistanı kapat");
  const panel = el("section", {className: "sa-panel", id: "saPanel", hidden: true},
    el("header", {className: "sa-head"}, el("div", {}, el("strong", {textContent: info.clinic || "Klinik asistanı"}), el("small", {textContent: "Ziyaretçi asistanı"})), close),
    log, chips, form);
  panel.setAttribute("aria-label", "Ziyaretçi asistanı");
  document.body.append(launcher, panel);

  const suggestions = ["Şu an açık mısınız?", info.links.booking ? "Randevu almak istiyorum" : "Nasıl ulaşırım?", "Adresiniz nerede?", "Hizmetleriniz neler?", "Aşı takvimi", "Mikroçip ve PETVET", "Ameliyat sonrası bakım"];
  chips.append(...suggestions.map(label => {
    const chip = el("button", {type: "button", className: "sa-chip", textContent: label});
    chip.addEventListener("click", () => ask(label));
    return chip;
  }));

  const add = (role, node) => { const item = el("div", {className: "sa-msg sa-" + role}, node); log.append(item); log.scrollTop = log.scrollHeight; };
  function render(result) {
    const box = el("div", {className: "sa-answer" + (result.urgent ? " sa-urgent" : "")}, el("p", {className: "sa-lead", textContent: result.text}));
    if (result.items?.length) box.append(el("ul", {className: "sa-items"}, ...result.items.map(([label, detail, href]) => {
      const target = safeHref(href);
      return el("li", {}, target ? el("a", {href: target, textContent: label}) : el("strong", {textContent: label}), detail ? el("span", {textContent: detail}) : null);
    })));
    if (result.table?.length) box.append(el("dl", {className: "sa-hours"}, ...result.table.map(([day, hours]) => el("div", {}, el("dt", {textContent: day}), el("dd", {textContent: hours})))));
    if (result.note) box.append(el("p", {className: "sa-note", textContent: result.note}));
    const links = (result.links || []).map(([label, href]) => [label, safeHref(href)]).filter(([, href]) => href);
    if (links.length) box.append(el("div", {className: "sa-links"}, ...links.map(([label, href]) => {
      const link = el("a", {className: "sa-link", href, textContent: label});
      if (/^https:\/\/wa\.me\//.test(href)) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
      return link;
    })));
    return box;
  }
  function ask(question) {
    const text = String(question || "").trim().slice(0, 300);
    if (!text) return;
    add("user", el("p", {textContent: text}));
    let result;
    try { result = engine(text); } catch { result = null; }
    add("bot", render(result || {text: "Bu konuda en doğru bilgiyi kliniğimiz verebilir.", links: info.links.contact ? [["İletişim sayfası", info.links.contact]] : []}));
  }
  let greeted = false;
  const setOpen = open => {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.classList.toggle("is-open", open);
    if (open && !greeted) { greeted = true; add("bot", render(help())); }
    if (open) setTimeout(() => input.focus({preventScroll: true}), 30);
    else launcher.focus({preventScroll: true});
  };
  launcher.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", event => { if (event.key === "Escape") setOpen(false); });
  form.addEventListener("submit", event => { event.preventDefault(); const value = input.value; input.value = ""; ask(value); });
}
