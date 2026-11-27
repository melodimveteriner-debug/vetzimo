// Hasta dosyası › Klinik kayıtlar: profesyonel sağlık zaman çizelgesi.
// Özet sayaçlar + tür süzgeci + arama, "Yaklaşan" şeridi, aylara göre gruplanmış geçmiş; satırın tamamı kaydı açar.
const TYPES = {
  exams: {label: "Muayene", hue: "#6d5df5", icon: '<path d="M6 3v6a6 6 0 0 0 12 0V3M6 3H4m2 0h2m10 0h-2m2 0h2M12 15v2a4 4 0 0 0 8 0v-1"/><circle cx="20" cy="14" r="2"/>'},
  labs: {label: "Tetkik", hue: "#0e9f8e", icon: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 14h9"/>'},
  treatments: {label: "Tedavi", hue: "#e0742c", icon: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>'},
  followups: {label: "Aşı ve takip", hue: "#2f7de1", icon: '<path d="m18 2 4 4M17 7l3-3M19 9 8.5 19.5 4.5 15.5 15 5M10 11l3 3M3 21l2.5-2.5"/>'},
  prescriptions: {label: "Reçete", hue: "#c2417f", icon: '<path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h4"/>'},
  stays: {label: "Yatış ve konaklama", hue: "#8a5a2b", icon: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>'},
  surgeries: {label: "Ameliyat", hue: "#d33f49", icon: '<path d="m14 4 6 6-9.5 9.5a2.1 2.1 0 0 1-3-3z"/><path d="m4 20 3.5-3.5"/>'},
  appointments: {label: "Randevu", hue: "#4b8a3c", icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'},
  weights: {label: "Kilo kaydı", hue: "#7a7f8c", icon: '<path d="M5 20h14l-2-12H7z"/><circle cx="12" cy="5" r="2"/>'},
};
const DONE = new Set(["Tamamlandı", "Yapıldı", "Taburcu", "Görüşüldü"]);
const CANCEL = new Set(["İptal", "İptal Edildi", "Reddedildi", "Gelmedi"]);
const lang = () => document.documentElement.lang || "tr";
const make = (tag, text = "", className = "") => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const svg = path => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const todayIso = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const fold = value => String(value || "").toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "");

function statusTone(event, today) {
  if (CANCEL.has(event.status)) return "cancel";
  if (DONE.has(event.status)) return "done";
  if (event.date && event.date < today && (event.type === "followups" || event.type === "appointments")) return "late";
  if (event.date && event.date >= today) return "planned";
  return event.status ? "neutral" : "";
}

export function mountPatientRecords(root, events, {openRecord, openExam, comparison} = {}) {
  const today = todayIso();
  const monthFmt = new Intl.DateTimeFormat(lang(), {month: "long", year: "numeric", timeZone: "UTC"});
  const dayFmt = new Intl.DateTimeFormat(lang(), {day: "2-digit", timeZone: "UTC"});
  const monFmt = new Intl.DateTimeFormat(lang(), {month: "short", timeZone: "UTC"});
  const fullFmt = new Intl.DateTimeFormat(lang(), {dateStyle: "medium", timeZone: "UTC"});
  const asDate = iso => new Date(iso + "T00:00:00Z");
  let type = "", query = "", limit = 30;

  root.className = "pr-records";
  root.replaceChildren();

  // Son iki muayene karşılaştırması: kısa ölçüm şeridi
  if (comparison && comparison.values.length) {
    const box = make("section", "", "pr-compare");
    box.append(make("strong", "Son iki tamamlanan muayene"), make("span", fullFmt.format(asDate(comparison.previous)) + " → " + fullFmt.format(asDate(comparison.latest)), "pr-compare-dates"));
    const list = make("div", "", "pr-compare-values");
    for (const v of comparison.values) {
      const trend = v.current > v.before ? "up" : v.current < v.before ? "down" : "same";
      const cell = make("div", "", "pr-compare-cell " + trend);
      cell.append(make("small", v.label), make("b", v.current + " " + v.unit), make("span", (trend === "up" ? "▲ " : trend === "down" ? "▼ " : "= ") + v.before + " " + v.unit));
      list.append(cell);
    }
    box.append(list);
    root.append(box);
  }

  // Araç çubuğu: tür süzgeci (sayaçlı) + arama
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  const bar = make("div", "", "pr-toolbar");
  const chips = make("div", "", "pr-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Kayıt türü");
  const chip = (key, label, count) => {
    const b = make("button", "", "pr-chip");
    b.type = "button";
    b.dataset.type = key;
    if (key) b.style.setProperty("--hue", TYPES[key].hue);
    b.append(make("span", label), make("b", String(count)));
    b.setAttribute("aria-pressed", String(type === key));
    b.addEventListener("click", () => { type = key; limit = 30; render(); });
    return b;
  };
  const search = make("input", "", "pr-search");
  search.type = "search";
  search.placeholder = "Kayıtlarda ara";
  search.setAttribute("aria-label", "Kayıtlarda ara");
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { query = fold(search.value.trim()); limit = 30; render(); }, 180); });
  bar.append(chips, search);
  const status = make("p", "", "pr-status");
  status.setAttribute("role", "status");
  const upcoming = make("section", "", "pr-upcoming");
  const list = make("div", "", "pr-timeline");
  const more = make("button", "Daha fazla kayıt göster", "button secondary pr-more");
  more.type = "button";
  more.addEventListener("click", () => { limit += 30; render(); });
  root.append(bar, status, upcoming, list, more);

  function row(event, compact = false) {
    const meta = TYPES[event.type] || {label: event.label, hue: "#7a7f8c", icon: ""};
    const tone = statusTone(event, today);
    const item = make("article", "", "pr-item" + (compact ? " compact" : ""));
    item.style.setProperty("--hue", meta.hue);
    const canOpen = openRecord?.allowed(event);
    if (canOpen) {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", event.title + " · " + meta.label);
      const open = () => openRecord.run(event);
      item.addEventListener("click", e => { if (!e.target.closest("button,summary,a")) open(); });
      item.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === item) { e.preventDefault(); open(); } });
    }
    const date = make("div", "", "pr-date");
    if (event.date) date.append(make("b", dayFmt.format(asDate(event.date))), make("span", monFmt.format(asDate(event.date))));
    else date.append(make("span", "—"));
    const dot = make("span", "", "pr-dot");
    dot.innerHTML = svg(meta.icon);
    const body = make("div", "", "pr-body");
    const head = make("div", "", "pr-head");
    const title = make("strong", event.title);
    title.dataset.uiPreserve = "";
    head.append(title, make("span", meta.label, "pr-type"));
    if (event.status) head.append(make("span", event.status, "pr-pill " + tone));
    else if (tone === "planned") head.append(make("span", "Planlandı", "pr-pill planned"));
    const info = [event.dateLabel && event.date ? event.dateLabel + ": " + fullFmt.format(asDate(event.date)) : "", event.time, event.author].filter(Boolean).join(" · ");
    body.append(head);
    if (info) body.append(make("small", info, "pr-meta"));
    if (event.summary && !compact) {
      const p = make("p", event.summary, "pr-summary");
      p.dataset.uiPreserve = "";
      body.append(p);
      if (event.summary.length > 160) {
        const toggle = make("button", "Özeti göster", "pr-link");
        toggle.type = "button";
        toggle.addEventListener("click", () => { const open = item.classList.toggle("expanded"); toggle.textContent = open ? "Özeti gizle" : "Özeti göster"; });
        body.append(toggle);
      }
    }
    if (openExam?.allowed(event)) {
      const linked = make("button", "Bağlı muayeneyi aç", "pr-link");
      linked.type = "button";
      linked.addEventListener("click", () => openExam.run(event));
      body.append(linked);
    }
    item.append(date, dot, body);
    if (canOpen) item.append(make("span", "›", "pr-go"));
    return item;
  }

  function render() {
    chips.replaceChildren(chip("", "Tümü", events.length), ...Object.keys(TYPES).filter(k => counts[k]).map(k => chip(k, TYPES[k].label, counts[k])));
    const filtered = events.filter(e => (!type || e.type === type) &&
      (!query || fold([e.title, e.label, e.status, e.author, e.summary].join(" ")).includes(query)));
    const future = filtered.filter(e => e.date && e.date > today && !DONE.has(e.status) && !CANCEL.has(e.status)).reverse();
    const upcomingSet = new Set(future);
    const past = filtered.filter(e => !upcomingSet.has(e));
    status.textContent = filtered.length ? filtered.length + " kayıt" : "";
    upcoming.replaceChildren();
    if (future.length) {
      const head = make("div", "", "pr-group-head");
      head.append(make("h3", "Yaklaşan"), make("span", String(future.length), "pr-count"));
      const strip = make("div", "", "pr-upcoming-list");
      future.slice(0, 6).forEach(e => strip.append(row(e, true)));
      upcoming.append(head, strip);
      if (future.length > 6) { const extra = make("small", "", "pr-meta"); extra.append(make("span", "+" + (future.length - 6) + " "), make("span", "planlı kayıt daha")); upcoming.append(extra); }
    }
    list.replaceChildren();
    if (!filtered.length) {
      const empty = make("div", "", "pr-empty");
      empty.append(make("strong", "Kayıt bulunamadı"), make("span", "Süzgeci veya aramayı değiştirin."));
      list.append(empty);
    }
    let month = "", group = null;
    for (const e of past.slice(0, limit)) {
      const key = e.date ? e.date.slice(0, 7) : "—";
      if (key !== month) {
        month = key;
        const section = make("section", "", "pr-month");
        const head = make("div", "", "pr-group-head");
        head.append(make("h3", e.date ? monthFmt.format(asDate(e.date)) : "Tarih belirtilmemiş"));
        group = make("div", "", "pr-month-list");
        section.append(head, group);
        list.append(section);
      }
      group.append(row(e));
    }
    more.hidden = past.length <= limit;
  }
  render();
}
