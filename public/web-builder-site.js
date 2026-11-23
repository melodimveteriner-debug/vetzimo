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
