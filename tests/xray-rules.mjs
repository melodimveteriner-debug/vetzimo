// Röntgen asistanı: görüntü kalite analizi ve kurallara dayalı yorumun temel doğruluğu.
import {analyse, interpret, vhsInterpret} from "../public/xray-assist.js";
const fail = m => { console.error("KALDI " + m); process.exit(1); };
const img = (w, h, f) => { const a = new Uint8ClampedArray(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y); return a; };
const dark = analyse(img(200, 200, (x, y) => 20 + ((x * 7 + y * 3) % 30)), 200, 200);
if (!dark.findings.some(f => /koyu/.test(f.text)) || dark.score > 80) fail("Koyu görüntü yakalanmadı");
const good = analyse(img(200, 200, (x, y) => ((x ^ y) * 37) % 256), 200, 200);
if (good.score < 75) fail("Normal görüntü düşük puan aldı: " + good.score);
if (vhsInterpret(11.5, "dog").tone !== "high" || vhsInterpret(9.8, "dog").tone !== "ok" || vhsInterpret(8.6, "cat").tone !== "high") fail("VHS yorumu hatalı");
const cardio = interpret({species: "dog", alveolarCaudodorsal: true, vhsHigh: true});
if (!cardio[0]?.urgent || !/Kardiyojenik/.test(cardio[0].diff)) fail("Kardiyojenik ödem acil olarak ilk sırada değil");
const noncardio = interpret({species: "dog", alveolarCaudodorsal: true});
if (!noncardio.some(d => /Nonkardiyojenik/.test(d.diff)) || noncardio.some(d => /Kardiyojenik pulmoner/.test(d.diff))) fail("Kalp büyümesi yokken ayrım yapılmadı");
if (!interpret({species: "dog", gdv: true})[0]?.urgent) fail("GDV acil değil");
if (interpret({species: "cat", effusion: true})[0].urgent) fail("Solunum güçlüğü yokken efüzyon acil sayıldı");
if (!interpret({species: "cat", effusion: true, dyspnea: true})[0].urgent) fail("Solunum güçlüğüyle efüzyon acil sayılmadı");
if (interpret({species: "dog"}).length !== 0) fail("Bulgu yokken yorum üretildi");
console.log("PASS Röntgen asistanı: kalite analizi, VHS referansları, acil önceliklendirme ve ayırıcı tanı kuralları");
