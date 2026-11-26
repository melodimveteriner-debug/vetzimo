// Klinik Rehberi: yalnız ücretli paketteki kliniklere açık, uygulama içi eğitim sayfası.
// İçerik ve medya oturumla korunan /api/guide uçlarından gelir; sayfa VetZimo kabuğunun orta alanında açılır.
const STYLE = "/clinic-guide.css?v=1";
let cache = null;

const h = (tag, cls, text, props = {}) => {
  const n = Object.assign(document.createElement(tag), props);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const norm = s => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const media = name => "/api/guide/media/" + encodeURIComponent(name);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function mountGuide(root, {fetch, tr = s => s, toast = () => {}, go = x => { location.hash = x; }}) {
  if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE}));
  root.replaceChildren(h("div", "cg-loading", tr("Klinik Rehberi yükleniyor…")));
  try {
    if (!cache) {
      const r = await fetch("/api/guide", {cache: "no-store"});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || tr("Klinik Rehberi açılamadı."));
      cache = data;
    }
  } catch (e) {
    root.replaceChildren(h("div", "cg-error", e.message));
    return;
  }
  if (!root.isConnected) return;
  const topics = cache.topics || [];
  const words = x => new Set(norm(x).split(/[^a-z0-9]+/).filter(Boolean));
  const index = topics.map(t => [t, words([t.title, t.summary, t.keywords, t.category, ...(t.steps || []).flatMap(s => [s.title, s.text])].join(" ")), words(t.title + " " + t.keywords)]);
  const hit = (set, w) => { for (const x of set) if (x.startsWith(w)) return true; return false; };
  let query = "", cat = "", current = null;
  const fromHash = () => (location.hash.slice(1).split("?")[0].split("/")[1] || "");

  const request = () => {
    const b = h("button", "cg-request", null, {type: "button"});
    b.append(h("span", "cg-request-icon", "＋"), h("span", "", tr("Yeni eğitim istiyorum")));
    b.addEventListener("click", () => {
      const subject = tr("Klinik Rehberi: yeni eğitim isteği"), body = (current ? tr("İlgili konu: ") + current.title + "\n" : "") + tr("Hangi konuda eğitim istiyorsunuz? ");
      go("bayi-destek/new");
      // Destek formu açılınca konu ve açıklamayı doldur (kullanıcı değiştirebilir).
      let tries = 0;
      const fill = () => {
        const f = document.querySelector('#main input[name="subject"]');
        if (f) { if (!f.value) f.value = subject; const t = f.form?.querySelector('textarea[name="body"]'); if (t && !t.value) { t.value = body; t.focus(); } return; }
        if (++tries < 30) setTimeout(fill, 100);
      };
      setTimeout(fill, 50);
    });
    return b;
  };

  function hero() {
    const wrap = h("header", "cg-hero");
    const bubbles = h("div", "cg-bubbles", null, {ariaHidden: "true"});
    for (const e of ["🐾", "💉", "🩺", "📅", "💬", "🐱", "🐶"]) bubbles.append(h("span", "", e));
    const copy = h("div", "cg-hero-copy");
    copy.append(h("span", "cg-eyebrow", tr("KLİNİK REHBERİ")), h("h1", "", tr("VetZimo'yu adım adım öğrenin")),
      h("p", "", tr("Kayıttan aşı planına, randevudan entegrasyonlara: kısa videolar ve gerçek ekran görüntüleriyle sade anlatımlar.")));
    const search = h("div", "cg-search");
    const input = h("input", "", null, {type: "search", placeholder: tr("Konu ara: aşı sihirbazı, SMS, randevu…"), value: query, autocomplete: "off", ariaLabel: tr("Rehberde ara")});
    input.addEventListener("input", () => { query = input.value; drawList(); });
    search.append(h("span", "cg-search-icon", "⌕", {ariaHidden: "true"}), input);
    copy.append(search);
    wrap.append(bubbles, copy, request());
    return [wrap, input];
  }

  let listHost, searchInput;
  function drawHome() {
    current = null;
    const [top, input] = hero(); searchInput = input;
    const cats = [...new Set(topics.map(t => t.category))];
    const chips = h("div", "cg-chips", null, {role: "group", ariaLabel: tr("Kategoriler")});
    for (const c of ["", ...cats]) {
      const b = h("button", "cg-chip", c || tr("Tümü"), {type: "button"});
      b.setAttribute("aria-pressed", String(cat === c));
      b.addEventListener("click", () => { cat = c; chips.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); drawList(); });
      chips.append(b);
    }
    listHost = h("div", "cg-grid");
    root.replaceChildren(h("div", "cg-root"));
    root.firstChild.append(top, chips, listHost);
    drawList();
  }

  function drawList() {
    const q = norm(query).split(/[^a-z0-9]+/).filter(Boolean);
    const rows = index.filter(([t, all]) => (!cat || t.category === cat) && q.every(w => hit(all, w)))
      .map(([t, , head]) => [t, q.filter(w => hit(head, w)).length]).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    listHost.replaceChildren();
    if (!rows.length) {
      const empty = h("div", "cg-empty");
      empty.append(h("strong", "", tr("Bu aramayla eşleşen konu yok.")), h("p", "", tr("Aradığınız konu için eğitim hazırlamamızı isteyebilirsiniz.")), request());
      listHost.append(empty); return;
    }
    rows.forEach((t, i) => {
      const card = h("button", "cg-card", null, {type: "button"});
      card.style.setProperty("--c", t.color || "#6a3df0");
      card.style.setProperty("--d", Math.min(i, 12) * 0.04 + "s");
      const hasVideo = (t.steps || []).some(s => s.media?.type === "video");
      const meta = h("span", "cg-meta");
      meta.append(h("span", "", t.category), h("span", "", "· " + t.minutes + " " + tr("dk")));
      if (hasVideo) meta.append(h("span", "cg-badge", "▶ " + tr("Video")));
      card.append(h("span", "cg-icon", t.icon, {ariaHidden: "true"}), h("strong", "", t.title), h("span", "cg-sum", t.summary), meta);
      card.addEventListener("click", () => openTopic(t));
      listHost.append(card);
    });
  }

  function mediaBlock(m) {
    const fig = h("figure", "cg-media");
    if (m.type === "video") {
      const v = h("video", "", null, {controls: true, muted: true, playsInline: true, preload: "none", poster: m.poster ? media(m.poster) : ""});
      v.setAttribute("playsinline", ""); v.setAttribute("controlslist", "nodownload"); v.setAttribute("disablepictureinpicture", "");
      v.append(h("source", "", null, {src: media(m.src), type: "video/mp4"}));
      v.addEventListener("contextmenu", e => e.preventDefault());
      fig.classList.add("is-video");
      fig.append(v);
    } else {
      const img = h("img", "", null, {src: media(m.src), alt: m.caption || "", loading: "lazy", decoding: "async"});
      const zoom = h("button", "cg-zoom", null, {type: "button", ariaLabel: tr("Görseli büyüt")});
      zoom.append(img);
      zoom.addEventListener("click", () => lightbox(img.src, m.caption));
      fig.append(zoom);
    }
    if (m.caption) fig.append(h("figcaption", "", m.caption));
    return fig;
  }

  function lightbox(src, caption) {
    const d = h("dialog", "cg-lightbox");
    const close = h("button", "cg-lb-close", "✕", {type: "button", ariaLabel: tr("Kapat")});
    const img = h("img", "", null, {src, alt: caption || ""});
    d.append(close, img, h("p", "", caption || ""));
    close.addEventListener("click", () => d.close());
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => d.remove());
    document.body.append(d); d.showModal();
  }

  function openTopic(t, push = true) {
    current = t;
    if (push && fromHash() !== t.id) history.pushState(null, "", "#klinik-rehberi/" + t.id);
    const page = h("article", "cg-topic");
    page.style.setProperty("--c", t.color || "#6a3df0");
    const bar = h("div", "cg-topbar");
    const back = h("button", "cg-back", "‹ " + tr("Tüm konular"), {type: "button"});
    back.addEventListener("click", () => { if (fromHash()) history.pushState(null, "", "#klinik-rehberi"); drawHome(); scrollTo({top: 0}); });
    bar.append(back, request());
    const head = h("header", "cg-topic-head");
    head.append(h("span", "cg-icon big", t.icon, {ariaHidden: "true"}));
    const ht = h("div");
    ht.append(h("span", "cg-eyebrow", t.category + " · " + t.minutes + " " + tr("dk")), h("h1", "", t.title), h("p", "", t.summary));
    head.append(ht);
    if (t.route) {
      const open = h("button", "cg-open", tr("Sayfayı aç") + " ↗", {type: "button"});
      open.addEventListener("click", () => go(t.route));
      head.append(open);
    }
    const steps = h("ol", "cg-steps");
    (t.steps || []).forEach((s, i) => {
      const li = h("li", "cg-step");
      li.style.setProperty("--d", Math.min(i, 8) * 0.05 + "s");
      li.append(h("span", "cg-num", String(i + 1), {ariaHidden: "true"}));
      const body = h("div", "cg-step-body");
      body.append(h("h2", "", s.title));
      if (s.text) body.append(h("p", "", s.text));
      if (s.media) body.append(mediaBlock(s.media));
      li.append(body); steps.append(li);
    });
    page.append(bar, head);
    if (t.warn) page.append(h("p", "cg-warn", "⚠ " + t.warn));
    page.append(steps);
    if (t.tips?.length) {
      const tips = h("aside", "cg-tips");
      tips.append(h("strong", "", "💡 " + tr("İpuçları")));
      const ul = h("ul"); for (const x of t.tips) ul.append(h("li", "", x)); tips.append(ul);
      page.append(tips);
    }
    const i = topics.indexOf(t), nav = h("nav", "cg-pn", null, {ariaLabel: tr("Konular arası geçiş")});
    for (const [n, label] of [[topics[i - 1], "‹ "], [topics[i + 1], ""]]) {
      if (!n) { nav.append(h("span")); continue; }
      const b = h("button", "cg-pn-btn", null, {type: "button"});
      b.append(h("small", "", label ? tr("Önceki konu") : tr("Sonraki konu")), h("strong", "", (label || "") + n.title + (label ? "" : " ›")));
      b.addEventListener("click", () => { openTopic(n); scrollTo({top: 0, behavior: reduced() ? "auto" : "smooth"}); });
      nav.append(b);
    }
    page.append(nav);
    root.replaceChildren(h("div", "cg-root"));
    root.firstChild.append(page);
  }

  const initial = topics.find(t => t.id === fromHash());
  if (initial) openTopic(initial, false); else drawHome();
}
