// Klinik web sitesi "Evcil Hayvan Araçları": yaş hesaplayıcı, kayıp ilanı afişi, QR kimlik kartı.
// Her şey ziyaretçinin tarayıcısında çalışır; fotoğraf ve bilgiler sunucuya gönderilmez.
import {qrSvg} from "./qr.js?v=1";


function el(tag, text = "", cls = "") {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function tr(text) {
  // Site çeviri katmanı varsa onu kullan (web-builder-site.js), yoksa Türkçe.
  return window.vzSiteText ? window.vzSiteText(text) : text;
}

// AVMA tablosuna yakın doğrusal model: ilk yıl 15, ikinci yıl 24; sonrası tür/boyuta göre yıllık artış.
const STEP = {"cat": 4, "dog-small": 4, "dog-medium": 4.6, "dog-large": 5.4};
const STAGES = {
  cat: [[0.5, "Yavru"], [2, "Genç"], [7, "Yetişkin"], [11, "Olgun"], [15, "Yaşlı"], [99, "Geriatrik"]],
  dog: [[0.5, "Yavru"], [2, "Genç"], [6, "Yetişkin"], [9, "Olgun"], [12, "Yaşlı"], [99, "Geriatrik"]],
};
const TIPS = {
  Yavru: "Aşı takvimi, parazit uygulamaları ve sosyalleşme için en kritik dönem.",
  Genç: "Kısırlaştırma, diş bakımı ve düzenli egzersiz alışkanlıklarını oturtun.",
  Yetişkin: "Yılda bir genel kontrol ve aşı tekrarları yeterlidir; kiloyu takip edin.",
  Olgun: "Yılda bir kan tahlili ile böbrek, karaciğer ve tiroit fonksiyonlarını izletin.",
  Yaşlı: "Altı ayda bir kontrol önerilir; eklem, diş ve göz sağlığına dikkat edin.",
  Geriatrik: "Sık kontrol, ağrı takibi ve yaşam kalitesi değerlendirmesi önemlidir.",
};
export function humanAge(species, years) {
  if (years <= 0) return 0;
  if (years < 1) return years * 15;
  if (years < 2) return 15 + (years - 1) * 9;
  return 24 + (years - 2) * (STEP[species] || 4);
}

function ageTool(form, out) {
  const draw = () => {
    const species = form.species.value;
    const years = Math.max(0, Math.min(30, Number(form.years.value) || 0)) + Math.max(0, Math.min(11, Number(form.months.value) || 0)) / 12;
    const human = humanAge(species, years);
    const stage = (STAGES[species === "cat" ? "cat" : "dog"].find(([limit]) => years < limit) || [0, "Geriatrik"])[1];
    out.replaceChildren();
    const big = el("p", "", "age-big");
    big.append(el("strong", String(Math.round(human))), el("span", tr("insan yaşı")));
    const stageLine = el("p", "", "age-stage");
    stageLine.append(el("span", tr("Yaşam evresi") + ": "), el("strong", tr(stage)));
    const bar = el("div", "", "age-bar");
    const fill = el("i");
    fill.style.width = Math.min(100, human / 100 * 100).toFixed(1) + "%";
    bar.append(fill);
    out.append(big, stageLine, bar, el("p", tr(TIPS[stage]), "age-tip"));
  };
  form.addEventListener("input", draw);
  draw();
}

function lostTool(form, poster, clinic) {
  let photo = "";
  const draw = () => {
    const f = Object.fromEntries(new FormData(form).entries());
    poster.replaceChildren();
    poster.append(el("p", tr("KAYIP"), "lp-title"), el("p", [f.species, f.breed].filter(Boolean).join(" · "), "lp-kind"));
    const frame = el("div", "", "lp-photo");
    if (photo) { const img = el("img"); img.src = photo; img.alt = f.name || ""; frame.append(img); }
    else frame.append(el("span", tr("Fotoğraf ekleyin")));
    poster.append(frame, el("h3", f.name || tr("Hayvanın adı"), "lp-name"));
    const facts = el("dl", "", "lp-facts");
    const row = (k, v) => { if (!v) return; facts.append(el("dt", tr(k)), el("dd", v)); };
    row("Özellikler", f.marks);
    row("Kaybolduğu tarih", f.date ? new Intl.DateTimeFormat(document.documentElement.lang || "tr", {dateStyle: "long"}).format(new Date(f.date + "T12:00:00")) : "");
    row("Bölge", f.area);
    if (f.chip) row("Mikroçip", tr("Var — veteriner kliniklerinde okutulabilir"));
    poster.append(facts);
    if (f.reward) poster.append(el("p", tr("Ödül") + ": " + f.reward, "lp-reward"));
    const call = el("div", "", "lp-call");
    const phone = (f.phone || "").trim();
    const text = el("div");
    text.append(el("span", tr("Gördüyseniz lütfen arayın")), el("strong", phone || "—"));
    call.append(text);
    if (phone) { const q = el("div", "", "lp-qr"); q.innerHTML = qrSvg("tel:" + phone.replace(/[^+\d]/g, ""), {size: 110, label: tr("Telefon QR kodu")}); call.append(q); }
    poster.append(call);
    if (clinic) poster.append(el("p", clinic, "lp-clinic"));
  };
  form.addEventListener("input", draw);
  form.photo.addEventListener("change", () => {
    const file = form.photo.files[0];
    if (!file) return;
    if (file.size > 15e6) { form.photo.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { photo = String(reader.result); draw(); };
    reader.readAsDataURL(file);
  });
  draw();
}

function cardTool(form, card, clinic, clinicPhone) {
  const draw = () => {
    const f = Object.fromEntries(new FormData(form).entries());
    const lines = [tr("Bu hayvan kaybolmuş olabilir."), (f.name || "") && tr("Adı") + ": " + f.name, f.phone && tr("Sahibi") + ": " + f.phone,
      f.chip && tr("Mikroçip") + ": " + f.chip, f.note && tr("Not") + ": " + f.note, clinic && tr("Veteriner") + ": " + clinic + (clinicPhone ? " " + clinicPhone : "")].filter(Boolean);
    card.replaceChildren();
    const info = el("div", "", "ic-info");
    info.append(el("p", tr("Evcil hayvan kimlik kartı"), "ic-head"), el("h3", f.name || tr("Hayvanın adı")));
    const dl = el("dl");
    const row = (k, v) => { if (!v) return; dl.append(el("dt", tr(k)), el("dd", v)); };
    row("Sahibinin telefonu", f.phone); row("Mikroçip", f.chip); row("Not", f.note);
    info.append(dl);
    if (clinic) info.append(el("p", clinic + (clinicPhone ? " · " + clinicPhone : ""), "ic-clinic"));
    const q = el("div", "", "ic-qr");
    q.innerHTML = qrSvg(lines.join("\n"), {size: 150, label: tr("Kimlik QR kodu")});
    card.append(info, q);
  };
  form.addEventListener("input", draw);
  draw();
}

function init(root) {
  const clinic = root.dataset.clinic || "", clinicPhone = root.dataset.clinicPhone || "";
  const panels = [...root.querySelectorAll(".tool-panel")], tabs = [...root.querySelectorAll("[data-tool]")];
  const show = id => {
    if (!panels.some(p => p.id === id)) id = "yas";
    for (const p of panels) p.hidden = p.id !== id;
    for (const t of tabs) t.setAttribute("aria-current", String(t.dataset.tool === id));
  };
  tabs.forEach(t => t.addEventListener("click", e => { e.preventDefault(); history.replaceState(null, "", "#" + t.dataset.tool); show(t.dataset.tool); }));
  show(location.hash.slice(1));
  ageTool(root.querySelector("[data-age]"), root.querySelector(".age-result"));
  lostTool(root.querySelector("[data-lost]"), root.querySelector(".lost-poster"), clinic);
  cardTool(root.querySelector("[data-card]"), root.querySelector(".id-card"), clinic, clinicPhone);
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-print]");
    if (!b) return;
    const form = b.closest(".tool-panel").querySelector("form");
    if (!form.reportValidity()) return;
    document.body.dataset.print = b.dataset.print;
    window.print();
  });
  window.addEventListener("afterprint", () => { delete document.body.dataset.print; });
}

const toolsRoot = document.querySelector(".pet-tools");
if (toolsRoot) init(toolsRoot);
