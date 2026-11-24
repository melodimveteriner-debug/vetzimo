// Satış sitesi alt sayfaları: öğeleri sırayla belirecek şekilde işaretler (landing.js gözlemler) ve kartlarda imleç parıltısı.
const root = document.querySelector(".lp-sub");
if (root) {
  const groups = [".cards>.card", ".lp-why>article", ".faq>details", ".faq>:is(p,h3)", ".feature-detail", ".callout", ".application", ".toggle"];
  for (const selector of groups) {
    root.querySelectorAll(selector).forEach((node, index) => {
      node.setAttribute("data-reveal", "");
      node.style.setProperty("--d", Math.min(index, 8) * 0.07 + "s");
    });
  }
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.addEventListener("pointermove", event => {
      const card = event.target.closest?.(".card");
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", (event.clientX - box.left) + "px");
      card.style.setProperty("--my", (event.clientY - box.top) + "px");
    }, {passive: true});
  }
}
