// Gebelik gelişim çizimleri (embriyodan doğuma). Tıbbi illüstrasyon tarzında, gradyan ve dokularla katmanlı SVG;
// son aşamada gerçek yavru fotoğrafı. Her çizim kendi gradyan kimliklerini kullanır (sayfada çok sayıda olabilir).
let seq = 0;

// Sabit "rastgele" noktalar (her çizimde aynı doku)
const R = (n, s) => Array.from({length: n}, (_, i) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); });

function defs(p, sp) {
  const fur = sp === "Kedi" ? ["#cfc6bb", "#8f8378", "#5d5249"] : ["#e2b98a", "#b07a47", "#6e4524"];
  return `<defs>
  <radialGradient id="${p}sac" cx="42%" cy="38%" r="65%"><stop offset="0" stop-color="#f0f9ff" stop-opacity=".96"/><stop offset=".7" stop-color="#dbeafe" stop-opacity=".78"/><stop offset="1" stop-color="#93c5fd" stop-opacity=".55"/></radialGradient>
  <radialGradient id="${p}cyto" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#fffbeb"/><stop offset=".7" stop-color="#fdecc8"/><stop offset="1" stop-color="#f6cf8f"/></radialGradient>
  <radialGradient id="${p}cell" cx="35%" cy="32%" r="75%"><stop offset="0" stop-color="#fff7ed"/><stop offset=".65" stop-color="#fbd5b5"/><stop offset="1" stop-color="#e9a47a"/></radialGradient>
  <radialGradient id="${p}skin" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#ffe4de"/><stop offset=".55" stop-color="#f7b8ae"/><stop offset="1" stop-color="#d9837a"/></radialGradient>
  <radialGradient id="${p}skin2" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#ffd9d1"/><stop offset=".6" stop-color="#f0a299"/><stop offset="1" stop-color="#c76a62"/></radialGradient>
  <radialGradient id="${p}yolk" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#fef3c7"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>
  <radialGradient id="${p}heart" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fca5a5"/><stop offset="1" stop-color="#b91c1c"/></radialGradient>
  <linearGradient id="${p}plac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9f1239"/><stop offset=".5" stop-color="#be123c"/><stop offset="1" stop-color="#7f1d1d"/></linearGradient>
  <linearGradient id="${p}uter" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fda4af"/><stop offset=".45" stop-color="#e11d48" stop-opacity=".75"/><stop offset="1" stop-color="#881337"/></linearGradient>
  <radialGradient id="${p}fur" cx="40%" cy="35%" r="80%"><stop offset="0" stop-color="${fur[0]}"/><stop offset=".6" stop-color="${fur[1]}"/><stop offset="1" stop-color="${fur[2]}"/></radialGradient>
  <radialGradient id="${p}xr" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#020617"/></radialGradient>
  <filter id="${p}soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".6"/></filter>
  <clipPath id="${p}clip"><circle cx="60" cy="60" r="52"/></clipPath>
  </defs>`;
}

const sac = (p, r = 52) => `<circle cx="60" cy="60" r="${r}" fill="url(#${p}sac)" stroke="#60a5fa" stroke-opacity=".55" stroke-width="1.6"/>
  <ellipse cx="42" cy="34" rx="${r * .35}" ry="${r * .16}" fill="#fff" opacity=".45" transform="rotate(-28 42 34)"/>`;

// Kuşak (zonary) plasenta: kedi ve köpekte kesenin ortasını saran kalın bant
const placenta = p => `<path d="M14 46 Q60 22 106 46" fill="none" stroke="url(#${p}plac)" stroke-width="9" stroke-linecap="round" opacity=".9"/>
  <path d="M18 44 Q60 22 102 44" fill="none" stroke="#fecdd3" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>`;

// Göbek kordonu (sarmal görünüm)
const cord = (x1, y1, cx, cy, x2, y2) => `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#e8a1b0" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#be185d" stroke-width="1.3" stroke-dasharray="2.6 2.2" opacity=".75"/>`;

// Fetüs (yan görünüş, kıvrılmış): ölçek, cilt / tüy, ayrıntı düzeyi
function fetus(p, sp, {s = 1, skin = "skin", lid = true, claws = false, whisk = false, furry = false, bones = false, ears = "bud"} = {}) {
  const fill = furry ? `url(#${p}fur)` : `url(#${p}${skin})`, line = furry ? "#5b4636" : "#b4615a";
  const earPath = ears === "cat" ? `<path d="M55 27 L60 12 L67 26 Z" fill="${fill}" stroke="${line}" stroke-width="1.2" stroke-linejoin="round"/><path d="M58.5 24 L60.5 16.5 L64 24 Z" fill="#f9a8d4" opacity=".7"/>`
    : ears === "dog" ? `<path d="M56 27 C64 20 72 26 70 40 C66 44 60 38 58 32 Z" fill="${fill}" stroke="${line}" stroke-width="1.2"/>`
    : `<ellipse cx="61" cy="28" rx="5" ry="3.4" fill="${fill}" stroke="${line}" stroke-width="1" transform="rotate(-30 61 28)"/>`;
  const furTex = furry ? R(46, 3).map((v, i) => { const a = i / 46 * Math.PI * 2, x = 64 + Math.cos(a) * 18 * (0.6 + v * .5), y = 68 + Math.sin(a) * 16 * (0.6 + v * .5);
    return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a + 1.2) * 3).toFixed(1)} ${(Math.sin(a + 1.2) * 3).toFixed(1)}" stroke="#3f3127" stroke-width=".7" opacity=".45"/>`; }).join("")
    + (sp === "Kedi" ? `<path d="M70 50 q6 8 2 18 M78 56 q5 8 1 17 M62 50 q4 7 0 15" fill="none" stroke="#4b3f36" stroke-width="1.6" opacity=".45"/>` : "") : "";
  const xray = bones ? `<g opacity=".85" stroke="#f8fafc" fill="none" stroke-linecap="round">
      <ellipse cx="47" cy="38" rx="12" ry="10.5" stroke-width="1.6" transform="rotate(25 47 38)"/><path d="M36 47 q-4 3 -2 7" stroke-width="1.4"/>
      <path d="M58 46 C74 44 88 56 86 74" stroke-width="2.2" stroke-dasharray="2.4 1.6"/>
      ${[0, 1, 2, 3, 4, 5].map(i => `<path d="M${62 + i * 3.6} ${48 + i * 2.2} q-6 10 -2 20" stroke-width="1.1" opacity=".8"/>`).join("")}
      <path d="M52 60 L46 70 L42 74" stroke-width="1.6"/><path d="M82 76 L74 84 L70 90" stroke-width="1.6"/><path d="M86 74 C92 66 90 56 84 52" stroke-width="1.1" stroke-dasharray="1.6 1.4"/></g>` : "";
  return `<g transform="translate(60 62) scale(${s}) translate(-60 -62)">
    <path d="M86 72 C95 64 94 52 84 48" fill="none" stroke="${line}" stroke-width="${furry ? 4.4 : 3.6}" stroke-linecap="round"/>
    <path d="M86 72 C95 64 94 52 84 48" fill="none" stroke="${fill}" stroke-width="${furry ? 3 : 2.2}" stroke-linecap="round"/>
    <path d="M48 46 C34 56 34 80 50 88 C64 95 84 90 88 75 C92 60 84 48 70 45 C62 43 55 42 48 46Z" fill="${fill}" stroke="${line}" stroke-width="1.3"/>
    <path d="M58 52 C70 50 80 58 82 70" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
    ${furTex}
    <path d="M80 78 C76 86 70 90 64 92" fill="none" stroke="${line}" stroke-width="7" stroke-linecap="round"/><path d="M80 78 C76 86 70 90 64 92" fill="none" stroke="${fill}" stroke-width="5.4" stroke-linecap="round"/>
    <ellipse cx="62.5" cy="92" rx="5" ry="3.4" fill="${fill}" stroke="${line}" stroke-width="1"/>
    <path d="M52 62 C46 68 44 74 42 78" fill="none" stroke="${line}" stroke-width="6.2" stroke-linecap="round"/><path d="M52 62 C46 68 44 74 42 78" fill="none" stroke="${fill}" stroke-width="4.6" stroke-linecap="round"/>
    <ellipse cx="41" cy="79.5" rx="4.4" ry="3.1" fill="${fill}" stroke="${line}" stroke-width="1"/>
    ${claws ? `<path d="M37.5 80.5 l-1.6 1.2 M39.5 82 l-1 1.6 M41.6 82.6 l-.3 1.8 M59 94 l-1.2 1.4 M61.5 95.2 l-.5 1.8 M64 95.3 l.2 1.8" stroke="#7c2d12" stroke-width=".8" stroke-linecap="round"/>` : `<path d="M38 80 h-1 M58.5 93.5 h-1" stroke="${line}" stroke-width=".8"/>`}
    ${earPath}
    <ellipse cx="48" cy="39" rx="16.5" ry="14.5" fill="${fill}" stroke="${line}" stroke-width="1.3" transform="rotate(25 48 39)"/>
    <ellipse cx="36" cy="50" rx="9.5" ry="6.6" fill="${fill}" stroke="${line}" stroke-width="1.2" transform="rotate(42 36 50)"/>
    <ellipse cx="31.5" cy="55" rx="2.4" ry="1.8" fill="${furry ? "#2b211b" : "#c26a73"}" transform="rotate(42 31.5 55)"/>
    ${lid ? `<path d="M41 37 q4 3 8 1" fill="none" stroke="#5b2a2a" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="45" cy="37" rx="4.2" ry="3" fill="#6b3a3a" opacity=".28"/>`
      : `<circle cx="45" cy="37" r="4.2" fill="#3f2a2a" opacity=".55"/>`}
    ${whisk ? `<g fill="#7c2d12" opacity=".55">${[[33, 50], [35, 52], [32.5, 53], [35.5, 49]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7"/>`).join("")}</g>` : ""}
    ${xray}
  </g>`;
}

const STAGES = [
  // 0 Döllenme: zigot (zona pellucida, iki pronükleus, kutup cisimciği, çevrede spermler)
  (p) => `${[[14, 24, 30], [102, 92, 210], [18, 96, 330]].map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})"><ellipse rx="3.2" ry="2.2" fill="#e2e8f0" stroke="#64748b" stroke-width=".8"/><path d="M3 0 q5 -3 9 0 t9 0" fill="none" stroke="#94a3b8" stroke-width=".9"/></g>`).join("")}
    <circle cx="60" cy="60" r="45" fill="none" stroke="#fde68a" stroke-width="8" opacity=".55"/><circle cx="60" cy="60" r="49" fill="none" stroke="#f59e0b" stroke-width=".8" opacity=".5"/>
    <circle cx="60" cy="60" r="38" fill="url(#${p}cyto)" stroke="#d97706" stroke-width=".9"/>
    ${R(60, 1).map((v, i) => { const a = i * 2.39996, d = Math.sqrt(i / 60) * 34; return `<circle cx="${(60 + Math.cos(a) * d).toFixed(1)}" cy="${(60 + Math.sin(a) * d).toFixed(1)}" r="${(0.6 + v * .9).toFixed(2)}" fill="#b45309" opacity=".28"/>`; }).join("")}
    <circle cx="52" cy="58" r="9.5" fill="#fff7ed" stroke="#b45309" stroke-width="1.1" opacity=".95"/><circle cx="50" cy="56" r="2.2" fill="#b45309" opacity=".6"/>
    <circle cx="68" cy="62" r="8.5" fill="#fff7ed" stroke="#b45309" stroke-width="1.1" opacity=".95"/><circle cx="69" cy="61" r="2" fill="#b45309" opacity=".6"/>
    <circle cx="60" cy="19.5" r="4.4" fill="url(#${p}cell)" stroke="#c2410c" stroke-width=".8"/>`,
  // 1 Morula
  (p) => `<circle cx="60" cy="60" r="47" fill="none" stroke="#fde68a" stroke-width="6" opacity=".5"/>
    ${[[48, 46, 13], [70, 44, 13], [80, 62, 12.5], [70, 80, 13], [48, 78, 13], [38, 62, 12.5], [59, 62, 13.5], [60, 34, 10], [86, 46, 9], [36, 44, 9], [34, 80, 9], [86, 78, 9]]
      .sort((a, b) => a[1] - b[1]).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${p}cell)" stroke="#c2410c" stroke-width=".9"/><circle cx="${x - 2}" cy="${y - 1}" r="${(r * .28).toFixed(1)}" fill="#c2410c" opacity=".22"/>`).join("")}`,
  // 2 Blastosist
  (p) => `<circle cx="60" cy="60" r="49" fill="none" stroke="#fde68a" stroke-width="3" opacity=".55"/>
    <circle cx="60" cy="60" r="42" fill="#e0f2fe" opacity=".85"/>
    ${Array.from({length: 22}, (_, i) => { const a = i / 22 * Math.PI * 2, x = 60 + Math.cos(a) * 42, y = 60 + Math.sin(a) * 42;
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="7.4" ry="3.4" fill="url(#${p}cell)" stroke="#c2410c" stroke-width=".7" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`; }).join("")}
    ${[[40, 34, 8], [52, 30, 8], [34, 46, 7.5], [46, 43, 8.5], [58, 40, 7], [40, 56, 6.5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${p}cell)" stroke="#c2410c" stroke-width=".8"/>`).join("")}
    <ellipse cx="74" cy="72" rx="16" ry="11" fill="#fff" opacity=".35"/>`,
  // 3 Rahme tutunma: rahim duvarı, damarlar, villuslarla tutunan kese
  (p) => `<g clip-path="url(#${p}clip)"><rect x="0" y="0" width="120" height="120" fill="#fff1f2"/><rect x="0" y="62" width="120" height="58" fill="url(#${p}uter)"/>
    <path d="M0 64 Q15 56 30 64 T60 64 T90 64 T120 64" fill="none" stroke="#fecdd3" stroke-width="2" opacity=".8"/>
    ${[[10, 80, 40, 104], [55, 96, 95, 82], [80, 108, 118, 98], [20, 112, 46, 92]].map(([a, b, c, d]) => `<path d="M${a} ${b} Q${(a + c) / 2} ${b - 12} ${c} ${d}" fill="none" stroke="#7f1d1d" stroke-width="1.6" opacity=".55"/>`).join("")}
    ${R(28, 5).map((v, i) => `<circle cx="${(4 + i * 4.2).toFixed(1)}" cy="${(70 + v * 46).toFixed(1)}" r="${(0.8 + v).toFixed(1)}" fill="#fff1f2" opacity=".35"/>`).join("")}
    <circle cx="60" cy="58" r="26" fill="#ffe4e6" opacity=".55"/>
    ${Array.from({length: 26}, (_, i) => { const a = Math.PI * (0.05 + i / 26 * 1.9), x = 60 + Math.cos(a) * 25, y = 58 + Math.sin(a) * 25;
      return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * 6).toFixed(1)} ${(Math.sin(a) * 6).toFixed(1)}" stroke="#be123c" stroke-width="1.6" stroke-linecap="round" opacity="${y > 60 ? .9 : .45}"/>`; }).join("")}
    <circle cx="60" cy="58" r="22" fill="url(#${p}sac)" stroke="#fb7185" stroke-width="1.2"/>
    <ellipse cx="56" cy="50" rx="9" ry="6" fill="url(#${p}cell)" stroke="#c2410c" stroke-width=".8"/></g><circle cx="60" cy="60" r="52" fill="none" stroke="#fb7185" stroke-opacity=".6" stroke-width="1.4"/>`,
  // 4 Organ taslakları (~0,5 cm): C biçimli embriyo, somitler, göz, kalp çıkıntısı, vitellüs kesesi
  (p) => `${sac(p)}<circle cx="88" cy="86" r="11" fill="url(#${p}yolk)" stroke="#b45309" stroke-width=".9"/><path d="M80 80 Q74 74 70 72" stroke="#e8a1b0" stroke-width="3" fill="none"/>
    <path d="M62 30 C42 32 36 54 42 70 C48 86 68 92 77 82 C83 75 76 68 70 72" fill="none" stroke="#c76a62" stroke-width="17" stroke-linecap="round"/>
    <path d="M62 30 C42 32 36 54 42 70 C48 86 68 92 77 82 C83 75 76 68 70 72" fill="none" stroke="url(#${p}skin)" stroke-width="14.5" stroke-linecap="round"/>
    <circle cx="60" cy="34" r="13" fill="url(#${p}skin)" stroke="#c76a62" stroke-width="1.1"/>
    ${[[50, 41, 140], [45, 47, 130], [41, 54, 110], [39, 61, 95], [40, 68, 80], [43, 75, 62], [47, 81, 45], [53, 86, 28], [60, 89, 12], [67, 89, -5]].map(([x, y, r]) => `<path d="M${x} ${y} l3.4 0" transform="rotate(${r} ${x} ${y})" stroke="#b4515a" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>`).join("")}
    <circle cx="56" cy="33" r="3.2" fill="#3f2a2a" opacity=".6"/><path d="M50 44 q-3 3 0 6 M48 48 q-3 3 0 6" stroke="#b4515a" stroke-width="1" fill="none"/>
    <circle cx="54" cy="56" r="6" fill="url(#${p}heart)" stroke="#7f1d1d" stroke-width=".8"/>`,
  // 5 Kalp atışı (~1 cm): uzuv tomurcukları, göz pigmenti, atan kalp, kordon ve plasenta
  (p) => `${sac(p)}${placenta(p)}${cord(64, 72, 92, 64, 96, 46)}
    <path d="M64 28 C40 30 32 56 40 74 C47 90 70 96 80 84 C87 76 79 68 72 73" fill="none" stroke="#c76a62" stroke-width="20" stroke-linecap="round"/>
    <path d="M64 28 C40 30 32 56 40 74 C47 90 70 96 80 84 C87 76 79 68 72 73" fill="none" stroke="url(#${p}skin)" stroke-width="17.5" stroke-linecap="round"/>
    <circle cx="58" cy="34" r="15" fill="url(#${p}skin)" stroke="#c76a62" stroke-width="1.2"/>
    <circle cx="52" cy="33" r="4" fill="#3f2a2a" opacity=".75"/><circle cx="51" cy="32" r="1" fill="#fff" opacity=".6"/>
    <ellipse cx="44" cy="62" rx="6" ry="4" fill="url(#${p}skin)" stroke="#c76a62" stroke-width="1" transform="rotate(-30 44 62)"/>
    <ellipse cx="74" cy="88" rx="6" ry="4" fill="url(#${p}skin)" stroke="#c76a62" stroke-width="1" transform="rotate(20 74 88)"/>
    <circle class="hb" cx="54" cy="56" r="6.5" fill="url(#${p}heart)" stroke="#7f1d1d" stroke-width=".9"/>`,
  // 6 Fetüs dönemi (~2,5 cm)
  (p, sp) => `${sac(p)}${placenta(p)}${cord(64, 74, 96, 70, 98, 46)}${fetus(p, sp, {s: .86, lid: false})}`,
  // 7 Hızlı büyüme: göz kapakları kapalı, bıyık noktaları, tırnaklar
  (p, sp) => `${sac(p)}${placenta(p)}${cord(64, 74, 96, 70, 98, 46)}${fetus(p, sp, {s: .98, claws: true, whisk: true, ears: sp === "Kedi" ? "bud" : "bud"})}`,
  // 8 İskelet kemikleşir: röntgen görünümü
  (p, sp) => `<circle cx="60" cy="60" r="52" fill="url(#${p}xr)"/><g opacity=".55">${fetus(p, sp, {s: 1.02, skin: "skin2", claws: true})}</g>
    <g clip-path="url(#${p}clip)">${fetus(p, sp, {s: 1.02, bones: true, skin: "skin2"}).replace(/fill="url\(#[^)]+\)"/g, 'fill="none"').replace(/stroke="#b4615a"/g, 'stroke="#94a3b8"')}</g>
    <circle cx="60" cy="60" r="52" fill="none" stroke="#38bdf8" stroke-opacity=".5" stroke-width="1.4"/>`,
  // 9 Tüyler ve hareket: türe göre tüy ve kulak
  (p, sp) => `${sac(p)}${placenta(p)}${cord(64, 74, 96, 70, 98, 46)}${fetus(p, sp, {s: 1.06, claws: true, whisk: true, furry: true, ears: sp === "Kedi" ? "cat" : "dog"})}`,
];

/** Aşama çizimi (SVG metni). i: 0–10; size: piksel. Son aşama gerçek yavru fotoğrafıdır. */
export function devArt(i, species, size = 32, {pulse = false} = {}) {
  const p = "pa" + (++seq) + "_";
  if (i >= STAGES.length) {
    // Doğuma hazır / yeni doğan: battaniye üzerinde kıvrılmış, gözleri kapalı yavru
    const blanket = species === "Kedi" ? ["#e0e7ff", "#a5b4fc"] : ["#fce7f3", "#f9a8d4"];
    return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">${defs(p, species)}
      <g clip-path="url(#${p}clip)"><rect width="120" height="120" fill="${blanket[0]}"/>
      ${Array.from({length: 9}, (_, k) => `<path d="M-10 ${k * 15} Q30 ${k * 15 - 8} 60 ${k * 15} T130 ${k * 15}" fill="none" stroke="${blanket[1]}" stroke-width="5" opacity=".45"/>`).join("")}
      <ellipse cx="62" cy="96" rx="46" ry="10" fill="#000" opacity=".12"/>
      ${fetus(p, species, {s: 1.16, claws: true, whisk: true, furry: true, ears: species === "Kedi" ? "cat" : "dog"})}
      <path d="M86 26 q4 -4 8 0 M94 18 q3 -3 6 0" fill="none" stroke="#7c3aed" stroke-width="1.4" stroke-linecap="round" opacity=".55"/><text x="96" y="16" font-size="9" fill="#7c3aed" opacity=".6">z</text></g>
      <circle cx="60" cy="60" r="52" fill="none" stroke="url(#${p}plac)" stroke-width="2.5"/></svg>`;
  }
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"${pulse ? ' class="pa-pulse"' : ""}>${defs(p, species)}${STAGES[i](p, species)}</svg>`;
}
