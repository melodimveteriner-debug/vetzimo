// Yoğun bakım panosu: yatan hastaların oda/kafes kartları, saatlik talimat çizelgesi,
// vital bulgu takibi ve CRI (sabit hızlı infüzyon) zamanlayıcıları.
// Veri yatış kaydında tutulur: careOrders (talimatlar), icuVitals ve icuInfusions (sunucuda mühürlenir).

const pad = n => String(n).padStart(2, "0");
const localStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseLocal = s => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || ""); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
const json = s => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const uid = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9_-]/g, "");
const num = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

// Erişkin hasta için yaklaşık referans aralıkları (tür bazında). Klinik karar hekimindir.
const RANGES = {
  dog: {temp: [37.5, 39.2], hr: [60, 140], rr: [10, 30]},
  cat: {temp: [37.8, 39.2], hr: [140, 220], rr: [20, 30]},
  other: {temp: [37.5, 39.5], hr: [60, 200], rr: [10, 40]},
};
const COMMON = {spo2: [95, 100], sys: [90, 160], dia: [50, 100], glucose: [70, 150], pain: [0, 3], urine: [1, 50]};
const VITALS = [
  ["temp", "Ateş", "°C", "0.1"], ["hr", "Nabız", "/dk", "1"], ["rr", "Solunum", "/dk", "1"], ["spo2", "SpO₂", "%", "1"],
  ["sys", "Sistolik KB", "mmHg", "1"], ["dia", "Diyastolik KB", "mmHg", "1"], ["glucose", "Glukoz", "mg/dL", "1"],
  ["pain", "Ağrı skoru", "0-10", "1"], ["urine", "İdrar", "mL/kg/sa", "0.1"], ["weight", "Kilo", "kg", "0.01"],
];
const MM = ["Pembe", "Soluk", "Beyaz", "Siyanotik", "Sarı (ikterik)", "Hiperemik", "Kiremit kırmızısı"];
const MENTATION = ["Uyanık, tepkili", "Sessiz, tepkili", "Depresif", "Stupor", "Koma"];

function kind(species) {
  const s = String(species || "").toLocaleLowerCase("tr");
  if (/köpek|dog|canine|hund|perro|chien|cane/.test(s)) return "dog";
  if (/kedi|cat|feline|katze|gato|chat|gatto/.test(s)) return "cat";
  return "other";
}
function range(key, species) { return RANGES[kind(species)][key] || COMMON[key]; }
function flag(key, value, species) {
  const r = range(key, species), v = num(value);
  if (!r || v === null) return "";
  if (v < r[0]) return "low";
  if (v > r[1]) return "high";
  return "ok";
}

let timer = 0;

export function mountIcuBoard(root, api) {
  const {esc, tr, fmtTime, fmtDate} = api;
  const ui = {view: sessionStorageGet("vz-icu-view") || "cards", day: localStamp(new Date()).slice(0, 10), open: null, confirm: null};
  let busy = false;

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

  function rows() {
    return api.list().map(entry => {
      const orders = json(entry.stay.careOrders).sort((a, b) => a.due.localeCompare(b.due));
      const vitals = json(entry.stay.icuVitals).sort((a, b) => a.at.localeCompare(b.at));
      const infusions = json(entry.stay.icuInfusions).sort((a, b) => a.start.localeCompare(b.start));
      return {...entry, orders, vitals, infusions};
    });
  }

  function elapsed(fromStamp, now = new Date()) {
    const d = parseLocal(fromStamp);
    if (!d) return "";
    let s = Math.max(0, Math.floor((now - d) / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  function duration(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h} ${tr("sa")} ${m} ${tr("dk")}` : `${m} ${tr("dk")}`;
  }
  function infusionEnd(inf) {
    const start = parseLocal(inf.start), rate = num(inf.rate), vol = num(inf.volume);
    if (!start || !rate || !vol) return null;
    return new Date(start.getTime() + vol / rate * 3600000);
  }
  function dayCount(stay) {
    const start = parseLocal(stay.start);
    if (!start) return 1;
    return Math.max(1, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / 86400000) + 1);
  }

  async function save(stayId, mutate, action) {
    if (busy) { api.toast("Önceki işlem sürüyor, lütfen bekleyin."); return false; }
    const prior = api.find(stayId);
    if (!prior) return false;
    const next = mutate({...prior});
    if (!next) return false;
    busy = true;
    root.classList.add("icu-busy");
    try {
      await api.save(next, prior, action);
      api.toast(action);
      return true;
    } catch (error) {
      api.toast(error.message);
      return false;
    } finally {
      busy = false;
      root.classList.remove("icu-busy");
    }
  }

  // ---------- Görünüm parçaları ----------
  function summary(list, now) {
    const stamp = localStamp(now), soon = localStamp(new Date(now.getTime() + 3600000));
    let overdue = 0, upcoming = 0, cri = 0, alerts = 0;
    for (const r of list) {
      for (const o of r.orders) if (o.status === "pending") { if (o.due < stamp) overdue++; else if (o.due <= soon) upcoming++; }
      cri += r.infusions.filter(i => !i.stop).length;
      const last = r.vitals.at(-1);
      if (last && ["temp", "hr", "rr", "spo2", "sys", "pain"].some(k => ["low", "high"].includes(flag(k, last[k], r.patient?.species)))) alerts++;
    }
    const tile = (value, label, tone) => `<div class="icu-tile" data-tone="${tone}"><b>${value}</b><span>${tr(label)}</span></div>`;
    return `<div class="icu-tiles">${tile(list.length, "Yatan hasta", "base")}${tile(overdue, "Geciken talimat", overdue ? "danger" : "ok")}${tile(upcoming, "Önümüzdeki 1 saat", upcoming ? "warn" : "ok")}${tile(cri, "Çalışan CRI", "info")}${tile(alerts, "Anormal vital", alerts ? "danger" : "ok")}</div>`;
  }

  function hourRuler(r, now) {
    const today = localStamp(now).slice(0, 10);
    const marks = r.orders.filter(o => o.due.startsWith(today)).map(o => {
      const h = +o.due.slice(11, 13), m = +o.due.slice(14, 16);
      const state = o.status === "done" ? "done" : o.status === "cancelled" ? "cancelled" : o.due < localStamp(now) ? "overdue" : "pending";
      return `<i class="icu-mark" data-state="${state}" style="left:${((h * 60 + m) / 1440 * 100).toFixed(2)}%" title="${esc(o.due.slice(11))} · ${esc(o.text)}"></i>`;
    }).join("");
    const nowPos = ((now.getHours() * 60 + now.getMinutes()) / 1440 * 100).toFixed(2);
    const ticks = [0, 6, 12, 18, 24].map(h => `<span style="left:${h / 24 * 100}%">${pad(h % 24 === 0 && h ? 0 : h)}</span>`).join("");
    return `<div class="icu-ruler" aria-hidden="true"><div class="icu-ruler-track">${marks}<em style="left:${nowPos}%"></em></div><div class="icu-ruler-ticks">${ticks}</div></div>`;
  }

  function orderList(r, now) {
    const stamp = localStamp(now), horizon = localStamp(new Date(now.getTime() + 12 * 3600000));
    const pending = r.orders.filter(o => o.status === "pending" && o.due <= horizon);
    const done = r.orders.filter(o => o.status === "done").slice(-2);
    const canDo = api.canWrite && r.stay.status === "Yatışta";
    const item = o => {
      const late = o.status === "pending" && o.due < stamp;
      const key = r.stay.id + "|" + o.id;
      const confirm = ui.confirm === key;
      return `<li data-state="${o.status === "done" ? "done" : late ? "overdue" : "pending"}"><time>${esc(o.due.slice(11))}${o.due.slice(0, 10) !== stamp.slice(0, 10) ? `<small>${esc(fmtDate(o.due.slice(0, 10)))}</small>` : ""}</time><span data-ui-preserve dir="auto">${esc(o.text)}</span>${o.status === "done" ? `<small class="icu-by" data-ui-preserve>✓ ${esc(o.closedBy || "")}</small>` : canDo ? `<button type="button" class="button small ${confirm ? "primary" : ""}" data-icu-done="${esc(r.stay.id)}" data-order="${esc(o.id)}">${tr(confirm ? "Onayla" : "Uygulandı")}</button>` : ""}</li>`;
    };
    const items = [...done, ...pending];
    return `<section class="icu-block"><h3>${tr("Talimatlar")}<small>${tr("Sonraki 12 saat")}</small></h3>${items.length ? `<ol class="icu-orders">${items.map(item).join("")}</ol>` : `<p class="icu-empty">${tr("Bekleyen talimat yok.")}</p>`}</section>`;
  }

  function spark(values) {
    const v = values.filter(x => x !== null);
    if (v.length < 2) return "";
    const mn = Math.min(...v), mx = Math.max(...v), span = mx - mn || 1;
    return `<svg viewBox="0 0 60 18" preserveAspectRatio="none" aria-hidden="true"><polyline points="${v.map((x, i) => `${(i / (v.length - 1) * 58 + 1).toFixed(1)},${(16 - (x - mn) / span * 14).toFixed(1)}`).join(" ")}"/></svg>`;
  }

  function vitalBlock(r, now) {
    const last = r.vitals.at(-1), species = r.patient?.species;
    const keys = ["temp", "hr", "rr", "spo2", "sys", "pain"];
    const cell = key => {
      const meta = VITALS.find(v => v[0] === key), value = last?.[key];
      const series = r.vitals.slice(-12).map(v => num(v[key]));
      return `<div class="icu-vital" data-flag="${value != null ? flag(key, value, species) : ""}"><span>${tr(meta[1])}</span><b>${value != null ? esc(value) : "—"}<small>${esc(meta[2])}</small></b>${spark(series)}</div>`;
    };
    const ago = last ? Math.round((now - parseLocal(last.at)) / 60000) : null;
    const stale = ago !== null && ago > 240;
    const extra = last ? [last.crt && `${tr("KDZ")} ${esc(last.crt)} sn`, last.mm && `${tr("Mukoza")}: ${esc(tr(last.mm))}`, last.mentation && esc(tr(last.mentation)), last.glucose && `${tr("Glukoz")} ${esc(last.glucose)}`, last.urine && `${tr("İdrar")} ${esc(last.urine)} mL/kg/sa`].filter(Boolean).join(" · ") : "";
    const form = ui.open === "vital:" + r.stay.id ? vitalForm(r) : "";
    const can = api.canWrite && r.stay.status === "Yatışta";
    return `<section class="icu-block"><h3>${tr("Vital bulgular")}<small class="${stale ? "icu-stale" : ""}">${last ? `${esc(fmtTime(last.at))} · ${ago < 1 ? tr("az önce") : duration(ago) + " " + tr("önce")}` : tr("Henüz ölçüm yok")}</small></h3>
      <div class="icu-vitals">${keys.map(cell).join("")}</div>${extra ? `<p class="icu-extra" data-ui-preserve>${extra}</p>` : ""}
      <div class="icu-actions">${can && !form ? `<button type="button" class="button small" data-icu-open="vital:${esc(r.stay.id)}">${tr("Vital gir")}</button>` : ""}${r.vitals.length ? `<button type="button" class="button small ghost" data-icu-open="history:${esc(r.stay.id)}">${tr("Geçmiş")} (${r.vitals.length})</button>` : ""}</div>${form}${ui.open === "history:" + r.stay.id ? vitalHistory(r) : ""}</section>`;
  }

  function vitalForm(r) {
    const now = localStamp(new Date());
    const inputs = VITALS.map(([k, label, unit, step]) => `<label><span>${tr(label)} <small>${esc(unit)}</small></span><input name="${k}" type="number" inputmode="decimal" step="${step}" min="0"></label>`).join("");
    const select = (name, label, values) => `<label><span>${tr(label)}</span><select name="${name}"><option value=""></option>${values.map(v => `<option value="${esc(v)}">${tr(v)}</option>`).join("")}</select></label>`;
    return `<form class="icu-form" data-icu-vital="${esc(r.stay.id)}"><div class="icu-form-grid"><label><span>${tr("Ölçüm saati")}</span><input name="at" type="datetime-local" required value="${now}" max="${now}"></label>${inputs}<label><span>${tr("KDZ")} <small>sn</small></span><input name="crt" type="text" maxlength="20" placeholder="< 2"></label>${select("mm", "Mukoza rengi", MM)}${select("mentation", "Bilinç durumu", MENTATION)}<label class="wide"><span>${tr("Not")}</span><input name="note" type="text" maxlength="600"></label></div><p class="form-error" role="alert"></p><div class="icu-form-actions"><button class="button primary small" type="submit">${tr("Kaydet")}</button><button class="button small" type="button" data-icu-close>${tr("Vazgeç")}</button></div></form>`;
  }

  function vitalHistory(r) {
    const cols = ["temp", "hr", "rr", "spo2", "sys", "dia", "pain", "glucose"];
    const species = r.patient?.species;
    return `<div class="icu-history"><table><thead><tr><th>${tr("Saat")}</th>${cols.map(k => `<th>${tr(VITALS.find(v => v[0] === k)[1])}</th>`).join("")}<th>${tr("Not")}</th></tr></thead><tbody>${[...r.vitals].reverse().slice(0, 48).map(v => `<tr><td>${esc(fmtTime(v.at))}</td>${cols.map(k => `<td data-flag="${v[k] != null ? flag(k, v[k], species) : ""}">${v[k] != null ? esc(v[k]) : ""}</td>`).join("")}<td data-ui-preserve dir="auto">${esc([v.crt && "KDZ " + v.crt, v.mm, v.mentation, v.note].filter(Boolean).join(" · "))}<small> ${esc(v.by || "")}</small></td></tr>`).join("")}</tbody></table></div>`;
  }

  function criBlock(r, now) {
    const running = r.infusions.filter(i => !i.stop), stopped = r.infusions.filter(i => i.stop).slice(-2);
    const can = api.canWrite && r.stay.status === "Yatışta";
    const row = inf => {
      const end = infusionEnd(inf), left = end ? (end - now) / 60000 : null;
      const total = end ? (end - parseLocal(inf.start)) / 60000 : null;
      const progress = end ? Math.min(100, Math.max(0, 100 - left / total * 100)) : null;
      const tone = inf.stop ? "stopped" : left !== null && left <= 0 ? "empty" : left !== null && left <= 15 ? "low" : "run";
      const confirm = ui.confirm === "stop:" + inf.id;
      return `<li class="icu-cri" data-tone="${tone}"><div><b data-ui-preserve dir="auto">${esc(inf.drug)}</b><small data-ui-preserve>${esc([inf.dose, inf.fluid].filter(Boolean).join(" · "))}</small></div>
        <div class="icu-cri-rate"><b>${esc(inf.rate)}</b><small>mL/${tr("sa")}</small></div>
        <div class="icu-cri-time">${inf.stop ? `<small>${esc(fmtTime(inf.start))} – ${esc(fmtTime(inf.stop))}</small>` : `<b data-elapsed="${esc(inf.start)}">${elapsed(inf.start, now)}</b><small>${end ? (left > 0 ? `${tr("Bitiş")} ${esc(fmtTime(localStamp(end)))} · ${duration(left)}` : tr("Torba/şırınga bitti")) : tr("Hacim girilmedi")}</small>`}</div>
        ${progress !== null && !inf.stop ? `<div class="icu-progress" role="progressbar" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress.toFixed(1)}%"></i></div>` : ""}
        ${!inf.stop && can ? `<button type="button" class="button small ${confirm ? "danger" : ""}" data-icu-stop="${esc(r.stay.id)}" data-inf="${esc(inf.id)}">${tr(confirm ? "Durdurmayı onayla" : "Durdur")}</button>` : ""}</li>`;
    };
    const form = ui.open === "cri:" + r.stay.id ? criForm(r) : "";
    return `<section class="icu-block"><h3>${tr("CRI / infüzyon")}<small>${running.length ? running.length + " " + tr("çalışıyor") : tr("Çalışan infüzyon yok")}</small></h3>
      ${running.length || stopped.length ? `<ul class="icu-cris">${[...running, ...stopped].map(row).join("")}</ul>` : ""}
      <div class="icu-actions">${can && !form ? `<button type="button" class="button small" data-icu-open="cri:${esc(r.stay.id)}">${tr("CRI başlat")}</button>` : ""}${r.weight ? `<a class="button small ghost" href="#hesaplayicilar/kilo/${encodeURIComponent(r.weight)}">${tr("Doz hesapla")}</a>` : ""}</div>${form}</section>`;
  }

  function criForm(r) {
    const now = localStamp(new Date());
    return `<form class="icu-form" data-icu-cri="${esc(r.stay.id)}"><div class="icu-form-grid">
      <label class="wide"><span>${tr("İlaç / sıvı")}</span><input name="drug" required maxlength="120" list="icuDrugs"></label>
      <label><span>${tr("Doz")}</span><input name="dose" maxlength="80" placeholder="ör. 5 mcg/kg/dk"></label>
      <label><span>${tr("Taşıyıcı sıvı")}</span><input name="fluid" maxlength="120" placeholder="ör. %0,9 NaCl"></label>
      <label><span>${tr("Hız")} <small>mL/${tr("sa")}</small></span><input name="rate" type="number" inputmode="decimal" step="0.01" min="0.01" max="2000" required></label>
      <label><span>${tr("Hacim")} <small>mL</small></span><input name="volume" type="number" inputmode="decimal" step="0.1" min="0.1" max="10000"></label>
      <label><span>${tr("Başlangıç")}</span><input name="start" type="datetime-local" required value="${now}" max="${now}"></label>
      <label class="wide"><span>${tr("Not")}</span><input name="note" maxlength="400"></label></div>
      <datalist id="icuDrugs">${["Fentanil", "Ketamin", "Lidokain", "Metoklopramid", "Dopamin", "Dobutamin", "Norepinefrin", "İnsülin (regüler)", "Midazolam", "Propofol", "Dekstroz %5", "Laktatlı Ringer", "%0,9 NaCl", "Potasyum klorür"].map(d => `<option value="${esc(d)}">`).join("")}</datalist>
      <p class="icu-hint">${tr("Rate değişikliğinde mevcut infüzyonu durdurup yeni hızla başlatın; geçmiş korunur.")}</p>
      <p class="form-error" role="alert"></p><div class="icu-form-actions"><button class="button primary small" type="submit">${tr("Başlat")}</button><button class="button small" type="button" data-icu-close>${tr("Vazgeç")}</button></div></form>`;
  }

  function card(r, now) {
    const p = r.patient || {};
    const stamp = localStamp(now);
    const overdue = r.orders.filter(o => o.status === "pending" && o.due < stamp).length;
    const last = r.vitals.at(-1);
    const abnormal = last && ["temp", "hr", "rr", "spo2", "sys", "pain"].some(k => ["low", "high"].includes(flag(k, last[k], p.species)));
    const tone = overdue || abnormal ? "danger" : r.stay.status === "Planlandı" ? "planned" : "ok";
    return `<article class="icu-card" data-tone="${tone}">
      <header><span class="icu-room" data-ui-preserve>${esc(r.stay.room || "—")}</span><div><a href="#patient/${encodeURIComponent(p.id || r.stay.patient)}" data-ui-preserve dir="auto">${esc(p.name || r.stay.patient)}</a>
      <small data-ui-preserve>${esc([p.species, p.breed, r.weight ? r.weight + " kg" : "", r.owner].filter(Boolean).join(" · "))}</small></div>
      <div class="icu-meta"><b>${tr("Gün")} ${dayCount(r.stay)}</b><small>${tr(r.stay.status)}</small></div></header>
      <div class="icu-badges">${overdue ? `<span data-tone="danger">${overdue} ${tr("geciken")}</span>` : ""}${abnormal ? `<span data-tone="danger">${tr("Anormal vital")}</span>` : ""}${r.infusions.some(i => !i.stop) ? `<span data-tone="info">CRI</span>` : ""}${r.stay.clinician ? `<span data-ui-preserve>${esc(r.stay.clinician)}</span>` : ""}${r.stay.allergies ? `<span data-tone="warn" title="${esc(r.stay.allergies)}">${tr("Alerji / hastalık notu")}</span>` : ""}</div>
      ${hourRuler(r, now)}
      ${orderList(r, now)}${vitalBlock(r, now)}${criBlock(r, now)}
      <footer>${api.canWrite ? `<button type="button" class="button small" data-edit="stays" data-id="${esc(r.stay.id)}">${tr("Talimat ekle / yatışı düzenle")}</button>` : ""}<a class="button small ghost" href="#cikti-sablonlari/stay/${encodeURIComponent(r.stay.id)}">${tr("Çıktı")}</a></footer></article>`;
  }

  function sheet(list, now) {
    const day = ui.day, hours = [...Array(24).keys()], stamp = localStamp(now);
    const head = `<tr><th scope="col">${tr("Hasta")}</th>${hours.map(h => `<th scope="col" class="${day === stamp.slice(0, 10) && h === now.getHours() ? "icu-now" : ""}">${pad(h)}</th>`).join("")}</tr>`;
    const body = list.map(r => {
      const cells = hours.map(h => {
        const prefix = `${day}T${pad(h)}`;
        const orders = r.orders.filter(o => o.due.startsWith(prefix));
        const vitals = r.vitals.filter(v => v.at.startsWith(prefix));
        const slotStart = parseLocal(prefix + ":00"), slotEnd = new Date(slotStart.getTime() + 3600000);
        const cri = r.infusions.some(i => { const s = parseLocal(i.start), e = i.stop ? parseLocal(i.stop) : now; return s < slotEnd && e > slotStart; });
        const marks = orders.map(o => {
          const state = o.status === "done" ? "done" : o.status === "cancelled" ? "cancelled" : o.due < stamp ? "overdue" : "pending";
          const can = state !== "done" && state !== "cancelled" && api.canWrite && r.stay.status === "Yatışta";
          const key = r.stay.id + "|" + o.id, confirm = ui.confirm === key;
          const symbol = state === "done" ? "✓" : state === "overdue" ? "!" : state === "cancelled" ? "×" : "•";
          return can ? `<button type="button" class="icu-dot ${confirm ? "icu-confirm" : ""}" data-state="${state}" data-icu-done="${esc(r.stay.id)}" data-order="${esc(o.id)}" title="${esc(o.due.slice(11))} · ${esc(o.text)}${confirm ? " — " + tr("Onaylamak için tekrar tıklayın") : ""}">${confirm ? "?" : symbol}</button>` : `<span class="icu-dot" data-state="${state}" title="${esc(o.due.slice(11))} · ${esc(o.text)}">${symbol}</span>`;
        }).join("");
        const vital = vitals.length ? `<span class="icu-v" title="${esc(vitals.map(v => [v.at.slice(11), v.temp && v.temp + "°C", v.hr && "N " + v.hr, v.rr && "S " + v.rr].filter(Boolean).join(" ")).join("\n"))}">V</span>` : "";
        return `<td class="${cri ? "icu-cri-on" : ""}">${marks}${vital}</td>`;
      }).join("");
      return `<tr><th scope="row"><span class="icu-room" data-ui-preserve>${esc(r.stay.room || "—")}</span> <a href="#patient/${encodeURIComponent(r.stay.patient)}" data-ui-preserve dir="auto">${esc(r.patient?.name || r.stay.patient)}</a></th>${cells}</tr>`;
    }).join("");
    const legend = `<p class="icu-legend"><span><i class="icu-dot" data-state="pending">•</i>${tr("Bekliyor")}</span><span><i class="icu-dot" data-state="overdue">!</i>${tr("Gecikti")}</span><span><i class="icu-dot" data-state="done">✓</i>${tr("Uygulandı")}</span><span><i class="icu-v">V</i>${tr("Vital ölçüm")}</span><span><i class="icu-cri-sw"></i>${tr("CRI çalışıyor")}</span></p>`;
    return `<div class="icu-sheet-tools"><button type="button" class="button small" data-icu-day="-1" aria-label="${tr("Önceki gün")}">‹</button><input type="date" value="${day}" data-icu-date aria-label="${tr("Gün")}"><button type="button" class="button small" data-icu-day="1" aria-label="${tr("Sonraki gün")}">›</button><button type="button" class="button small" data-icu-day="0">${tr("Bugün")}</button></div>${legend}<div class="icu-sheet-wrap"><table class="icu-sheet"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function render() {
    if (!root.isConnected) return;
    const now = new Date(), list = rows();
    // Açık formdaki yazılanlar yeniden çizimde kaybolmasın.
    const draft = root.querySelector(".icu-form");
    const kept = draft ? [...draft.elements].filter(el => el.name).map(el => [el.name, el.value]) : null;
    const active = document.activeElement?.closest?.(".icu-form") ? document.activeElement.name : null;
    const views = [["cards", "Kartlar"], ["sheet", "Saatlik çizelge"]];
    root.innerHTML = `<div class="icu-head"><div><h1>${tr("Yoğun Bakım Panosu")}</h1><p>${tr("Yatan hastaların talimatları, vital bulguları ve infüzyonları tek ekranda.")}</p></div>
      <div class="icu-tools"><time class="icu-clock" data-icu-clock>${pad(now.getHours())}:${pad(now.getMinutes())}</time><div class="segmented" role="group" aria-label="${tr("Görünüm")}">${views.map(([k, l]) => `<button type="button" aria-pressed="${ui.view === k}" data-icu-view="${k}">${tr(l)}</button>`).join("")}</div><button type="button" class="button small" data-icu-print>${tr("Yazdır")}</button></div></div>
      ${summary(list, now)}
      ${list.length ? (ui.view === "sheet" ? sheet(list, now) : `<div class="icu-grid">${list.map(r => card(r, now)).join("")}</div>`) : `<div class="icu-empty-state"><p>${tr("Şu anda yatan hasta yok.")}</p>${api.canWrite ? `<button type="button" class="button primary" data-edit="stays">${tr("Yeni yatış")}</button>` : ""}</div>`}`;
    const form = root.querySelector(".icu-form");
    if (form && kept) for (const [name, value] of kept) if (form.elements[name]) form.elements[name].value = value;
    if (form && active && form.elements[active]) form.elements[active].focus();
    else if (form && ui.focus) { form.querySelector("input,select")?.focus(); ui.focus = false; }
  }

  function tick() {
    if (!root.isConnected) { clearInterval(timer); return; }
    const now = new Date();
    for (const el of root.querySelectorAll("[data-elapsed]")) el.textContent = elapsed(el.dataset.elapsed, now);
    const clock = root.querySelector("[data-icu-clock]");
    if (clock) clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (now.getSeconds() === 0) render();
  }

  root.addEventListener("click", async event => {
    const t = event.target.closest("button,[data-icu-view]");
    if (!t || !root.contains(t)) return;
    if (t.dataset.icuView) { ui.view = t.dataset.icuView; sessionStorageSet("vz-icu-view", ui.view); render(); return; }
    if (t.hasAttribute("data-icu-print")) { window.print(); return; }
    if (t.dataset.icuDay !== undefined) {
      const d = t.dataset.icuDay === "0" ? new Date() : new Date(ui.day + "T12:00");
      if (t.dataset.icuDay !== "0") d.setDate(d.getDate() + Number(t.dataset.icuDay));
      ui.day = localStamp(d).slice(0, 10); render(); return;
    }
    if (t.dataset.icuOpen) { ui.open = ui.open === t.dataset.icuOpen ? null : t.dataset.icuOpen; ui.focus = true; root.querySelector(".icu-form")?.remove(); render(); return; }
    if (t.hasAttribute("data-icu-close")) { ui.open = null; t.closest("form").remove(); render(); return; }
    if (t.dataset.icuDone) {
      const key = t.dataset.icuDone + "|" + t.dataset.order;
      if (ui.confirm !== key) { ui.confirm = key; render(); setTimeout(() => { if (ui.confirm === key) { ui.confirm = null; render(); } }, 5000); return; }
      ui.confirm = null;
      await save(t.dataset.icuDone, stay => {
        const orders = json(stay.careOrders), order = orders.find(o => o.id === t.dataset.order);
        if (!order || order.status !== "pending") return null;
        order.status = "done";
        return {...stay, careOrders: JSON.stringify(orders)};
      }, "Talimat uygulandı");
      render();
      return;
    }
    if (t.dataset.icuStop) {
      const key = "stop:" + t.dataset.inf;
      if (ui.confirm !== key) { ui.confirm = key; render(); setTimeout(() => { if (ui.confirm === key) { ui.confirm = null; render(); } }, 5000); return; }
      ui.confirm = null;
      await save(t.dataset.icuStop, stay => {
        const list = json(stay.icuInfusions), inf = list.find(i => i.id === t.dataset.inf);
        if (!inf || inf.stop) return null;
        const stop = localStamp(new Date());
        inf.stop = stop < inf.start ? inf.start : stop;
        return {...stay, icuInfusions: JSON.stringify(list)};
      }, "İnfüzyon durduruldu");
      render();
    }
  });

  root.addEventListener("change", event => {
    if (event.target.matches("[data-icu-date]") && event.target.value) { ui.day = event.target.value; render(); }
  });

  root.addEventListener("submit", async event => {
    const form = event.target.closest("form.icu-form");
    if (!form) return;
    event.preventDefault();
    const error = form.querySelector(".form-error");
    const data = Object.fromEntries(new FormData(form).entries());
    for (const k of Object.keys(data)) { data[k] = String(data[k]).trim().replace(",", "."); if (data[k] === "") delete data[k]; }
    const now = localStamp(new Date());
    if (form.dataset.icuVital) {
      const entry = {id: uid(), at: data.at};
      let filled = 0;
      for (const [k] of VITALS) if (data[k] !== undefined) {
        if (!/^\d{1,5}(\.\d{1,3})?$/.test(data[k])) { error.textContent = tr("Değerleri sayı olarak girin."); return; }
        entry[k] = data[k]; filled++;
      }
      for (const k of ["crt", "mm", "mentation", "note"]) if (data[k]) { entry[k] = data[k]; filled++; }
      if (!filled) { error.textContent = tr("En az bir ölçüm girin."); return; }
      if (!entry.at || entry.at > now) { error.textContent = tr("Ölçüm saati ileri bir zaman olamaz."); return; }
      const ok = await save(form.dataset.icuVital, stay => {
        if (stay.start && entry.at < stay.start.slice(0, 16)) { error.textContent = tr("Ölçüm saati yatış girişinden önce olamaz."); return null; }
        return {...stay, icuVitals: JSON.stringify([...json(stay.icuVitals), entry])};
      }, "Vital bulgu kaydedildi");
      if (ok) { ui.open = null; form.remove(); render(); }
      return;
    }
    if (form.dataset.icuCri) {
      if (!data.drug || !/^\d{1,4}(\.\d{1,3})?$/.test(data.rate || "") || +data.rate <= 0) { error.textContent = tr("İlaç adı ve hız (mL/sa) gerekli."); return; }
      if (data.volume && !/^\d{1,5}(\.\d{1,3})?$/.test(data.volume)) { error.textContent = tr("Değerleri sayı olarak girin."); return; }
      if (!data.start || data.start > now) { error.textContent = tr("Başlangıç saati ileri bir zaman olamaz."); return; }
      const entry = {id: uid(), start: data.start, drug: data.drug, rate: data.rate};
      for (const k of ["dose", "fluid", "volume", "note"]) if (data[k]) entry[k] = data[k];
      const ok = await save(form.dataset.icuCri, stay => {
        if (stay.start && entry.start < stay.start.slice(0, 16)) { error.textContent = tr("Başlangıç saati yatış girişinden önce olamaz."); return null; }
        return {...stay, icuInfusions: JSON.stringify([...json(stay.icuInfusions), entry])};
      }, "İnfüzyon başlatıldı");
      if (ok) { ui.open = null; form.remove(); render(); }
    }
  });

  clearInterval(timer);
  timer = setInterval(tick, 1000);
  render();
  return {render};
}
