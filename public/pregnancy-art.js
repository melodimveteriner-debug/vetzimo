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

// ── Gerçekçi geç dönem fetüs ve yeni doğan (yan yatmış, kıvrık). Tüy dokusu feTurbulence ile, ıslaklık parlama ve damlalarla.
function pupDefs(p, sp) {
  const cat = sp === "Kedi";
  const c = cat ? {base: "#9c958e", dark: "#5f5852", light: "#d9d4ce", skin: "#f2b5ad"} : {base: "#c79a6b", dark: "#7a4d2a", light: "#ecd2b2", skin: "#f3b1a6"};
  return {c, defs: `<defs>
    <radialGradient id="${p}pf" cx="45%" cy="35%" r="75%"><stop offset="0" stop-color="${c.light}"/><stop offset=".55" stop-color="${c.base}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>
    <radialGradient id="${p}pk" cx="45%" cy="35%" r="80%"><stop offset="0" stop-color="#ffe1da"/><stop offset=".6" stop-color="${c.skin}"/><stop offset="1" stop-color="#cf7f78"/></radialGradient>
    <linearGradient id="${p}bel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7c6be" stop-opacity="0"/><stop offset="1" stop-color="#f4a9a0" stop-opacity=".85"/></linearGradient>
    <linearGradient id="${p}shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>
    <filter id="${p}fz" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="${p}tex" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="2.2 .9" numOctaves="3" seed="9"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.05"/></filter>
    <filter id="${p}cloth" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="2"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .5  0 0 0 0 .45  0 0 0 .18 0"/></filter>
    <filter id="${p}bl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter>
    <clipPath id="${p}bodyc"><path d="${BODY}"/><path d="${cat ? HEAD_CAT : HEAD_DOG}"/></clipPath>
  </defs>`};
}
const BODY = "M45 57 C53 44 78 43 90 52 C102 61 102 85 89 94 C77 102 55 101 46 90 C39 81 39 66 45 57Z";
const HEAD_CAT = "M21 59 C20 45 34 38 46 41 C58 45 61 61 55 72 C49 83 30 83 24 73 C21 68 21 64 21 59Z";
const HEAD_DOG = "M23 56 C24 43 38 38 48 42 C59 46 61 61 55 72 C50 81 37 82 30 78 C24 76 17 73 16 67 C16 62 19 58 23 56Z";

function realPup(p, sp, {wet = true, fetal = false} = {}) {
  const cat = sp === "Kedi", {c, defs} = pupDefs(p, sp);
  const fur = fetal ? `url(#${p}pk)` : `url(#${p}pf)`, edge = fetal ? "#c4766f" : c.dark;
  const head = cat ? HEAD_CAT : HEAD_DOG;
  // Tüy telleri: gövde boyunca, kafada ileri doğru (geç fetüste seyrek ve ince)
  const n = fetal ? 70 : 190, rr = R(n * 3, cat ? 7 : 11);
  const strands = Array.from({length: n}, (_, i) => {
    const onHead = i % 4 === 0, x = onHead ? 24 + rr[i] * 30 : 46 + rr[i] * 56, y = onHead ? 46 + rr[i + n] * 30 : 52 + rr[i + n] * 44;
    const a = onHead ? Math.PI * (0.95 + rr[i + 2 * n] * .2) : Math.PI * (0.02 + (y - 70) / 160 + rr[i + 2 * n] * .1), L = fetal ? 1.6 : 2.4 + rr[i + 2 * n] * 2.4;
    const col = rr[i + 2 * n] > .55 ? c.dark : c.light;
    return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q${(Math.cos(a) * L * .5).toFixed(1)} ${(Math.sin(a) * L * .5 - .6).toFixed(1)} ${(Math.cos(a) * L).toFixed(1)} ${(Math.sin(a) * L).toFixed(1)}" stroke="${fetal ? "#fff" : col}" stroke-width="${fetal ? .35 : .55}" opacity="${fetal ? .35 : .55}" fill="none"/>`;
  }).join("");
  // Islak tüy kümeleri (koyu, birbirine yapışmış tutamlar)
  const clumps = wet && !fetal ? [[50, 56, 12, -5], [62, 51, 14, -3], [76, 52, 13, 2], [88, 58, 10, 8], [56, 66, 12, 1], [70, 64, 14, 3], [84, 70, 10, 10], [30, 48, 9, 8], [40, 45, 9, 12]]
    .map(([x, y, l, d]) => `<path d="M${x} ${y} q${l / 2} ${d / 2 - 2} ${l} ${d}" stroke="${c.dark}" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".5"/><path d="M${x + 1} ${y + 1.4} q${l / 2} ${d / 2 - 2} ${l - 1} ${d}" stroke="${c.light}" stroke-width=".7" fill="none" opacity=".55"/>`).join("") : "";
  const tabby = cat && !fetal ? `<g stroke="#4a433d" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".5" filter="url(#${p}fz)">
      <path d="M58 50 q-3 9 1 17"/><path d="M68 48 q-2 10 2 19"/><path d="M79 51 q-1 10 3 18"/><path d="M89 57 q0 9 3 15"/><path d="M36 44 l2 6 M42 42 l1 6 M30 47 l3 5"/></g>` : "";
  const ear = cat ? `<path d="M41 43 q6 -6 12 -1 q-1 5 -6 6 q-4 0 -6 -5z" fill="${fur}" stroke="${edge}" stroke-width=".8"/><path d="M44 43.5 q4 -3 7 0 q-2 2.5 -4 2.6z" fill="#e7a3a5" opacity=".75"/>`
    : `<path d="M45 45 c5 -2 9 2 8 8 c-1 4 -4 5 -6 3 c-2 -2 -3 -7 -2 -11z" fill="${fetal ? fur : c.dark}" stroke="${edge}" stroke-width=".7" opacity=".92"/><path d="M46.5 47 c3 0 5 3 4.5 6" stroke="#000" stroke-width=".6" fill="none" opacity=".25"/>`;
  const nose = cat ? `<path d="M17.5 64.5 l3.4 -.4 l-1.5 2.4z" fill="#d88a91"/><path d="M19.3 66.6 q-1 2.6 -3.4 2.4 M19.3 66.6 q1 2.6 3.6 2.6" stroke="#8b5a5a" stroke-width=".7" fill="none"/>`
    : `<ellipse cx="16.4" cy="65.4" rx="3.2" ry="2.6" fill="${fetal ? "#b9776f" : "#2b2523"}"/><ellipse cx="15.5" cy="64.6" rx="1" ry=".6" fill="#fff" opacity=".5"/><path d="M16.6 68.2 q2.6 3 7.6 2.2" stroke="#7a4d3a" stroke-width=".8" fill="none"/>`;
  const muzzle = cat ? `<ellipse cx="25" cy="67" rx="7.5" ry="6" fill="${fur}" opacity=".9"/>` : `<ellipse cx="22" cy="67" rx="8" ry="6.6" fill="${fur}" opacity=".95"/>`;
  const whisk = !fetal ? `<g fill="${c.dark}" opacity=".6">${(cat ? [[23, 66], [25, 68], [22.5, 69], [26, 65.5]] : [[20, 66], [22, 68], [19.5, 69], [23, 65.5]]).map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".55"/>`).join("")}</g>` : "";
  const paw = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><ellipse rx="5.2" ry="3.6" fill="${fur}" stroke="${edge}" stroke-width=".7"/><ellipse cx="-1" cy="1" rx="2" ry="1.4" fill="#f0a4a8"/>${[-3.2, -1.2, 1, 3].map(t => `<circle cx="${t}" cy="-1.6" r=".85" fill="#f0a4a8"/>`).join("")}</g>`;
  const tail = cat ? "M96 69 C110 73 110 92 95 98" : "M97 71 C105 73 105 82 99 86";
  const drops = wet && !fetal ? [[58, 50, 1.4], [74, 49, 1.1], [92, 64, 1.3], [34, 50, 1], [48, 76, 1.2], [80, 92, 1], [20, 92, 1.6], [104, 100, 1.4], [30, 98, 1.1]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#dbeafe" opacity=".55"/><circle cx="${x - r * .35}" cy="${y - r * .35}" r="${r * .35}" fill="#fff" opacity=".9"/>`).join("") : "";
  const membrane = wet && !fetal ? `<path d="M78 82 C86 76 98 78 102 86 C100 94 90 98 82 95 C77 92 76 87 78 82Z" fill="#c7d2fe" opacity=".28"/><path d="M80 82 C87 78 96 80 100 86" stroke="#fff" stroke-width=".8" fill="none" opacity=".7"/>` : "";
  return `${defs}
    <ellipse cx="60" cy="100" rx="46" ry="7" fill="#000" opacity=".16" filter="url(#${p}bl)"/>
    <path d="${tail}" stroke="${edge}" stroke-width="${cat ? 5.4 : 6.4}" stroke-linecap="round" fill="none"/><path d="${tail}" stroke="${fur}" stroke-width="${cat ? 4 : 5}" stroke-linecap="round" fill="none" filter="url(#${p}fz)"/>
    <g filter="url(#${p}fz)"><path d="${BODY}" fill="${fur}" stroke="${edge}" stroke-width=".8"/></g>
    ${fetal ? `<path d="${BODY}" fill="url(#${p}pf)" opacity=".3"/>` : ""}
    <path d="${BODY}" fill="url(#${p}shade)"/>
    <ellipse cx="66" cy="93" rx="19" ry="6.5" fill="url(#${p}bel)"/>
    <path d="M65 97 q3 5 -1 10" stroke="#c7646d" stroke-width="3.4" stroke-linecap="round" fill="none"/><path d="M65 97 q3 5 -1 10" stroke="#f2a6a6" stroke-width="1.2" fill="none"/>
    <g filter="url(#${p}fz)"><ellipse cx="87" cy="83" rx="13" ry="10" fill="${fur}" stroke="${edge}" stroke-width=".7" transform="rotate(-18 87 83)"/></g>
    ${paw(75, 98, -12)}
    <path d="M50 78 C45 83 42 87 40 90" stroke="${edge}" stroke-width="7.6" stroke-linecap="round" fill="none"/><path d="M50 78 C45 83 42 87 40 90" stroke="${fur}" stroke-width="6.4" stroke-linecap="round" fill="none"/>
    ${paw(38, 91, 18)}
    <g transform="translate(40 64) scale(1.14) translate(-40 -64)">
    <g filter="url(#${p}fz)"><path d="${head}" fill="${fur}" stroke="${edge}" stroke-width=".8"/></g>
    ${fetal ? `<path d="${head}" fill="url(#${p}pf)" opacity=".28"/>` : ""}
    <path d="${head}" fill="url(#${p}shade)" opacity=".7"/>
    ${muzzle}${nose}${whisk}
    <ellipse cx="${cat ? 36 : 37}" cy="57.5" rx="5.6" ry="3.6" fill="#000" opacity=".12"/>
    <path d="M${cat ? 31.5 : 32.5} 57.5 q4.5 2.6 9 -.2" stroke="#3b2a26" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    </g>
    ${tabby}
    <g clip-path="url(#${p}bodyc)"><rect width="120" height="120" filter="url(#${p}tex)" opacity="${fetal ? .25 : .55}"/>${strands}${clumps}</g>
    ${wet ? `<path d="M50 52 C64 43 84 46 95 57" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".45" filter="url(#${p}bl)"/><path d="M22 52 C26 46 32 43 38 43" stroke="#fff" stroke-width="2" fill="none" opacity=".4" filter="url(#${p}bl)"/>` : ""}
    <g transform="translate(40 64) scale(1.14) translate(-40 -64)">${ear}</g>
    ${membrane}${drops}`;
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
  // 9 Tüyler ve hareket: kese içinde gerçek oranlı geç fetüs; ince seyrek tüyler, pembe deri, kaynaşmış gözler
  (p, sp) => `${sac(p)}${placenta(p)}${cord(64, 100, 108, 80, 100, 46)}
    ${R(24, 8).map((v, k) => `<circle cx="${(18 + R(24, 9)[k] * 84).toFixed(1)}" cy="${(22 + v * 76).toFixed(1)}" r="${(0.5 + v * .8).toFixed(1)}" fill="#fff" opacity=".5"/>`).join("")}
    <g transform="translate(60 64) scale(.78) translate(-60 -72)">${realPup(p, sp, {wet: true, fetal: true})}</g>`,
];

/** Aşama çizimi (SVG metni). i: 0–10; size: piksel. Son aşama gerçek yavru fotoğrafıdır. */
export function devArt(i, species, size = 32, {pulse = false} = {}) {
  const p = "pa" + (++seq) + "_";
  if (i >= STAGES.length) {
    // Yeni doğan: havlu üzerinde ıslak, gözleri kapalı, kulakları katlı, göbek kordonu kalıntılı yavru
    const towel = species === "Kedi" ? ["#eef2ff", "#c7d2fe"] : ["#fff7ed", "#fed7aa"];
    return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">${defs(p, species)}
      <g clip-path="url(#${p}clip)"><rect width="120" height="120" fill="${towel[0]}"/><rect width="120" height="120" filter="url(#${p}cloth)"/>
      ${Array.from({length: 7}, (_, k) => `<path d="M-10 ${8 + k * 17} Q30 ${k * 17} 60 ${8 + k * 17} T130 ${8 + k * 17}" fill="none" stroke="${towel[1]}" stroke-width="6" opacity=".45"/>`).join("")}
      <g transform="translate(60 62) scale(.84) translate(-58 -72)">${realPup(p, species, {wet: true})}</g></g>
      <circle cx="60" cy="60" r="52" fill="none" stroke="url(#${p}plac)" stroke-width="2.5"/></svg>`;
  }

  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"${pulse ? ' class="pa-pulse"' : ""}>${defs(p, species)}${STAGES[i](p, species)}</svg>`;
}
