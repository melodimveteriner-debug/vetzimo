import {devArt} from "./pregnancy-art.js?v=1";
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
.pg-dialog,.pg-start,.pg-form{--pg-a:#7c3aed;--pg-b:#ec4899;--pg-c:#06b6d4;--pg-line:color-mix(in srgb,currentColor 14%,transparent)}
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
.pg-track{display:flex;align-items:stretch;gap:8px;min-width:0}
.pg-track .pg-tank{flex:1;height:46px;cursor:crosshair;outline:none}
.pg-track .pg-tank:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--pg-a) 45%,transparent)}
.pg-dev{position:absolute;top:50%;z-index:3;width:30px;height:30px;margin:-15px 0 0 -15px;padding:0;border:0;background:none;cursor:pointer;display:grid;place-items:center;border-radius:50%;transition:transform .25s}
.pg-dev svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))}
.pg-dev.future{opacity:.42}.pg-dev.past{opacity:.95}
.pg-dev.now{transform:scale(1.28);animation:pgNow 1.8s ease-in-out infinite}
.pg-dev.now::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid #fff;opacity:.85;animation:pgRing 1.8s ease-out infinite}
.pg-dev:hover,.pg-dev:focus-visible{transform:scale(1.4);outline:none;z-index:4}
.pg .hb{animation:pgBeat .9s ease-in-out infinite;transform-origin:center;transform-box:fill-box}
@keyframes pgNow{0%,100%{transform:scale(1.22)}50%{transform:scale(1.34)}}
@keyframes pgRing{from{transform:scale(.8);opacity:.9}to{transform:scale(1.5);opacity:0}}
@keyframes pgBeat{0%,100%{transform:scale(1)}30%{transform:scale(1.45)}}
.pg-cursor{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#fff;box-shadow:0 0 0 1px color-mix(in srgb,var(--pg-a) 60%,transparent);z-index:2;pointer-events:none;opacity:0;transition:opacity .15s}
.pg-tank:hover .pg-cursor,.pg-tank:focus-visible .pg-cursor,.pg-cursor.on{opacity:1}
.pg-nest{flex:none;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:1px;width:74px;min-height:46px;padding:3px;border-radius:14px;border:1px dashed color-mix(in srgb,var(--pg-b) 45%,transparent);background:color-mix(in srgb,var(--pg-b) 8%,transparent);cursor:help;position:relative}
.pg-nest svg{width:22px;height:22px;animation:pgNap 3.2s ease-in-out infinite;transform-origin:50% 90%}
.pg-nest svg:nth-child(2n){animation-delay:.8s}.pg-nest svg:nth-child(3n){animation-delay:1.6s}
.pg-nest.many svg{width:16px;height:16px}
.pg-nest b{position:absolute;right:-6px;top:-8px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:linear-gradient(135deg,var(--pg-a),var(--pg-b));color:#fff;font-size:.72rem;display:grid;place-items:center;box-shadow:0 3px 8px rgba(0,0,0,.2)}
@keyframes pgNap{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg) translateY(-1px)}}
.pg-tip{position:absolute;z-index:20;width:min(300px,calc(100% - 16px));padding:10px 12px;border-radius:14px;background:var(--pg-tipbg,#1e1b2e);color:#fff;font-size:.8rem;line-height:1.45;box-shadow:0 14px 34px rgba(15,23,42,.35);pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s}
.pg-tip.on{opacity:1;transform:none}
.pg-tip b{display:block;font-size:.86rem;margin-bottom:2px}.pg-tip small{display:block;opacity:.75;margin-bottom:4px}.pg-tip em{display:inline-block;margin-top:4px;font-style:normal;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,.16)}
.pg-today{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:center;padding:10px 12px;border-radius:14px;background:color-mix(in srgb,var(--pg-a) 7%,transparent);border:1px solid var(--pg-line)}
.pg-today svg{width:44px;height:44px;grid-row:span 2}
.pg-today b{font-size:.9rem}.pg-today p{margin:0;font-size:.82rem;opacity:.85;line-height:1.45}
.pg-note{margin:0;font-size:.74rem;opacity:.6}
.pg{position:relative}
@media(max-width:560px){.pg-track .pg-tank{height:40px}.pg-dev{width:24px;height:24px;margin:-12px 0 0 -12px}.pg-nest{width:56px}.pg-nest svg{width:17px;height:17px}.pg-nest.many svg{width:12px;height:12px}.pg-today svg{width:36px;height:36px}}
@media(prefers-reduced-motion:reduce){.pg-dev,.pg-dev::after,.pg-dev .hb,.pg-nest svg{animation:none!important}}
.pg-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pg-check{display:grid;gap:6px;align-content:start;padding:12px 14px;border-radius:14px;border:1px solid var(--pg-line);background:color-mix(in srgb,currentColor 3%,transparent);min-width:0}
.pg-check header{display:flex;align-items:center;justify-content:space-between;gap:8px}.pg-check header b{font-size:.92rem}
.pg-check dl{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:.82rem}.pg-check dt{opacity:.7}.pg-check dd{margin:0;font-weight:700}
.pg-check p{margin:0;font-size:.82rem;opacity:.8}.pg-check .pg-empty{opacity:.6;font-style:italic}
.pg-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 9px;border-radius:999px;font-size:.76rem;font-weight:800}
.pg-pill.ok{background:color-mix(in srgb,#16a34a 16%,transparent);color:#15803d}.pg-pill.bad{background:color-mix(in srgb,#dc2626 14%,transparent);color:#b91c1c}.pg-pill.mid{background:color-mix(in srgb,#f59e0b 18%,transparent);color:#b45309}
.pg-mini{min-height:32px;padding:0 12px;font-size:.78rem}
.pg-cform{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pg-cform label{display:grid;gap:3px;font-size:.78rem;font-weight:700;min-width:0}
.pg-cform input,.pg-cform select,.pg-cform textarea{min-height:36px;padding:6px 10px;border-radius:10px;border:1px solid var(--pg-line);font:inherit;background:transparent;color:inherit;min-width:0}
.pg-cform .wide{grid-column:1/-1}.pg-cform textarea{min-height:60px;resize:vertical}
.pg-seg{display:flex;flex-wrap:wrap;gap:4px}.pg-seg button{flex:1;min-height:34px;border-radius:10px;border:1px solid var(--pg-line);background:transparent;color:inherit;font:inherit;font-size:.78rem;font-weight:700;cursor:pointer}
.pg-seg button[aria-pressed=true]{background:linear-gradient(135deg,var(--pg-a),var(--pg-b));color:#fff;border-color:transparent}
.pg-mem{display:grid;gap:6px;justify-items:center;padding:8px 0 4px}
.pg-mem>b{justify-self:start;font-size:.92rem}
.pg-deck{display:flex;justify-content:center;align-items:flex-end;padding:26px 10px 8px;min-height:210px}
.pg-card{position:relative;flex:none;width:150px;margin:0 -16px;padding:8px 8px 30px;border:0;border-radius:10px;background:#fff;color:#1f2937;cursor:pointer;
 box-shadow:0 10px 24px rgba(15,23,42,.22),0 0 0 1px rgba(15,23,42,.06);transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s;transform:rotate(var(--r)) translateY(var(--y,0))}
.pg-card:nth-child(1){--r:-9deg;--y:6px;z-index:1}.pg-card:nth-child(2){--r:0deg;--y:-6px;z-index:2}.pg-card:nth-child(3){--r:9deg;--y:6px;z-index:1}
.pg-card:hover,.pg-card:focus-visible{transform:rotate(0) translateY(-14px) scale(1.06);z-index:5;box-shadow:0 22px 40px rgba(15,23,42,.3);outline:none}
.pg-card::before{content:"";position:absolute;inset:3px;border-radius:8px;border:2px solid transparent;background:linear-gradient(135deg,var(--pg-a),var(--pg-b),var(--pg-c)) border-box;-webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.pg-card .lbl{position:absolute;left:50%;top:-24px;transform:translateX(-50%);padding:2px 12px;border-radius:999px;background:linear-gradient(135deg,var(--pg-a),var(--pg-b));color:#fff;font-size:.74rem;font-weight:800;white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,.18)}
.pg-card .ph{display:grid;place-items:center;width:100%;aspect-ratio:4/5;border-radius:6px;overflow:hidden;background:repeating-linear-gradient(45deg,#f5f3ff,#f5f3ff 8px,#fdf2f8 8px,#fdf2f8 16px)}
.pg-card .ph img{width:100%;height:100%;object-fit:cover;display:block}
.pg-card .ph span{display:grid;justify-items:center;gap:4px;font-size:.72rem;font-weight:700;color:#7c3aed;text-align:center;padding:6px}
.pg-card .ph span i{font-style:normal;font-size:1.6rem}
.pg-card .cap{position:absolute;left:8px;right:8px;bottom:6px;font-size:.7rem;line-height:1.25;color:#4b5563;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"Segoe Print","Bradley Hand",cursive}
.pg-view{width:min(860px,calc(100vw - 20px))}
.pg-view form{gap:10px}
.pg-view .big{display:grid;place-items:center;background:#0f172a;border-radius:14px;min-height:240px;max-height:62vh;overflow:hidden}
.pg-view .big img{max-width:100%;max-height:62vh;object-fit:contain;display:block}
.pg-view .big span{color:#cbd5e1;padding:30px;text-align:center}
.pg-view .nav{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center}
.pg-view textarea{width:100%;min-height:80px;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);font:inherit;background:transparent;color:inherit;resize:vertical}
.pg-view .tabs{display:flex;gap:6px}.pg-view .tabs button{border-radius:999px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:transparent;color:inherit;padding:4px 12px;font:inherit;font-size:.82rem;font-weight:700;cursor:pointer}
.pg-view .tabs button[aria-pressed=true]{background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;border-color:transparent}
@media(max-width:560px){.pg-checks,.pg-cform{grid-template-columns:1fr}.pg-card{width:104px;margin:0 -12px;padding:6px 6px 24px}.pg-deck{min-height:170px}.pg-card .cap{font-size:.62rem}}
@media(prefers-reduced-motion:reduce){.pg-card{transition:none}}
.pg-tipart{float:left;margin:0 10px 4px 0;width:104px;height:104px;border-radius:50%;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.25)}.pg-tipart svg{display:block}
.pg-tip{width:min(380px,calc(100% - 16px))!important}.pg-tip::after{content:"";display:block;clear:both}
.pg-today svg{width:96px!important;height:96px!important;border-radius:50%;background:#fff;box-shadow:0 6px 16px rgba(124,58,237,.18)}
.pg-dev svg{border-radius:50%;background:#fff}
@media(max-width:560px){.pg-tipart{width:78px;height:78px}.pg-tipart svg{width:78px;height:78px}.pg-today svg{width:72px!important;height:72px!important}}
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


// Gelişim aşamaları: [başlangıç günü, bitiş günü, yaklaşık boy (cm; 0 = mikroskobik)]; köpek ort. 63, kedi ort. 65 gün.
const DEV_DAYS = {
  "Köpek": [[0, 2, 0], [3, 7, 0], [8, 15, 0], [16, 20, 0.2], [21, 24, 0.5], [25, 29, 1], [30, 35, 2.5], [36, 42, 5], [43, 50, 8], [51, 57, 11], [58, 63, 15]],
  "Kedi": [[0, 2, 0], [3, 6, 0], [7, 12, 0], [13, 16, 0.2], [17, 21, 0.5], [22, 27, 1], [28, 35, 2.5], [36, 42, 4.5], [43, 50, 7], [51, 58, 9.5], [59, 65, 12]],
};
const DEV_TEXT = [
  ["Döllenme", "Yumurta ve sperm yumurta kanalında birleşir; tek hücreli zigot oluşur."],
  ["Hücre bölünmesi (morula)", "Zigot bölünerek dut görünümlü bir hücre kümesine dönüşür ve rahme doğru ilerler."],
  ["Blastosist", "Embriyolar rahme ulaşır, içi sıvı dolu keseye dönüşür ve rahim boynuzlarına eşit aralıklarla yerleşir."],
  ["Rahme tutunma", "Embriyo rahim duvarına tutunur, plasenta oluşmaya başlar. Annede kısa süreli iştahsızlık görülebilir."],
  ["Organ taslakları", "Beyin, omurilik, kalp ve göz taslakları belirir; kalp atmaya başlar. Kedilerde meme uçları pembeleşir."],
  ["Kalp atışı görülür", "Ultrasonla gebelik keseleri ve kalp atışları izlenebilir; veteriner karından keseleri hissedebilir."],
  ["Fetüs dönemi", "Embriyo artık fetüs: yüz, kulak, pençe ve kuyruk şekillenir, cinsiyet belirginleşir. Ultrason kontrol zamanı."],
  ["Hızlı büyüme", "Göz kapakları kapanır, bıyık ve tırnak tomurcukları çıkar. Annenin karnı belirginleşir, iştahı ve kilosu artar."],
  ["İskelet kemikleşir", "Kemikler kireçlenir; röntgende yavrular sayılabilir ve doğum şekli planlanır."],
  ["Tüyler ve hareket", "Tüy ve renkler belirginleşir, yavruların kıpırtısı karından hissedilir. Anne yuva hazırlamaya başlar."],
  ["Doğuma hazır", "Akciğerler olgunlaşır, yavrular doğum kanalına döner. Doğumdan 12–24 saat önce vücut ısısı yaklaşık 1 °C düşer; huzursuzluk ve iştahsızlık olur."],
];
const devStage = (species, d) => { const L = DEV_DAYS[species] || DEV_DAYS["Köpek"]; let i = L.findIndex(([a, b]) => d >= a && d <= b); return i < 0 ? (d < 0 ? 0 : L.length - 1) : i; };
// Aşama çizimleri (32×32): zigottan yavruya büyüyen biçimler. Son aşama türe göre (köpekte sarkık, kedide sivri kulak).
function devSvg(i, species) {
  const W = 'fill="#fff" stroke="#7c3aed" stroke-width="1.6"', P = 'fill="#ec4899"';
  const cat = species === "Kedi";
  const body = [
    `<circle cx="16" cy="16" r="8.5" ${W}/><circle cx="16" cy="16" r="2.6" ${P}/>`,
    `<g ${W}><circle cx="12.5" cy="13" r="4.6"/><circle cx="19.5" cy="13" r="4.6"/><circle cx="12.5" cy="19.5" r="4.6"/><circle cx="19.5" cy="19.5" r="4.6"/><circle cx="16" cy="16.2" r="4.2"/></g>`,
    `<circle cx="16" cy="16" r="10" ${W}/><path d="M9 12a8 8 0 0 1 8-4.5c-1 3-4 5-8 4.5z" ${P}/>`,
    `<path d="M3 26q13-6 26 0" fill="none" stroke="#ec4899" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="16" cy="18.5" rx="7" ry="5.5" ${W}/><circle cx="15" cy="17.5" r="2" ${P}/>`,
    `<path d="M21 8c-8-2-13 4-12 10 1 6 7 8 11 5 2.5-2 1.5-5-1-5" fill="none" stroke="#7c3aed" stroke-width="5.4" stroke-linecap="round"/><path d="M21 8c-8-2-13 4-12 10 1 6 7 8 11 5 2.5-2 1.5-5-1-5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M22 7c-9-2-15 5-14 11 1 7 8 9 12 6 3-2 2-6-1-6" fill="none" stroke="#7c3aed" stroke-width="6.4" stroke-linecap="round"/><path d="M22 7c-9-2-15 5-14 11 1 7 8 9 12 6 3-2 2-6-1-6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle class="hb" cx="15" cy="16" r="2.1" fill="#ef4444"/>`,
    `<g ${W}><ellipse cx="14" cy="19" rx="7.5" ry="6"/><circle cx="20" cy="11" r="5.5"/></g><path d="M10 24l-1 3M16 24.5l0 2.5" stroke="#7c3aed" stroke-width="1.6" stroke-linecap="round"/><circle cx="21.5" cy="10.5" r="1" fill="#7c3aed"/>`,
    `<g ${W}><ellipse cx="13.5" cy="19.5" rx="8.5" ry="6.5"/><circle cx="21" cy="11" r="6.3"/></g><path d="M19.5 11q1.6 1 3 0" fill="none" stroke="#7c3aed" stroke-width="1.2"/><path d="M8 25l-1.5 3M14 26l0 3M19 24l1 3" stroke="#7c3aed" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 18q-3 1-2 4" fill="none" stroke="#7c3aed" stroke-width="1.6" stroke-linecap="round"/>`,
    `<g ${W}><ellipse cx="13.5" cy="19.5" rx="9" ry="6.8"/><circle cx="21.5" cy="11" r="6.5"/></g><path d="M7 19h13" stroke="#ec4899" stroke-width="1.4" stroke-dasharray="1.6 1.4"/><path d="M9 22l-1 3M13 22.5l0 3M17 22l1 3" stroke="#ec4899" stroke-width="1.3"/><path d="M20 11q1.6 1 3 0" fill="none" stroke="#7c3aed" stroke-width="1.2"/>`,
    `<g ${W}><ellipse cx="13.5" cy="19.5" rx="9.5" ry="7"/><circle cx="21.5" cy="11" r="6.8"/></g><path d="M8 15l-1-2M11 14l0-2.2M15 14l1-2M6 21l-2 .5M7 24l-2 1.5M23 6l1-2M19 5.5l-.5-2" stroke="#7c3aed" stroke-width="1.2" stroke-linecap="round"/><path d="M20 11q1.6 1 3 0" fill="none" stroke="#7c3aed" stroke-width="1.2"/>`,
  ];
  if (i < body.length) return `<svg viewBox="0 0 32 32" aria-hidden="true">${body[i]}</svg>`;
  return baby(species, 0);
}
// Yavru başı (son aşama ve yuva): kapalı gözler, burun; köpekte sarkık, kedide sivri kulaklar.
function baby(species, k = 0) {
  const tone = ["#f3d2a8", "#e8b67a", "#c9a27e", "#f1e3cf", "#b88a64", "#d9c2a6"][k % 6];
  const ears = species === "Kedi"
    ? `<path d="M7 12L8 3l7 6zM25 12L24 3l-7 6z" fill="${tone}" stroke="#7c3aed" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 9l.5-3.5 2.8 2.4zM23 9l-.5-3.5-2.8 2.4z" fill="#f9a8d4"/>`
    : `<ellipse cx="6.5" cy="15" rx="4" ry="7.5" transform="rotate(18 6.5 15)" fill="#8b5e3c" stroke="#7c3aed" stroke-width="1.2"/><ellipse cx="25.5" cy="15" rx="4" ry="7.5" transform="rotate(-18 25.5 15)" fill="#8b5e3c" stroke="#7c3aed" stroke-width="1.2"/>`;
  const head = `<circle cx="16" cy="17" r="10" fill="${tone}" stroke="#7c3aed" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 32 32" aria-hidden="true">${species === "Kedi" ? ears + head : head + ears}<path d="M11 16q1.6 1.5 3.2 0M17.8 16q1.6 1.5 3.2 0" fill="none" stroke="#3b2a20" stroke-width="1.3" stroke-linecap="round"/><path d="M14.6 20.2h2.8l-1.4 1.6z" fill="#3b2a20"/><path d="M16 21.8q-1.5 1.7-3 .8M16 21.8q1.5 1.7 3 .8" fill="none" stroke="#3b2a20" stroke-width="1"/>${species === "Kedi" ? '<path d="M7 20h4M7 22.5l4-1M25 20h-4M25 22.5l-4-1" stroke="#3b2a20" stroke-width=".8"/>' : ""}</svg>`;
}

export function mountPregnancy(root, opts) {
  const {patient, tr = s => s, load, save, canWrite = false, owner = false, photo = null} = opts;
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

  function expectedForm() {
    const form = el("form", "", {className: "pg-form"});
    const n = el("input", "", {type: "number", min: 1, max: 20, value: item.expected || "", placeholder: "4", inputMode: "numeric"});
    const l = el("label", tr("Röntgen / ultrasonda görülen yavru")); l.append(n);
    const ok = el("button", "💾 " + tr("Kaydet"), {type: "submit", className: "pg-btn pg-btn-go"});
    const back = el("button", tr("Vazgeç"), {type: "button", className: "pg-btn pg-btn-soft"}); back.addEventListener("click", draw);
    const err = el("p", "", {className: "pg-err", role: "alert"});
    form.append(l, ok, back, err);
    form.addEventListener("submit", async e => {
      e.preventDefault(); ok.disabled = true; err.textContent = "";
      try { item = await save({action: "expected", expected: n.value || null}); draw(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); ok.disabled = false; }
    });
    return form;
  }


  // ── Ultrason / röntgen kontrol sonuçları (klinik girer, hasta sahibi görür)
  const KIND = {us: "Ultrason", xray: "Röntgen", family: "Aile"};
  function checksBox() {
    const box = el("div", "", {className: "pg-checks"});
    for (const kind of ["us", "xray"]) {
      const c = item.checks?.[kind], card = el("section", "", {className: "pg-check"});
      const head = el("header"); head.append(el("b", (kind === "us" ? "🔊 " : "🦴 ") + tr(KIND[kind] + " kontrolü")));
      if (canWrite && !owner && !item.ended) {
        const b = el("button", c ? "✎ " + tr("Düzenle") : "＋ " + tr("Sonuç gir"), {type: "button", className: "pg-btn pg-mini"});
        b.addEventListener("click", () => card.replaceChildren(head, checkForm(kind, c)));
        head.append(b);
      }
      card.append(head);
      if (!c) card.append(el("p", tr(kind === "us" ? "30. gün ultrason sonucu henüz girilmedi." : "45. gün röntgen sonucu henüz girilmedi."), {className: "pg-empty"}));
      else {
        const dl = el("dl");
        const row = (t, v) => { dl.append(el("dt", tr(t))); const dd = el("dd"); typeof v === "string" ? dd.textContent = v : dd.append(v); dl.append(dd); };
        row("Tarih", fmt(c.date));
        row("Yavru sayısı", c.count === null || c.count === undefined ? "—" : String(c.count));
        row("Kalp atışları", c.heart ? el("span", c.heart === "heard" ? "♥ " + tr("Duyuldu") : "✕ " + tr("Duyulmadı"), {className: "pg-pill " + (c.heart === "heard" ? "ok" : "bad")}) : "—");
        row("Amnion sıvısı", c.fluid ? el("span", tr(c.fluid), {className: "pg-pill " + (c.fluid === "Normal" ? "ok" : "mid")}) : "—");
        card.append(dl);
        if (c.note) card.append(el("p", "📝 " + c.note));
      }
      box.append(card);
    }
    return box;
  }
  function checkForm(kind, c = {}) {
    c = c || {};
    const form = el("form", "", {className: "pg-cform"});
    const date = el("input", "", {type: "date", required: true, min: item.mating, max: today(), value: c.date || (today() < (kind === "us" ? item.us : item.xray) ? today() : (kind === "us" ? item.us : item.xray))});
    const count = el("input", "", {type: "number", min: 0, max: 20, inputMode: "numeric", value: c.count ?? "", placeholder: "4"});
    const lab = (t, n, cls = "") => { const l = el("label", tr(t), {className: cls}); l.append(n); return l; };
    const seg = (opts, value) => { const g = el("div", "", {className: "pg-seg", role: "group"}); g.value = value || "";
      for (const [v, t] of opts) { const b = el("button", tr(t), {type: "button"}); b.setAttribute("aria-pressed", String(g.value === v));
        b.addEventListener("click", () => { g.value = g.value === v ? "" : v; g.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-pressed", String(opts[i][0] === g.value))); }); g.append(b); }
      return g; };
    const heart = seg([["heard", "Kalp atışları duyuldu"], ["not", "Kalp atışları duyulmadı"]], c.heart);
    const fluid = seg([["Az", "Az"], ["Normal", "Normal"], ["Fazla", "Fazla"]], c.fluid);
    const note = el("textarea", "", {maxLength: 300, value: c.note || "", placeholder: tr("Örn. fetüs boyutları, konum, öneriler")});
    const ok = el("button", "💾 " + tr("Kaydet"), {type: "submit", className: "pg-btn pg-btn-go pg-mini"});
    const back = el("button", tr("Vazgeç"), {type: "button", className: "pg-btn pg-btn-soft pg-mini"}); back.addEventListener("click", draw);
    const bar = el("div", "", {className: "pg-actions wide"}); bar.append(ok, back);
    if (c.date) { const del = el("button", "✕ " + tr("Sonucu sil"), {type: "button", className: "pg-btn pg-btn-soft pg-mini"});
      del.addEventListener("click", async () => { try { item = await save({action: "check", kind, remove: true}); draw(); } catch (x) { err.textContent = x.message; } }); bar.append(del); }
    const err = el("p", "", {className: "pg-err wide", role: "alert"});
    form.append(lab("Kontrol tarihi", date), lab("Görülen yavru sayısı", count), lab("Canlılık", heart, "wide"), lab("Amnion sıvısı miktarı", fluid, "wide"), lab("Not", note, "wide"), bar, err);
    form.addEventListener("submit", async e => {
      e.preventDefault(); ok.disabled = true; err.textContent = "";
      try { item = await save({action: "check", kind, date: date.value, count: count.value === "" ? null : count.value, heart: heart.value, fluid: fluid.value, note: note.value}); draw(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); ok.disabled = false; }
    });
    return form;
  }

  // ── Anı fotoğrafları: Aile · Ultrason · Röntgen (iskambil kartı gibi dizili; tıklayınca büyük hali ve not)
  const imgCache = new Map();
  const getImg = async kind => { const m = item.photos?.[kind]; if (!m?.image || !photo) return null; const key = kind + ":" + m.v;
    if (!imgCache.has(key)) imgCache.set(key, photo(kind).catch(() => null)); return imgCache.get(key); };
  const canPhoto = kind => canWrite && (!owner || kind === "family");
  function memories() {
    const wrap = el("section", "", {className: "pg-mem"});
    wrap.append(el("b", "📸 " + tr("Anı fotoğrafları")));
    const deck = el("div", "", {className: "pg-deck"});
    for (const kind of ["family", "us", "xray"]) {
      const m = item.photos?.[kind];
      const card = el("button", "", {type: "button", className: "pg-card"});
      card.setAttribute("aria-label", tr(KIND[kind]) + (m?.note ? ": " + m.note : ""));
      const ph = el("div", "", {className: "ph"});
      const empty = el("span"); empty.append(el("i", kind === "family" ? "🐾" : kind === "us" ? "🔊" : "🦴"), document.createTextNode(canPhoto(kind) ? tr("Fotoğraf ekle") : tr("Henüz fotoğraf yok")));
      ph.append(empty);
      if (m?.image) getImg(kind).then(src => { if (src) { const im = el("img", "", {src, alt: tr(KIND[kind]), loading: "lazy", decoding: "async"}); ph.replaceChildren(im); } });
      card.append(el("span", tr(KIND[kind]), {className: "lbl"}), ph, el("span", m?.note || "", {className: "cap"}));
      card.addEventListener("click", () => viewer(kind));
      deck.append(card);
    }
    wrap.append(deck);
    return wrap;
  }
  async function resize(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw Error(tr("Lütfen bir fotoğraf seçin."));
    const bmp = await createImageBitmap(file).catch(() => { throw Error(tr("Fotoğraf okunamadı.")); });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    for (const q of [0.85, 0.72, 0.6, 0.45]) { const url = cv.toDataURL("image/jpeg", q); if (url.length < 2_000_000) return url; }
    throw Error(tr("Fotoğraf çok büyük."));
  }
  function viewer(start) {
    const dlg = el("dialog", "", {className: "pg-dialog pg-view"});
    const form = el("form"); form.method = "dialog"; dlg.append(form);
    let kind = start, pending = null;
    const tabs = el("div", "", {className: "tabs"}), big = el("div", "", {className: "big"}), note = el("textarea", "", {maxLength: 500});
    const err = el("p", "", {className: "pg-err", role: "alert"}), file = el("input", "", {type: "file", accept: "image/*", hidden: true});
    const pick = el("button", "📷 " + tr("Fotoğraf seç"), {type: "button", className: "pg-btn pg-mini"});
    const saveB = el("button", "💾 " + tr("Kaydet"), {type: "button", className: "pg-btn pg-btn-go pg-mini"});
    const del = el("button", "✕ " + tr("Fotoğrafı kaldır"), {type: "button", className: "pg-btn pg-btn-soft pg-mini"});
    const close = el("button", tr("Kapat"), {type: "submit", className: "pg-btn pg-btn-soft pg-mini"});
    const nav = el("div", "", {className: "nav"}), acts = el("div", "", {className: "pg-actions"});
    nav.append(tabs, close);
    const show = async () => {
      pending = null; err.textContent = "";
      tabs.replaceChildren(...["family", "us", "xray"].map(k => { const b = el("button", tr(KIND[k]), {type: "button"}); b.setAttribute("aria-pressed", String(k === kind)); b.addEventListener("click", () => { kind = k; show(); }); return b; }));
      const m = item.photos?.[kind];
      note.value = m?.note || ""; note.readOnly = !canPhoto(kind); note.placeholder = canPhoto(kind) ? tr("Bu fotoğrafa not ekleyin…") : "";
      big.replaceChildren(el("span", tr("Yükleniyor…")));
      const src = await getImg(kind);
      big.replaceChildren(src ? el("img", "", {src, alt: tr(KIND[kind])}) : el("span", canPhoto(kind) ? tr("Henüz fotoğraf yok. \"Fotoğraf seç\" ile ekleyin.") : tr("Henüz fotoğraf yok")));
      acts.replaceChildren(...(canPhoto(kind) ? [pick, saveB, ...(m ? [del] : [])] : []));
    };
    pick.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => { const f = file.files?.[0]; file.value = ""; if (!f) return; err.textContent = "";
      try { pending = await resize(f); big.replaceChildren(el("img", "", {src: pending, alt: tr(KIND[kind])})); } catch (x) { err.textContent = x.message; } });
    saveB.addEventListener("click", async () => { saveB.disabled = true; err.textContent = "";
      try { item = await save({action: "photo", kind, note: note.value, ...(pending ? {image: pending} : {})}); pending = null; await show(); draw(); }
      catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); } finally { saveB.disabled = false; } });
    del.addEventListener("click", async () => { if (!confirm(tr("Fotoğraf ve notu kaldırılsın mı?"))) return;
      try { item = await save({action: "photo", kind, remove: true}); await show(); draw(); } catch (x) { err.textContent = x.message; } });
    form.append(el("h2", "📸 " + tr("Anı fotoğrafları")), nav, big, note, acts, err, file);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg); dlg.showModal(); show();
  }

  function endForm() {
    const form = el("form", "", {className: "pg-form"});
    const date = el("input", "", {type: "date", required: true, max: today(), min: item.mating, value: today() < item.birthMax ? today() : item.birth});
    const count = el("input", "", {type: "number", min: 1, max: 20, placeholder: "4", inputMode: "numeric", value: item.expected || ""});
    const l1 = el("label", tr("Doğum tarihi")); l1.append(date);
    const l2 = el("label", tr("Yavru sayısı")); l2.append(count);
    const healthy = el("input", "", {type: "number", min: 0, max: 20, inputMode: "numeric"});
    const l3 = el("label", tr("Sağlıklı yavru")); l3.append(healthy);
    const ok = el("button", "🍼 " + tr("Kaydet"), {type: "submit", className: "pg-btn pg-btn-go"});
    const err = el("p", "", {className: "pg-err", role: "alert"});
    form.append(l1, l2, l3, ok, err);
    form.addEventListener("submit", async e => {
      e.preventDefault(); ok.disabled = true;
      try { item = await save({action: "end", ended: date.value, litter: count.value || null, healthy: healthy.value === "" ? null : healthy.value}); draw(); }
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
      ...(item.healthy != null ? [el("span", "💚 " + item.healthy + " " + tr("sağlıklı") + (item.endedBy === "owner" ? " · " + tr("hasta sahibi bildirdi") : ""))] : item.endedBy === "owner" ? [el("span", tr("hasta sahibi bildirdi"))] : []),
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

    const tank = el("div", "", {className: "pg-tank", role: "progressbar", tabIndex: 0});
    tank.setAttribute("aria-valuemin", "0"); tank.setAttribute("aria-valuemax", String(total)); tank.setAttribute("aria-valuenow", String(Math.min(passed, total)));
    tank.setAttribute("aria-valuetext", Math.min(passed, total) + ". " + tr("gün") + " · " + tr(DEV_TEXT[devStage(patient.species, passed)][0]));
    const fill = el("div", "", {className: "pg-fill"});
    fill.innerHTML = wave + wave + "<i></i><i></i><i></i>";
    tank.append(fill);
    for (const d of [30, 45]) { const m = el("span", "", {className: "pg-mark"}); m.style.left = (d / total * 100) + "%"; tank.append(m); }
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = pct + "%"; }));
    // Gelişim aşamaları çubuğun içinde: geçmiş, bugün (nabız gibi atan) ve gelecek aşamalar; üzerine gelince / dokununca bilgi.
    const stages = DEV_DAYS[patient.species] || DEV_DAYS["Köpek"], nowStage = devStage(patient.species, passed);
    const tip = el("div", "", {className: "pg-tip", role: "tooltip"});
    const cursor = el("span", "", {className: "pg-cursor"}); tank.append(cursor);
    const sizeText = cm => cm ? "≈ " + String(cm).replace(".", ",") + " cm" : tr("mikroskobik");
    const stageHtml = (i, d) => { const [a, b, cm] = stages[i], [t, info] = DEV_TEXT[i];
      return `<div class="pg-tipart">${devArt(i, patient.species, 104)}</div><b>${d === undefined ? a + "–" + b + ". " + tr("gün") : d + ". " + tr("gün") + " · " + fmt(addDays(item.mating, d))}</b><small>${tr(t)}${d === undefined ? "" : " (" + a + "–" + b + ". " + tr("gün") + ")"}</small>${tr(info)}<br><em>${tr("Yaklaşık boy")}: ${sizeText(cm)}</em>`; };
    const showTip = (html, x) => { tip.innerHTML = html; tip.classList.add("on"); const cw = card.clientWidth, tw = Math.min(300, cw - 16), tr0 = tank.getBoundingClientRect(), cr = card.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(cw - tw - 8, x - cr.left - tw / 2)) + "px"; tip.style.top = (tr0.bottom - cr.top + 8) + "px"; };
    const hideTip = () => { tip.classList.remove("on"); cursor.classList.remove("on"); };
    stages.forEach(([a, b], i) => {
      const btn = el("button", "", {type: "button", className: "pg-dev " + (i < nowStage ? "past" : i === nowStage && !item.ended ? "now" : i === nowStage ? "past" : "future")});
      btn.style.left = ((a + b) / 2 / total * 100) + "%";
      btn.innerHTML = devArt(i, patient.species, 30);
      btn.setAttribute("aria-label", tr(DEV_TEXT[i][0]) + ", " + a + "–" + b + ". " + tr("gün"));
      const on = () => { const r = btn.getBoundingClientRect(); showTip(stageHtml(i), r.left + r.width / 2); };
      btn.addEventListener("pointerenter", e => { e.stopPropagation(); on(); });
      btn.addEventListener("focus", on); btn.addEventListener("blur", hideTip);
      btn.addEventListener("click", e => { e.stopPropagation(); on(); });
      tank.append(btn);
    });
    // Gün gün: çubuğun herhangi bir yerinde o günün tarihi ve aşaması; klavyede ← → ile gün değişir.
    let kbDay = Math.min(passed, total);
    const showDay = (d, x) => { d = Math.max(0, Math.min(total, d)); cursor.style.left = (d / total * 100) + "%"; cursor.classList.add("on"); showTip(stageHtml(devStage(patient.species, d), d), x); };
    const fromX = x => { const r = tank.getBoundingClientRect(); return Math.round((x - r.left) / r.width * total); };
    tank.addEventListener("pointermove", e => { if (e.target.closest(".pg-dev")) return; showDay(fromX(e.clientX), e.clientX); });
    tank.addEventListener("pointerdown", e => { if (e.target.closest(".pg-dev")) return; showDay(fromX(e.clientX), e.clientX); });
    tank.addEventListener("pointerleave", hideTip);
    tank.addEventListener("keydown", e => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault();
      kbDay = e.key === "Home" ? 0 : e.key === "End" ? total : kbDay + (e.key === "ArrowRight" ? 1 : -1); kbDay = Math.max(0, Math.min(total, kbDay));
      const r = tank.getBoundingClientRect(); showDay(kbDay, r.left + r.width * kbDay / total); });
    tank.addEventListener("blur", hideTip);
    // Yuva: doğacak yavrular (röntgen/ultrasonda sayılan; bilinmiyorsa soru işareti).
    const nest = el("div", "", {className: "pg-nest", tabIndex: 0});
    const n = item.expected || 0;
    nest.innerHTML = n ? Array.from({length: n}, (_, k) => baby(patient.species, k)).join("") + `<b>${n}</b>` : baby(patient.species, 0) + "<b>?</b>";
    if (n > 6) nest.classList.add("many");
    const nestHtml = `<b>${tr("Tahmini doğum")} · ${fmt(item.birth)}</b><small>${fmt(item.birthMin)} – ${fmt(item.birthMax)}</small>${n ? n + " " + tr(patient.species === "Kedi" ? "kedi yavrusu bekleniyor" : "köpek yavrusu bekleniyor") : tr("Yavru sayısı 45. gün röntgeninde belirlenir; sayıyı girince burada görünür.")}`;
    nest.setAttribute("aria-label", nest.textContent ? (n ? n + " " + tr("yavru") : tr("Yavru sayısı bilinmiyor")) : "");
    const nestOn = () => { const r = nest.getBoundingClientRect(); showTip(nestHtml, r.left + r.width / 2); };
    nest.addEventListener("pointerenter", nestOn); nest.addEventListener("focus", nestOn); nest.addEventListener("click", nestOn);
    nest.addEventListener("pointerleave", hideTip); nest.addEventListener("blur", hideTip);
    const track = el("div", "", {className: "pg-track"}); track.append(tank, nest);
    // Bugünkü aşama özeti (mobilde dokunmadan da okunur)
    const st0 = DEV_TEXT[nowStage], todayBox = el("div", "", {className: "pg-today"});
    todayBox.innerHTML = devArt(nowStage, patient.species, 96);
    todayBox.append(el("b", (passed > total ? tr("Doğum zamanı geldi") : Math.min(passed, total) + ". " + tr("gün") + " · " + tr(st0[0])) + " · " + sizeText(stages[nowStage][2])), el("p", tr(st0[1])));
    const devNote = el("p", tr("Gelişim bilgileri ortalamadır; ırka, yavru sayısına ve bireye göre birkaç gün değişebilir. Aşamaların üzerine gelin veya dokunun."), {className: "pg-note"});

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
    } else card.append(top, track, steps, todayBox, devNote, tip);
    card.append(checksBox(), memories());

    if (canWrite) {
      const actions = el("div", "", {className: "pg-actions"});
      const err = el("p", "", {className: "pg-err", role: "alert"});
      const run = async body => { err.textContent = ""; try { item = await save(body); draw(); } catch (x) { err.textContent = x.message || tr("Kaydedilemedi."); } };
      if (!item.ended) {
        const edit = el("button", "✎ " + tr("Tarihi düzenle"), {type: "button", className: "pg-btn"});
        edit.addEventListener("click", () => { actions.replaceChildren(startForm(item.mating)); });
        const done = el("button", "🍼 " + tr("Doğum gerçekleşti"), {type: "button", className: "pg-btn pg-btn-go"});
        done.addEventListener("click", () => actions.replaceChildren(endForm()));
        const exp = el("button", "🔢 " + tr(item.expected ? "Yavru sayısını düzenle" : "Beklenen yavru sayısı"), {type: "button", className: "pg-btn"});
        exp.addEventListener("click", () => actions.replaceChildren(expectedForm()));
        actions.append(edit, exp, done);
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
