// Herkese açık canlı takip (SMS bağlantısı): yalnız kalan süre ve mesafe, 15 sn'de bir yenilenir.
(() => {
  const token = location.pathname.split("/").pop();
  const $ = s => document.querySelector(s);
  async function tick() {
    try {
      const r = await fetch("/api/evde-hizmet/canli/" + token, {cache: "no-store"});
      if (!r.ok) return;
      const s = await r.json();
      $("[data-title]").textContent = s.active ? s.staff + (s.approaching ? " yaklaştı" : " yolda") : s.statusLabel;
      $("[data-eta]").textContent = s.active && s.eta != null ? "~" + Math.max(1, Math.round(s.eta / 60)) + " dk" : (s.status === "arrived" || s.status === "started" ? "Ulaştı" : "—");
      $("[data-distance]").textContent = s.active && s.distance != null ? (s.distance / 1000).toFixed(1).replace(".", ",") + " km" : "";
      $("[data-updated]").textContent = "Son güncelleme: " + new Date(s.updatedAt * 1000).toLocaleTimeString("tr-TR", {hour: "2-digit", minute: "2-digit"});
      if (!s.active) document.querySelector(".road")?.remove();
      const map = $("[data-map]");
      if (map && window.VZLiveMap && s.active && s.pos && s.dest) { map.hidden = false; VZLiveMap.update(map, [{id: token, pos: s.pos, dest: s.dest, label: (s.staff || "•")[0].toLocaleUpperCase("tr")}]); } else if (map) map.hidden = true;
    } catch {}
  }
  tick(); setInterval(() => document.hidden || tick(), 15000);
})();
