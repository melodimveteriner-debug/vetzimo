const patient = document.querySelector("[data-patient-picker]");
if (patient) {
  const sync = () => {
    for (const field of document.querySelectorAll("[data-visitor-field]")) {
      field.required = !patient.value;
      field.closest("label").hidden = Boolean(patient.value);
    }
  };
  patient.addEventListener("change", sync);
  sync();
}
const photos = [...document.querySelectorAll("[data-gallery]")];
const gallery = document.querySelector("#gallery-dialog");
if (photos.length && gallery?.showModal) {
  let active = 0;
  let start;
  const photo = gallery.querySelector("img");
  const display = index => {
    active = (index + photos.length) % photos.length;
    photo.src = photos[active].href;
    photo.alt = photos[active].querySelector("img").alt;
  };
  photos.forEach((link, index) => link.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    display(index);
    gallery.showModal();
  }));
  gallery.querySelector("[data-close]").addEventListener("click", () => gallery.close());
  gallery.querySelector("[data-next]").addEventListener("click", () => display(active + 1));
  gallery.querySelector("[data-previous]").addEventListener("click", () => display(active - 1));
  gallery.addEventListener("keydown", event => {
    if (event.key === "ArrowRight") display(active + 1);
    if (event.key === "ArrowLeft") display(active - 1);
  });
  photo.addEventListener("touchstart", event => { start = event.changedTouches[0].clientX; }, {passive:true});
  photo.addEventListener("touchend", event => {
    const distance = event.changedTouches[0].clientX - start;
    if (Math.abs(distance) > 35) display(active + (distance < 0 ? 1 : -1));
  }, {passive:true});
}

for (const call of document.querySelectorAll("[data-call-metric]")) {
  call.addEventListener("click", () => {
    void fetch(call.dataset.callMetric,{keepalive:true}).catch(()=>{});
  }, {passive:true});
}

const schedules = [...document.querySelectorAll(".open-state[data-hours]")].map(node => ({
    node, hours: JSON.parse(node.dataset.hours), holidays: JSON.parse(node.dataset.holidays)
}));
if (schedules.length) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
        weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    });
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const renderHours = () => {
        const parts = Object.fromEntries(formatter.formatToParts().map(({type, value}) => [type, value]));
        const day = `${parts.year}-${parts.month}-${parts.day}`;
        const time = `${parts.hour}:${parts.minute}`;
        const weekday = weekdays.indexOf(parts.weekday) + 1;
        for (const {node, hours, holidays} of schedules) {
            const open = !holidays.includes(day) && (hours[weekday] ?? []).some(([from, to]) => from <= time && time < to);
            node.textContent = open ? "Şu an açığız" : "Maalesef kapalıyız";
            node.classList.toggle("open", open);
            node.classList.toggle("closed", !open);
        }
    };
    renderHours();
    setInterval(renderHours, 30_000);
}

// Tema hareketleri: kaydırınca beliren bölümler, sayaçlar ve küçülen üst menü. Hareket azaltma tercihinde kapalıdır.
{
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const onScroll = () => document.body.classList.toggle("is-scrolled", scrollY > 24);
  addEventListener("scroll", onScroll, {passive:true});
  onScroll();
  if (!still && "IntersectionObserver" in window) {
    const targets = document.querySelectorAll("main .block>h2, main .cards>article, main .services>li, .clinic-numbers dl>div, main>.prose, main .contact-panel>*, main>h1, main .public-form, main .section-about>*");
    const groups = new Map();
    for (const node of targets) {
      const parent = node.parentElement;
      const index = groups.get(parent) ?? 0;
      groups.set(parent, index + 1);
      node.style.setProperty("--reveal-delay", Math.min(index, 8) * 70 + "ms");
      node.setAttribute("data-reveal", "");
    }
    const counters = [...document.querySelectorAll(".clinic-numbers dd")];
    const count = node => {
      const text = node.textContent.trim();
      const match = text.match(/^(\d{1,3}(?:\.\d{3})*|\d+)(.*)$/);
      if (!match) return;
      const target = Number(match[1].replace(/\./g, ""));
      if (!Number.isFinite(target) || target < 2) return;
      const format = new Intl.NumberFormat("tr-TR");
      const start = performance.now();
      const step = now => {
        const t = Math.min(1, (now - start) / 1400);
        node.textContent = format.format(Math.round(target * (1 - Math.pow(1 - t, 3)))) + match[2];
        if (t < 1) requestAnimationFrame(step); else node.textContent = text;
      };
      requestAnimationFrame(step);
    };
    const seen = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        seen.unobserve(entry.target);
        if (counters.includes(entry.target)) count(entry.target);
      }
    }, {rootMargin: "0px 0px -8% 0px", threshold: 0.12});
    document.documentElement.classList.add("motion");
    for (const node of document.querySelectorAll("[data-reveal]")) seen.observe(node);
    for (const node of counters) seen.observe(node);
  }
}
