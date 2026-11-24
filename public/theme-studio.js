// Prizma ve Nebula temalarının hareket katmanı: ekran geçişinde kademeli belirme ve panellerde imleci izleyen parıltı.
// Yalnız bu temalar seçiliyken çalışır; hareket azaltma tercihine uyar; büyük listelerde ek iş yapmaz.
const themes = new Set(["prizma", "nebula"]);
const active = () => themes.has(document.body?.dataset.clinicPalette || "");
const calm = matchMedia("(prefers-reduced-motion: reduce)");

let timer = 0;
const enter = () => {
  const main = document.getElementById("main");
  if (!main || !active() || calm.matches) return;
  main.classList.remove("vz-enter");
  void main.offsetWidth;
  main.classList.add("vz-enter");
  clearTimeout(timer);
  timer = setTimeout(() => main.classList.remove("vz-enter"), 950);
};
addEventListener("hashchange", enter);
addEventListener("DOMContentLoaded", enter);

// İmleci izleyen parıltı: tek dinleyici, kare başına en fazla bir güncelleme, yalnız üzerindeki panel.
if (matchMedia("(pointer: fine)").matches) {
  let frame = 0, last = null, x = 0, y = 0, target = null;
  addEventListener("pointermove", event => {
    if (!active() || calm.matches) return;
    x = event.clientX; y = event.clientY;
    target = event.target instanceof Element ? event.target.closest(".panel") : null;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (last && last !== target) { last.style.removeProperty("--vz-mx"); last.style.removeProperty("--vz-my"); }
      last = target;
      if (!target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--vz-mx", Math.round(x - box.left) + "px");
      target.style.setProperty("--vz-my", Math.round(y - box.top) + "px");
    });
  }, {passive: true});
}
