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
.pg-notes{display:flex;flex-wrap:wrap;gap:8px}
.pg-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;font-size:.8rem;font-weight:600;background:var(--pg-soft);border:1px solid var(--pg-line)}
.pg-chip.warn{background:color-mix(in srgb,#f59e0b 14%,transparent);border-color:color-mix(in srgb,#f59e0b 40%,transparent)}
.pg-chip.ok{background:color-mix(in srgb,#16a34a 12%,transparent);border-color:color-mix(in srgb,#16a34a 35%,transparent)}
.pg-actions{display:flex;flex-wrap:wrap;gap:8px}
.pg-form{display:flex;flex-wrap:wrap;align-items:end;gap:8px}
.pg-form label{display:grid;gap:4px;font-size:.82rem;font-weight:700}
.pg-form input{min-height:38px;padding:6px 10px;border-radius:10px;border:1px solid var(--pg-line);font:inherit;background:transparent;color:inherit}
.pg-start{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;margin:12px 0 2px;padding:10px 14px;border-radius:14px;border:1px dashed var(--pg-line)}
.pg-start p{margin:0;font-size:.86rem;opacity:.85}
.pg-err{margin:0;color:#dc2626;font-weight:600;font-size:.85rem}
@keyframes pgWave{to{transform:translateX(-50%)}}
@keyframes pgSlosh{0%,100%{transform:skewX(0) scaleY(1)}25%{transform:skewX(-6deg) scaleY(1.03)}50%{transform:skewX(0) scaleY(.98)}75%{transform:skewX(5deg) scaleY(1.02)}}
@keyframes pgBubble{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(-30px);opacity:0}}
@media(max-width:560px){.pg-steps{height:62px}.pg-step b{font-size:.68rem}.pg-step span{font-size:.66rem}}
@media(prefers-reduced-motion:reduce){.pg-fill,.pg-fill svg,.pg-fill i{animation:none}.pg-fill{transition:none}}`;
  document.head.append(s);
}

const el = (tag, text = "", props = {}) => { const n = document.createElement(tag); if (text !== "") n.textContent = text; Object.assign(n, props); return n; };
const day = d => new Date(d + "T12:00:00");
const diff = (a, b) => Math.round((day(b) - day(a)) / 86400000);
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
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
    const ok = el("button", tr("Takibi başlat"), {type: "submit", className: "button primary small"});
    const err = el("p", "", {className: "pg-err", role: "alert"});
    form.append(label, ok, err);
    form.addEventListener("submit", async e => {
      e.preventDefault(); ok.disabled = true; err.textContent = "";
      try { item = await save({mating: input.value}); draw(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); ok.disabled = false; }
    });
    return form;
  }

  function draw() {
    root.replaceChildren();
    if (!item) {
      if (!canWrite || patient.sex !== "Dişi") return;
      const box = el("div", "", {className: "pg-start"});
      const p = el("p", "🐾 " + tr(owner ? "Dostunuz gebe mi? Çiftleşme tarihini girin; ultrason, röntgen ve doğum günlerini sizin için takip edelim." : "Gebelik takibi: çiftleşme tarihini girin, ultrason (30. gün), röntgen (45. gün) ve doğum tarihi otomatik hesaplansın."));
      const open = el("button", tr("Gebelik takibini başlat"), {type: "button", className: "button small"});
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

    const notes = el("div", "", {className: "pg-notes"});
    if (item.ended) notes.append(el("span", "🎉 " + tr("Doğum gerçekleşti") + ": " + fmt(item.ended) + " · " + tr("bu kart 30 gün sonra kaldırılır"), {className: "pg-chip ok"}));
    else {
      notes.append(el("span", left > 0 ? "⏳ " + left + " " + tr("gün kaldı") + " · " + fmt(item.birthMin) + "–" + fmt(item.birthMax) : left === 0 ? "🍼 " + tr("Doğum günü bugün!") : "🍼 " + tr("Doğum zamanı geldi; gecikme varsa kliniği arayın"), {className: "pg-chip"}));
      const nextPar = (item.parasite || []).find(d => d >= now);
      notes.append(el("span", "🪱 " + tr("Doğuma kadar aylık iç-dış parazit uygulaması") + (nextPar ? " · " + tr("sonraki") + ": " + fmt(nextPar) : ""), {className: "pg-chip warn"}));
      notes.append(el("span", "🔔 " + tr(owner ? "Ultrason, röntgen ve doğumdan 1 gün önce hatırlatma gelecek" : "Ultrason, röntgen ve doğumdan 1 gün önce hasta sahibine SMS, WhatsApp ve uygulama bildirimi"), {className: "pg-chip"}));
    }
    card.append(top, tank, steps, notes);

    if (canWrite) {
      const actions = el("div", "", {className: "pg-actions"});
      const err = el("p", "", {className: "pg-err", role: "alert"});
      const run = async body => { err.textContent = ""; try { item = await save(body); draw(); } catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); } };
      if (!item.ended) {
        const edit = el("button", tr("Tarihi düzenle"), {type: "button", className: "button small"});
        edit.addEventListener("click", () => { actions.replaceChildren(startForm(item.mating)); });
        const done = el("button", tr("Doğum gerçekleşti"), {type: "button", className: "button small"});
        done.addEventListener("click", () => run({action: "end"}));
        actions.append(edit, done);
      }
      if (!owner) {
        const clear = el("button", tr("Takibi kaldır"), {type: "button", className: "button small ghost"});
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
