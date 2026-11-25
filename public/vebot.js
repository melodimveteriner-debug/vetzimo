// VeBot · VetZimo klinik asistanı.
// Tamamen tarayıcıda çalışır: soruları kliniğin ekranda zaten yüklü olan verisiyle yanıtlar,
// hiçbir veriyi dış servise göndermez, istek sınırı veya ücret yoktur.
// Yalnızca kullanıcının görmeye yetkili olduğu koleksiyonları okur (ctx.data izin süzgecinden geçer).
// Metinler Türkçe kalıp anahtarlarıdır; ui-copy.js bunları seçili dile çevirir.

import {interpretLabs} from "./lab-interpret.js?v=20261124-r2";
import {vetAnswer, KNOWLEDGE_EXAMPLES} from "./vet-knowledge.js?v=1";

const TZ = "Europe/Istanbul";
const isoDay = new Intl.DateTimeFormat("en-CA", {timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit"});
const todayISO = () => isoDay.format(new Date());
const addDays = (date, days) => {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const weekStart = date => addDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
const cents = value => Math.round(Number(String(value ?? "").replace(",", ".") || 0) * 100);
const money = value => new Intl.NumberFormat(document.documentElement.lang || "tr", {style:"currency", currency:"TRY"}).format(value / 100);
const count = value => new Intl.NumberFormat(document.documentElement.lang || "tr").format(value);
const dateText = date => date ? new Intl.DateTimeFormat(document.documentElement.lang || "tr", {timeZone:"UTC", day:"numeric", month:"short", year:"numeric"}).format(new Date(date + "T12:00:00Z")) : "—";
const fill = (template, ...values) => template.replace(/\{(\d)\}/g, (_, index) => String(values[index] ?? ""));
const norm = value => String(value ?? "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const day = row => String(row?.date || row?.start || "").slice(0, 10);
const inRange = (row, [from, to]) => { const value = day(row); return value >= from && value <= to; };
const active = row => row && row.status !== "İptal" && row.archived !== "Evet";

// ---- Dönem ----
function period(text, fallback = "today") {
  const t = norm(text), now = todayISO();
  const last = t.match(/\b(?:son|last|past)\s+(\d{1,3})\s*(?:gun|days?)\b/);
  if (last) { const n = Math.min(365, Math.max(1, Number(last[1]))); return {range:[addDays(now, 1 - n), now], label:fill("Son {0} gün", n)}; }
  const table = [
    [/\b(dun(?:ku)?\b|yesterday)/, () => [addDays(now, -1), addDays(now, -1)], "Dün"],
    [/\b(yarin|tomorrow)/, () => [addDays(now, 1), addDays(now, 1)], "Yarın"],
    [/\b(gecen|onceki) hafta|\blast week\b/, () => { const s = addDays(weekStart(now), -7); return [s, addDays(s, 6)]; }, "Geçen hafta"],
    [/\bbu hafta|\bthis week\b|\bhaftalik\b|\bweekly\b/, () => [weekStart(now), now], "Bu hafta"],
    [/\b(gecen|onceki) ay|\blast month\b/, () => { const d = new Date(now.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); const s = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return [s, d.toISOString().slice(0, 10)]; }, "Geçen ay"],
    [/\bbu ay|\bthis month\b|\baylik\b|\bmonthly\b/, () => [now.slice(0, 7) + "-01", now], "Bu ay"],
    [/\bbu yil|\bthis year\b|\byillik\b|\byearly\b/, () => [now.slice(0, 4) + "-01-01", now], "Bu yıl"],
    [/\b(bugun|today)/, () => [now, now], "Bugün"],
  ];
  for (const [pattern, range, label] of table) if (pattern.test(t)) return {range:range(), label};
  const named = {today:[[now, now], "Bugün"], week:[[weekStart(now), now], "Bu hafta"], month:[[now.slice(0, 7) + "-01", now], "Bu ay"]};
  return {range:named[fallback][0], label:named[fallback][1]};
}

function previousRange([from, to]) {
  const days = Math.round((new Date(to + "T12:00:00Z") - new Date(from + "T12:00:00Z")) / 86400000) + 1;
  return [addDays(from, -days), addDays(from, -1)];
}

// ---- Laboratuvar sonucunu okuma ----
// "HCT: 32 % (37-55)" veya "WBC 18,2 10^9/L 6-17" gibi satırları referans aralığıyla karşılaştırır.
export function labFlags(text) {
  const num = /[-+]?\d+(?:[.,]\d+)?/;
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const head = line.match(/^\s*([\p{L}][\p{L}\p{N} ./%#()-]{0,28}?)\s*[:=\t ]\s*([-+]?\d+(?:[.,]\d+)?)(.*)$/u);
    if (!head) continue;
    const [, name, raw, rest] = head;
    // Referans aralığı satırın son "alt - üst" sayı çiftidir; arada kalan metin birimdir (10^9/L, %, mg/dL…).
    const ranges = [...rest.matchAll(/([-+]?\d+(?:[.,]\d+)?)\s*[-–—]\s*([-+]?\d+(?:[.,]\d+)?)/g)];
    const range = ranges.at(-1);
    if (!range) continue;
    const unit = rest.slice(0, range.index).replace(/[()\[\]]|ref(?:erans)?\.?:?/giu, " ").replace(/\s+/g, " ").trim().slice(0, 16);
    const value = Number(raw.replace(",", ".")), low = Number(range[1].replace(",", ".")), high = Number(range[2].replace(",", "."));
    if (![value, low, high].every(Number.isFinite) || low > high || num.test(unit) && !/\^/.test(unit)) continue;
    out.push({name:name.trim(), value:raw, unit, low:range[1], high:range[2], status:value < low ? "low" : value > high ? "high" : "normal"});
    if (out.length >= 40) break;
  }
  return out;
}

// ---- Acil belirti uyarısı (tanı koymaz, yalnız yönlendirir) ----
const urgent = [
  /zehir|ilac yuttu|cikolata yedi|fare zehri|antifriz|poison/,
  /nefes alam|solunum sikintisi|bogul|morar|can'?t breathe|breathing/,
  /durmayan kanama|siddetli kanama|bleeding/,
  /nobet|havale|kasilma|seizure/,
  /karin sis|mide donme|gdv|bloat/,
  /idrar yapam|idrara cikam|cannot urinate/,
  /bayild|bilinc|yere yigil|collapse|unconscious/,
  /arac carp|araba carp|yuksekten dus|hit by a car/,
  /sicak carp|heat ?stroke/,
  /dogum.*(zorlan|2 saat|ilerlem)|dystocia/,
];
export const isUrgent = text => urgent.some(pattern => pattern.test(norm(text)));

// ---- Yanıt motoru ----
export function createEngine(ctx) {
  const rows = name => { try { return (ctx.data(name) || []).filter(Boolean); } catch { return []; } };
  const can = name => { try { return !!ctx.can(name); } catch { return false; } };
  const nameOf = (collection, id) => rows(collection).find(row => row.id === id)?.name || "";
  const saleAmount = row => cents(row.amount);
  const lines = row => { try { const list = JSON.parse(row.items || "[]"); return Array.isArray(list) ? list : []; } catch { return []; } };

  const answer = (text, parts = {}) => ({text, ...parts});
  const denied = label => answer(fill("{0} bölümünü görme yetkiniz yok.", label));

  function sales(text) {
    if (!can("sales")) return denied("Satış ve Tahsilat");
    const p = period(text, "today"), list = rows("sales").filter(row => active(row) && inRange(row, p.range));
    const total = list.reduce((sum, row) => sum + saleAmount(row), 0);
    const prev = rows("sales").filter(row => active(row) && inRange(row, previousRange(p.range))).reduce((sum, row) => sum + saleAmount(row), 0);
    const change = prev ? Math.round((total - prev) * 100 / prev) : null;
    return answer(fill("Toplam satış (ciro) · {0}", p.label), {
      stats:[[fill("{0} satış", count(list.length)), money(total)], ["Önceki dönem", money(prev)], ...(change === null ? [] : [["Değişim", (change > 0 ? "+" : "") + change + "%"]])],
      links:[["Satışları aç", "#sales"]],
    });
  }

  function receipts(text) {
    if (!can("sales") && !can("expenses")) return denied("Kasa ve Muhasebe");
    const p = period(text, "today");
    const first = can("sales") ? rows("sales").filter(row => active(row) && inRange(row, p.range)).reduce((sum, row) => sum + cents(row.paid), 0) : 0;
    const later = can("sales") ? rows("collections").filter(row => inRange(row, p.range)).reduce((sum, row) => sum + cents(row.amount), 0) : 0;
    const other = can("expenses") ? rows("expenses").filter(row => row.type === "Gelir" && inRange(row, p.range)).reduce((sum, row) => sum + cents(row.amount), 0) : 0;
    const spent = can("expenses") ? rows("expenses").filter(row => row.type === "Gider" && inRange(row, p.range)).reduce((sum, row) => sum + cents(row.amount), 0) : 0;
    return answer(fill("Kasa özeti · {0}", p.label), {
      stats:[["Satışlardan ilk tahsilat", money(first)], ["Sonradan yapılan tahsilat", money(later)], ["Diğer gelir", money(other)], ["Gider", money(spent)], ["Net", money(first + later + other - spent)]],
      links:[["Kasayı aç", "#cash"]],
    });
  }

  function expenses(text) {
    if (!can("expenses")) return denied("Kasa ve Muhasebe");
    const p = period(text, "month"), list = rows("expenses").filter(row => row.type === "Gider" && inRange(row, p.range));
    const total = list.reduce((sum, row) => sum + cents(row.amount), 0);
    const top = list.slice().sort((a, b) => cents(b.amount) - cents(a.amount)).slice(0, 5);
    return answer(fill("Giderler · {0}", p.label), {
      stats:[[fill("{0} hareket", count(list.length)), money(total)]],
      items:top.map(row => [fill("{0} · {1}", row.detail || "—", money(cents(row.amount))), dateText(day(row))]),
      links:[["Kasayı aç", "#cash"]],
    });
  }

  function debts() {
    if (!can("sales")) return denied("Satış ve Tahsilat");
    const paidLater = new Map();
    for (const row of rows("collections")) paidLater.set(row.sale, (paidLater.get(row.sale) || 0) + cents(row.amount));
    const byClient = new Map();
    for (const row of rows("sales").filter(active)) {
      const rest = saleAmount(row) - cents(row.paid) - (paidLater.get(row.id) || 0);
      if (rest > 0) byClient.set(row.client || "", (byClient.get(row.client || "") || 0) + rest);
    }
    const total = [...byClient.values()].reduce((sum, value) => sum + value, 0);
    const top = [...byClient].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return answer("Açık bakiyeler (alacaklar)", {
      stats:[[fill("{0} müşteri", count(byClient.size)), money(total)]],
      items:top.map(([client, value]) => [fill("{0} · {1}", client ? nameOf("clients", client) || "—" : "Müşterisiz satış", money(value)), ""]),
      links:[["Satışları aç", "#sales"]],
    });
  }

  function stock(text) {
    if (!can("products")) return denied("Ürün ve Stok");
    const tracked = rows("products").filter(row => active(row) && row.track !== "Hayır" && row.category !== "Hizmet");
    const t = norm(text);
    if (/skt|son kullanma|miad|expir|bozul/.test(t)) {
      const now = todayISO(), limit = addDays(now, 30), lots = [];
      for (const product of tracked) {
        const own = rows("stockLots").filter(lot => lot.product === product.id && Number(lot.remaining) > 0);
        const list = own.length ? own : (product.expiry && Number(product.stock) > 0 ? [{expiry:product.expiry, remaining:product.stock}] : []);
        for (const lot of list) if (lot.expiry && lot.expiry <= limit) lots.push({product, lot});
      }
      lots.sort((a, b) => a.lot.expiry.localeCompare(b.lot.expiry));
      return answer("Son kullanma tarihi yaklaşan veya geçen ürünler", {
        stats:[["Geçmiş", count(lots.filter(item => item.lot.expiry < now).length)], ["30 gün içinde", count(lots.filter(item => item.lot.expiry >= now).length)]],
        items:lots.slice(0, 10).map(({product, lot}) => [fill("{0} · {1} adet", product.name, count(Number(lot.remaining))), dateText(lot.expiry), "#product/" + encodeURIComponent(product.id)]),
        empty:"Son kullanma tarihi yaklaşan ürün yok.",
      });
    }
    const critical = tracked.filter(row => Number(row.stock) <= Number(row.min || 0)).sort((a, b) => Number(a.stock) - Number(b.stock));
    return answer("Kritik seviyedeki stoklar", {
      stats:[["Kritik ürün", count(critical.length)], ["İzlenen ürün", count(tracked.length)]],
      items:critical.slice(0, 12).map(row => [fill("{0} · stok {1} / en az {2}", row.name, count(Number(row.stock || 0)), count(Number(row.min || 0))), "", "#product/" + encodeURIComponent(row.id)]),
      empty:"Kritik seviyede stok yok.",
      links:[["Stoğu aç", "#products"]],
    });
  }

  function topSellers(text) {
    if (!can("sales")) return denied("Satış ve Tahsilat");
    const p = period(text, "month"), totals = new Map();
    for (const sale of rows("sales").filter(row => active(row) && inRange(row, p.range))) {
      const list = lines(sale);
      for (const line of list.length ? list : [{name:sale.detail || "—", quantity:1, price:Number(sale.amount) || 0}]) {
        const key = String(line.name || "—").trim() || "—";
        const item = totals.get(key) || {quantity:0, amount:0};
        item.quantity += Number(line.quantity) || 1;
        item.amount += line.legacyAmount ? cents(line.legacyAmount) : cents(line.price) * (Number(line.quantity) || 1);
        totals.set(key, item);
      }
    }
    const top = [...totals].sort((a, b) => b[1].quantity - a[1].quantity || b[1].amount - a[1].amount).slice(0, 8);
    return answer(fill("En çok satılan ürün ve hizmetler · {0}", p.label), {
      items:top.map(([name, item]) => [fill("{0} · {1} adet", name, count(item.quantity)), money(item.amount)]),
      empty:"Bu dönemde satış kaydı yok.",
    });
  }

  function appointments(text) {
    if (!can("appointments")) return denied("Randevular");
    const p = period(text, "today"), list = rows("appointments").filter(row => active(row) && inRange(row, p.range))
      .sort((a, b) => (day(a) + (a.time || "")).localeCompare(day(b) + (b.time || "")));
    const byStaff = new Map();
    for (const row of list) byStaff.set(row.clinician || "—", (byStaff.get(row.clinician || "—") || 0) + 1);
    return answer(fill("Randevular · {0}", p.label), {
      stats:[["Randevu", count(list.length)], ["Tamamlanan", count(list.filter(row => row.status === "Tamamlandı").length)], ...[...byStaff].filter(([name]) => name !== "—" && !/bekleniyor/i.test(name)).slice(0, 4).map(([name, value]) => [name, count(value)])],
      items:list.slice(0, 12).map(row => [fill("{0} · {1}", [row.time, row.endTime].filter(Boolean).join("–") || "—", [nameOf("patients", row.patient), row.service].filter(Boolean).join(" · ") || "—"), row.status || "", row.patient && can("patients") ? "#patient/" + encodeURIComponent(row.patient) : ""]),
      empty:"Bu dönemde randevu yok.",
      links:[["Takvimi aç", "#appointments"]],
    });
  }

  function exams(text) {
    if (!can("exams")) return denied("Muayeneler");
    const p = period(text, "today"), list = rows("exams").filter(row => active(row) && inRange(row, p.range));
    const byStaff = new Map();
    for (const row of list) byStaff.set(row.clinician || "—", (byStaff.get(row.clinician || "—") || 0) + 1);
    return answer(fill("Muayeneler · {0}", p.label), {
      stats:[["Muayene", count(list.length)], ["Tamamlanan", count(list.filter(row => row.status === "Tamamlandı").length)], ...[...byStaff].filter(([name]) => name !== "—" && !/bekleniyor/i.test(name)).slice(0, 4).map(([name, value]) => [name, count(value)])],
      items:list.slice(-8).reverse().map(row => [fill("{0} · {1}", nameOf("patients", row.patient) || "—", row.title || "—"), row.status || "", row.patient ? "#patient/" + encodeURIComponent(row.patient) : ""]),
    });
  }

  function vaccines(text) {
    if (!can("followups")) return denied("Aşı ve takip");
    const now = todayISO(), t = norm(text), planned = rows("followups").filter(row => row.status === "Planlandı");
    let title = "Yaklaşan aşı ve takipler (7 gün)", list = planned.filter(row => row.date >= now && row.date <= addDays(now, 7));
    if (/gec|kacir|overdue|yapilmam/.test(t)) { title = "Geciken aşı ve takipler"; list = planned.filter(row => row.date < now); }
    else if (/bugun|today/.test(t)) { title = "Bugünkü aşı ve takipler"; list = planned.filter(row => row.date === now); }
    list.sort((a, b) => a.date.localeCompare(b.date));
    return answer(title, {
      stats:[["Kayıt", count(list.length)]],
      items:list.slice(0, 12).map(row => [fill("{0} · {1}", nameOf("patients", row.patient) || "—", row.title || row.kind || "—"), dateText(row.date), row.patient ? "#patient/" + encodeURIComponent(row.patient) : ""]),
      empty:"Bu listede kayıt yok.",
      links:[["Aşı takvimini aç", "#vaccine-calendar"]],
    });
  }

  function messages(text) {
    if (!can("messages")) return denied("Mesajlar");
    const p = period(text, "week"), list = rows("messages").filter(row => inRange({date:String(row.date || row.createdAt || "").slice(0, 10)}, p.range));
    const byStatus = new Map();
    for (const row of list) byStatus.set(row.status || row.channel || "—", (byStatus.get(row.status || row.channel || "—") || 0) + 1);
    return answer(fill("Gönderilen mesajlar · {0}", p.label), {
      stats:[["Mesaj", count(list.length)], ...[...byStatus].slice(0, 5).map(([name, value]) => [name, count(value)])],
      empty:"Bu dönemde mesaj kaydı yok.",
      links:[["Gönderim geçmişini aç", "#bayi-mesajlari"]],
    });
  }

  function newcomers(text) {
    const p = period(text, "month");
    const clients = can("clients") ? rows("clients").filter(row => inRange({date:row.registered || String(row.createdAt || "").slice(0, 10)}, p.range)).length : null;
    const patients = can("patients") ? rows("patients").filter(row => inRange({date:row.registered || String(row.createdAt || "").slice(0, 10)}, p.range)).length : null;
    return answer(fill("Yeni kayıtlar · {0}", p.label), {stats:[...(clients === null ? [] : [["Yeni müşteri", count(clients)]]), ...(patients === null ? [] : [["Yeni hasta", count(patients)]])]});
  }

  function summary() {
    const parts = [];
    if (can("appointments")) parts.push(appointments("bugün"));
    if (can("sales")) parts.push(sales("bugün"));
    if (can("products")) parts.push(stock("kritik"));
    if (can("followups")) parts.push(vaccines("geciken"));
    const stats = parts.flatMap(part => part.stats ? [[part.text.replace(/ · [^·]+$/, ""), part.stats[0][1]]] : []);
    return answer("Günün özeti", {stats, empty:"Görüntüleme yetkiniz olan bir bölüm yok."});
  }

  // ---- Hasta ----
  function findPatients(text) {
    if (!can("patients")) return [];
    const t = " " + norm(text) + " ";
    const owners = can("clients") ? new Map(rows("clients").map(row => [row.id, norm(row.name)])) : new Map();
    const hits = [];
    for (const patient of rows("patients")) {
      const name = norm(patient.name);
      if (name.length < 2) continue;
      const own = new RegExp("[ '’]" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:[ '’,.?!]|nin|nun|n[iu]n|in|un|ya|ye|yi|yu| )").test(t);
      const owner = owners.get(patient.owner);
      const byOwner = owner && owner.length > 3 && t.includes(" " + owner.split(" ")[0] + " ") && t.includes(owner.split(" ").at(-1));
      if (own) hits.push({patient, score:2 + (byOwner ? 1 : 0)});
      else if (byOwner && /hasta|kedi|kopek|pet/.test(t)) hits.push({patient, score:1});
    }
    return hits.sort((a, b) => b.score - a.score).map(hit => hit.patient);
  }

  function ageText(birth) {
    if (!birth) return "";
    const months = Math.floor((new Date(todayISO()) - new Date(birth)) / (30.44 * 86400000));
    if (!Number.isFinite(months) || months < 0) return "";
    return months < 24 ? fill("{0} aylık", months) : fill("{0} yaşında", Math.floor(months / 12));
  }

  function patient(text, list) {
    const t = norm(text);
    if (list.length > 1 && !/hepsi|all/.test(t)) {
      return answer("Birden fazla hasta eşleşti. Hangisini kastettiniz?", {
        items:list.slice(0, 6).map(row => [[row.name, row.species, nameOf("clients", row.owner)].filter(Boolean).join(" · "), row.protocol || "", "#patient/" + encodeURIComponent(row.id)]),
      });
    }
    const pet = list[0], link = "#patient/" + encodeURIComponent(pet.id);
    const mine = name => can(name) ? rows(name).filter(row => row.patient === pet.id).sort((a, b) => day(b).localeCompare(day(a))) : [];
    if (/\b(hemogram|biyokimya|kan|lab|tahlil|tetkik|sonuc|test|yorum|degerlendir|gaz)/.test(t)) {
      const labs = mine("labs").filter(row => row.status !== "İptal");
      const wanted = /hemogram/.test(t) ? labs.filter(row => /hemogram/i.test(row.kind + " " + row.title)) : /biyokimya/.test(t) ? labs.filter(row => /biyokimya/i.test(row.kind + " " + row.title)) : labs;
      const lab = wanted[0];
      if (!lab) return answer(fill("{0} için uygun tetkik kaydı bulunamadı.", pet.name), {links:[["Hasta dosyasını aç", link]]});
      // Aynı günlerde girilen hemogram, biyokimya ve kan gazı birlikte yorumlanır.
      const near = labs.filter(row => row.id !== lab.id && Math.abs(new Date(day(row)) - new Date(day(lab))) <= 3 * 864e5);
      const older = labs.filter(row => row.id !== lab.id && !near.includes(row));
      const age = pet.birth ? Math.floor((Date.now() - new Date(pet.birth + "T12:00:00Z")) / (30.44 * 864e5)) : NaN;
      const panel = row => ({date:day(row), values:row.values || "", result:row.values ? "" : row.result || ""});
      const res = interpretLabs({panels:[panel(lab), ...near.map(panel)], species:pet.species, sex:pet.sex, ageMonths:age, history:older.map(panel)});
      if (!res.rows.length) {
        const flags = labFlags(lab.result);
        return answer(fill("{0} · {1} ({2})", pet.name, lab.title || lab.kind || "Tetkik", dateText(day(lab))), {
          items:flags.filter(flag => flag.status !== "normal").slice(0, 14).map(flag => [fill("{0}: {1} {2} (referans {3}–{4})", flag.name, flag.value, flag.unit, flag.low, flag.high).replace("  ", " "), flag.status === "high" ? "Yüksek" : "Düşük"]),
          note:String(lab.result || "Sonuç girilmemiş.").slice(0, 600), links:[["Hasta dosyasını aç", link]],
        });
      }
      const brief = /yorum|degerlendir|ne dusun|teshis|tani|tedavi|interpret/.test(t);
      return answer(fill("{0} · {1} ({2})", pet.name, near.length ? "Birleşik tetkik yorumu" : lab.title || lab.kind || "Tetkik", dateText(day(lab))), {
        urgent: res.critical.length > 0,
        stats:[["Okunan değer", count(res.rows.length)], ["Aralık dışı", count(res.abnormal.length)], ["Birlikte değerlendirilen panel", count(1 + near.length)]],
        items:[...res.critical.map(text => [text, "Kritik değerler"]),
          ...res.abnormal.slice(0, brief ? 8 : 14).map(row => [`${row.name}: ${row.raw} ${row.unit}`.trim(), `${row.status === "high" ? "↑ Yüksek" : "↓ Düşük"} · ${row.degree}`]),
          ...(brief ? [...res.findings.slice(0, 6).map(item => [item.title, "Değerlendirme"]),
            ...res.differentials.slice(0, 6).map(item => [item, "Olası neden"]),
            ...res.tests.slice(0, 5).map(item => [item, "Önerilen tetkik"])] : [])],
        note:brief
          ? "Karar desteğidir; kesin tanı ve tedavi kararı hekime aittir."
          : "Ayrıntılı yorum için “yorumla” yazın veya tetkik kaydını açın. Karar desteğidir; kesin tanı ve tedavi kararı hekime aittir.",
        links:[["Hasta dosyasını aç", link]],
      });
    }
    if (/\b(ilac|recete|tedavi|treatment|drug|medic)/.test(t)) {
      const meds = mine("prescriptions").slice(0, 8), care = mine("treatments").slice(0, 5);
      return answer(fill("{0} · son ilaç ve tedaviler", pet.name), {
        items:[...meds.map(row => [[row.drug, row.dose, row.frequency, row.duration].filter(Boolean).join(" · "), dateText(day(row))]),
          ...care.map(row => [[row.title, row.status].filter(Boolean).join(" · "), dateText(day(row))])],
        empty:"Kayıtlı ilaç veya tedavi yok.",
        links:[["Hasta dosyasını aç", link]],
      });
    }
    if (/\b(asi|vaccin|parazit)/.test(t)) {
      const shots = mine("followups");
      const now = todayISO();
      return answer(fill("{0} · aşı ve takipler", pet.name), {
        stats:[["Yapılan", count(shots.filter(row => row.status === "Tamamlandı").length)], ["Geciken", count(shots.filter(row => row.status === "Planlandı" && row.date < now).length)], ["Planlı", count(shots.filter(row => row.status === "Planlandı" && row.date >= now).length)]],
        items:shots.slice(0, 10).map(row => [fill("{0} · {1}", row.title || row.kind || "—", row.status || ""), dateText(row.done || row.date)]),
        links:[["Hasta dosyasını aç", link]],
      });
    }
    if (/\b(kilo|agirlik|weight)/.test(t)) {
      const points = [...mine("weights").map(row => [day(row), row.weight]), ...mine("exams").filter(row => row.weight).map(row => [day(row), row.weight])]
        .filter(([, value]) => Number(value) > 0).sort((a, b) => b[0].localeCompare(a[0]));
      const [latest, previous] = points;
      const change = latest && previous ? (Number(latest[1]) - Number(previous[1])).toFixed(2) : null;
      return answer(fill("{0} · kilo geçmişi", pet.name), {
        stats:latest ? [["Son kilo", latest[1] + " kg"], ...(change === null ? [] : [["Önceki ölçüme göre", (change > 0 ? "+" : "") + change + " kg"]])] : [],
        items:points.slice(0, 8).map(([date, value]) => [value + " kg", dateText(date)]),
        empty:"Kilo ölçümü bulunamadı",
        links:[["Hasta dosyasını aç", link]],
      });
    }
    const exam = mine("exams")[0], lab = mine("labs")[0], shot = mine("followups").find(row => row.status === "Planlandı");
    const meds = mine("prescriptions").slice(0, 3);
    return answer(fill("{0} · hasta özeti", pet.name), {
      stats:[["Tür", [pet.species, pet.breed].filter(Boolean).join(" · ") || "—"], ["Yaş", ageText(pet.birth) || "—"], ["Hasta sahibi", nameOf("clients", pet.owner) || "—"]],
      items:[
        ...(exam ? [[fill("Son muayene: {0}", [exam.title, exam.assessment].filter(Boolean).join(" · ").slice(0, 160)), dateText(day(exam))]] : []),
        ...(lab ? [[fill("Son tetkik: {0}", [lab.title || lab.kind, lab.status].filter(Boolean).join(" · ")), dateText(day(lab))]] : []),
        ...meds.map(row => [fill("İlaç: {0}", [row.drug, row.dose, row.frequency].filter(Boolean).join(" · ")), dateText(day(row))]),
        ...(shot ? [[fill("Sıradaki takip: {0}", shot.title || shot.kind), dateText(shot.date)]] : []),
        ...(pet.warning ? [[fill("Uyarı: {0}", pet.warning), ""]] : []),
      ],
      empty:"Bu hasta için henüz klinik kayıt yok.",
      links:[["Hasta dosyasını aç", link]],
    });
  }

  const actions = [
    [/yeni (hasta sahibi|musteri)|musteri ekle|new (client|customer|pet owner)/, "Yeni müşteri", "new:clients"],
    [/yeni hasta|hasta ekle|new patient/, "Yeni hasta", "new:patients"],
    [/randevu (ekle|olustur|ver|al)|yeni randevu|new appointment|book/, "Yeni randevu", "new:appointments"],
    [/yeni satis|satis (yap|ekle)|new sale/, "Yeni satış", "new:sales"],
    [/yeni muayene|muayene (ekle|baslat)|new exam/, "Yeni muayene", "new:exams"],
    [/asi (ekle|planla)|yeni asi|new vaccin/, "Yeni aşı", "new:followups"],
    [/rapor/, "Raporları aç", "#reports"],
  ];
  const canDocs = () => { try { return !!(ctx.canEdit && ctx.save && ctx.canEdit("products")); } catch { return false; } };

  // Kelimeler kelime başında aranır: "hastasının" içindeki "aşı" aşı sorusu sayılmaz.
  const words = list => new RegExp("\\b(?:" + list + ")");
  // Tedavi sonrası arama listesi: dünkü/önceki günkü muayeneler, kaçırılan kontroller, geciken aşılar.
  function callList() {
    if (!can("patients")) return denied("Hastalar");
    const today = todayISO(), yesterday = addDays(today, -1), twoDays = addDays(today, -2), since = addDays(today, -60);
    const patients = new Map(rows("patients").map(row => [row.id, row]));
    const clients = can("clients") ? new Map(rows("clients").map(row => [row.id, row])) : new Map();
    const appointments = can("appointments") ? rows("appointments").filter(active) : [];
    const seen = new Set(), items = [];
    const push = (patientId, reason, date) => {
      const pet = patients.get(patientId);
      if (!pet || seen.has(patientId) || pet.archived === "Evet" || pet.deceased === "Evet") return false;
      seen.add(patientId);
      const owner = clients.get(pet.owner);
      items.push([[pet.name, owner?.name].filter(Boolean).join(" · "), [reason, dateText(date), owner?.phone].filter(Boolean).join(" · "), "#patient/" + encodeURIComponent(pet.id)]);
      return true;
    };
    let visits = 0, missed = 0, overdue = 0;
    if (can("exams")) {
      for (const exam of rows("exams").filter(active)) {
        const date = day(exam);
        if (date === yesterday || date === twoDays) { if (push(exam.patient, "Muayene sonrası arama", date)) visits++; }
      }
      for (const exam of rows("exams").filter(active)) {
        if (!exam.next || exam.next >= today || exam.next < since) continue;
        const came = appointments.some(item => item.patient === exam.patient && day(item) >= exam.next) ||
          rows("exams").some(item => item.patient === exam.patient && day(item) >= exam.next && item.id !== exam.id);
        if (!came) { if (push(exam.patient, "Kontrole gelmedi", exam.next)) missed++; }
      }
    }
    if (can("followups")) {
      for (const item of rows("followups")) {
        if (item.status === "Tamamlandı" || item.done || item.status === "İptal") continue;
        const date = day(item);
        if (date < today && date >= since) { if (push(item.patient, item.title || item.vaccine || "Aşı / takip gecikti", date)) overdue++; }
      }
    }
    return answer("Bugünkü arama listesi", {
      stats:[["Muayene sonrası", String(visits)], ["Kaçırılan kontrol", String(missed)], ["Geciken aşı/takip", String(overdue)]],
      items:items.slice(0, 25),
      empty:"Bugün aranması önerilen hasta yok.",
      note:"Arama sırasında sorulabilecekler: iştah ve su tüketimi, ilaçların düzenli verilmesi, yara veya dikiş durumu, kusma, ishal ve halsizlik. Endişe verici bir yanıt varsa hekime danışın.",
    });
  }

  const intents = [
    {test:words("ciro|satis|satildi|kazanc|hasilat|revenue|sales|turnover"), run:sales, skip:/en cok|best|top/},
    {test:words("tahsilat|kasa|gelir|nakit|payment|cash|income"), run:receipts},
    {test:words("gider|masraf|harcama|expense|cost"), run:expenses},
    {test:words("alacak|borc|bakiye|acik hesap|odenmemis|veresiye|debt|unpaid|balance"), run:debts},
    {test:/\ben cok (satan|satilan|kullanilan)|\ben populer|\bbest ?sell|\btop (product|service)/, run:topSellers},
    {test:words("stok|skt|son kullanma|miad|stock|inventory|expir"), run:stock},
    {test:/\b(aranacak|arama listesi|kimi? ?(ara|arayal)|kimleri ara|geri ara|takip arama|tedavi sonrasi|muayene sonrasi|kontrole gelme|kontrolu kacir|follow.?up call|call list|who should i call)/, run:callList},
    {test:words("asi|takip|parazit|vaccin|reminder|hatirlat"), run:vaccines},
    {test:words("randevu|takvim|program|appointment|schedule|calendar"), run:appointments},
    {test:words("muayene|exam|vaka|visit"), run:exams},
    {test:words("sms|whatsapp|mesaj|message|bildirim"), run:messages},
    {test:/\byeni (musteri|hasta|kayit)|\bkayit sayisi|\bnew (clients|patients)/, run:newcomers},
    {test:words("ozet|nasil gidiyor|genel bakis|summary|overview|how.*today"), run:summary},
  ];

  // VetZimo kullanım rehberi: "Web sitesi nasıl kurarım?", "Instagram'ı nasıl bağlarım?" gibi sorulara adım adım yanıt ve ilgili ekran.
  const GUIDES = [
    [/web ?site|web sitem|internet sitesi|\bsite(mi|yi|ni)? (kur|olustur|yap|ac|yayin)|alan adi|domain|online randevu/, "Klinik web sitenizi kurmak için:", ["Web Sitem ekranını açın (Diğer › Web Sitem).", "Temalardan birini seçin; klinik adı, logo, hizmetler, ekip, galeri ve iletişim bilgilerini girin.", "Online randevu ve iletişim formunu açın; gelen talepler randevu takviminize ve gelen kutunuza düşer.", "Önizleyip Yayınla’ya basın. Kendi alan adınızı bağlamak için ekrandaki yönlendirmeyi izleyin."], [["Web Sitem", "/web-sitem"]]],
    [/gelen kutu|instagram|facebook|messenger|telegram|kanal bagla|(whatsapp|e-?posta|mail).*(bagla|baglan|gelen|cevap|yanit)/, "WhatsApp, Instagram, Facebook, Telegram, SMS ve e-posta mesajlarını tek yerde toplamak için:", ["Gelen Kutusu’nu açın (sol menü › Gelen Kutusu).", "Ayarlar › Kanal bağlantıları bölümünden bağlamak istediğiniz hesabı seçip bilgilerini girin.", "Gelen mesajlar konuşma olarak düşer; aynı ekrandan yanıtlayın, ekip arkadaşına atayın, hasta sahibi kartına bağlayın.", "Okunmamış mesaj sayısı menüde ve Genel Bakış’ta görünür."], [["Gelen Kutusu", "#gelen-kutusu"]]],
    [/telefon baglanti|kendi (hattimdan|hattindan|numaramdan|numarasindan)|sms (gonder|kur|bagla|ayarla)|toplu (sms|mesaj)/, "SMS ve WhatsApp’ı kliniğin kendi numarasından göndermek için:", ["Müşteriler › Telefon Bağlantısı’nı açın.", "Kurulum sekmesindeki adımlarla kliniğin telefonunu bir kez eşleştirin.", "Hatırlatmalar, toplu mesajlar ve yanıtlar bu numaradan gider; ek SMS paketi gerekmez.", "Toplu gönderim için: Muhasebe › Toplu gönderim."], [["Telefon Bağlantısı", "#telefon-baglantisi"], ["Toplu gönderim", "#bayi-mesajlari/toplu"]]],
    [/e-?fatura|e-?arsiv|e-?smm|serbest meslek makbuz|gib portal|fatura (kes|duzenle|olustur)/, "e-Fatura, e-Arşiv ve e-SMM için:", ["Satışlar › e-Fatura / e-SMM ekranını açın.", "Kurulum rehberindeki adımlarla kendi GİB, Uyumsoft veya Ödeal hesabınızı bir kez tanıtın.", "Satış listesinde ilgili satıştaki e-belge düğmesine basın; belge numarası satışa kendiliğinden işlenir."], [["e-Fatura / e-SMM", "#e-belgeler"]]],
    [/\b(personel|calisan|ekip uyesi|kullanici|yetki)/, "Personel hesabı açmak için:", ["Diğer › Ayarlar › Ekip ve yetkiler (Klinik hesapları ve yetkiler) ekranını açın.", "Yeni üyelik ve aktivasyon › Hesap türü: Personel seçin; ad, cep telefonu ve yöntemi girin.", "Modül yetkilerini (görüntüleme / düzenleme) işaretleyip Personel oluştur’a basın."], [["Ekip ve yetkiler", "#merkezi-hesaplar"]]],
    [/\bsube/, "Şube eklemek ve yönetmek için:", ["Diğer › Ayarlar › Ekip ve yetkiler › Şubeleri yönet’i açın.", "Şube adını ve şehrini girip kaydedin; paketinizdeki şube sınırı ekranda görünür.", "Sağ üstteki şube seçiciyle şubeler arasında geçiş yapın."], [["Ekip ve yetkiler", "#merkezi-hesaplar"]]],
    [/\b(paket|abonelik|uyelik|satin al|odeme)/, "Paketinizi satın almak, yenilemek veya yükseltmek için:", ["Muhasebe › Abonelik mağazası’nı açın.", "Paketi ve aylık / yıllık dönemi seçip Satın Alın’a basın.", "Kredi kartı (PayTR, 3D Secure) ile anında ya da havale / EFT ile ödeyin; havalede dekont referansını girin."], [["Abonelik mağazası", "#kredi-magazasi"]]],
    [/(mobil|telefon|android|ios|iphone|ipad|tablet|bilgisayar|masaustu|windows|mac) (uygulama|programi)|uygulama(yi)? (indir|kur|yukle)|hasta sahibi (uygulama|portal|giris)/, "VetZimo uygulamalarını kurmak için:", ["Satış sitesindeki Uygulama indir sayfasını açın (QR kodu telefonla okutabilirsiniz).", "Android, iPhone/iPad, Windows, Mac ve Linux için kurulum dosyası oradadır.", "Ekibiniz ve hasta sahipleri aynı telefon numarası ve şifreyle giriş yapar; herkes kendi yetkili alanına düşer."], [["Uygulama indir", "/platform/uygulama-indir"]]],
    [/yedek|aktar|excel|eski program|import/, "Kayıtlarınızı yedeklemek veya başka programdan aktarmak için:", ["Hastalar › Hasta yedeği ve aktarım ekranını açın.", "Excel / CSV dosyanızı yükleyin; sütunları eşleştirip önizlemeyi onaylayın.", "Yedek almak için aynı ekrandaki Yedek indir düğmesini kullanın."], [["Yedek ve aktarım", "#import"]]],
    [/\btema|renk(ler)?i? degis|karanlik mod|gece modu|gorunum/, "Görünümü değiştirmek için:", ["Diğer › Ayarlar › Görünüm ve ses sekmesini açın.", "Prizma · Işıltı (açık) veya Nebula · Neon Gece (koyu) temasını seçin; menü yerleşimini de buradan değiştirebilirsiniz."], [["Ayarlar", "#ayarlar"]]],
    [/bildirim|sessiz saat/, "Bildirim tercihleri için:", ["Diğer › Ayarlar › İletişim ve bildirimler sekmesini açın.", "Hangi bildirimlerin geleceğini ve sessiz saatleri seçin; telefon uygulamasında ayrıca kategori bazında sessize alabilirsiniz."], [["Ayarlar", "#ayarlar"]]],
    [/kvkk|onay formu|izin formu|iletisim izni/, "KVKK ve iletişim izni almak için:", ["Hasta sahibi kartında Onay formu gönder’e basın; tek kullanımlık bağlantı SMS / WhatsApp ile gider.", "Hasta sahibi telefonundan ya da klinikteki tablette imzalar; sonuç Müşteriler › Müşteri Onayları’nda görünür."], [["Müşteri Onayları", "#musteri-onaylari"]]],
    [/cihaz (bagla|entegr|ekle|tanit)|(hemogram|biyokimya|rontgen|ultrason|kan gazi|idrar) cihaz|lab(oratuvar)? cihaz/, "Laboratuvar ve görüntüleme cihazlarını bağlamak için:", ["Diğer › Ayarlar › Entegrasyonlar › Cihaz entegrasyonu’nu açın.", "Cihazlar sekmesinden cihazınızı ekleyin; HL7, ASTM, CSV/XML veya DICOM çıkışını seçin.", "Gelen sonuçlar mikroçip, protokol ya da hasta adıyla eşleşip muayeneye eklenir; emin olunamayan sonucu tek tıkla doğru hastaya atarsınız."], [["Cihaz entegrasyonu", "#cihaz-entegrasyonu"]]],
    [/evde hizmet|ev ziyaret|canli rota|eve (git|gel)/, "Evde hizmet için:", ["Diğer › Evde Hizmet’i açın; hizmet, bölge ve ödeme ayarlarını girin.", "Gelen başvuruları planlayın; personel yola çıkınca hasta sahibine tahmini varış süresi gider."], [["Evde Hizmet", "#evde-hizmet"]]],
    [/hatirlat/, "Otomatik aşı ve randevu hatırlatmaları için:", ["Önce Müşteriler › Telefon Bağlantısı ile kliniğin numarasını eşleştirin.", "Diğer › Ayarlar › İletişim ve bildirimler’den hatırlatma saatini ve kanalı (SMS / WhatsApp) seçin.", "Hasta sahibinin iletişim izni Var ise aşı ve kontrol tarihinden önce mesaj kendiliğinden gider."], [["Telefon Bağlantısı", "#telefon-baglantisi"], ["Ayarlar", "#ayarlar"]]],
    [/google (yorum|degerlendirme|isletme)/, "Google yorumu istemek için:", ["Diğer › Ayarlar › Klinik › Google yorum bağlantısı’na işletme bağlantınızı ekleyin.", "Ziyaret ve evde hizmet sonrası hasta sahibine isteğe bağlı yorum bağlantısı gönderilir."], [["Ayarlar", "#ayarlar"]]],
  ];
  function howTo(t) {
    const asking = /\b(nasil|nereden|nerede|nereye|ne yapmam|yardim|kurulum|kur(ar|abilir|mak|ulur)|bagla(r|yabilir|mak|nir)|ekle(r|yebilir|mek|nir)|olustur|ac(ar|abilir|mak|ilir)|yap(ar|abilir|ilir|mak)|ogren|ne ise yarar|how|setup|connect)/.test(t);
    for (const [pattern, title, steps, links] of GUIDES) {
      if (!pattern.test(t)) continue;
      if (!asking) continue;
      return answer(title, {items: steps.map(step => [step, ""]), links});
    }
    return null;
  }

  function help() {
    return answer("Size şu konularda yardımcı olabilirim:", {
      items:[["“Bugünkü ciro ne kadar?” · “Bu ay en çok satılan ürün hangisi?”", ""], ["“Kritik stokta neler var?” · “SKT yaklaşan ürünler”", ""],
        ["“Yarınki randevular” · “Bugün kaç muayene yapıldı?”", ""], ["“Geciken aşılar” · “Açık bakiyesi olan müşteriler”", ""],
        ["“Pamuk’un son hemogramını özetle” · “Pamuk’un son ilaçları”", ""], ["“Yeni randevu” · “Günün özeti”", ""], ["Kullanım: “Web sitesi nasıl kurulur?” · “Instagram’ı nasıl bağlarım?” · “Personel nasıl eklenir?” · “e-Fatura nasıl kesilir?”", ""], ["Hekim bilgisi: " + KNOWLEDGE_EXAMPLES.slice(0, 6).join(" · "), ""], [KNOWLEDGE_EXAMPLES.slice(6).join(" · "), ""]],
      note:"Yanıtlar yalnızca bu cihazda, görmeye yetkili olduğunuz kayıtlardan hazırlanır. Veriler dışarı gönderilmez.",
    });
  }

  return function respond(text) {
    const t = norm(text);
    if (!t) return help();
    // Hekim başvuru bilgisi (doz, aşı, referans, zehirlenme, ayırıcı tanı…); hasta adı geçiyorsa tür ve kilo kayıttan alınır.
    // "Geciken aşılar", "yarınki aşılar" gibi liste soruları hekim bilgisine değil klinik kayıtlarına gider.
    const listQuery = /\b(geciken|gecikmis|gecmis|bugun(ku)?|yarin(ki)?|bu (hafta|ay)|liste|kac|hangi (hasta|musteri)|yaklasan|planlanan)/.test(t);
    if (!/^(yardim|help|merhaba|selam)\b/.test(t) && !listQuery) {
      const named = findPatients(text);
      const pet = named.length === 1 ? named[0] : null;
      const known = vetAnswer(text, pet ? {species: /kedi/i.test(pet.species || "") ? "cat" : /k[öo]pek/i.test(pet.species || "") ? "dog" : /tav[şs]an/i.test(pet.species || "") ? "rabbit" : "", weight: pet.weight, name: pet.name} : {});
      if (known) return answer(known.text, known);
    }
    if (isUrgent(text)) {
      return answer("Acil olabilir", {urgent:true, note:"Anlatılan belirti acil müdahale gerektirebilir. Hayvanı bekletmeden hekime gösterin; kliniğe ulaşamıyorsanız en yakın 7/24 açık veteriner kliniğine başvurun. VeBot tanı koymaz."});
    }
    if (/^(yardim|help|ne yapabilirsin|neler yapabilirsin|merhaba|selam|hello|hi)\b/.test(t)) return help();
    const guide = howTo(t);
    if (guide) return guide;
    const counting = /\b(kac|sayi|ne kadar|how many|count)|\b(bu|gecen) (ay|hafta|yil)|\bbugun|\bson \d/.test(t);
    if (/\b(tahlil|tetkik|hemogram|biyokimya|lab)\w*\b.*\b(fotograf|foto|resim|tara|goruntu)/.test(t)) {
      return answer("Tetkik formundaki «Fotoğraftan oku» ile sonuç kâğıdının fotoğrafını tabloya aktarabilirsiniz.", {note:"Okuma cihazınızda yapılır; değerleri kaydetmeden önce kontrol edin.", links:[["Yeni tetkik", "new:labs"]]});
    }
    if (/\b(fatura|irsaliye|fiyat listesi|e-?fatura|belge)\w*\b/.test(t) && !counting) {
      if (!canDocs()) return answer("Belgeden stok aktarmak için ürün ve stok düzenleme yetkisi gerekir.");
      return answer("Faturanın veya fiyat listesinin fotoğrafını, e-Fatura XML dosyasını ya da Excel/CSV listesini ekleyin. Kalemleri okuyup stok ürünleriyle eşleştiririm; siz onaylayınca kaydedilir.", {note:"PDF yerine e-Faturanın XML dosyasını veya sayfanın fotoğrafını kullanın.", links:[["Belge seç", "doc:pick"]]});
    }
    if (!counting) for (const [pattern, label, hash] of actions) if (pattern.test(t)) return answer(fill("{0} ekranını açabilirim.", label), {links:[[label, hash]]});
    const pets = findPatients(text);
    if (pets.length) return patient(text, pets);
    for (const intent of intents) if (intent.test.test(t) && !(intent.skip && intent.skip.test(t))) return intent.run(text);
    return null;
  };
}

// ---- Arayüz ----
const icon = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2"/><rect x="4" y="6" width="16" height="12" rx="4"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><path d="M9.5 15.5h5"/><path d="M2 11v3M22 11v3"/></svg>';
const micIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const clipIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5 12.6 20a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>';
const sendIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

export function mountVeBot(ctx) {
  if (document.querySelector(".vebot-launcher")) return;
  const respond = createEngine(ctx);
  const el = (tag, props = {}, ...children) => {
    const {dataset, ...rest} = props;
    const node = Object.assign(document.createElement(tag), rest);
    if (dataset) Object.assign(node.dataset, dataset);
    for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  };

  const launcher = el("button", {type:"button", className:"vebot-launcher", hidden:true, innerHTML:icon});
  launcher.setAttribute("aria-label", "VeBot asistanını aç");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "vebotPanel");

  const log = el("div", {className:"vebot-log"});
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const input = el("textarea", {className:"vebot-input", rows:1, maxLength:500, placeholder:"Sorunuzu yazın veya mikrofona basın"});
  input.setAttribute("aria-label", "VeBot’a soru");
  const mic = el("button", {type:"button", className:"vebot-icon-button", innerHTML:micIcon});
  mic.setAttribute("aria-label", "Sesle sor");
  mic.setAttribute("aria-pressed", "false");
  const send = el("button", {type:"submit", className:"vebot-icon-button vebot-send", innerHTML:sendIcon});
  send.setAttribute("aria-label", "Gönder");
  const status = el("p", {className:"vebot-status"});
  const attach = el("button", {type:"button", className:"vebot-icon-button", innerHTML:clipIcon, hidden:true});
  attach.setAttribute("aria-label", "Belge ekle (fatura, fiyat listesi)");
  attach.title = "Belge ekle (fatura, fiyat listesi)";
  const fileInput = el("input", {type:"file", hidden:true, accept:"image/*,.xml,.xlsx,.csv,.tsv,.pdf,application/xml,text/xml"});
  const form = el("form", {className:"vebot-form"}, attach, fileInput, input, mic, send);
  const chips = el("div", {className:"vebot-chips"});
  const close = el("button", {type:"button", className:"icon-button vebot-close", textContent:"×"});
  close.setAttribute("aria-label", "VeBot’u kapat");
  const panel = el("aside", {className:"vebot-panel", id:"vebotPanel", hidden:true},
    el("header", {className:"vebot-head"},
      el("span", {className:"vebot-avatar", innerHTML:icon}),
      el("div", {className:"vebot-title"}, el("strong", {textContent:"VeBot"}), el("small", {textContent:"Klinik asistanı · cihazınızda çalışır"})),
      close),
    log, chips, form, status);
  panel.setAttribute("aria-label", "VeBot klinik asistanı");
  document.body.append(launcher, panel);

  const suggestions = [["Günün özeti", "summary"], ["Bugünkü ciro", "sales"], ["Kritik stok", "products"], ["Yarınki randevular", "appointments"], ["Geciken aşılar", "followups"], ["Açık bakiyeler", "sales"], ["Faturadan stok", "products"], ["Bugün kimi aramalıyım?", "patients"]];
  const renderChips = () => {
    chips.replaceChildren(...suggestions.filter(([, module]) => module === "summary" || safeCan(module)).map(([label]) => {
      const chip = el("button", {type:"button", className:"vebot-chip", textContent:label});
      chip.addEventListener("click", () => ask(label));
      return chip;
    }));
  };
  const safeCan = name => { try { return !!ctx.can(name); } catch { return false; } };

  function bubble(role, content) {
    const item = el("div", {className:"vebot-msg vebot-" + role}, content);
    log.append(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function renderAnswer(result) {
    const box = el("div", {className:"vebot-answer" + (result.urgent ? " vebot-urgent" : "")});
    box.append(el("p", {className:"vebot-lead", textContent:result.text}));
    if (result.stats?.length) {
      box.append(el("dl", {className:"vebot-stats"}, ...result.stats.flatMap(([label, value]) => [el("div", {}, el("dt", {textContent:label}), el("dd", {textContent:value}))])));
    }
    if (result.items?.length) {
      box.append(el("ul", {className:"vebot-items"}, ...result.items.map(([label, meta, href]) => {
        const main = href ? el("a", {href, textContent:label}) : el("span", {textContent:label});
        return el("li", {}, main, meta ? el("small", {textContent:meta}) : null);
      })));
    } else if (result.empty && !result.stats?.some(([, value]) => value !== "0")) {
      box.append(el("p", {className:"vebot-empty", textContent:result.empty}));
    } else if (result.empty && !result.items) {
      // Yalnız sayısal özet
    }
    if (result.note) box.append(el("p", {className:"vebot-note", textContent:result.note}));
    if (result.links?.length) {
      box.append(el("div", {className:"vebot-links"}, ...result.links.map(([label, href]) => href === "doc:pick"
        ? el("button", {type:"button", className:"button small", textContent:label, dataset:{vebotDoc:"1"}})
        : href.startsWith("new:")
        ? el("button", {type:"button", className:"button small", textContent:label, dataset:{vebotNew:href.slice(4)}})
        : el("a", {className:"button small", href, textContent:label}))));
    }
    return box;
  }

  function ask(question) {
    const text = String(question || "").trim().slice(0, 500);
    if (!text) return;
    bubble("user", el("p", {textContent:text}));
    let result;
    try { result = respond(text); }
    catch (error) { console.error("VeBot", error); result = {text:"Bu soruyu şu anda yanıtlayamadım. Sayfayı yenileyip tekrar deneyin."}; }
    if (!result) {
      result = {text:"Bu soruyu yanıtlayamadım.", note:"Klinik verisi (ciro, tahsilat, stok, randevu, muayene, aşı, hasta özeti) ve hekim bilgisi (ilaç dozu, aşı takvimi, normal değerler, referans aralıkları, zehirlenmeler, ayırıcı tanı, sıvı/enerji, gebelik, KPR) sorularını yanıtlayabilirim. Örnek: “4 kg kedi meloksikam dozu”.", links:[]};
    }
    bubble("bot", renderAnswer(result));
  }

  const docsAllowed = () => { try { return !!(ctx.save && ctx.canEdit && ctx.canEdit("products")); } catch { return false; } };
  let reading = false;
  function pickDocument() {
    if (reading) return;
    if (!docsAllowed()) { bubble("bot", renderAnswer({text:"Belgeden stok aktarmak için ürün ve stok düzenleme yetkisi gerekir."})); return; }
    fileInput.value = "";
    fileInput.click();
  }
  attach.addEventListener("click", pickDocument);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || reading) return;
    reading = true;
    attach.disabled = true;
    bubble("user", el("p", {textContent:"📎 " + file.name}));
    try {
      const docs = await import("./vebot-docs.js?v=20261124-r1");
      const parsed = await docs.readDocument(file, {
        ocr: ctx.ocr,
        readSheets: f => import("./migration-file.js").then(module => module.readMigrationFile(f)),
        onStatus: text => { status.textContent = text; },
      });
      status.textContent = "";
      bubble("bot", renderAnswer({text:fill("Belgede {0} kalem okundu.", parsed.lines.length), note:"Taslağı kontrol edip onaylayın; onaylamadan hiçbir kayıt değişmez."}));
      docs.openDocDraft(ctx, parsed, file.name, result => bubble("bot", renderAnswer(result)));
    } catch (error) {
      status.textContent = "";
      bubble("bot", renderAnswer({text:error?.message || "Belge okunamadı."}));
    } finally {
      reading = false;
      attach.disabled = false;
      fileInput.value = "";
    }
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value;
    input.value = "";
    autosize();
    ask(text);
  });
  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  log.addEventListener("click", event => {
    if (event.target.closest("button[data-vebot-doc]")) { pickDocument(); return; }
    const create = event.target.closest("button[data-vebot-new]");
    if (create && typeof ctx.open === "function") {
      if (matchMedia("(max-width: 720px)").matches) setOpen(false);
      ctx.open(create.dataset.vebotNew);
      return;
    }
    const link = event.target.closest("a[href^='#']");
    if (link && matchMedia("(max-width: 720px)").matches) setOpen(false);
  });

  let greeted = false;
  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.classList.toggle("is-open", open);
    if (open) {
      renderChips();
      attach.hidden = !docsAllowed();
      if (!greeted) {
        greeted = true;
        bubble("bot", renderAnswer({text:"Merhaba, ben VeBot. Kliniğinizle ilgili sorunuzu yazın veya sesle sorun.", note:"Yanıtlar yalnızca bu cihazda, görmeye yetkili olduğunuz kayıtlardan hazırlanır. Veriler dışarı gönderilmez."}));
      }
      requestAnimationFrame(() => input.focus({preventScroll:true}));
    } else {
      stopRecording(true);
      launcher.focus({preventScroll:true});
    }
  }
  launcher.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden && panel.contains(document.activeElement)) setOpen(false); });

  // ---- Sesle sorma: yerel Whisper modeli, ses cihazdan çıkmaz ----
  let worker = null, recorder = null, chunks = [], stream = null, busy = false;
  const voiceSupported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext && window.OfflineAudioContext && window.WebAssembly && window.Worker);
  mic.hidden = !voiceSupported;
  const say = text => { status.textContent = text; };

  function stopRecording(discard) {
    if (recorder && recorder.state !== "inactive") { recorder.discard = !!discard; recorder.stop(); }
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    mic.setAttribute("aria-pressed", "false");
    mic.classList.remove("is-recording");
  }

  async function toSamples(blob) {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const length = Math.min(Math.ceil(decoded.duration * 16000), 480000);
      if (length < 4000) return null;
      const offline = new OfflineAudioContext(1, length, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      return (await offline.startRendering()).getChannelData(0);
    } finally { await context.close(); }
  }

  function transcribe(samples) {
    worker ??= new Worker("/voice-local-worker.js?v=r29", {type:"module"});
    return new Promise((resolve, reject) => {
      worker.onmessage = ({data}) => {
        if (data.stage === "load") return say("Yerel ses modeli yükleniyor · %" + data.progress);
        if (data.stage === "transcribe") return say("Konuşma metne çevriliyor…");
        if (data.error) { worker?.terminate(); worker = null; return reject(new Error("model")); }
        resolve(data.text || "");
      };
      worker.onerror = () => { worker?.terminate(); worker = null; reject(new Error("model")); };
      worker.postMessage({samples, profile:"base"}, [samples.buffer]);
    });
  }

  mic.addEventListener("click", async () => {
    if (busy) return;
    if (recorder && recorder.state === "recording") { stopRecording(false); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}});
    } catch { say("Mikrofon açılamadı. Site iznini kontrol edin veya sorunuzu yazın."); return; }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      const discard = recorder.discard;
      recorder = null;
      if (discard || !chunks.length) { say(""); return; }
      busy = true;
      try {
        const samples = await toSamples(new Blob(chunks, {type:chunks[0].type}));
        if (!samples) { say("Anlaşılır ses algılanmadı. Tekrar konuşabilirsiniz."); return; }
        say("Konuşma metne çevriliyor…");
        const text = (await transcribe(new Float32Array(samples))).trim();
        say("");
        if (text) ask(text); else say("Anlaşılır ses algılanmadı. Tekrar konuşabilirsiniz.");
      } catch { say("Ses modeli çalıştırılamadı. Sorunuzu yazabilirsiniz."); }
      finally { busy = false; }
    };
    recorder.start();
    mic.setAttribute("aria-pressed", "true");
    mic.classList.add("is-recording");
    say("Dinliyorum. Bitince mikrofona tekrar basın.");
    setTimeout(() => { if (recorder?.state === "recording") stopRecording(false); }, 29000);
  });

  // Uygulama verisi yüklenince düğmeyi göster.
  const reveal = () => {
    let ready = false;
    try { ready = !!ctx.ready(); } catch {}
    launcher.hidden = !ready;
    if (!ready) setTimeout(reveal, 800);
  };
  reveal();
}
