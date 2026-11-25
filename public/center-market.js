// Merkez paneli · Satış Sitesi Stüdyosu: tüm satış sayfalarının metin, başlık/SEO ve ek bölüm düzenlemesi (canlı önizleme,
// önizlemede tıklayarak düzenleme, cihaz genişliği), uygulama bazlı indirme istatistikleri ve QR kodları, otomatik demo ayarları.
import {qrSvg} from "./qr.js?v=1";

const STYLE = "/center-market.css?v=2";
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmt = n => Number(n || 0).toLocaleString("tr-TR");
const day = d => d ? new Date(d + "T12:00:00").toLocaleDateString("tr-TR", {day: "numeric", month: "short"}) : "—";
const when = t => t ? new Date(t * 1000).toLocaleString("tr-TR", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "—";
const GROUPS = [
  ["Genel sayfalar", p => !/\/(ozellikler|cozumler|blog)(\/|$)/.test(p)],
  ["Özellikler", p => p.startsWith("/platform/ozellikler")],
  ["Çözümler", p => p.startsWith("/platform/cozumler")],
  ["Blog", p => p.startsWith("/platform/blog")],
];
const PLATFORM = {android: "Android", ios: "iOS", windows: "Windows", macos: "macOS", linux: "Linux", web: "Web", other: "Diğer"};

export async function mountMarketStudio(root, {call, url, params}) {
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  const section = ["sayfalar", "indirmeler", "demo"].includes(params.get("bolum")) ? params.get("bolum") : "sayfalar";
  const shell = h("div", "mk");
  const head = h("header", "mk-head");
  head.append(h("div", "", null), h("nav", "mk-tabs"));
  head.firstChild.append(h("h2", "", "Satış Sitesi Stüdyosu"), h("p", "mk-muted", "Satış sitesindeki tüm sayfaların metinleri, arama motoru bilgileri, uygulama indirmeleri ve otomatik demo tek yerde."));
  for (const [key, label] of [["sayfalar", "Sayfalar ve içerik"], ["indirmeler", "Uygulama indirmeleri"], ["demo", "Otomatik demo"]]) {
    const a = h("a", "mk-tab", label, {href: url("site", {bolum: key})});
    if (key === section) a.setAttribute("aria-current", "page");
    head.lastChild.append(a);
  }
  const body = h("div", "mk-body");
  shell.append(head, body);
  root.replaceChildren(shell);
  try {
    if (section === "indirmeler") await downloads(body, call);
    else if (section === "demo") await demoAuto(body, call);
    else await pages(body, {call, url, params});
  } catch (e) { body.replaceChildren(h("p", "mk-error", e.message)); }
}

// ───────────────────────────── Sayfalar ─────────────────────────────
async function pages(body, {call, url, params}) {
  const [list, editedPages] = await Promise.all([
    fetch("/cpanel-market-pages.json?v=2").then(r => { if (!r.ok) throw Error("Satış sitesi sayfa listesi yüklenemedi."); return r.json(); }),
    call("market-status").catch(() => ({pages: []})),
  ]);
  const edited = new Map(editedPages.pages.map(p => [p.path, p]));
  const selected = list.find(([p]) => p === params.get("page")) || list[0];
  const [path, title] = selected;
  const view = ["seo", "sections"].includes(params.get("view")) ? params.get("view") : "content";
  const page = await call("market-text?" + new URLSearchParams({page: path}));
  const record = page.record || {};
  const pageUrl = path === "/platform" ? "/" : path;

  // Sol: gruplu sayfa listesi
  const nav = h("aside", "mk-nav");
  const search = h("input", "mk-input", null, {type: "search", placeholder: "Sayfa ara…", "aria-label": "Sayfa ara"});
  const navList = h("div", "mk-nav-list");
  const drawNav = () => {
    const q = search.value.trim().toLocaleLowerCase("tr");
    navList.replaceChildren();
    for (const [label, test] of GROUPS) {
      const items = list.filter(([p, n]) => test(p) && (n + " " + p).toLocaleLowerCase("tr").includes(q));
      if (!items.length) continue;
      const box = h("details", "mk-nav-group", null, {open: true});
      box.append(h("summary", "", `${label} · ${items.length}`));
      for (const [p, n] of items) {
        const a = h("a", "mk-nav-item", null, {href: url("site", {bolum: "sayfalar", page: p, view})});
        a.append(h("span", "", n));
        const st = edited.get(p);
        if (st) a.append(h("small", "mk-dot", st.edits ? String(st.edits) : "•", {title: "Düzenlenmiş sayfa"}));
        if (p === path) a.setAttribute("aria-current", "page");
        box.append(a);
      }
      navList.append(box);
    }
    if (!navList.childElementCount) navList.append(h("p", "mk-muted", "Eşleşen sayfa yok."));
  };
  search.addEventListener("input", drawNav); drawNav();
  nav.append(h("strong", "", "Sayfalar"), h("small", "mk-muted", `${list.length} sayfa · ${edited.size} düzenlenmiş`), search, navList);

  // Sağ: düzenleyici + önizleme
  const main = h("section", "mk-main");
  const toolbar = h("div", "mk-toolbar");
  toolbar.append(h("h3", "", title), h("code", "mk-path", pageUrl));
  const devices = h("div", "mk-seg", null, {role: "group", "aria-label": "Önizleme genişliği"});
  const frameWrap = h("div", "mk-frame");
  const frame = h("iframe", "", null, {title: title + " · önizleme", loading: "lazy"});
  frameWrap.append(frame);
  for (const [k, label, w] of [["desk", "Masaüstü", "100%"], ["tab", "Tablet", "820px"], ["phone", "Telefon", "390px"]]) {
    const b = h("button", "mk-seg-btn", label, {type: "button"});
    b.addEventListener("click", () => { frame.style.width = w; devices.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
    b.setAttribute("aria-pressed", String(k === "desk"));
    devices.append(b);
  }
  const togglePreview = h("button", "mk-btn", "Önizlemeyi gizle", {type: "button"});
  const open = h("a", "mk-btn", "Siteyi aç ↗", {href: pageUrl, target: "_blank", rel: "noopener"});
  toolbar.append(devices, togglePreview, open);
  const tabs = h("nav", "mk-subtabs");
  for (const [k, l] of [["content", "İçerik"], ["seo", "Başlık ve SEO"], ["sections", "Ek bölüm"]]) {
    const a = h("a", "mk-subtab", l, {href: url("site", {bolum: "sayfalar", page: path, view: k})});
    if (k === view) a.setAttribute("aria-current", "page");
    tabs.append(a);
  }
  const split = h("div", "mk-split");
  const editor = h("form", "mk-editor", null, {noValidate: true});
  split.append(editor, frameWrap);
  togglePreview.addEventListener("click", () => { const hide = !frameWrap.hidden; frameWrap.hidden = hide; split.classList.toggle("solo", hide); togglePreview.textContent = hide ? "Önizlemeyi göster" : "Önizlemeyi gizle"; });
  main.append(toolbar, tabs, split);
  body.replaceChildren(h("div", "mk-studio"));
  body.firstChild.append(nav, main);

  const payload = {
    title: record.title || page.title || title, description: record.description || "VetZimo · " + title,
    section_title: record.section_title || "", section_text: record.section_text || "", section_url: record.section_url || "",
  };
  let edits = {...record.edits}, baseline = JSON.stringify(edits), metaBaseline = JSON.stringify(payload);
  const meta = {...payload};
  const dirty = () => JSON.stringify(edits) !== baseline || JSON.stringify(meta) !== metaBaseline;
  const status = h("p", "mk-status", "", {role: "status"});
  const save = h("button", "mk-btn primary", "Değişiklikleri yayımla", {type: "submit"});
  const discard = h("button", "mk-btn", "Değişiklikleri geri al", {type: "button"});
  const bar = h("div", "mk-savebar"); bar.append(status, discard, save);
  const sync = () => { const d = dirty(); save.disabled = !d; discard.disabled = !d; bar.classList.toggle("on", d); if (d) status.textContent = "Kaydedilmemiş değişiklikler var."; };
  const warn = e => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", warn);

  // Önizleme: aynı kökenli iframe; metin değiştikçe yayındaki sayfada canlı gösterilir, sayfadaki metne tıklayınca alanı açar.
  const fieldsByText = new Map(), inputs = new Map();
  let doc = null;
  const live = (key, before, after) => {
    if (!doc) return;
    for (const node of doc.querySelectorAll("[data-mk-key=\"" + key + "\"]")) node.textContent = after;
    if (!doc.querySelector("[data-mk-key=\"" + key + "\"]")) mark(key, before);
    for (const node of doc.querySelectorAll("[data-mk-key=\"" + key + "\"]")) node.textContent = after;
  };
  const mark = (key, text) => {
    if (!doc || !text) return;
    for (const node of doc.querySelectorAll("main h1,main h2,main h3,main h4,main h5,main h6,main p,main a,main button,main summary,main label,main strong,main small,main span,main li")) {
      if (node.children.length === 0 && node.textContent.trim() === text.trim() && !node.dataset.mkKey) node.dataset.mkKey = key;
    }
  };
  frame.addEventListener("load", () => {
    try { doc = frame.contentDocument; } catch { doc = null; }
    if (!doc) return;
    const st = doc.createElement("style");
    st.textContent = "[data-mk-key]{outline:1px dashed transparent;outline-offset:3px;cursor:pointer;transition:outline-color .15s}[data-mk-key]:hover{outline-color:#7c3aed}[data-mk-key].mk-focus{outline:2px solid #7c3aed}";
    doc.head.append(st);
    for (const [key, cur] of fieldsByText) mark(key, cur());
    doc.addEventListener("click", e => {
      const node = e.target.closest?.("[data-mk-key]");
      if (!node) return;
      e.preventDefault();
      const input = inputs.get(node.dataset.mkKey);
      if (input) { input.closest("details")?.setAttribute("open", ""); input.scrollIntoView({block: "center", behavior: "smooth"}); input.focus(); }
    }, true);
  });
  frame.src = pageUrl + (pageUrl.includes("?") ? "&" : "?") + "onizleme=1";

  if (view === "content") {
    const groups = new Map();
    for (const entry of Object.entries(page.fields || {})) {
      const g = entry[1].group || "Sayfa içeriği";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(entry);
    }
    const filter = h("input", "mk-input", null, {type: "search", placeholder: "Düzenlenecek metni ara… (önizlemede bir metne tıklayarak da açabilirsiniz)", "aria-label": "Metin ara"});
    const results = h("div", "mk-fields");
    const total = [...groups.values()].reduce((n, x) => n + x.length, 0);
    const draw = () => {
      const q = filter.value.trim().toLocaleLowerCase("tr");
      results.replaceChildren();
      for (const [group, entries] of groups) {
        const matches = entries.filter(([key, row]) => (row.text + " " + (edits[key] ?? "")).toLocaleLowerCase("tr").includes(q));
        if (!matches.length) continue;
        const changed = matches.filter(([k]) => k in edits).length;
        const box = h("details", "mk-group", null, {open: !!q || !results.childElementCount});
        box.append(h("summary", "", `${group} · ${matches.length}${changed ? " · " + changed + " değişti" : ""}`));
        for (const [key, row] of matches) {
          const item = h("div", "mk-field" + (key in edits ? " changed" : ""));
          const label = h("label", "mk-label");
          const ta = h("textarea", "mk-textarea", null, {rows: row.text.length > 120 ? 4 : 2, maxLength: 1000});
          ta.value = edits[key] ?? row.text;
          const tag = h("span", "mk-tag", (row.tag || "").toUpperCase());
          label.append(tag, h("span", "mk-orig", row.text.slice(0, 120)), ta);
          const reset = h("button", "mk-link", "Varsayılana dön", {type: "button"});
          const count = h("small", "mk-count", ta.value.length + "/1000");
          let prev = ta.value;
          const update = () => {
            if (ta.value === row.text) delete edits[key]; else edits[key] = ta.value;
            item.classList.toggle("changed", key in edits);
            count.textContent = ta.value.length + "/1000";
            live(key, prev, ta.value); prev = ta.value; sync();
          };
          ta.addEventListener("input", update);
          ta.addEventListener("focus", () => { doc?.querySelectorAll(".mk-focus").forEach(n => n.classList.remove("mk-focus")); const n = doc?.querySelector("[data-mk-key=\"" + key + "\"]"); if (n) { n.classList.add("mk-focus"); n.scrollIntoView({block: "center", behavior: "smooth"}); } });
          reset.addEventListener("click", () => { ta.value = row.text; update(); });
          const foot = h("div", "mk-field-foot"); foot.append(count, reset);
          item.append(label, foot);
          inputs.set(key, ta);
          fieldsByText.set(key, () => edits[key] ?? row.text);
          box.append(item);
        }
        results.append(box);
      }
      if (!results.childElementCount) results.append(h("p", "mk-muted", "Düzenlenebilir metin bulunamadı."));
    };
    filter.addEventListener("input", draw); draw();
    const info = h("p", "mk-muted", `${total} düzenlenebilir metin · ${Object.keys(edits).length} değiştirilmiş`);
    editor.append(filter, info, results);
    if (path === "/platform/paketler") editor.prepend(h("a", "mk-link", "Paket kartlarını ve fiyatları Yazılım Paketleri’nde düzenleyin →", {href: url("paketler")}));
    if (path === "/platform/uygulama-indir") editor.prepend(h("a", "mk-link", "İndirme sayılarını ve QR kodlarını görün →", {href: url("site", {bolum: "indirmeler"})}));
  } else if (view === "seo") {
    const t = h("input", "mk-input", null, {value: meta.title, maxLength: 160});
    const d = h("textarea", "mk-textarea", null, {rows: 3, maxLength: 350}); d.value = meta.description;
    const tc = h("small", "mk-count"), dc = h("small", "mk-count");
    const snippet = h("div", "mk-snippet");
    const drawSeo = () => {
      meta.title = t.value; meta.description = d.value;
      tc.textContent = t.value.length + " karakter · önerilen 30–60"; tc.classList.toggle("warn", t.value.length > 60 || t.value.length < 20);
      dc.textContent = d.value.length + " karakter · önerilen 70–160"; dc.classList.toggle("warn", d.value.length > 160 || d.value.length < 50);
      snippet.replaceChildren(h("small", "", location.host + (pageUrl === "/" ? "" : pageUrl)), h("strong", "", (t.value || title) + " · VetZimo"), h("p", "", d.value.length > 160 ? d.value.slice(0, 157) + "…" : d.value));
      if (doc) { const h1 = doc.querySelector("main h1"); if (h1) h1.textContent = t.value; }
      sync();
    };
    t.addEventListener("input", drawSeo); d.addEventListener("input", drawSeo);
    const lt = h("label", "mk-label"); lt.append(h("span", "", "Sayfa başlığı (sayfadaki ana başlık ve tarayıcı sekmesi)"), t, tc);
    const ld = h("label", "mk-label"); ld.append(h("span", "", "Arama sonucu açıklaması"), d, dc);
    editor.append(lt, ld, h("h4", "", "Google önizlemesi"), snippet);
    drawSeo();
  } else {
    const st = h("input", "mk-input", null, {value: meta.section_title, maxLength: 160});
    const sx = h("textarea", "mk-textarea", null, {rows: 6, maxLength: 1500}); sx.value = meta.section_text;
    const su = h("input", "mk-input", null, {type: "url", value: meta.section_url, maxLength: 500, placeholder: "https://"});
    const upd = () => { meta.section_title = st.value; meta.section_text = sx.value; meta.section_url = su.value; sync(); };
    [st, sx, su].forEach(x => x.addEventListener("input", upd));
    const l1 = h("label", "mk-label"); l1.append(h("span", "", "Bölüm başlığı"), st);
    const l2 = h("label", "mk-label"); l2.append(h("span", "", "Bölüm metni"), sx);
    const l3 = h("label", "mk-label"); l3.append(h("span", "", "HTTPS bağlantısı (isteğe bağlı, “Ayrıntıları incele” düğmesi)"), su);
    editor.append(h("p", "mk-muted", "Ek bölüm sayfanın en altına, sayfa sonu çağrısından önce eklenir. Boş bırakılırsa gösterilmez."), l1, l2, l3);
  }
  editor.append(bar);
  discard.addEventListener("click", () => { window.removeEventListener("beforeunload", warn); location.reload(); });
  editor.addEventListener("submit", async e => {
    e.preventDefault();
    if (!dirty()) return;
    if (meta.section_url && !/^https:\/\//.test(meta.section_url)) { status.textContent = "Bağlantı https:// ile başlamalıdır."; return; }
    save.disabled = true; status.textContent = "Yayımlanıyor…";
    try {
      await call("market", {...meta, path, id: record.id || "", edits});
      baseline = JSON.stringify(edits); metaBaseline = JSON.stringify(meta);
      sync(); status.textContent = "Sayfa yayımlandı.";
      edited.set(path, {path, edits: Object.keys(edits).length}); drawNav();
      frame.src = frame.src;
    } catch (er) { status.textContent = er.message; save.disabled = false; }
  });
  sync();
}

// ───────────────────────────── İndirmeler ─────────────────────────────
async function downloads(body, call) {
  let days = 30;
  const wrap = h("div", "mk-dl");
  body.replaceChildren(wrap);
  const draw = async () => {
    wrap.replaceChildren(h("p", "mk-muted", "Yükleniyor…"));
    const s = await call("downloads?days=" + days);
    const pageRow = s.apps.find(a => a.key === "page");
    const apps = s.apps.filter(a => a.key !== "page");
    const kpis = h("div", "mk-kpis");
    for (const [label, value, note] of [["Toplam indirme", s.totals.total, "tüm zamanlar"], ["Benzersiz indirme", s.totals.unique, "kişi/gün bazında"],
      ["Son " + s.days + " gün", s.totals.period, "tüm uygulamalar"], ["QR ile indirme", s.totals.qr, "son " + s.days + " gün"], ["İndirme sayfası QR açılışı", pageRow?.period || 0, "son " + s.days + " gün"]]) {
      const k = h("div", "mk-kpi"); k.append(h("span", "", label), h("strong", "", fmt(value)), h("small", "", note)); kpis.append(k);
    }
    const period = h("div", "mk-seg", null, {role: "group", "aria-label": "Dönem"});
    for (const d of [7, 30, 90, 365]) {
      const b = h("button", "mk-seg-btn", d === 365 ? "1 yıl" : d + " gün", {type: "button"});
      b.setAttribute("aria-pressed", String(d === days));
      b.addEventListener("click", () => { days = d; draw().catch(e => wrap.replaceChildren(h("p", "mk-error", e.message))); });
      period.append(b);
    }
    const top = h("div", "mk-row"); top.append(h("h3", "", "Uygulama indirmeleri"), period);
    // Günlük çubuk grafik (tek seri, ince çubuklar, üzerine gelince değer)
    const chart = h("figure", "mk-chart");
    const series = s.series, max = Math.max(1, ...series.map(x => x[1]));
    const W = 720, H = 180, P = 26, bw = Math.max(2, (W - P * 2) / series.length - 2);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H + 24}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Günlük indirme sayıları");
    const tip = h("div", "mk-tip", "", {hidden: true});
    for (const frac of [0, .5, 1]) {
      const y = H - frac * (H - 12);
      const ln = document.createElementNS(svg.namespaceURI, "line"); ln.setAttribute("x1", P); ln.setAttribute("x2", W - P); ln.setAttribute("y1", y); ln.setAttribute("y2", y); ln.setAttribute("class", "mk-grid"); svg.append(ln);
      const tx = document.createElementNS(svg.namespaceURI, "text"); tx.setAttribute("x", 2); tx.setAttribute("y", y + 4); tx.setAttribute("class", "mk-axis"); tx.textContent = fmt(Math.round(max * frac)); svg.append(tx);
    }
    series.forEach(([d, v], i) => {
      const x = P + i * ((W - P * 2) / series.length);
      const bh = Math.max(v ? 3 : 0, (v / max) * (H - 12));
      const hit = document.createElementNS(svg.namespaceURI, "rect");
      hit.setAttribute("x", x); hit.setAttribute("y", 0); hit.setAttribute("width", bw + 2); hit.setAttribute("height", H); hit.setAttribute("fill", "transparent");
      const r = document.createElementNS(svg.namespaceURI, "rect");
      r.setAttribute("x", x); r.setAttribute("y", H - bh); r.setAttribute("width", bw); r.setAttribute("height", bh); r.setAttribute("rx", Math.min(4, bw / 2)); r.setAttribute("class", "mk-bar");
      const show = () => { tip.hidden = false; tip.textContent = day(d) + " · " + fmt(v) + " indirme"; tip.style.left = (x / W * 100) + "%"; r.classList.add("on"); };
      const hide = () => { tip.hidden = true; r.classList.remove("on"); };
      hit.addEventListener("mouseenter", show); hit.addEventListener("mouseleave", hide); hit.addEventListener("touchstart", show, {passive: true});
      svg.append(r, hit);
      if (series.length <= 31 ? i % Math.ceil(series.length / 8) === 0 : i % Math.ceil(series.length / 6) === 0) {
        const tx = document.createElementNS(svg.namespaceURI, "text"); tx.setAttribute("x", x); tx.setAttribute("y", H + 16); tx.setAttribute("class", "mk-axis"); tx.textContent = day(d); svg.append(tx);
      }
    });
    chart.append(svg, tip, h("figcaption", "mk-muted", "Günlük indirme sayısı (tüm uygulamalar). Bağlantı önizlemeleri ve botlar sayılmaz; yarıda kalıp devam eden indirme ikinci kez sayılmaz."));
    // Uygulama tablosu
    const table = h("div", "mk-table");
    const t = h("table");
    t.innerHTML = "<thead><tr><th scope=col>Uygulama</th><th scope=col>Sürüm</th><th scope=col class=n>Toplam</th><th scope=col class=n>Benzersiz</th><th scope=col class=n>Son " + s.days + " gün</th><th scope=col class=n>QR</th><th scope=col class=n>Web</th><th scope=col class=n>Panel</th><th scope=col>Son indirme</th><th scope=col>QR kod</th></tr></thead>";
    const tb = h("tbody");
    for (const a of [...apps].sort((x, y) => y.total - x.total)) {
      const tr = h("tr", a.available ? "" : "off");
      const name = h("td"); name.append(h("strong", "", a.label), h("small", "mk-muted", " " + (PLATFORM[a.platform] || a.platform) + (a.access === "paid" ? " · yalnız ücretli bayi" : "") + (a.available ? "" : " · dosya yok")));
      tr.append(name, h("td", "", a.version ? "v" + a.version : "—"));
      for (const k of ["total", "unique", "period", "qr", "web", "panel"]) tr.append(h("td", "n", fmt(a[k])));
      tr.append(h("td", "", day(a.last)));
      const qc = h("td");
      if (a.access === "public" && a.available) { const b = h("button", "mk-btn small", "QR", {type: "button"}); b.addEventListener("click", () => qrDialog(a.label, s.origin + "/download/" + a.key + "?src=qr")); qc.append(b); }
      else qc.append(h("span", "mk-muted", "—"));
      tr.append(qc);
      tb.append(tr);
    }
    t.append(tb); table.append(t);
    // Cihaz dağılımı
    const cl = h("div", "mk-clients");
    const ctot = Object.values(s.clients).reduce((a, b) => a + b, 0) || 1;
    for (const [k, v] of Object.entries(s.clients).sort((a, b) => b[1] - a[1])) {
      const row = h("div", "mk-crow"); const barw = h("span", "mk-cbar"); barw.style.setProperty("--w", (v / ctot * 100).toFixed(1) + "%");
      row.append(h("span", "", PLATFORM[k] || k), barw, h("b", "", fmt(v))); cl.append(row);
    }
    // QR kodları: indirme sayfası + her uygulama
    const qrs = h("div", "mk-qrs");
    const qrCard = (label, link) => { const c = h("figure", "mk-qr"); const q = h("div"); q.innerHTML = qrSvg(link, {size: 132, label}); const cap = h("figcaption"); cap.append(h("strong", "", label), h("code", "", link.replace(/^https?:\/\//, ""))); const copy = h("button", "mk-btn small", "Bağlantıyı kopyala", {type: "button"}); copy.addEventListener("click", () => navigator.clipboard?.writeText(link).then(() => { copy.textContent = "Kopyalandı"; }, () => {})); c.append(q, cap, copy); return c; };
    qrs.append(qrCard("İndirme sayfası", s.origin + "/download/?src=qr"));
    for (const a of apps.filter(a => a.access === "public" && a.available && ["android", "ios", "windows", "macos-arm64", "linux-deb"].includes(a.key))) qrs.append(qrCard(a.label, s.origin + "/download/" + a.key + "?src=qr"));
    const cols = h("div", "mk-cols");
    const left = h("section", "mk-card"); left.append(h("h4", "", "İndiren cihazlar · son " + s.days + " gün"), cl);
    const right = h("section", "mk-card"); right.append(h("h4", "", "Nasıl sayılır?"), h("ul", "mk-list"));
    for (const t of ["Her indirme /download/… adresinden geçer; dosyalara doğrudan erişim kapalıdır.", "Benzersiz: aynı kişi aynı gün aynı dosyayı tekrar indirirse yalnız toplam artar (IP saklanmaz, günlük özet tutulur).",
      "QR: kodu okutarak gelen indirmeler; Web: satış sitesinden; Panel: klinik panelinden (ajanlar).", "Ajanlar yalnız ücretli bayi oturumuyla iner; demo hesaplarına bağlantı verilmez."]) right.lastChild.append(h("li", "", t));
    cols.append(left, right);
    wrap.replaceChildren(top, kpis, chart, h("h4", "", "Uygulama bazında"), table, cols, h("h4", "", "QR kodları (sayaçlı adresler)"), qrs);
  };
  await draw();
}

function qrDialog(label, link) {
  const d = h("dialog", "mk-dialog");
  const q = h("div", "mk-qr big"); q.innerHTML = qrSvg(link, {size: 240, label});
  const close = h("button", "mk-btn", "Kapat", {type: "button"}); close.addEventListener("click", () => { d.close(); d.remove(); });
  d.append(h("h3", "", label), q, h("code", "", link), close);
  document.body.append(d); d.showModal();
}

// ───────────────────────────── Otomatik demo ─────────────────────────────
async function demoAuto(body, call) {
  const draw = data => {
    const s = data.settings;
    const card = h("form", "mk-card mk-demo", null, {noValidate: true});
    const enabled = h("input", "", null, {type: "checkbox", checked: s.enabled});
    const daysIn = h("input", "mk-input", null, {type: "number", min: 1, max: 90, value: s.days});
    const plan = h("select", "mk-input"); plan.append(new Option("Başvurudaki paket (yoksa ilk yayındaki paket)", ""), ...data.plans.map(p => new Option(p.name, p.id))); plan.value = s.plan;
    const line = h("select", "mk-input"); line.append(new Option("— Kod gönderecek telefon hattını seçin —", ""), ...data.lines.map(l => new Option(`${l.name} · ${l.phones} telefon`, l.id))); if (s.linePartner && !data.lines.some(l => l.id === s.linePartner)) line.append(new Option(`${s.lineName || s.linePartner} · bağlı telefon yok`, s.linePartner)); line.value = s.linePartner;
    const lab = (text, input, note) => { const l = h("label", "mk-label"); l.append(h("span", "", text), input); if (note) l.append(h("small", "mk-muted", note)); return l; };
    const sw = h("label", "mk-switch"); sw.append(enabled, h("span", "", "Otomatik demo açık"));
    const state = h("p", "mk-state " + (data.ready ? "ok" : "warn"), data.ready ? "Hazır: telefonu doğrulayıp sözleşmeyi imzalayan başvuru sahiplerine demo kendiliğinden açılır." : "Kapalı veya kod gönderecek hat seçilmedi: başvurular Demo İstek-Değerlendirme’de yönetici onayı bekler.");
    const msg = h("p", "mk-status", "", {role: "status"});
    const save = h("button", "mk-btn primary", "Kaydet", {type: "submit"});
    card.append(h("h3", "", "Otomatik demo"), state, sw,
      lab("Demo süresi (gün)", daysIn, "Varsayılan 14 gün. Başvuru sahibi telefonu doğrulayıp sözleşmeyi imzaladığı gün başlar."),
      lab("Demo paketi", plan, "Demo süresince açık olacak özellikler bu paketten gelir."),
      lab("Kodu gönderecek telefon hattı", line, "Telefon Bağlantısı’nda Android telefonu bağlı bir bayi hesabı (örneğin VetZimo merkez hesabı). Kod bu hattan SMS olarak gider."),
      msg, save);
    card.addEventListener("submit", async e => {
      e.preventDefault(); save.disabled = true; msg.textContent = "Kaydediliyor…";
      try { const r = await call("demo-auto", {enabled: enabled.checked, days: Number(daysIn.value), plan: plan.value, linePartner: line.value}); draw(r); }
      catch (er) { msg.textContent = er.message; save.disabled = false; }
    });
    const how = h("section", "mk-card");
    how.append(h("h3", "", "Nasıl çalışır?"));
    const ol = h("ol", "mk-list");
    for (const t of ["Ziyaretçi satış sitesinde demo/deneme formunu doldurur.", "Başvurudaki cep telefonuna 6 haneli kod gider (15 dakika geçerli, en çok 5 deneme).",
      "Kişi kodu girer, VetZimo Kullanım Sözleşmesini telefonunda okuyup parmağıyla imzalar.", "Bayi hesabı ve seçilen süre kadar demo dönemi kendiliğinden açılır; kişi şifresini belirleyip hemen giriş yapar.",
      "Başvuru “Kazanıldı” olarak işaretlenir, imza Kullanım Sözleşmesi kayıtlarına eklenir, merkeze e-posta gider.", "Aynı telefon veya e-posta ile ikinci demo açılmaz; bu başvurular yönetici incelemesine düşer."]) ol.append(h("li", "", t));
    how.append(ol);
    const recent = h("section", "mk-card");
    recent.append(h("h3", "", "Son doğrulamalar"));
    if (!data.recent.length) recent.append(h("p", "mk-muted", "Henüz otomatik demo doğrulaması yok."));
    else {
      const t = h("div", "mk-table"); const tbl = h("table");
      tbl.innerHTML = "<thead><tr><th scope=col>Klinik</th><th scope=col>Kişi</th><th scope=col>Kod gönderildi</th><th scope=col>Durum</th><th scope=col class=n>Hatalı deneme</th></tr></thead>";
      const tb = h("tbody");
      for (const r of data.recent) { const tr = h("tr"); tr.append(h("td", "", r.clinic), h("td", "", r.name), h("td", "", when(r.sent_at)), h("td", r.verified_at ? "ok" : "", r.verified_at ? "Demo açıldı · " + when(r.verified_at) : "Doğrulama bekliyor"), h("td", "n", String(r.attempts))); tb.append(tr); }
      tbl.append(tb); t.append(tbl); recent.append(t);
    }
    const cols = h("div", "mk-cols"); cols.append(card, how);
    body.replaceChildren(cols, recent);
  };
  draw(await call("demo-auto"));
}
