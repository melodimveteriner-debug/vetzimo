// İşletme analizi (veri havuzu): dönem seçimi, hareketli göstergeler ve grafikler, kâr/zarar tablosu, ürün/hizmet/
// müşteri/personel sıralamaları, tahsilat ve alacak, stok ve gider. Hesap sunucuda arşiv dahil yapılır
// (/api/clinic/business-report); bu modül yalnız gösterir. Satırlar tıklanınca ilgili kayda / filtreli listeye gider.
import {workbook} from "./xlsx.js";

const RM = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

function presets(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const monday = new Date(y, m, d - ((now.getDay() + 6) % 7));
  return {
    today: [iso(now), iso(now)],
    week: [iso(monday), iso(now)],
    month: [iso(new Date(y, m, 1)), iso(now)],
    lastMonth: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    quarter: [iso(new Date(y, m - 2, 1)), iso(now)],
    year: [iso(new Date(y, 0, 1)), iso(now)],
    lastYear: [iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))],
  };
}

export function mountBusinessReports(root, api) {
  const {tr} = api;
  const money = c => api.money((c || 0) / 100);
  const short = c => {
    const v = (c || 0) / 100, a = Math.abs(v);
    const f = a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + " mn" : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + " bin" : v.toFixed(0);
    return "₺" + f.replace(".", ",");
  };
  const num = n => Number(n || 0).toLocaleString("tr-TR", {maximumFractionDigits: 2});
  const pct = (a, b) => !b ? null : Math.round((a - b) * 1000 / Math.abs(b)) / 10;
  const P = presets();
  let st = {preset: "month", from: P.month[0], to: P.month[1], tab: "summary", branch: api.branch(), sort: {products: "revenue", services: "revenue", customers: "revenue"}, data: null, loading: false, error: ""};
  try { const saved = JSON.parse(sessionStorage.getItem("vz-br") || "null"); if (saved?.from) st = {...st, ...saved, data: null, loading: false, error: ""}; } catch {}
  const remember = () => { try { sessionStorage.setItem("vz-br", JSON.stringify({preset: st.preset, from: st.from, to: st.to, tab: st.tab, branch: st.branch, sort: st.sort})); } catch {} };

  root.innerHTML = "";
  root.classList.add("br-root");
  const shell = document.createElement("div");
  root.append(shell);

  async function load() {
    st.loading = true; st.error = ""; draw();
    try {
      const q = new URLSearchParams({from: st.from, to: st.to});
      if (api.isDealer()) q.set("branch", st.branch || "");
      st.data = await api.fetch("/api/clinic/business-report?" + q);
    } catch (e) { st.error = e.message || tr("Rapor yüklenemedi."); st.data = null; }
    st.loading = false; remember(); draw(true);
  }

  // ── çizim yardımcıları
  const delta = (cur, prev, inverse = false) => {
    if (!cur && !prev) return `<span class="br-delta">—</span>`;
    const p = pct(cur, prev);
    if (p === null) return `<span class="br-delta">${tr("önceki dönem yok")}</span>`;
    const good = inverse ? p <= 0 : p >= 0;
    return `<span class="br-delta ${good ? "up" : "down"}" title="${esc(tr("Önceki eşit dönem"))}: ${esc(money(prev))}">${p >= 0 ? "▲" : "▼"} %${Math.abs(p).toLocaleString("tr-TR")}</span>`;
  };
  const card = (label, value, cur, prev, opts = {}) => `<article class="br-kpi ${opts.tone || ""}"${opts.go ? ` data-br-tab="${opts.go}" role="button" tabindex="0"` : ""}>
    <span>${esc(tr(label))}</span><strong data-count="${opts.raw ?? value}" data-kind="${opts.kind || "money"}">${opts.kind === "count" ? num(value) : money(value)}</strong>
    ${prev === undefined ? (opts.note ? `<small>${esc(opts.note)}</small>` : "") : delta(cur, prev, opts.inverse)}${opts.sub ? `<small>${opts.sub}</small>` : ""}</article>`;

  function columnChart(rows) {
    if (!rows.length) return `<p class="br-empty">${tr("Bu dönemde kayıt yok.")}</p>`;
    const W = 720, H = 240, L = 54, B = 26, T = 12, max = Math.max(1, ...rows.map(r => Math.max(r.revenue, r.collected, r.expenses))), min = Math.min(0, ...rows.map(r => r.profit));
    const span = max - min || 1, y = v => T + (H - T - B) * (max - v) / span, bw = (W - L - 8) / rows.length;
    const lab = k => st.data.grain === "month" ? k.slice(5, 7) + "." + k.slice(2, 4) : k.slice(8, 10) + "." + k.slice(5, 7);
    const every = Math.ceil(rows.length / 12);
    const grid = [0, .25, .5, .75, 1].map(f => { const v = min + span * f; return `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="br-grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="br-axis">${esc(short(v))}</text>`; }).join("");
    const bars = rows.map((r, i) => {
      const x = L + i * bw + bw * .12, w = Math.max(2, bw * .76);
      return `<g class="br-col" style="--i:${i}"><title>${esc(r.key)}\n${esc(tr("Ciro"))}: ${esc(money(r.revenue))}\n${esc(tr("Brüt kâr"))}: ${esc(money(r.profit))}\n${esc(tr("Tahsilat"))}: ${esc(money(r.collected))}\n${esc(tr("Gider"))}: ${esc(money(r.expenses))}\n${esc(tr("Satış"))}: ${r.count}</title>
        <rect x="${x}" y="${y(Math.max(0, r.revenue))}" width="${w}" height="${Math.max(0, y(0) - y(r.revenue))}" rx="3" class="br-bar"/>
        ${r.expenses ? `<rect x="${x + w * .6}" y="${y(r.expenses)}" width="${w * .4}" height="${Math.max(0, y(0) - y(r.expenses))}" rx="2" class="br-bar exp"/>` : ""}
        ${i % every === 0 ? `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="br-axis">${esc(lab(r.key))}</text>` : ""}</g>`;
    }).join("");
    const pts = rows.map((r, i) => `${L + i * bw + bw / 2},${y(r.profit)}`).join(" ");
    const cpts = rows.map((r, i) => `${L + i * bw + bw / 2},${y(r.collected)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" class="br-chart" role="img" aria-label="${esc(tr("Dönem grafiği"))}">${grid}${bars}
      <polyline points="${cpts}" class="br-line col" pathLength="1"/><polyline points="${pts}" class="br-line" pathLength="1"/></svg>
      <div class="br-legend"><span class="k rev"></span>${tr("Ciro")}<span class="k pro"></span>${tr("Brüt kâr")}<span class="k col"></span>${tr("Tahsilat")}<span class="k exp"></span>${tr("Gider")}</div>`;
  }
  function hbars(rows, value, label, fmt, link) {
    if (!rows.length) return `<p class="br-empty">${tr("Bu dönemde kayıt yok.")}</p>`;
    const max = Math.max(1, ...rows.map(r => Math.abs(value(r))));
    return `<ol class="br-hbars">${rows.map((r, i) => `<li${link ? ` ${link(r)}` : ""} style="--i:${i}"><span class="n">${i + 1}</span><span class="t">${esc(label(r))}</span>
      <span class="b"><i class="${value(r) < 0 ? "neg" : ""}" style="--w:${Math.max(1.5, Math.abs(value(r)) * 100 / max)}%"></i></span><b>${esc(fmt(r))}</b></li>`).join("")}</ol>`;
  }
  function donut(rows, value, label) {
    const total = rows.reduce((a, r) => a + Math.max(0, value(r)), 0);
    if (!total) return `<p class="br-empty">${tr("Bu dönemde kayıt yok.")}</p>`;
    let off = 0;
    const segs = rows.slice(0, 8).map((r, i) => { const f = Math.max(0, value(r)) / total, s = `<circle r="15.9" cx="18" cy="18" pathLength="100" class="br-seg s${i}" style="--d:${(f * 100).toFixed(2)};--o:${(-off * 100).toFixed(2)};--i:${i}"><title>${esc(label(r))}: ${esc(money(value(r)))} (%${(f * 100).toFixed(1)})</title></circle>`; off += f; return s; }).join("");
    return `<div class="br-donut"><svg viewBox="0 0 36 36">${segs}</svg><ul>${rows.slice(0, 8).map((r, i) => `<li><span class="k s${i}"></span>${esc(label(r))}<b>${esc(money(value(r)))}</b><small>%${(value(r) * 100 / total).toFixed(1)}</small></li>`).join("")}</ul></div>`;
  }
  const table = (cols, rows, link) => rows.length ? `<div class="table-wrap br-table" tabindex="0"><table><thead><tr>${cols.map(c => `<th scope="col"${c.num ? ' class="num"' : ""}>${esc(tr(c.t))}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr${link ? ` ${link(r)}` : ""}>${cols.map(c => `<td${c.num ? ' class="num"' : ""}>${c.f(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="br-empty">${tr("Bu dönemde kayıt yok.")}</p>`;
  const panel = (title, body, extra = "") => `<section class="panel br-panel"><header><h3>${esc(tr(title))}</h3>${extra}</header>${body}</section>`;
  const sorter = (group, opts) => `<div class="br-seg-tabs" role="group">${opts.map(([k, t]) => `<button type="button" data-br-sort="${group}:${k}" aria-pressed="${st.sort[group] === k}">${esc(tr(t))}</button>`).join("")}</div>`;
  const linkOwner = r => r.id ? `data-br-go="owner/${esc(encodeURIComponent(r.id))}" tabindex="0" title="${esc(tr("Hasta sahibi kartını aç"))}"` : "";
  const linkItem = r => r.id ? `data-br-go="record/products/${esc(encodeURIComponent(r.id))}" tabindex="0"` : `data-br-search="${esc(r.name)}" tabindex="0" title="${esc(tr("Bu kalemin satışlarını göster"))}"`;
  const linkStaff = r => r.name && r.name !== "Belirtilmemiş" ? `data-br-staff="${esc(r.name)}" tabindex="0" title="${esc(tr("Bu personelin satışlarını göster"))}"` : "";
  const marginTag = (m, known = true) => !known ? `<span class="br-tag warn" title="${esc(tr("Alış maliyeti girilmemiş; kâr gerçeğinden yüksek görünebilir."))}">${tr("maliyet yok")}</span>` : `<span class="br-tag ${m >= 40 ? "good" : m >= 15 ? "" : "bad"}">%${num(m)}</span>`;

  // ── sekmeler
  function summary(d) {
    const k = d.kpi, p = d.previous;
    return `<div class="br-grid2">${panel("Ciro, kâr, tahsilat ve gider", columnChart(d.timeline), `<small>${esc(tr({day: "Günlük", week: "Haftalık", month: "Aylık"}[d.grain]))}</small>`)}
      ${panel("Ödeme yöntemleri (tahsilat)", donut(d.methods, r => r.amount, r => r.name))}</div>
      <div class="br-grid3">${panel("En çok kazandıran hizmetler", hbars(d.services.byRevenue.slice(0, 6), r => r.revenue, r => r.name, r => short(r.revenue), linkItem), `<button class="button small" data-br-tab="services">${tr("Tümü")}</button>`)}
      ${panel("En çok satılan ürünler", hbars(d.products.byQty.slice(0, 6), r => r.qty, r => r.name, r => num(r.qty) + " " + tr("adet"), linkItem), `<button class="button small" data-br-tab="products">${tr("Tümü")}</button>`)}
      ${panel("En değerli müşteriler", hbars(d.customers.byRevenue.slice(0, 6), r => r.revenue, r => r.name, r => short(r.revenue), linkOwner), `<button class="button small" data-br-tab="customers">${tr("Tümü")}</button>`)}</div>
      <div class="br-grid3">${panel("Personel cirosu", hbars(d.staff.slice(0, 6), r => r.revenue, r => r.name, r => short(r.revenue), linkStaff), `<button class="button small" data-br-tab="staff">${tr("Tümü")}</button>`)}
      ${panel("Haftanın günlerine göre ciro", hbars(d.weekday, r => r.revenue, r => tr(r.name), r => short(r.revenue)))}
      ${panel("Türlere göre ciro", hbars(d.species.slice(0, 7), r => r.revenue, r => tr(r.name), r => short(r.revenue)))}</div>
      ${panel("Önemli bulgular", insights(d))}`;
  }
  function insights(d) {
    const k = d.kpi, p = d.previous, out = [];
    const ch = pct(k.revenue, p.revenue);
    if (ch !== null) out.push([ch >= 0 ? "good" : "bad", `${tr("Ciro önceki döneme göre")} %${Math.abs(ch).toLocaleString("tr-TR")} ${ch >= 0 ? tr("arttı") : tr("azaldı")} (${money(p.revenue)} → ${money(k.revenue)}).`]);
    const best = d.services.byProfit[0] || d.products.byProfit[0];
    if (best) out.push(["good", `${tr("En çok kâr ettiren kalem")}: ${best.name} · ${money(best.profit)} (${tr("marj")} %${num(best.margin)}).`]);
    const low = [...d.products.byRevenue].filter(r => r.costKnown && r.revenue > 0).sort((a, b) => a.margin - b.margin)[0];
    if (low && low.margin < 15) out.push(["bad", `${tr("Düşük kârlı ürün")}: ${low.name} · ${tr("marj")} %${num(low.margin)}. ${tr("Satış fiyatını veya alış maliyetini gözden geçirin.")}`]);
    if (k.costUnknown) out.push(["warn", `${k.costUnknown} ${tr("satışta alış maliyeti bilinmeyen ürün var; stok partisi veya alış faturası girerseniz kâr kesinleşir.")}`]);
    if (d.debt.total) out.push(["warn", `${tr("Açık alacak")}: ${money(d.debt.total)} · ${d.debt.count} ${tr("müşteri")}. ${tr("90 günü geçen")}: ${money(d.debt.aging[3] + d.debt.aging[4])}.`]);
    if (k.customers) out.push(["", `${k.customers} ${tr("müşteri satın aldı")}: ${k.newCustomers} ${tr("yeni")}, ${k.returningCustomers} ${tr("tekrar gelen")} (%${Math.round(k.returningCustomers * 100 / k.customers)}).`]);
    if (k.appointments?.total) out.push([k.appointments.noshow / k.appointments.total > .1 ? "bad" : "", `${tr("Randevu")}: ${k.appointments.total} · ${tr("gelmedi")} ${k.appointments.noshow} · ${tr("iptal")} ${k.appointments.cancel}.`]);
    if (d.stock.idleCount) out.push(["warn", `${d.stock.idleCount} ${tr("stoklu ürün bu dönemde hiç satılmadı")} (${tr("bağlı stok değeri")} ${money(d.stock.idle.reduce((a, r) => a + r.value, 0))}).`]);
    const wd = [...d.weekday].sort((a, b) => b.revenue - a.revenue)[0];
    if (wd?.revenue) out.push(["", `${tr("En yoğun gün")}: ${tr(wd.name)} (${money(wd.revenue)}).`]);
    return `<ul class="br-insights">${out.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("") || `<li>${tr("Bu dönemde kayıt yok.")}</li>`}</ul>`;
  }
  function pnl(d) {
    const k = d.kpi, p = d.previous;
    const row = (t, a, b, o = {}) => `<tr class="${o.cls || ""}"><th scope="row">${esc(tr(t))}</th><td class="num">${o.sign && a > 0 ? "−" : ""}${money(a)}</td><td class="num">${o.sign && b > 0 ? "−" : ""}${money(b)}</td><td class="num">${delta(a, b, o.inverse)}</td></tr>`;
    return `<div class="br-grid2">${panel("Kâr / zarar tablosu", `<div class="table-wrap br-table"><table class="br-pnl"><thead><tr><th></th><th class="num">${tr("Bu dönem")}</th><th class="num">${tr("Önceki dönem")}</th><th class="num">${tr("Değişim")}</th></tr></thead><tbody>
      ${row("Satış cirosu (KDV dahil)", k.revenue, p.revenue)}${row("KDV", k.vat, p.vat, {sign: true, inverse: true})}${row("Net satış", k.net, p.net, {cls: "sub"})}
      ${row("Satılan malın maliyeti", k.cost, p.cost, {sign: true, inverse: true})}${row("Brüt kâr", k.grossProfit, p.grossProfit, {cls: "sub"})}
      ${row("Giderler (kasa)", k.expenses, p.expenses, {sign: true, inverse: true})}${row("Diğer gelirler", k.otherIncome, p.otherIncome)}
      ${row(k.netProfit >= 0 ? "Net kâr" : "Net zarar", k.netProfit, p.netProfit, {cls: "total " + (k.netProfit >= 0 ? "pos" : "neg")})}</tbody></table></div>
      <p class="br-note">${tr("Brüt kâr marjı")}: <b>%${num(k.margin)}</b>. ${tr("Maliyet, ürünün stok partilerindeki ağırlıklı alış fiyatından; yoksa son alış faturasından hesaplanır. Hizmetlerin maliyeti 0 kabul edilir.")}</p>`)}
      ${panel("Nakit akışı", `<div class="br-flow">${[["Kasaya giren", k.cashIn, "in"], ["Kasadan çıkan", k.cashOut, "out"], ["Net nakit", k.cashIn - k.cashOut, k.cashIn >= k.cashOut ? "in" : "out"]].map(([t, v, c]) => `<div class="${c}"><span>${esc(tr(t))}</span><strong data-count="${v}" data-kind="money">${money(v)}</strong></div>`).join("")}</div>
        <dl class="br-dl">${[["Satış anında alınan ve sonraki tahsilatlar", k.cashIn - k.otherIncome], ["Diğer gelirler", k.otherIncome], ["Kasa giderleri", k.expenses], ["Tedarikçi ödemeleri", k.supplierPayments], ["Stok alışları (fatura toplamı)", k.purchases], ["Silinen borçlar (kasaya girmez)", k.writeOffs]].map(([t, v]) => `<div><dt>${esc(tr(t))}</dt><dd>${money(v)}</dd></div>`).join("")}</dl>`)}</div>
      ${panel("Dönemlere göre kâr", columnChart(d.timeline))}`;
  }
  function items(d, kind) {
    const g = d[kind], by = st.sort[kind], rows = by === "profit" ? g.byProfit : by === "qty" ? g.byQty : g.byRevenue;
    const val = by === "profit" ? r => r.profit : by === "qty" ? r => (kind === "services" ? r.count : r.qty) : r => r.revenue;
    const fmt = by === "qty" ? r => num(kind === "services" ? r.count : r.qty) + " " + tr(kind === "services" ? "işlem" : "adet") : r => short(val(r));
    return `${panel(kind === "products" ? "Ürün performansı" : "Hizmet performansı", hbars(rows.slice(0, 10), val, r => r.name, fmt, linkItem), sorter(kind, [["revenue", "Ciro"], ["profit", "Kâr"], ["qty", kind === "services" ? "İşlem sayısı" : "Satış adedi"]]))}
      ${panel(`${kind === "products" ? "Tüm ürünler" : "Tüm hizmetler"} (${g.total})`, table([
        {t: kind === "products" ? "Ürün" : "Hizmet", f: r => `<strong>${esc(r.name)}</strong>${r.category ? `<small class="kv-cell-note">${esc(r.category)}</small>` : ""}`},
        {t: "Adet", num: true, f: r => num(r.qty)}, {t: "İşlem", num: true, f: r => num(r.count)}, {t: "Müşteri", num: true, f: r => num(r.customers)},
        {t: "Ciro", num: true, f: r => money(r.revenue)}, {t: "Maliyet", num: true, f: r => r.costKnown ? money(r.cost) : "—"},
        {t: "Kâr", num: true, f: r => `<b class="${r.profit < 0 ? "neg" : ""}">${money(r.profit)}</b>`}, {t: "Marj", num: true, f: r => marginTag(r.margin, r.costKnown)}], rows, linkItem))}`;
  }
  function customers(d) {
    const by = st.sort.customers, g = d.customers, rows = by === "profit" ? g.byProfit : by === "visits" ? g.byVisits : g.byRevenue;
    const val = by === "profit" ? r => r.profit : by === "visits" ? r => r.visits : r => r.revenue;
    return `${panel("Müşteri sıralaması", hbars(rows.slice(0, 10), val, r => r.name, r => by === "visits" ? r.visits + " " + tr("ziyaret") : short(val(r)), linkOwner), sorter("customers", [["revenue", "En çok harcayan"], ["profit", "En çok kazandıran"], ["visits", "En çok ziyaret eden"]]))}
      ${panel(`${tr("Müşteriler")} (${g.total})`, table([{t: "Müşteri", f: r => `<strong>${esc(r.name)}</strong><small class="kv-cell-note">${esc(r.phone)}</small>`},
        {t: "Ziyaret", num: true, f: r => num(r.visits)}, {t: "İşlem", num: true, f: r => num(r.count)}, {t: "Ciro", num: true, f: r => money(r.revenue)},
        {t: "Kâr", num: true, f: r => money(r.profit)}, {t: "Ort. sepet", num: true, f: r => money(r.avgTicket)}, {t: "Son ziyaret", f: r => esc(api.date(r.last))},
        {t: "Borç", num: true, f: r => r.debt ? `<b class="neg">${money(r.debt)}</b>` : "—"}], rows, linkOwner))}`;
  }
  function staff(d) {
    const total = d.staff.reduce((a, r) => a + r.revenue, 0) || 1;
    return `<div class="br-grid2">${panel("Personele göre ciro", hbars(d.staff.slice(0, 12), r => r.revenue, r => r.name, r => short(r.revenue), linkStaff))}
      ${panel("Personele göre brüt kâr", hbars([...d.staff].sort((a, b) => b.profit - a.profit).slice(0, 12), r => r.profit, r => r.name, r => short(r.profit), linkStaff))}</div>
      ${panel("Personel performansı", table([{t: "Personel", f: r => `<strong>${esc(r.name)}</strong>`}, {t: "Satış", num: true, f: r => num(r.count)},
        {t: "Ciro", num: true, f: r => money(r.revenue)}, {t: "Pay", num: true, f: r => "%" + num(r.revenue * 100 / total)}, {t: "Brüt kâr", num: true, f: r => money(r.profit)},
        {t: "Ort. sepet", num: true, f: r => money(r.avgTicket)}, {t: "Müşteri", num: true, f: r => num(r.customers)}, {t: "Muayene", num: true, f: r => num(r.exams)}, {t: "Randevu", num: true, f: r => num(r.appointments)}], d.staff, linkStaff)
        + `<p class="br-note">${tr("Satışlar, satış kaydındaki Personel alanına göre gruplanır. Personeli boş satışlar \"Belirtilmemiş\" altında görünür.")}</p>`)}`;
  }
  function debt(d) {
    const ag = ["0–30 gün", "31–60 gün", "61–90 gün", "91–180 gün", "180+ gün"].map((t, i) => ({name: t, v: d.debt.aging[i]}));
    return `<div class="br-grid2">${panel("Alacak yaşlandırması", hbars(ag, r => r.v, r => tr(r.name), r => money(r.v)) + `<p class="br-note">${tr("Toplam açık alacak")}: <b>${money(d.debt.total)}</b> · ${d.debt.count} ${tr("müşteri")}. ${tr("Bugün itibarıyla, seçilen dönemden bağımsızdır.")}</p>`)}
      ${panel("Tahsilat yöntemleri", donut(d.methods, r => r.amount, r => r.name) + `<p class="br-note">${tr("Dönemde silinen borç")}: <b>${money(d.kpi.writeOffs)}</b> (${tr("kasaya girmez")}).</p>`)}</div>
      ${panel("En yüksek borçlu müşteriler", table([{t: "Müşteri", f: r => `<strong>${esc(r.name)}</strong><small class="kv-cell-note">${esc(r.phone)}</small>`}, {t: "Borç", num: true, f: r => `<b class="neg">${money(r.debt)}</b>`}], d.debt.top, linkOwner),
        api.canDebt() ? `<button class="button small" data-br-go="borc-hatirlatma">${tr("Borç hatırlatma gönder")}</button>` : "")}`;
  }
  function stock(d) {
    return `${panel("Stok değeri", `<div class="br-flow"><div class="in"><span>${tr("Eldeki stok (alış değeriyle)")}</span><strong data-count="${d.stock.value}" data-kind="money">${money(d.stock.value)}</strong></div><div class="out"><span>${tr("Dönemde hiç satılmayan stoklu ürün")}</span><strong>${num(d.stock.idleCount)}</strong></div></div>`)}
      ${panel("Satılmayan stoklar (bağlı sermaye)", table([{t: "Ürün", f: r => `<strong>${esc(r.name)}</strong>`}, {t: "Stok", num: true, f: r => num(r.stock)}, {t: "Alış değeri", num: true, f: r => money(r.value)}, {t: "Satış fiyatı", num: true, f: r => money(r.price)}], d.stock.idle, linkItem))}`;
  }
  function expenses(d) {
    return `<div class="br-grid2">${panel("Gider dağılımı", hbars(d.expenseGroups.slice(0, 12), r => r.amount, r => r.name, r => money(r.amount)))}
      ${panel("Gider özeti", table([{t: "Kalem", f: r => esc(tr(r[0]))}, {t: "Bu dönem", num: true, f: r => money(r[1])}, {t: "Önceki", num: true, f: r => money(r[2])}, {t: "Değişim", num: true, f: r => delta(r[1], r[2], true)}],
        [["Kasa giderleri", d.kpi.expenses, d.previous.expenses], ["Tedarikçi ödemeleri", d.kpi.supplierPayments, d.previous.supplierPayments], ["Stok alışları", d.kpi.purchases, d.previous.purchases]]))}</div>
      ${panel("Gider kalemleri", table([{t: "Açıklama", f: r => esc(r.name)}, {t: "Adet", num: true, f: r => num(r.count)}, {t: "Tutar", num: true, f: r => money(r.amount)}], d.expenseGroups))}`;
  }

  const TABS = [["summary", "Özet"], ["pnl", "Kâr / Zarar"], ["services", "Hizmetler"], ["products", "Ürünler"], ["customers", "Müşteriler"], ["staff", "Personel"], ["debt", "Tahsilat ve alacak"], ["stock", "Stok"], ["expenses", "Giderler"]];
  function draw(animate = false) {
    const d = st.data, k = d?.kpi, p = d?.previous;
    const pre = [["today", "Bugün"], ["week", "Bu hafta"], ["month", "Bu ay"], ["lastMonth", "Geçen ay"], ["quarter", "Son 3 ay"], ["year", "Bu yıl"], ["lastYear", "Geçen yıl"], ["custom", "Tarih aralığı"]];
    const branches = api.isDealer() ? api.branches() : [];
    shell.innerHTML = `<header class="br-head"><div><h2>${tr("İşletme Analizi")}</h2><p>${tr("Ciro, kâr-zarar, ürün, hizmet, müşteri ve personel performansı. Arşivdeki kayıtlar dahil hesaplanır.")}</p></div>
      <div class="br-actions">${d && k ? `<button class="button small" data-br-xlsx>${tr("Excel'e aktar")}</button>` : ""}<button class="button small" data-br-reload>${tr("Yenile")}</button></div></header>
      <section class="panel br-filters"><div class="br-presets" role="group" aria-label="${esc(tr("Dönem"))}">${pre.map(([kk, t]) => `<button type="button" data-br-preset="${kk}" aria-pressed="${st.preset === kk}">${esc(tr(t))}</button>`).join("")}</div>
        <div class="br-range"><label>${tr("Başlangıç")}<input type="date" id="brFrom" value="${st.from}" max="${iso(new Date())}"></label><label>${tr("Bitiş")}<input type="date" id="brTo" value="${st.to}" max="${iso(new Date())}"></label>
        ${branches.length > 1 ? `<label>${tr("Şube")}<select id="brBranch"><option value="">${tr("Tüm şubeler")}</option>${branches.map(b => `<option value="${esc(b.id)}" ${st.branch === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>` : ""}
        <button class="button primary small" data-br-apply>${tr("Uygula")}</button></div>
        ${d?.period ? `<small class="br-period">${esc(api.date(d.period.from))} – ${esc(api.date(d.period.to))} · ${d.period.days} ${tr("gün")} · ${tr("karşılaştırma")}: ${esc(api.date(d.period.prevFrom))} – ${esc(api.date(d.period.prevTo))}</small>` : ""}</section>
      ${st.loading ? `<div class="br-loading"><span></span>${tr("Rapor hazırlanıyor…")}</div>` : ""}
      ${st.error ? `<p class="callout warning">${esc(st.error)}</p>` : ""}
      ${k ? `<div class="br-kpis">
        ${card("Ciro", k.revenue, k.revenue, p.revenue, {sub: `${num(k.count)} ${tr("satış")} · ${tr("ort.")} ${money(k.avgTicket)}`, go: "pnl"})}
        ${card("Brüt kâr", k.grossProfit, k.grossProfit, p.grossProfit, {tone: "accent", sub: `${tr("marj")} %${num(k.margin)}`, go: "pnl"})}
        ${card(k.netProfit >= 0 ? "Net kâr" : "Net zarar", k.netProfit, k.netProfit, p.netProfit, {tone: k.netProfit >= 0 ? "good" : "bad", go: "pnl"})}
        ${card("Tahsilat", k.cashIn, k.cashIn, p.cashIn, {go: "debt"})}
        ${card("Giderler", k.expenses + k.supplierPayments, k.expenses + k.supplierPayments, p.expenses + p.supplierPayments, {inverse: true, go: "expenses"})}
        ${card("Açık alacak", d.debt.total, undefined, undefined, {tone: d.debt.total ? "bad" : "", note: `${d.debt.count} ${tr("müşteri")}`, go: "debt"})}
        ${card("Müşteri", k.customers, k.customers, undefined, {kind: "count", sub: `${num(k.newCustomers)} ${tr("yeni")} · ${num(k.returningCustomers)} ${tr("tekrar")}`, go: "customers"})}
        ${card("Stok değeri", d.stock.value, undefined, undefined, {note: `${d.stock.idleCount} ${tr("satılmayan ürün")}`, go: "stock"})}
      </div>
      <nav class="br-tabs" role="tablist">${TABS.map(([kk, t]) => `<button role="tab" data-br-tab="${kk}" aria-selected="${st.tab === kk}">${esc(tr(t))}</button>`).join("")}</nav>
      <div class="br-body">${({summary, pnl, services: x => items(x, "services"), products: x => items(x, "products"), customers, staff, debt, stock, expenses}[st.tab] || summary)(d)}</div>` : ""}`;
    if (animate) countUp();
  }
  function countUp() {
    if (RM) return;
    shell.querySelectorAll("[data-count]").forEach(n => {
      const target = Number(n.dataset.count), kind = n.dataset.kind, t0 = performance.now(), dur = 750;
      if (!Number.isFinite(target) || !target) return;
      const step = t => { const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 3), v = Math.round(target * e); n.textContent = kind === "count" ? num(v) : money(v); if (f < 1 && n.isConnected) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function exportXlsx() {
    const d = st.data; if (!d?.kpi) return;
    const c = v => Math.round(v || 0) / 100, k = d.kpi, p = d.previous;
    const itemSheet = (name, rows) => ({name: tr(name), headers: [tr("Ad"), tr("Kategori"), tr("Adet"), tr("İşlem"), tr("Müşteri"), tr("Ciro"), tr("Net (KDV hariç)"), tr("Maliyet"), tr("Kâr"), tr("Marj %")],
      rows: rows.map(r => [r.name, r.category, r.qty, r.count, r.customers, c(r.revenue), c(r.net), r.costKnown ? c(r.cost) : "", c(r.profit), r.margin])});
    const bytes = workbook([
      {name: tr("Özet"), headers: [tr("Gösterge"), tr("Bu dönem"), tr("Önceki dönem")], rows: [[tr("Dönem"), `${d.period.from} – ${d.period.to}`, `${d.period.prevFrom} – ${d.period.prevTo}`],
        [tr("Ciro (KDV dahil)"), c(k.revenue), c(p.revenue)], [tr("KDV"), c(k.vat), c(p.vat)], [tr("Net satış"), c(k.net), c(p.net)], [tr("Satılan malın maliyeti"), c(k.cost), c(p.cost)],
        [tr("Brüt kâr"), c(k.grossProfit), c(p.grossProfit)], [tr("Giderler"), c(k.expenses), c(p.expenses)], [tr("Diğer gelirler"), c(k.otherIncome), c(p.otherIncome)], [tr("Net kâr / zarar"), c(k.netProfit), c(p.netProfit)],
        [tr("Tahsilat"), c(k.cashIn), c(p.cashIn)], [tr("Tedarikçi ödemeleri"), c(k.supplierPayments), c(p.supplierPayments)], [tr("Satış adedi"), k.count, p.count], [tr("Açık alacak"), c(d.debt.total), ""], [tr("Stok değeri"), c(d.stock.value), ""]]},
      {name: tr("Dönemler"), headers: [tr("Dönem"), tr("Ciro"), tr("Brüt kâr"), tr("Tahsilat"), tr("Gider"), tr("Satış")], rows: d.timeline.map(r => [r.key, c(r.revenue), c(r.profit), c(r.collected), c(r.expenses), r.count])},
      itemSheet("Hizmetler", d.services.byRevenue), itemSheet("Ürünler", d.products.byRevenue),
      {name: tr("Müşteriler"), headers: [tr("Müşteri"), tr("Telefon"), tr("Ziyaret"), tr("İşlem"), tr("Ciro"), tr("Kâr"), tr("Ort. sepet"), tr("Son ziyaret"), tr("Borç")], rows: d.customers.byRevenue.map(r => [r.name, r.phone, r.visits, r.count, c(r.revenue), c(r.profit), c(r.avgTicket), r.last, c(r.debt)])},
      {name: tr("Personel"), headers: [tr("Personel"), tr("Satış"), tr("Ciro"), tr("Brüt kâr"), tr("Ort. sepet"), tr("Müşteri"), tr("Muayene"), tr("Randevu")], rows: d.staff.map(r => [r.name, r.count, c(r.revenue), c(r.profit), c(r.avgTicket), r.customers, r.exams, r.appointments])},
      {name: tr("Alacaklar"), headers: [tr("Müşteri"), tr("Telefon"), tr("Borç")], rows: d.debt.top.map(r => [r.name, r.phone, c(r.debt)])},
      {name: tr("Giderler"), headers: [tr("Açıklama"), tr("Adet"), tr("Tutar")], rows: d.expenseGroups.map(r => [r.name, r.count, c(r.amount)])},
    ]);
    const url = URL.createObjectURL(new Blob([bytes], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a = document.createElement("a"); a.href = url; a.download = `isletme-analizi-${d.period.from}-${d.period.to}.xlsx`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  shell.addEventListener("click", e => {
    const t = e.target.closest("button,[data-br-go],[data-br-search],[data-br-staff],[data-br-tab]");
    if (!t || !shell.contains(t)) return;
    if (t.dataset.brPreset) {
      st.preset = t.dataset.brPreset;
      if (st.preset !== "custom") { [st.from, st.to] = presets()[st.preset]; load(); } else draw();
      return;
    }
    if (t.hasAttribute("data-br-apply")) {
      const f = shell.querySelector("#brFrom").value, to = shell.querySelector("#brTo").value;
      if (!f || !to) return;
      st.from = f <= to ? f : to; st.to = f <= to ? to : f; st.preset = "custom";
      const b = shell.querySelector("#brBranch"); if (b) st.branch = b.value;
      load(); return;
    }
    if (t.hasAttribute("data-br-reload")) return load();
    if (t.hasAttribute("data-br-xlsx")) return exportXlsx();
    if (t.dataset.brSort) { const [g, k] = t.dataset.brSort.split(":"); st.sort[g] = k; remember(); draw(); return; }
    if (t.dataset.brTab) { st.tab = t.dataset.brTab; remember(); draw(); shell.querySelector(".br-tabs")?.scrollIntoView({block: "nearest", behavior: RM ? "auto" : "smooth"}); return; }
    if (t.dataset.brGo) return api.go(t.dataset.brGo);
    if (t.dataset.brSearch) return api.salesSearch(t.dataset.brSearch, st.from, st.to);
    if (t.dataset.brStaff) return api.salesByStaff(t.dataset.brStaff, st.from, st.to);
  });
  shell.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-br-go],[data-br-search],[data-br-staff],.br-kpi[data-br-tab]")) { e.preventDefault(); e.target.click(); } });
  shell.addEventListener("change", e => { if (e.target.id === "brBranch") { st.branch = e.target.value; load(); } });
  load();
}
