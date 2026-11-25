// VetZimo canlı izleme haritası (ücretsiz, API'siz): OpenStreetMap yol verisi sunucudaki yerel dosyalardan okunur,
// araçtan adrese en hızlı yol rotası tarayıcıda hesaplanır ve tuval üzerine çizilir. Harita servisi veya anahtar gerekmez.
"use strict";
(() => {
  const SCALE = 1e6, COLORS = ["#6a3df0", "#c4306e", "#0f8a5f", "#d97706", "#0369a1", "#7c3aed"];
  const cache = new Map();
  const gap = (a, b) => { const p = Math.PI / 180, x = (b.lon - a.lon) * p * Math.cos((a.lat + b.lat) * p / 2), y = (b.lat - a.lat) * p; return Math.sqrt(x * x + y * y) * 6371000; };
  const route = (from, to) => new Promise(resolve => {
    try {
      const w = new Worker("/visit-road-worker.js?v=50");
      const timer = setTimeout(() => { w.terminate(); resolve(null); }, 30000);
      w.onmessage = ({data}) => { clearTimeout(timer); w.terminate(); const leg = data.matrix?.[0]?.[0]; resolve(data.error || !leg ? null : {leg, positions: data.positions, roadLines: data.roadLines}); };
      w.onerror = () => { clearTimeout(timer); w.terminate(); resolve(null); };
      w.postMessage({request: 1, points: [from, to]});
    } catch { resolve(null); }
  });
  // Rota yalnız araç 300 m'den fazla ilerlediğinde ya da yeni takip başladığında yeniden hesaplanır.
  async function prepare(tracks) {
    for (const t of tracks) {
      if (!t.pos || !t.dest) continue;
      const c = cache.get(t.id);
      if (c && c.dest.lat === t.dest.lat && gap(c.from, t.pos) < 300) continue;
      const r = await route(t.pos, t.dest);
      cache.set(t.id, {from: t.pos, dest: t.dest, data: r});
    }
  }
  function draw(canvas, tracks) {
    const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (!width || !height) return;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    ctx.fillStyle = dark ? "#16132a" : "#eff5f6"; ctx.fillRect(0, 0, width, height);
    const pts = [], lines = [], legs = [];
    tracks.forEach((t, i) => {
      if (t.pos) pts.push([t.pos.lat * SCALE, t.pos.lon * SCALE]);
      if (t.dest) pts.push([t.dest.lat * SCALE, t.dest.lon * SCALE]);
      const d = cache.get(t.id)?.data;
      if (d) { lines.push(...d.roadLines); legs.push({path: d.leg.path.map(k => d.positions[k]), color: COLORS[i % COLORS.length]}); legs.at(-1).path.forEach(p => pts.push(p)); }
    });
    if (!pts.length) { ctx.fillStyle = dark ? "#b5addb" : "#5e5880"; ctx.font = "14px system-ui"; ctx.textAlign = "center"; ctx.fillText("Şu an yolda olan ekip yok.", width / 2, height / 2); return; }
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [la, lo] of pts) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); }
    const lonFactor = Math.cos((minLat + maxLat) / 2 / SCALE * Math.PI / 180);
    const scale = Math.min((height - 60) / Math.max(1500, maxLat - minLat), (width - 60) / Math.max(1500, (maxLon - minLon) * lonFactor));
    const xy = (la, lo) => [width / 2 + (lo - (minLon + maxLon) / 2) * lonFactor * scale, height / 2 - (la - (minLat + maxLat) / 2) * scale];
    for (const major of [0, 1]) {
      ctx.beginPath();
      for (const [a, b, c, d, m] of lines) if (m === major) { ctx.moveTo(...xy(a, b)); ctx.lineTo(...xy(c, d)); }
      ctx.strokeStyle = dark ? (major ? "#4a4470" : "#332e52") : (major ? "#a7bdc7" : "#c8d7dc"); ctx.lineWidth = major ? 1.7 : 1; ctx.stroke();
    }
    ctx.lineJoin = ctx.lineCap = "round";
    for (const {path, color} of legs) for (const [c, w] of [["#fff", 8], [color, 4.5]]) {
      ctx.beginPath(); path.forEach((p, j) => j ? ctx.lineTo(...xy(...p)) : ctx.moveTo(...xy(...p))); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke();
    }
    ctx.font = "700 12px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    tracks.forEach((t, i) => {
      const color = COLORS[i % COLORS.length];
      if (t.dest) { const [x, y] = xy(t.dest.lat * SCALE, t.dest.lon * SCALE); ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke(); ctx.fillStyle = color; ctx.fillText("⌂", x, y + 1); }
      if (t.pos) { const [x, y] = xy(t.pos.lat * SCALE, t.pos.lon * SCALE); ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.fillText(t.label || "●", x, y + 1); }
    });
  }
  window.VZLiveMap = {
    async update(canvas, tracks) { draw(canvas, tracks); await prepare(tracks); draw(canvas, tracks); },
    redraw(canvas, tracks) { draw(canvas, tracks); },
    colors: COLORS,
  };
})();
