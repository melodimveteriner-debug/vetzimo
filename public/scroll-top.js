// "Sayfanın başına dön" oku: satış sitesi ve klinik web sitelerinde ortak. Aşağı kaydırınca belirir, temanın vurgu rengini alır,
// kaydırma ilerlemesini halka olarak gösterir; klavye ve ekran okuyucuyla kullanılabilir, "hareketi azalt" ayarına uyar.
(() => {
  if (document.querySelector(".vz-top")) return;
  const css = "/scroll-top.css?v=1";
  if (!document.querySelector(`link[href="${css}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: css}));
  const tr = document.documentElement.lang && !document.documentElement.lang.startsWith("tr") ? "Back to top" : "Sayfanın başına dön";
  const b = document.createElement("button");
  b.type = "button"; b.className = "vz-top"; b.setAttribute("aria-label", tr); b.title = tr;
  b.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="vz-top-track" cx="24" cy="24" r="21"/><circle class="vz-top-ring" cx="24" cy="24" r="21"/><path d="M24 31V17m0 0-6.5 6.5M24 17l6.5 6.5"/></svg>';
  const ring = () => b.querySelector(".vz-top-ring");
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const y = scrollY;
    b.classList.toggle("is-visible", y > Math.min(480, innerHeight * 0.6));
    ring().style.strokeDashoffset = String(132 * (1 - (max > 0 ? Math.min(1, y / max) : 0)));
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, {passive: true});
  addEventListener("resize", update, {passive: true});
  b.addEventListener("click", () => {
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({top: 0, behavior: smooth ? "smooth" : "auto"});
    (document.querySelector("main h1, h1") || document.body).focus?.({preventScroll: true});
  });
  const mount = () => { document.body.append(b); update(); };
  if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);
})();
