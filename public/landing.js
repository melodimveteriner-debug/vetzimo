// VetZimo açılış sayfası hareketleri. Hareket azaltma tercihine uyar; JavaScript yoksa içerik yine görünür.
const root = document.querySelector(".lp");
if (root) {
  root.classList.remove("lp-no-js");
  if (document.documentElement.lang === "fa") root.dir = "rtl";
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lang = document.documentElement.lang || "tr";
  const tr = text => { try { return globalThis.vetzimoTranslate?.(text) ?? text; } catch { return text; } };

  // Görünürken belirme
  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("seen"); reveal.unobserve(entry.target); }
  }, {rootMargin: "0px 0px -8% 0px", threshold: .08});
  root.querySelectorAll("[data-reveal]").forEach(node => calm ? node.classList.add("seen") : reveal.observe(node));

  // Sayaçlar
  const format = (value, decimals) => new Intl.NumberFormat(lang, {maximumFractionDigits: decimals, minimumFractionDigits: decimals}).format(value);
  const counter = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      counter.unobserve(entry.target);
      const node = entry.target, target = Number(node.dataset.count), decimals = Number(node.dataset.decimals || 0);
      const prefix = node.dataset.prefix || "", suffix = node.dataset.suffix || "";
      if (calm) { node.textContent = prefix + format(target, decimals) + suffix; continue; }
      const start = performance.now(), duration = 1600;
      const step = now => {
        const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
        node.textContent = prefix + format(target * eased, decimals) + suffix;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, {threshold: .4});
  root.querySelectorAll("[data-count]").forEach(node => counter.observe(node));

  // Dönen kelimeler
  const words = [...root.querySelectorAll(".lp-rotate .words span")];
  if (words.length > 1 && !calm) {
    let index = 0;
    setInterval(() => {
      const current = words[index];
      current.classList.remove("on"); current.classList.add("out");
      index = (index + 1) % words.length;
      const next = words[index];
      next.classList.remove("out"); void next.offsetWidth; next.classList.add("on");
      setTimeout(() => current.classList.remove("out"), 600);
    }, 2200);
  }

  // Bir kliniğin günü: kaydırmayla dolan çizgi, etkin adım, saat ve sahne
  const timeline = root.querySelector(".lp-timeline");
  if (timeline) {
    const steps = [...timeline.querySelectorAll(".lp-step")];
    const scenes = [...root.querySelectorAll(".lp-panel [data-scene]")];
    const clock = root.querySelector(".lp-clock b");
    let active = -1;
    const activate = index => {
      if (index === active) return;
      active = index;
      steps.forEach((step, i) => step.classList.toggle("on", i === index));
      scenes.forEach(scene => scene.classList.toggle("on", scene.dataset.scene === String(index)));
      if (clock && steps[index]) clock.textContent = steps[index].querySelector("time")?.textContent || "";
    };
    const update = () => {
      const box = timeline.getBoundingClientRect(), mid = innerHeight * .55;
      const fill = Math.max(0, Math.min(1, (mid - box.top) / box.height));
      timeline.style.setProperty("--fill", (fill * 100).toFixed(1) + "%");
      let index = 0;
      steps.forEach((step, i) => { if (step.getBoundingClientRect().top < mid) index = i; });
      activate(index);
    };
    activate(0);
    addEventListener("scroll", () => requestAnimationFrame(update), {passive: true});
    addEventListener("resize", update, {passive: true});
    update();
    steps.forEach((step, i) => step.addEventListener("mouseenter", () => activate(i)));
  }

  // VeBot sohbet demosu (görünürken döngüyle oynar)
  const chat = root.querySelector(".lp-chat");
  if (chat) {
    const script = JSON.parse(chat.dataset.script || "[]");
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = tr(text); return node; };
    const bubble = item => {
      const node = el("div", "lp-msg " + item.who + (item.warn ? " warn" : ""), item.text);
      if (item.stats) {
        const dl = el("dl");
        for (const [label, value] of item.stats) { const row = el("div"); row.append(el("dt", "", label), el("dd", "", value)); dl.append(row); }
        node.append(dl);
      }
      return node;
    };
    let running = false, visible = false;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const play = async () => {
      if (running) return;
      running = true;
      while (visible) {
        chat.replaceChildren();
        for (const item of script) {
          if (!visible) break;
          if (item.who === "bot" && !calm) { const typing = el("div", "lp-typing"); typing.append(el("i"), el("i"), el("i")); chat.append(typing); await wait(900); typing.remove(); }
          chat.append(bubble(item));
          await wait(calm ? 0 : item.who === "me" ? 700 : 1500);
        }
        if (calm) break;
        await wait(3500);
      }
      running = false;
    };
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) play(); }, {threshold: .3}).observe(chat);
  }

  // Tema renkleri önizlemesi
  const trio = root.querySelector(".lp-trio");
  const swatches = [...root.querySelectorAll(".lp-swatches button")];
  if (trio && swatches.length) {
    let auto = 0, timer;
    const pick = button => {
      swatches.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      trio.style.setProperty("--sw1", button.style.getPropertyValue("--a"));
      trio.style.setProperty("--sw2", button.style.getPropertyValue("--b2"));
    };
    swatches.forEach(button => button.addEventListener("click", () => { clearInterval(timer); pick(button); }));
    pick(swatches[0]);
    if (!calm) timer = setInterval(() => { auto = (auto + 1) % swatches.length; pick(swatches[auto]); }, 2400);
  }

  // Ürün maketine hafif imleç eğimi
  const stage = root.querySelector(".lp-stage"), device = root.querySelector(".lp-device");
  if (stage && device && !calm && matchMedia("(pointer:fine)").matches) {
    stage.addEventListener("pointermove", event => {
      const box = stage.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5, y = (event.clientY - box.top) / box.height - .5;
      device.style.transform = `rotateY(${(-8 + x * 10).toFixed(2)}deg) rotateX(${(4 - y * 8).toFixed(2)}deg)`;
    });
    stage.addEventListener("pointerleave", () => { device.style.transform = ""; });
  }
}
