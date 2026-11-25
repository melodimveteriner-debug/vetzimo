// Yönetici gelişmiş panel: tüm bayiler, şubeler, hasta sahipleri, hastalar, abonelikler ve bayi gelir-giderleri.
// Grafikler SVG ile çizilir; çizgi grafikte artı imleçli ipucu, çubuklarda tek tek ipucu vardır. Renkler doğrulanmış
// kategorik paletin ilk üç yuvasıdır (mavi, turuncu, aqua) ve açık/koyu temada ayrı adımlarla tanımlanır.
const CSS = "/center-analytics.css?v=3";
const NS = "http://www.w3.org/2000/svg";
const tl = v => new Intl.NumberFormat("tr-TR", {style: "currency", currency: "TRY", maximumFractionDigits: 0}).format((v || 0) / 100);
const tlShort = v => { const x = (v || 0) / 100; return Math.abs(x) >= 1e6 ? (x / 1e6).toLocaleString("tr-TR", {maximumFractionDigits: 1}) + " mn ₺" : Math.abs(x) >= 1e3 ? (x / 1e3).toLocaleString("tr-TR", {maximumFractionDigits: 0}) + " bin ₺" : x.toLocaleString("tr-TR", {maximumFractionDigits: 0}) + " ₺"; };
const n = v => new Intl.NumberFormat("tr-TR").format(v || 0);
const monthLabel = m => new Date(m + "-15").toLocaleDateString("tr-TR", {month: "short"});
const monthLong = m => new Date(m + "-15").toLocaleDateString("tr-TR", {month: "long", year: "numeric"});
const sum = a => a.reduce((s, x) => s + x, 0);

function svg(tag, attrs = {}, ...kids) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); for (const k of kids) k && e.append(k); return e; }
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }

/** Çok serili çizgi grafik (tek eksen). series: [{name, values, cls}] */
function lineChart({el, months, series, format, label}) {
  const W = 760, H = 280, L = 64, R = 92, T = 16, B = 30;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const x = i => L + i * (W - L - R) / (months.length - 1), y = v => T + (H - T - B) * (1 - v / max);
  const root = svg("svg", {viewBox: `0 0 ${W} ${H}`, class: "ca-svg", role: "img", "aria-label": label});
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; root.append(svg("line", {x1: L, x2: W - R, y1: y(v), y2: y(v), class: "ca-grid"}), svg("text", {x: L - 8, y: y(v) + 4, class: "ca-tick", "text-anchor": "end"}, document.createTextNode(tlShort(v)))); }
  months.forEach((m, i) => { if (i % 2 === 0 || i === months.length - 1) root.append(svg("text", {x: x(i), y: H - 8, class: "ca-tick", "text-anchor": "middle"}, document.createTextNode(monthLabel(m)))); });
  const labels = [];
  for (const s of series) {
    root.append(svg("path", {d: s.values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join(""), class: "ca-line " + s.cls}));
    const li = s.values.length - 1;
    root.append(svg("circle", {cx: x(li), cy: y(s.values[li]), r: 4.5, class: "ca-dot " + s.cls}));
    labels.push({y: y(s.values[li]), text: s.name, cls: s.cls});
  }
  labels.sort((a, b) => a.y - b.y).forEach((l, i, arr) => { if (i && l.y - arr[i - 1].y < 15) l.y = arr[i - 1].y + 15; });
  const over = labels.length ? labels[labels.length - 1].y - (H - B - 6) : 0;
  if (over > 0) labels.forEach(l => { l.y -= over; });
  labels.forEach(l => root.append(svg("text", {x: W - R + 10, y: l.y + 4, class: "ca-direct"}, document.createTextNode(l.text))));
  // Artı imleç ve ipucu
  const cross = svg("line", {y1: T, y2: H - B, class: "ca-cross", visibility: "hidden"});
  const hits = series.map(s => svg("circle", {r: 5.5, class: "ca-hit " + s.cls, visibility: "hidden"}));
  root.append(cross, ...hits);
  const wrap = el("div", "", {className: "ca-chart"});
  const tip = el("div", "", {className: "ca-tip", hidden: true});
  const overlay = svg("rect", {x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent"});
  root.append(overlay);
  const show = e => {
    const r = root.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(months.length - 1, Math.round((px - L) / ((W - L - R) / (months.length - 1)))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    series.forEach((s, k) => { hits[k].setAttribute("cx", x(i)); hits[k].setAttribute("cy", y(s.values[i])); hits[k].setAttribute("visibility", "visible"); });
    tip.replaceChildren(el("strong", monthLong(months[i])), ...series.map(s => { const row = el("div", "", {className: "ca-tip-row"}); row.append(el("i", "", {className: "ca-key " + s.cls}), el("span", s.name), el("b", format(s.values[i]))); return row; }));
    tip.hidden = false;
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.min(r.width - 210, Math.max(0, left + 14)) + "px";
  };
  overlay.addEventListener("pointermove", show); overlay.addEventListener("pointerdown", show);
  overlay.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); hits.forEach(h => h.setAttribute("visibility", "hidden")); });
  const legend = el("div", "", {className: "ca-legend"});
  for (const s of series) { const item = el("span"); item.append(el("i", "", {className: "ca-key " + s.cls}), document.createTextNode(s.name + " · " + format(sum(s.values)))); legend.append(item); }
  wrap.append(legend, root, tip);
  return wrap;
}

/** Tek serili dikey çubuk grafik (12 ay). */
function barChart({el, months, values, format, label, cls = "s1"}) {
  if (!values.some(v => v > 0)) return el("p", "Son 12 ayda kayıt yok.", {className: "ca-empty"});
  const W = 380, H = 220, L = 52, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...values));
  const bw = (W - L - R) / months.length, y = v => T + (H - T - B) * (1 - v / max);
  const root = svg("svg", {viewBox: `0 0 ${W} ${H}`, class: "ca-svg", role: "img", "aria-label": label});
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; root.append(svg("line", {x1: L, x2: W - R, y1: y(v), y2: y(v), class: "ca-grid"}), svg("text", {x: L - 6, y: y(v) + 4, class: "ca-tick ca-tick-s", "text-anchor": "end"}, document.createTextNode(format === n ? n(v) : tlShort(v)))); }
  const wrap = el("div", "", {className: "ca-chart"});
  const tip = el("div", "", {className: "ca-tip", hidden: true});
  months.forEach((m, i) => {
    const h = Math.max(0, H - B - y(values[i])), x0 = L + i * bw + 2, w = bw - 4;
    const r = Math.min(4, w / 2, h);
    const d = h > 0 ? `M${x0},${H - B}V${H - B - h + r}Q${x0},${H - B - h} ${x0 + r},${H - B - h}H${x0 + w - r}Q${x0 + w},${H - B - h} ${x0 + w},${H - B - h + r}V${H - B}Z` : "";
    if (d) root.append(svg("path", {d, class: "ca-bar " + cls}));
    if (i % 2 === 0 || i === months.length - 1) root.append(svg("text", {x: x0 + w / 2, y: H - 8, class: "ca-tick ca-tick-s", "text-anchor": "middle"}, document.createTextNode(monthLabel(m))));
    const hit = svg("rect", {x: L + i * bw, y: T, width: bw, height: H - T - B, fill: "transparent"});
    hit.addEventListener("pointerenter", () => { tip.replaceChildren(el("strong", monthLong(m)), el("div", format(values[i]))); tip.hidden = false; tip.style.left = Math.min(100, (i / months.length) * 100) + "%"; });
    hit.addEventListener("pointerleave", () => { tip.hidden = true; });
    root.append(hit);
  });
  wrap.append(root, tip);
  return wrap;
}

export async function mountAnalytics(content, {call, el, status, openPartner}) {
  if (!document.querySelector(`link[href="${CSS}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: CSS}));
  content.replaceChildren(el("p", "Panel verisi hazırlanıyor…", {className: "muted"}));
  const load = async refresh => {
    const d = await call("analytics" + (refresh ? "?refresh=1" : ""));
    draw(d);
  };
  function draw(d) {
    const t = d.totals, m = d.months, root = el("div", "", {className: "ca-root"});
    const head = el("div", "", {className: "ca-head"});
    const refresh = el("button", "Verileri yenile", {type: "button", className: "secondary"});
    refresh.addEventListener("click", async () => { refresh.disabled = true; refresh.textContent = "Hesaplanıyor…"; try { await load(true); } catch (e) { status.textContent = e.message; refresh.disabled = false; } });
    head.append(el("div", ""), refresh);
    head.firstChild.append(el("h3", "Gelişmiş panel"), el("p", "Son güncelleme: " + new Date(d.generatedAt * 1000).toLocaleString("tr-TR") + " · veriler 10 dakikada bir yenilenir", {className: "muted"}));
    const tile = (label, value, sub, tone = "") => { const b = el("div", "", {className: "ca-tile " + tone}); b.append(el("span", label), el("strong", value)); if (sub) b.append(el("small", sub)); return b; };
    const tiles = el("div", "", {className: "ca-tiles"});
    tiles.append(
      tile("Bayi", n(t.partners), n(t.activePartners) + " etkin"),
      tile("Şube", n(t.branches)),
      tile("Hasta sahibi kaydı", n(t.clients), n(t.ownerAccounts) + " portal hesabı"),
      tile("Hasta kaydı", n(t.patients), n(t.newPatients) + " bu ay yeni"),
      tile("Ekip üyesi", n(t.staff), "şube yöneticisi ve personel"),
      tile("Bu ay muayene", n(t.exams), n(t.appointments) + " randevu"),
      tile("Abonelik geliri", tl(t.saasRevenue), "son 12 ay · çevrim içi ödemeler"),
      tile("Sözleşme bekleyen", n(t.unsigned), t.unsigned ? "imzalamadan çalışma alanı açılmaz" : "tüm bayiler imzaladı", t.unsigned ? "warn" : ""));
    // Abonelik durumu (bölümlü çubuk)
    const subs = el("section", "", {className: "ca-card"});
    const totalSubs = Math.max(1, t.paid + t.trial + t.none);
    const segBar = el("div", "", {className: "ca-seg", role: "img", "aria-label": `Ücretli ${t.paid}, deneme ${t.trial}, aboneliksiz ${t.none}`});
    [["s1", t.paid, "Ücretli / atanmış"], ["s2", t.trial, "Deneme (demo)"], ["s3", t.none, "Abonelik yok"]].forEach(([c, v, lbl]) => { if (v) { const s = el("i", "", {className: "ca-seg-part " + c, title: lbl + ": " + v}); s.style.flexGrow = v; segBar.append(s); } });
    const segLegend = el("div", "", {className: "ca-legend"});
    [["s1", t.paid, "Ücretli / atanmış"], ["s2", t.trial, "Deneme (demo)"], ["s3", t.none, "Abonelik yok"]].forEach(([c, v, lbl]) => { const s = el("span"); s.append(el("i", "", {className: "ca-key " + c}), document.createTextNode(lbl + " · " + n(v) + " (%" + Math.round(v * 100 / totalSubs) + ")")); segLegend.append(s); });
    subs.append(el("h4", "Abonelik durumu"), segBar, segLegend);
    // Gelir-gider eğilimi
    const trend = el("section", "", {className: "ca-card ca-wide"});
    trend.append(el("h4", "Bayilerin toplam cirosu, tahsilatı ve gideri · son 12 ay"),
      lineChart({el, months: m, format: tl, label: "Aylık ciro, tahsilat ve gider", series: [
        {name: "Ciro (satış)", values: d.trend.sales, cls: "s1"}, {name: "Gider", values: d.trend.expenses, cls: "s2"}, {name: "Tahsilat", values: d.trend.collections, cls: "s3"}]}));
    const saas = el("section", "", {className: "ca-card"});
    saas.append(el("h4", "Abonelik geliri · aylık"), barChart({el, months: m, values: d.trend.saas, format: tl, label: "Aylık abonelik geliri"}));
    const pats = el("section", "", {className: "ca-card"});
    pats.append(el("h4", "Yeni hasta kaydı · aylık"), barChart({el, months: m, values: d.trend.newPatients, format: n, label: "Aylık yeni hasta kaydı", cls: "s3"}));
    // En çok ciro yapan bayiler
    const ranked = d.partners.map(p => ({...p, total: sum(p.sales)})).sort((a, b) => b.total - a.total).slice(0, 10);
    const top = el("section", "", {className: "ca-card"});
    top.append(el("h4", "En yüksek cirolu bayiler · 12 ay"));
    const tmax = Math.max(1, ...ranked.map(p => p.total));
    for (const p of ranked) {
      const row = el("button", "", {type: "button", className: "ca-rank"});
      const bar = el("i", "", {className: "ca-rank-bar s1"}); bar.style.width = Math.max(1, p.total * 100 / tmax) + "%";
      row.append(el("span", p.name), el("b", tl(p.total)), el("span", "", {className: "ca-rank-track"}));
      row.lastChild.append(bar);
      row.addEventListener("click", () => openPartner?.(p.id));
      top.append(row);
    }
    // Ayrıntılı bayi tablosu
    const tableBox = el("section", "", {className: "ca-card ca-wide"});
    const search = el("input", "", {type: "search", placeholder: "Bayi, şehir veya paket ara", className: "ca-search"});
    const csv = el("button", "CSV indir", {type: "button", className: "secondary"});
    const cols = [["name", "Bayi"], ["city", "Şehir"], ["plan", "Paket"], ["endsOn", "Bitiş"], ["branches", "Şube"], ["clients", "Hasta sahibi"], ["patients", "Hasta"],
      ["team", "Ekip"], ["portal", "Portal"], ["sales12", "Ciro 12 ay"], ["coll12", "Tahsilat 12 ay"], ["exp12", "Gider 12 ay"], ["net12", "Net 12 ay"], ["exams", "Bu ay muayene"], ["agreement", "Sözleşme"]];
    const rows = d.partners.map(p => ({...p, team: p.members.branch + p.members.staff, portal: p.members.customer, sales12: sum(p.sales), coll12: sum(p.collections),
      exp12: sum(p.expenses), net12: sum(p.collections) + sum(p.income) - sum(p.expenses)}));
    let sortKey = "sales12", dir = -1;
    const wrap = el("div", "", {className: "center-table-wrap"});
    const render = () => {
      const q = search.value.trim().toLocaleLowerCase("tr");
      const list = rows.filter(r => !q || [r.name, r.city, r.plan].some(v => String(v || "").toLocaleLowerCase("tr").includes(q)))
        .sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "tr")) * dir; });
      const tbl = el("table", "", {className: "center-table ca-table"}), hr = tbl.createTHead().insertRow();
      for (const [k, lbl] of cols) {
        const th = el("th", ""); const b = el("button", lbl + (k === sortKey ? (dir < 0 ? " ↓" : " ↑") : ""), {type: "button", className: "ca-sort"});
        th.setAttribute("aria-sort", k === sortKey ? (dir < 0 ? "descending" : "ascending") : "none");
        b.addEventListener("click", () => { dir = sortKey === k ? -dir : -1; sortKey = k; render(); });
        th.append(b); hr.append(th);
      }
      const body = tbl.createTBody();
      for (const r of list) {
        const tr = body.insertRow(); tr.tabIndex = 0;
        const kind = r.planKind === "trial" ? " · deneme" : r.planKind ? "" : "";
        const cells = [r.name + (r.active ? "" : " (kapalı)"), r.city || "—", (r.plan || "Abonelik yok") + kind, r.endsOn || "—", n(r.branches), n(r.clients), n(r.patients), n(r.team), n(r.portal),
          tl(r.sales12), tl(r.coll12), tl(r.exp12), tl(r.net12), n(r.exams), r.agreement ? "İmzalı" : "Bekliyor"];
        cells.forEach((c, i) => { const td = tr.insertCell(); td.textContent = c; if (i >= 4 && i <= 13) td.className = "num"; if (i === 14 && !r.agreement) td.className = "ca-warn"; });
        tr.addEventListener("click", () => openPartner?.(r.id));
        tr.addEventListener("keydown", e => { if (e.key === "Enter") openPartner?.(r.id); });
      }
      wrap.replaceChildren(tbl);
    };
    search.addEventListener("input", render);
    csv.addEventListener("click", () => {
      const esc = v => '"' + String(v ?? "").replaceAll('"', '""') + '"';
      const lines = [cols.map(c => esc(c[1])).join(";"), ...rows.map(r => cols.map(([k]) => esc(["sales12", "coll12", "exp12", "net12"].includes(k) ? (r[k] / 100).toFixed(2).replace(".", ",") : k === "agreement" ? (r[k] ? "İmzalı" : "Bekliyor") : r[k])).join(";"))];
      const a = Object.assign(document.createElement("a"), {href: URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], {type: "text/csv;charset=utf-8"})), download: "vetzimo-bayi-raporu.csv"});
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const tools = el("div", "", {className: "ca-tools"}); tools.append(search, csv);
    tableBox.append(el("h4", "Bayi ayrıntıları · satıra dokunarak bayi kartını açın"), tools, wrap);
    render();
    const grid = el("div", "", {className: "ca-grid"});
    grid.append(trend, subs, top, saas, pats, tableBox);
    root.append(head, tiles, grid);
    content.replaceChildren(root);
  }
  try { await load(false); } catch (e) { content.replaceChildren(el("p", e.message, {className: "muted"})); }
}
