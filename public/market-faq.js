// Sık sorulan sorular: arama (kelime başlarına göre, Türkçe karakter duyarsız) ve adresle gelen soruyu açma.
const norm = s => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const input = document.querySelector("[data-fq-search]");
const items = [...document.querySelectorAll(".fq-group details")].map(d => [d, new Set(norm(d.textContent).split(/[^a-z0-9]+/).filter(Boolean))]);
const empty = document.querySelector("[data-fq-empty]");
const hit = (set, w) => { for (const x of set) if (x.startsWith(w)) return true; return false; };
input?.addEventListener("input", () => {
  const q = norm(input.value).split(/[^a-z0-9]+/).filter(Boolean);
  let shown = 0;
  for (const [d, words] of items) {
    const ok = q.every(w => hit(words, w));
    d.classList.toggle("fq-hidden", !ok);
    if (ok) shown++;
    if (q.length && ok && shown <= 3) d.open = true;
  }
  for (const g of document.querySelectorAll(".fq-group")) g.classList.toggle("fq-hidden", !g.querySelector("details:not(.fq-hidden)"));
  if (empty) empty.hidden = shown > 0;
});
const openHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id && document.getElementById(id);
  if (target?.tagName === "DETAILS") { target.open = true; target.scrollIntoView({block: "start"}); }
};
openHash();
addEventListener("hashchange", openHash);
