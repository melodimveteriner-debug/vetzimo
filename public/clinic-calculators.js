// VetZimo klinik hesaplayıcıları. Tamamen tarayıcıda çalışır; hiçbir veri gönderilmez.
// Formüller: AAHA 2013 sıvı tedavisi rehberi (idame), RER = 70 × kg^0,75, MSD Veterinary Manual (metilksantin ve ksilitol eşikleri),
// transfüzyon hacmi = kg × K × (hedef − alıcı PCV) / verici PCV (K: köpek 90, kedi 60).

const n = value => {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : NaN;
};
const fmt = (value, digits = 2) => Number.isFinite(value)
  ? new Intl.NumberFormat(document.documentElement.lang || "tr", { maximumFractionDigits: digits }).format(value) : "—";

const CHOCOLATE = [
  ["Kakao tozu", 28.0], ["Pişirme (bitter %100) çikolata", 16.0], ["Bitter / yarı tatlı çikolata", 5.5],
  ["Sütlü çikolata", 2.0], ["Beyaz çikolata", 0.01],
];

const CALCULATORS = [
  {
    id: "doz", title: "İlaç dozu", icon: "💊",
    intro: "Kilo, mg/kg doz ve ilacın yoğunluğundan verilecek miktarı hesaplar.",
    fields: [["kg", "Kilo (kg)"], ["dose", "Doz (mg/kg)"], ["conc", "İlaç yoğunluğu (mg/mL)", true], ["tablet", "Tablet gücü (mg)", true]],
    run: v => {
      const mg = v.kg * v.dose;
      const rows = [["Toplam doz", fmt(mg) + " mg"]];
      if (v.conc > 0) rows.push(["Çekilecek hacim", fmt(mg / v.conc) + " mL"]);
      if (v.tablet > 0) rows.push(["Tablet sayısı", fmt(mg / v.tablet) + " tablet"]);
      return { rows, ok: v.kg > 0 && v.dose > 0 };
    },
  },
  {
    id: "cri", title: "CRI · sabit hızlı infüzyon", icon: "⏱️",
    intro: "Doz hızından pompa hızını ya da sıvı torbasına eklenecek ilacı hesaplar.",
    fields: [["kg", "Kilo (kg)"], ["rate", "Doz hızı"], ["unit", "Birim", false, [["mcgmin", "µg/kg/dk"], ["mgh", "mg/kg/sa"]]],
      ["conc", "İlaç yoğunluğu (mg/mL)"], ["fluid", "Sıvı hızı (mL/sa)", true], ["bag", "Torba / şırınga hacmi (mL)", true]],
    run: v => {
      const mgPerHour = v.unit === "mgh" ? v.rate * v.kg : v.rate * v.kg * 60 / 1000;
      const rows = [["Saatlik ilaç", fmt(mgPerHour, 3) + " mg/sa"], ["Sulandırmadan pompa hızı", fmt(mgPerHour / v.conc, 3) + " mL/sa"]];
      if (v.fluid > 0 && v.bag > 0) {
        const hours = v.bag / v.fluid, mg = mgPerHour * hours;
        rows.push(["Torbanın süresi", fmt(hours, 1) + " sa"], ["Torbaya eklenecek ilaç", fmt(mg, 2) + " mg = " + fmt(mg / v.conc, 2) + " mL"]);
        rows.push(["Not", "Torbaya eklediğiniz hacim kadar sıvıyı önceden çekebilirsiniz."]);
      }
      return { rows, ok: v.kg > 0 && v.rate > 0 && v.conc > 0 };
    },
  },
  {
    id: "sivi", title: "Sıvı tedavisi", icon: "💧",
    intro: "İdame (AAHA 2013), dehidrasyon açığı ve süren kayıplardan saatlik hızı hesaplar.",
    fields: [["species", "Tür", false, [["dog", "Köpek"], ["cat", "Kedi"]]], ["kg", "Kilo (kg)"], ["dehy", "Dehidrasyon (%)", true],
      ["hours", "Açığın kapatılacağı süre (sa)", true], ["loss", "Süren kayıplar (mL/gün)", true], ["set", "Damla seti", false, [["20", "Makro · 20 damla/mL"], ["15", "Makro · 15 damla/mL"], ["60", "Mikro · 60 damla/mL"]]]],
    run: v => {
      const maintenance = (v.species === "cat" ? 80 : 132) * Math.pow(v.kg, 0.75);
      const deficit = v.kg * (v.dehy || 0) * 10;
      const hours = v.hours > 0 ? v.hours : 24;
      const rate = maintenance / 24 + deficit / hours + (v.loss || 0) / 24;
      const drops = rate * Number(v.set || 20) / 3600;
      return { ok: v.kg > 0, rows: [
        ["İdame", fmt(maintenance, 0) + " mL/gün (" + fmt(maintenance / 24, 1) + " mL/sa)"],
        ["Dehidrasyon açığı", fmt(deficit, 0) + " mL · " + fmt(hours, 0) + " saatte"],
        ["İlk dönem toplam hız", fmt(rate, 1) + " mL/sa"],
        ["Damla hızı", fmt(drops, 2) + " damla/sn · 1 damla her " + fmt(1 / drops, 1) + " sn"],
      ] };
    },
  },
  {
    id: "enerji", title: "Enerji ihtiyacı", icon: "🍽️",
    intro: "Dinlenme enerji ihtiyacı (RER = 70 × kg^0,75) ve yaşam evresine göre günlük ihtiyaç.",
    fields: [["kg", "Kilo (kg)"], ["factor", "Yaşam evresi", false, [
      ["1.6", "Köpek · kısır yetişkin (1,6)"], ["1.8", "Köpek · kısır olmayan yetişkin (1,8)"], ["1.0", "Köpek · kilo verme (1,0)"],
      ["3.0", "Köpek · 4 aydan küçük yavru (3,0)"], ["2.0", "Köpek · 4 ay–yetişkin yavru (2,0)"],
      ["1.2", "Kedi · kısır yetişkin (1,2)"], ["1.4", "Kedi · kısır olmayan yetişkin (1,4)"], ["0.8", "Kedi · kilo verme (0,8)"], ["2.5", "Kedi · yavru (2,5)"],
      ["1.0", "Hastanede yatan hasta · RER (1,0)"]]], ["kcal", "Mamanın enerjisi (kcal/kg)", true]],
    run: v => {
      const rer = 70 * Math.pow(v.kg, 0.75), mer = rer * Number(v.factor || 1);
      const rows = [["RER", fmt(rer, 0) + " kcal/gün"], ["Günlük ihtiyaç", fmt(mer, 0) + " kcal/gün"]];
      if (v.kcal > 0) rows.push(["Mama miktarı", fmt(mer / v.kcal * 1000, 0) + " g/gün"]);
      return { rows, ok: v.kg > 0 };
    },
  },
  {
    id: "transfuzyon", title: "Kan transfüzyonu hacmi", icon: "🩸",
    intro: "Hedef PCV'ye ulaşmak için gereken tam kan hacmi.",
    fields: [["species", "Tür", false, [["90", "Köpek (K = 90)"], ["60", "Kedi (K = 60)"]]], ["kg", "Alıcının kilosu (kg)"],
      ["target", "Hedef PCV (%)"], ["recipient", "Alıcının PCV'si (%)"], ["donor", "Vericinin / ürünün PCV'si (%)"]],
    run: v => {
      const volume = v.kg * Number(v.species || 90) * (v.target - v.recipient) / v.donor;
      return { ok: v.kg > 0 && v.donor > 0 && v.target > v.recipient, rows: [
        ["Gereken hacim", fmt(volume, 0) + " mL"],
        ["Genel üst sınır", "İlk 15–30 dakikada yavaş başlayıp tepkileri izleyin; hız ve toplam hacmi hastanın durumuna göre hekim belirler."],
      ] };
    },
  },
  {
    id: "cikolata", title: "Çikolata zehirlenmesi", icon: "🍫",
    intro: "Yenen çikolatadaki teobromin miktarını kiloya göre değerlendirir (yaklaşık değerler).",
    fields: [["kg", "Kilo (kg)"], ["type", "Çikolata türü", false, CHOCOLATE.map(([label, value]) => [String(value), label])], ["grams", "Yenen miktar (g)"]],
    run: v => {
      const mgkg = Number(v.type) * v.grams / v.kg;
      const level = mgkg >= 60 ? ["danger", "Nöbet riski (≥ 60 mg/kg) · acil müdahale"] : mgkg >= 40 ? ["danger", "Kalp ritim bozukluğu riski (40–50 mg/kg)"]
        : mgkg >= 20 ? ["warn", "Hafif belirtiler beklenir (≥ 20 mg/kg): kusma, ishal, huzursuzluk"] : ["ok", "Belirti eşiğinin altında (< 20 mg/kg)"];
      return { ok: v.kg > 0 && v.grams > 0, level: level[0], rows: [["Teobromin", fmt(mgkg, 1) + " mg/kg"], ["Değerlendirme", level[1]]] };
    },
  },
  {
    id: "ksilitol", title: "Ksilitol zehirlenmesi", icon: "🍬",
    intro: "Köpeklerde ksilitol dozunu değerlendirir. Ürün etiketindeki ksilitol gramını girin.",
    fields: [["kg", "Kilo (kg)"], ["grams", "Alınan ksilitol (g)"]],
    run: v => {
      const gkg = v.grams / v.kg;
      const level = gkg > 0.5 ? ["danger", "Karaciğer yetmezliği riski (> 0,5 g/kg) · acil"] : gkg >= 0.075 ? ["danger", "Hipoglisemi riski (≥ 0,075–0,1 g/kg) · acil"] : ["ok", "Bilinen eşiklerin altında; yine de izlem önerilir"];
      return { ok: v.kg > 0 && v.grams > 0, level: level[0], rows: [["Doz", fmt(gkg, 3) + " g/kg"], ["Değerlendirme", level[1]]] };
    },
  },
  {
    id: "donusum", title: "Birim dönüşümleri", icon: "🔁",
    intro: "Sık kullanılan klinik birimleri dönüştürür.",
    fields: [["value", "Değer"], ["unit", "Dönüşüm", false, [
      ["lbkg", "lb → kg"], ["kglb", "kg → lb"], ["fc", "°F → °C"], ["cf", "°C → °F"],
      ["glu", "Glukoz mg/dL → mmol/L"], ["glur", "Glukoz mmol/L → mg/dL"], ["cre", "Kreatinin mg/dL → µmol/L"], ["crer", "Kreatinin µmol/L → mg/dL"],
      ["bun", "BUN mg/dL → üre mmol/L"], ["urea", "BUN mg/dL → üre mg/dL"], ["ca", "Kalsiyum mg/dL → mmol/L"], ["car", "Kalsiyum mmol/L → mg/dL"]]]],
    run: v => {
      const table = { lbkg: [x => x * 0.45359237, "kg"], kglb: [x => x / 0.45359237, "lb"], fc: [x => (x - 32) * 5 / 9, "°C"], cf: [x => x * 9 / 5 + 32, "°F"],
        glu: [x => x / 18.016, "mmol/L"], glur: [x => x * 18.016, "mg/dL"], cre: [x => x * 88.42, "µmol/L"], crer: [x => x / 88.42, "mg/dL"],
        bun: [x => x * 0.357, "mmol/L"], urea: [x => x * 2.14, "mg/dL"], ca: [x => x * 0.2495, "mmol/L"], car: [x => x / 0.2495, "mg/dL"] };
      const [convert, unit] = table[v.unit] || table.lbkg;
      return { ok: Number.isFinite(v.value), rows: [["Sonuç", fmt(convert(v.value), 3) + " " + unit]] };
    },
  },
];

export function mountCalculators(ui, { weight = "" } = {}) {
  const { view, heading } = ui;
  heading("Klinik Hesaplayıcılar", "Doz, infüzyon, sıvı, enerji, transfüzyon, zehirlenme ve birim hesapları. Sonuçlar karar desteğidir; tedaviyi veteriner hekim belirler.");
  const wrap = document.createElement("div");
  wrap.className = "calc-suite";
  const nav = document.createElement("nav");
  nav.className = "calc-nav";
  nav.setAttribute("aria-label", "Hesaplayıcılar");
  const panel = document.createElement("section");
  panel.className = "calc-panel panel";
  wrap.append(nav, panel);
  view.append(wrap);
  let shared = { kg: weight };
  const open = id => {
    const calc = CALCULATORS.find(item => item.id === id) || CALCULATORS[0];
    for (const button of nav.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.calc === calc.id));
    try { sessionStorage.setItem("vetzimo-calc", calc.id); } catch {}
    panel.innerHTML = "";
    const head = document.createElement("header");
    head.innerHTML = `<span class="calc-icon" aria-hidden="true"></span><div><h2></h2><p></p></div>`;
    head.querySelector(".calc-icon").textContent = calc.icon;
    head.querySelector("h2").textContent = calc.title;
    head.querySelector("p").textContent = calc.intro;
    const form = document.createElement("form");
    form.className = "calc-form";
    form.noValidate = true;
    for (const [key, label, optional, options] of calc.fields) {
      const field = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = label + (optional ? " · " : "");
      if (optional) { const small = document.createElement("small"); small.textContent = "isteğe bağlı"; caption.append(small); }
      let input;
      if (options) {
        input = document.createElement("select");
        for (const [value, text] of options) { const option = document.createElement("option"); option.value = value; option.textContent = text; input.append(option); }
      } else {
        input = document.createElement("input");
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.placeholder = "0";
      }
      input.name = key;
      if (shared[key] !== undefined && shared[key] !== "") input.value = shared[key];
      field.append(caption, input);
      form.append(field);
    }
    const result = document.createElement("div");
    result.className = "calc-result";
    result.setAttribute("aria-live", "polite");
    const note = document.createElement("p");
    note.className = "calc-note";
    note.textContent = "Karar desteği içindir. İlaç prospektüsü ve güncel kaynaklarla doğrulayın; doz ve tedavi kararı veteriner hekime aittir.";
    const update = () => {
      const values = {};
      for (const element of form.elements) {
        if (!element.name) continue;
        values[element.name] = element.tagName === "SELECT" ? element.value : n(element.value);
        if (element.name === "kg") shared.kg = element.value;
      }
      for (const [key, , , options] of calc.fields) if (options) values[key] = form.elements[key].value;
      const output = calc.run(values);
      result.dataset.level = output.level || "";
      result.innerHTML = "";
      if (!output.ok) { result.innerHTML = "<p class=\"calc-empty\"></p>"; result.firstChild.textContent = "Sonuç için gerekli alanları doldurun."; return; }
      const list = document.createElement("dl");
      for (const [term, value] of output.rows) {
        const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = term; dd.textContent = value; row.append(dt, dd); list.append(row);
      }
      const copy = document.createElement("button");
      copy.type = "button"; copy.className = "button small"; copy.textContent = "Sonucu kopyala";
      copy.addEventListener("click", async () => {
        const text = calc.title + "\n" + output.rows.map(([a, b]) => a + ": " + b).join("\n");
        try { await navigator.clipboard.writeText(text); copy.textContent = "Kopyalandı"; } catch { copy.textContent = "Kopyalanamadı"; }
        setTimeout(() => { copy.textContent = "Sonucu kopyala"; }, 1600);
      });
      result.append(list, copy);
    };
    form.addEventListener("input", update);
    form.addEventListener("submit", event => event.preventDefault());
    panel.append(head, form, result, note);
    update();
    form.querySelector("input")?.focus({ preventScroll: true });
  };
  for (const calc of CALCULATORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.calc = calc.id;
    button.innerHTML = "<span aria-hidden=\"true\"></span><strong></strong>";
    button.firstChild.textContent = calc.icon;
    button.lastChild.textContent = calc.title;
    button.addEventListener("click", () => open(calc.id));
    nav.append(button);
  }
  let start = CALCULATORS[0].id;
  try { start = sessionStorage.getItem("vetzimo-calc") || start; } catch {}
  open(start);
}
