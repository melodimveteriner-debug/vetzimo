// Doğum takip cetveli: klinik hasta dosyasında ve hasta sahibi panelinde ortak kullanılır.
// Çiftleşme tarihinden itibaren günler ilerledikçe bardaktaki su gibi çalkalanarak dolan bir çubuk gösterir;
// 30. gün ultrason, 45. gün röntgen (normal doğum / sezaryen kararı) ve tahmini doğum işaretlenir.

const SPECIES = new Set(["Kedi", "Köpek"]);
let styled = false;

function css() {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
.pg-host{grid-column:1/-1;flex:1 1 100%;width:100%;min-width:0}
.pg{--pg-a:#7c3aed;--pg-b:#ec4899;--pg-c:#06b6d4;--pg-ink:inherit;--pg-line:color-mix(in srgb,currentColor 14%,transparent);--pg-soft:color-mix(in srgb,currentColor 5%,transparent);
 display:grid;gap:12px;margin:14px 0 4px;padding:14px 16px 16px;border-radius:18px;border:1px solid var(--pg-line);background:linear-gradient(135deg,color-mix(in srgb,var(--pg-a) 7%,transparent),color-mix(in srgb,var(--pg-b) 6%,transparent));min-width:0}
.pg-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}
.pg-title{display:flex;align-items:center;gap:10px;min-width:0}
.pg-title b{font-size:1.02rem}.pg-title small{display:block;opacity:.75;font-size:.82rem}
.pg-ico{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,var(--pg-a),var(--pg-b));color:#fff;font-size:1.1rem;box-shadow:0 6px 16px color-mix(in srgb,var(--pg-a) 35%,transparent)}
.pg-count{display:flex;align-items:baseline;gap:6px;font-variant-numeric:tabular-nums}.pg-count strong{font-size:1.5rem;line-height:1;background:linear-gradient(90deg,var(--pg-a),var(--pg-b));-webkit-background-clip:text;background-clip:text;color:transparent}
.pg-tank{position:relative;height:30px;border-radius:999px;background:var(--pg-soft);border:1px solid var(--pg-line);overflow:hidden;isolation:isolate}
.pg-fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:999px;overflow:hidden;transition:width 1.6s cubic-bezier(.2,.8,.2,1);background:linear-gradient(90deg,var(--pg-c),var(--pg-a) 55%,var(--pg-b));transform-origin:left center;animation:pgSlosh 3.2s ease-in-out infinite}
.pg-fill svg{position:absolute;top:-6px;left:0;width:200%;height:22px;animation:pgWave 2.6s linear infinite;opacity:.55}
.pg-fill svg+svg{top:-3px;animation-duration:4.1s;animation-direction:reverse;opacity:.35}
.pg-fill i{position:absolute;bottom:-6px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.75);animation:pgBubble 3s ease-in infinite}
.pg-fill i:nth-of-type(2){left:30%;animation-delay:1s;width:4px;height:4px}.pg-fill i:nth-of-type(3){left:62%;animation-delay:2s}.pg-fill i:nth-of-type(1){left:12%}
.pg-tank::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 2px 6px rgba(0,0,0,.08);pointer-events:none}
.pg-mark{position:absolute;top:0;bottom:0;width:2px;background:color-mix(in srgb,currentColor 25%,transparent);z-index:2}
.pg-steps{position:relative;height:66px;margin:0 2px}
.pg-step{position:absolute;top:0;transform:translateX(-50%);display:grid;justify-items:center;gap:1px;font-size:.72rem;line-height:1.2;text-align:center;white-space:nowrap}
.pg-step.low{top:32px}
.pg-step::before{content:"";position:absolute;top:-8px;left:50%;width:1px;height:8px;background:currentColor;opacity:.25}.pg-step.low::before{top:-40px;height:40px}.pg-step:first-child::before{left:6px}.pg-step:last-child::before{left:auto;right:6px}
.pg-step:first-child{transform:none;justify-items:start;text-align:left}.pg-step:last-child{transform:translateX(-100%);justify-items:end;text-align:right}
.pg-step b{font-size:.76rem}.pg-step.done b{color:#16a34a}.pg-step.next b{color:var(--pg-a)}
.pg-step span{opacity:.75}
.pg-actions{display:flex;flex-wrap:wrap;gap:8px}
.pg-form{display:flex;flex-wrap:wrap;align-items:end;gap:8px}
.pg-form label{display:grid;gap:4px;font-size:.82rem;font-weight:700}
.pg-form input{min-height:38px;padding:6px 10px;border-radius:10px;border:1px solid var(--pg-line);font:inherit;background:transparent;color:inherit}
.pg-start{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;margin:12px 0 2px;padding:10px 14px;border-radius:14px;border:1px dashed var(--pg-line)}
.pg-start p{margin:0;font-size:.86rem;opacity:.85}
.pg-err{margin:0;color:#dc2626;font-weight:600;font-size:.85rem}
.pg-btn{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 18px;border:0;border-radius:999px;color:#fff;font:inherit;font-size:.88rem;font-weight:800;letter-spacing:.01em;cursor:pointer;
 background:linear-gradient(90deg,var(--pg-c),var(--pg-a),var(--pg-b),var(--pg-c));background-size:300% 100%;animation:pgFlow 6s linear infinite;box-shadow:0 8px 20px color-mix(in srgb,var(--pg-a) 30%,transparent);transition:transform .2s,box-shadow .2s}
.pg-btn::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.45) 50%,transparent 70%);transform:translateX(-130%);animation:pgShine 3.4s ease-in-out infinite}
.pg-btn:hover{transform:translateY(-2px);box-shadow:0 12px 26px color-mix(in srgb,var(--pg-a) 40%,transparent)}
.pg-btn:disabled{opacity:.6;cursor:progress}
.pg-btn-go{background-image:linear-gradient(90deg,#10b981,#06b6d4,#7c3aed,#10b981)}
.pg-btn-soft{background:color-mix(in srgb,currentColor 7%,transparent);color:inherit;box-shadow:none;animation:none;border:1px solid var(--pg-line)}.pg-btn-soft::after{display:none}.pg-btn-soft:hover{box-shadow:none;background:color-mix(in srgb,#dc2626 10%,transparent);color:#b91c1c}
@keyframes pgFlow{to{background-position:-300% 0}}
@keyframes pgShine{60%,100%{transform:translateX(130%)}}
.pg-start,.pg-form{--pg-a:#7c3aed;--pg-b:#ec4899;--pg-c:#06b6d4;--pg-line:color-mix(in srgb,currentColor 14%,transparent)}
.pg-litter{position:relative;display:grid;justify-items:center;gap:8px;padding:18px 12px 10px;border-radius:16px;overflow:hidden;background:radial-gradient(120% 90% at 50% 100%,color-mix(in srgb,#f59e0b 14%,transparent),transparent 70%)}
.pg-nest{position:relative;display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-end;gap:2px 0;max-width:560px;padding:20px 28px 22px;border-radius:50% / 38%;
 background:radial-gradient(ellipse at 50% 35%,#fff7ed,#fde3c4 55%,#f6c99a);box-shadow:inset 0 -8px 18px rgba(180,110,50,.25),0 10px 24px rgba(180,110,50,.18)}
.pg-nest::before{content:"";position:absolute;inset:6px;border-radius:inherit;background:repeating-linear-gradient(135deg,rgba(255,255,255,.35) 0 6px,transparent 6px 14px);pointer-events:none}
.pg-baby{position:relative;display:block;margin:0 -8px;transform-origin:50% 100%;transform:rotate(var(--r,0deg));animation:pgBreath 2.6s ease-in-out infinite;animation-delay:var(--d,0s)}
.pg-baby.flip img{transform:scaleX(-1)}
.pg-baby img{display:block;width:90px;height:auto;filter:drop-shadow(0 4px 4px rgba(120,70,20,.25))}
.pg-wig{display:block;transform-origin:30% 90%;animation:pgWiggle 7s ease-in-out infinite;animation-delay:var(--d,0s)}
.pg-more{align-self:center;margin-left:12px;font-weight:900;font-size:1rem;color:#b45309}
.pg-fx{position:absolute;inset:0;pointer-events:none}
.pg-fx i{position:absolute;bottom:34%;font-style:normal;font-weight:900;font-size:1rem;color:#ec4899;opacity:0;animation:pgFloat 4.5s ease-in infinite}
.pg-fx i:nth-child(even){color:#7c3aed;font-size:.85rem}
.pg-litter-cap{margin:0;display:grid;gap:2px;text-align:center}.pg-litter-cap strong{font-size:1rem}.pg-litter-cap span{font-size:.82rem;opacity:.8}
@keyframes pgBreath{0%,100%{transform:rotate(var(--r,0deg)) scale(1,1)}45%{transform:rotate(var(--r,0deg)) scale(1.015,1.045)}}
@keyframes pgWiggle{0%,88%,100%{transform:none}91%{transform:rotate(3deg)}94%{transform:rotate(-2deg)}97%{transform:rotate(1deg)}}
@keyframes pgFloat{0%{transform:translateY(0) scale(.7);opacity:0}15%{opacity:.9}100%{transform:translateY(-70px) scale(1.15);opacity:0}}
.pg-dialog{width:min(680px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:0;border-radius:20px;box-shadow:0 30px 80px rgba(15,23,42,.35)}
.pg-dialog::backdrop{background:rgba(15,23,42,.45)}
.pg-dialog form{display:grid;gap:12px;padding:20px}
.pg-dialog h2{margin:0;font-size:1.2rem}.pg-muted{margin:0;opacity:.8;font-size:.9rem;line-height:1.5}
.pg-dgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.pg-dgrid label{display:grid;gap:4px;font-size:.8rem;font-weight:700;min-width:0}
.pg-dialog input:not([type=checkbox]),.pg-dialog select{min-height:38px;padding:6px 10px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);font:inherit;background:transparent;color:inherit;min-width:0}
.pg-vlist{display:grid;gap:8px;max-height:46vh;overflow:auto}
.pg-vrow{display:grid;grid-template-columns:auto minmax(0,1fr) auto minmax(0,150px);align-items:center;gap:10px;padding:10px 12px;border-radius:14px;border:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.pg-vrow div{display:grid;min-width:0}.pg-vrow small{opacity:.7}
.pg-vrow:has(.pg-keep input:checked){background:color-mix(in srgb,#16a34a 8%,transparent)}
.pg-keep{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;cursor:pointer}
.pg-keep input{width:18px;height:18px;accent-color:#16a34a}
.pg-ctrl{flex-wrap:wrap}.pg-ctrl input[type=number]{width:70px}
.pg-arrow{opacity:.5}
@media(max-width:560px){.pg-dgrid{grid-template-columns:1fr}.pg-vrow{grid-template-columns:auto minmax(0,1fr)}.pg-vrow .pg-arrow{display:none}.pg-vrow input[type=date]{grid-column:1/-1}.pg-baby img{width:70px}}
@keyframes pgWave{to{transform:translateX(-50%)}}
@keyframes pgSlosh{0%,100%{transform:skewX(0) scaleY(1)}25%{transform:skewX(-6deg) scaleY(1.03)}50%{transform:skewX(0) scaleY(.98)}75%{transform:skewX(5deg) scaleY(1.02)}}
@keyframes pgBubble{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(-30px);opacity:0}}
@media(max-width:560px){.pg-steps{height:62px}.pg-step b{font-size:.68rem}.pg-step span{font-size:.66rem}}
@media(prefers-reduced-motion:reduce){.pg-fill,.pg-fill svg,.pg-fill i,.pg-btn,.pg-btn::after,.pg-baby,.pg-wig,.pg-fx i{animation:none}.pg-fill{transition:none}}`;
  document.head.append(s);
}

const el = (tag, text = "", props = {}) => { const n = document.createElement(tag); if (text !== "") n.textContent = text; Object.assign(n, props); return n; };
const day = d => new Date(d + "T12:00:00");
const diff = (a, b) => Math.round((day(b) - day(a)) / 86400000);
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (d, n) => { const x = day(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const LITTER = {Kedi: ["kitten-lie", "kitten-sleep"], "Köpek": ["puppy-lie", "puppy-sleep"]};
const wave = '<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 10 Q12.5 0 25 10 T50 10 T75 10 T100 10 T125 10 T150 10 T175 10 T200 10 V20 H0z" fill="#fff"/></svg>';

export function mountPregnancy(root, opts) {
  const {patient, tr = s => s, load, save, canWrite = false, owner = false} = opts;
  if (!root || !SPECIES.has(patient.species)) return;
  css();
  const lang = document.documentElement.lang || "tr";
  const fmt = d => new Intl.DateTimeFormat(lang, {day: "numeric", month: "long"}).format(day(d));
  let item = null;

  function startForm(initial = "") {
    const form = el("form", "", {className: "pg-form"});
    const input = el("input", "", {type: "date", required: true, max: today(), value: initial});
    const label = el("label", tr("Çiftleşme tarihi")); label.append(input);
    const ok = el("button", "🐾 " + tr("Takibi başlat"), {type: "submit", className: "pg-btn pg-btn-go"});
    const err = el("p", "", {className: "pg-err", role: "alert"});
    form.append(label, ok, err);
    form.addEventListener("submit", async e => {
      e.preventDefault(); ok.disabled = true; err.textContent = "";
      try { const before = item?.mating; item = await save({mating: input.value}); draw(); if (item && item.mating !== before) askVaccines(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); ok.disabled = false; }
    });
    return form;
  }

  function endForm() {
    const form = el("form", "", {className: "pg-form"});
    const date = el("input", "", {type: "date", required: true, max: today(), min: item.mating, value: today() < item.birthMax ? today() : item.birth});
    const count = el("input", "", {type: "number", min: 1, max: 20, placeholder: "4", inputMode: "numeric"});
    const l1 = el("label", tr("Doğum tarihi")); l1.append(date);
    const l2 = el("label", tr("Yavru sayısı")); l2.append(count);
    const ok = el("button", "🍼 " + tr("Kaydet"), {type: "submit", className: "pg-btn pg-btn-go"});
    const err = el("p", "", {className: "pg-err", role: "alert"});
    form.append(l1, l2, ok, err);
    form.addEventListener("submit", async e => {
      e.preventDefault(); ok.disabled = true;
      try { item = await save({action: "end", ended: date.value, litter: count.value || null}); draw(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); ok.disabled = false; }
    });
    return form;
  }

  // Doğumdan sonra çubuğun yerine battaniyede yatan, nefes alıp kıpırdayan gerçekçi yavrular.
  function litterScene() {
    const n = Math.max(1, Math.min(item.litter || 4, 20));
    const shown = Math.min(n, 8);
    const pics = LITTER[patient.species] || LITTER.Kedi;
    const scene = el("div", "", {className: "pg-litter"});
    scene.setAttribute("role", "img");
    scene.setAttribute("aria-label", n + " " + tr(patient.species === "Kedi" ? "kedi yavrusu" : "köpek yavrusu"));
    const nest = el("div", "", {className: "pg-nest"});
    for (let i = 0; i < shown; i++) {
      const baby = el("span", "", {className: "pg-baby" + (i % 2 ? " flip" : "")});
      baby.style.setProperty("--d", (i * 0.37 % 2.4).toFixed(2) + "s");
      baby.style.setProperty("--r", (i % 3 - 1) * 3 + "deg");
      const img = el("img", "", {src: "/img-litter/" + pics[i % 2] + ".webp", alt: "", width: 90, height: 50, loading: "lazy", decoding: "async"});
      const wig = el("i", "", {className: "pg-wig"}); wig.append(img);
      baby.append(wig);
      nest.append(baby);
    }
    if (n > shown) nest.append(el("span", "+" + (n - shown), {className: "pg-more"}));
    const fx = el("div", "", {className: "pg-fx"}); fx.setAttribute("aria-hidden", "true");
    for (const [ch, x, d] of [["♥", 12, 0], ["z", 38, 1.4], ["♥", 63, 2.3], ["z", 86, .7]]) { const f = el("i", ch); f.style.left = x + "%"; f.style.animationDelay = d + "s"; fx.append(f); }
    const caption = el("p", "", {className: "pg-litter-cap"});
    caption.append(el("strong", (item.litter ? n + " " : "") + tr(patient.species === "Kedi" ? "minik kedi yavrusu dünyaya geldi!" : "minik köpek yavrusu dünyaya geldi!")),
      el("span", tr("Doğum sonrası kontrol") + ": " + fmt(item.control) + " · " + tr("aşılar") + " " + fmt(item.vaccineFrom) + " " + tr("sonrası")));
    scene.append(fx, nest, caption);
    return scene;
  }

  // Gebelik girilince: doğum sonrası 40. günden önceye düşen aşılar sorulur; işaretlenenler aynı tarihte kalır.
  function askVaccines() {
    if (!opts.vaccines || !item) return;
    const rows = (opts.vaccines() || []).filter(v => v.date && v.date < item.vaccineFrom).sort((a, b) => a.date.localeCompare(b.date));
    const dialog = el("dialog", "", {className: "pg-dialog"});
    const form = el("form", "", {method: "dialog"});
    form.append(el("h2", "💉 " + tr("Gebelikte aşı planı")),
      el("p", tr("Gebelik boyunca aşı yapılmaması önerilir. Aşağıdaki aşılar doğumdan sonraya taşınacak. Devam etmesi gerekenleri işaretleyin; onların tarihi değişmez."), {className: "pg-muted"}));
    const opts2 = el("div", "", {className: "pg-dgrid"});
    const offset = el("input", "", {type: "number", min: 40, max: 180, value: 40});
    const l1 = el("label", tr("Doğumdan sonra başla (gün)")); l1.append(offset);
    const mode = el("select");
    mode.append(el("option", tr("Mevcut aralıkları koru"), {value: "keep"}), el("option", tr("Aralığı elle gir"), {value: "gap"}));
    const l2 = el("label", tr("Aşılar arası aralık")); l2.append(mode);
    const gap = el("input", "", {type: "number", min: 1, max: 365, value: 21, disabled: true});
    const l3 = el("label", tr("Aralık (gün)")); l3.append(gap);
    opts2.append(l1, l2, l3);
    const list = el("div", "", {className: "pg-vlist"});
    const items = rows.map(v => {
      const row = el("div", "", {className: "pg-vrow"});
      const keep = el("input", "", {type: "checkbox"});
      const keepL = el("label", "", {className: "pg-keep"}); keepL.append(keep, el("span", tr("Devam etsin")));
      const name = el("div"); name.append(el("strong", v.title || tr("Aşı")), el("small", tr("Şu an") + ": " + fmt(v.date)));
      const date = el("input", "", {type: "date", min: item.mating});
      const r = {v, keep, date, manual: false};
      date.addEventListener("input", () => { r.manual = true; });
      keep.addEventListener("change", recompute);
      row.append(keepL, name, el("span", "→", {className: "pg-arrow"}), date);
      list.append(row);
      return r;
    });
    if (!items.length) list.append(el("p", "✓ " + tr("Doğumdan sonraya taşınması gereken planlı aşı yok."), {className: "pg-muted"}));
    function recompute() {
      const start = addDays(item.birth, Math.max(40, Number(offset.value) || 40));
      const moving = items.filter(r => !r.keep.checked);
      items.filter(r => r.keep.checked).forEach(r => { r.date.value = r.v.date; r.date.disabled = true; r.manual = false; });
      moving.forEach((r, i) => {
        r.date.disabled = false;
        if (r.manual) return;
        r.date.value = mode.value === "keep" ? addDays(start, diff(moving[0].v.date, r.v.date)) : addDays(start, i * Math.max(1, Number(gap.value) || 21));
      });
    }
    offset.addEventListener("input", recompute);
    gap.addEventListener("input", recompute);
    mode.addEventListener("change", () => { gap.disabled = mode.value !== "gap"; items.forEach(r => { r.manual = false; }); recompute(); });
    const ctrl = el("input", "", {type: "checkbox", checked: !!opts.addControl});
    const ctrlDays = el("input", "", {type: "number", min: 1, max: 60, value: 7});
    const ctrlL = el("label", "", {className: "pg-keep pg-ctrl"}); ctrlL.append(ctrl, el("span", tr("Doğum sonrası kontrol ekle · doğumdan")), ctrlDays, el("span", tr("gün sonra")));
    const err = el("p", "", {className: "pg-err", role: "alert"});
    const foot = el("div", "", {className: "pg-actions"});
    const apply = el("button", "✓ " + tr("Uygula"), {type: "submit", className: "pg-btn pg-btn-go"});
    const later = el("button", tr("Şimdi değil"), {type: "button", className: "pg-btn pg-btn-soft"});
    later.addEventListener("click", () => dialog.close());
    foot.append(apply, later);
    form.append(opts2, list, ...(opts.addControl ? [ctrlL] : []), err, foot);
    form.addEventListener("submit", async e => {
      e.preventDefault(); apply.disabled = true; err.textContent = "";
      const moves = items.filter(r => !r.keep.checked && r.date.value && r.date.value !== r.v.date).map(r => ({id: r.v.id, date: r.date.value}));
      const control = opts.addControl && ctrl.checked ? addDays(item.birth, Math.max(1, Number(ctrlDays.value) || 7)) : null;
      try { await opts.applyVaccines({moves, control}); dialog.close(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); apply.disabled = false; }
    });
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    recompute();
    dialog.showModal();
  }

  function draw() {
    root.replaceChildren();
    if (!item) {
      if (!canWrite || patient.sex !== "Dişi") return;
      const box = el("div", "", {className: "pg-start"});
      const p = el("p", "🐾 " + tr(owner ? "Dostunuz gebe mi? Çiftleşme tarihini girin; ultrason, röntgen ve doğum günlerini sizin için takip edelim." : "Gebelik takibi: çiftleşme tarihini girin, ultrason (30. gün), röntgen (45. gün) ve doğum tarihi otomatik hesaplansın."));
      const open = el("button", "🐾 " + tr("Gebelik takibini başlat"), {type: "button", className: "pg-btn"});
      open.addEventListener("click", () => { box.replaceChildren(startForm()); box.querySelector("input")?.focus(); });
      box.append(p, open);
      root.append(box);
      return;
    }
    const now = today();
    const total = item.days;
    const passed = Math.max(0, diff(item.mating, item.ended || now));
    const pct = Math.min(100, Math.max(2, passed / total * 100));
    const left = diff(now, item.birth);
    const card = el("section", "", {className: "pg"});
    card.setAttribute("aria-label", tr("Doğum takip cetveli"));
    const top = el("div", "", {className: "pg-top"});
    const title = el("div", "", {className: "pg-title"});
    const ico = el("span", "🐾", {className: "pg-ico"}); ico.setAttribute("aria-hidden", "true");
    const t = el("div"); t.append(el("b", tr("Doğum takip cetveli")), el("small", (patient.species === "Kedi" ? tr("Kedi") : tr("Köpek")) + " · " + tr("ortalama gebelik") + " " + total + " " + tr("gün")));
    title.append(ico, t);
    const count = el("div", "", {className: "pg-count"});
    count.append(el("strong", String(Math.min(passed, total + 9))), el("span", "/ " + total + " " + tr("gün")));
    top.append(title, count);

    const tank = el("div", "", {className: "pg-tank", role: "progressbar"});
    tank.setAttribute("aria-valuemin", "0"); tank.setAttribute("aria-valuemax", String(total)); tank.setAttribute("aria-valuenow", String(Math.min(passed, total)));
    const fill = el("div", "", {className: "pg-fill"});
    fill.innerHTML = wave + wave + "<i></i><i></i><i></i>";
    tank.append(fill);
    for (const d of [30, 45]) { const m = el("span", "", {className: "pg-mark"}); m.style.left = (d / total * 100) + "%"; tank.append(m); }
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = pct + "%"; }));

    const steps = el("div", "", {className: "pg-steps"});
    const stepList = [
      [0, tr("Çiftleşme"), item.mating],
      [30, tr("Ultrason"), item.us],
      [45, tr("Röntgen · doğum şekli"), item.xray],
      [total, tr("Tahmini doğum"), item.birth],
    ];
    const nextIdx = stepList.findIndex(([, , d]) => d >= now);
    stepList.forEach(([d, label, date], i) => {
      const s = el("div", "", {className: "pg-step" + (i % 2 ? " low" : "") + (date < now ? " done" : i === nextIdx ? " next" : "")});
      s.style.left = (d / total * 100) + "%";
      s.append(el("b", (date < now ? "✓ " : "") + label), el("span", (d && d < total ? d + ". " + tr("gün") + " · " : "") + fmt(date)));
      steps.append(s);
    });

    if (item.ended) {
      count.replaceChildren(el("strong", "🎉"), el("span", fmt(item.ended)));
      card.append(top, litterScene());
    } else card.append(top, tank, steps);

    if (canWrite) {
      const actions = el("div", "", {className: "pg-actions"});
      const err = el("p", "", {className: "pg-err", role: "alert"});
      const run = async body => { err.textContent = ""; try { item = await save(body); draw(); } catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); } };
      if (!item.ended) {
        const edit = el("button", "✎ " + tr("Tarihi düzenle"), {type: "button", className: "pg-btn"});
        edit.addEventListener("click", () => { actions.replaceChildren(startForm(item.mating)); });
        const done = el("button", "🍼 " + tr("Doğum gerçekleşti"), {type: "button", className: "pg-btn pg-btn-go"});
        done.addEventListener("click", () => actions.replaceChildren(endForm()));
        actions.append(edit, done);
        if (opts.vaccines) {
          const vac = el("button", "💉 " + tr("Aşıları düzenle"), {type: "button", className: "pg-btn"});
          vac.addEventListener("click", askVaccines);
          actions.append(vac);
        }
      }
      if (!owner) {
        const clear = el("button", "✕ " + tr("Takibi kaldır"), {type: "button", className: "pg-btn pg-btn-soft"});
        clear.addEventListener("click", () => { if (confirm(tr("Gebelik takibi kaldırılsın mı?"))) run({action: "clear"}); });
        actions.append(clear);
      }
      card.append(actions, err);
    }
    root.append(card);
  }

  Promise.resolve(load()).then(v => { item = v || null; draw(); }).catch(() => { item = null; draw(); });
  return {redraw: draw};
}
