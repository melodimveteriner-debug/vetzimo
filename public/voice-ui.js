import {createVoiceActivity,prepareVoiceSamples,voiceLevel,VOICE_PAUSE_MS} from "./voice-audio.js?v=20261121-r51";
import {spokenNumber,voiceIntent,voiceNavigation,voiceText} from "./voice-commands.js?v=20261121-r51";
import {normalizeClinicalSpeech,voiceTerms} from "./voice-terms.js?v=20261121-r51";

const microphone = '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-3 0h6" stroke-linecap="round"/></svg>';
const idle = "Komutu yazın veya mikrofonu basılı tutarak konuşun.";
const textInputTypes = new Set(["text","search","email","url","tel","number"]);

function isDictationField(field) {
  if (!(field instanceof HTMLElement) || !field.closest("#main") ||
      field.closest("[hidden],[inert],[data-voice-settings],#customerPasswordForm") ||
      field.matches(":disabled,[readonly]")) return false;
  return field instanceof HTMLTextAreaElement ||
    (field instanceof HTMLInputElement && textInputTypes.has(field.type) &&
      !/password|one-time-code|totp|otp|verificationcode/i.test(field.autocomplete+" "+field.name+" "+field.id));
}

function insertDictation(target, text) {
  const {field,value,start,end}=target;
  if (!isDictationField(field) || value!==field.value) return false;
  if (field.type==="number") {
    const transcript=text.trim().replace(/[.!?]$/,"").replace(",",".");
    const number=/^-?\d+(?:\.\d+)?$/.test(transcript) ? transcript : spokenNumber(transcript);
    if (number===null) return false;
    field.value=number;
    if (!field.validity.valid) {field.value=value;return false;}
  } else {
    const before=value.slice(0,start), after=value.slice(end);
    const prefix=before && !/\s$/.test(before) && !/^[,.;!?]/.test(text) ? " " : "";
    const suffix=after && !/^\s|^[,.;!?]/.test(after) ? " " : "";
    const available=field.maxLength<0 ? Infinity : field.maxLength-before.length-after.length;
    const addition=(prefix+text+suffix).slice(0,Math.max(0,available));
    if (!addition.trim()) return false;
    field.value=before+addition+after;
    if (field.selectionStart!==null) field.setSelectionRange(start+addition.length,start+addition.length);
  }
  field.dispatchEvent(new Event("input",{bubbles:true}));
  return true;
}

export function mountVoice({allowed,sections,scope,patients,owners,terms,describe,patientCard,current,run}) {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.hidden = true;
  launcher.className = "voice-launcher";
  launcher.setAttribute("aria-label","Sesli komut · Basılı tut ve konuş");
  launcher.innerHTML = microphone;
  const dialog = document.createElement("aside");
  dialog.hidden = true;
  dialog.className = "voice-dock";
  dialog.setAttribute("aria-label","Sesli komut durumu");
  dialog.innerHTML = `<div class="voice-dock-head">
    <div class="voice-signal" aria-hidden="true"><span class="voice-mic-static">${microphone}</span>
      <span class="voice-wave"><i></i><i></i><i></i><i></i></span><span class="voice-spinner"></span></div>
    <div class="voice-dock-copy"><strong data-voice-title>Sesli Komut</strong><p class="voice-status" role="status"></p></div>
    <button type="button" class="icon-button voice-dismiss" data-close aria-label="Sesli komutu kapat">×</button>
  </div>
  <div data-meter hidden><meter aria-label="Mikrofon seviyesi" min="0" max="1" value="0"></meter></div>
  <div class="voice-output" hidden></div>
  <div class="voice-actions" hidden>
    <button type="button" class="button small" data-stop>Şimdi bitir</button>
    <button type="button" class="button small" data-cancel>İptal</button>
  </div>
  <form class="voice-form" hidden>
    <label for="voiceInput">Algılanan komut</label>
    <textarea id="voiceInput" rows="2" maxlength="1000"></textarea>
    <button class="button small" data-run>Komutu çalıştır</button>
  </form>`;
  const settings=document.createElement("section");
  settings.className="panel voice-settings";
  settings.dataset.voiceSettings="";
  settings.innerHTML=`<h2>Sesli Komut Ayarları</h2>
    <p>Bir yazı alanı seçin, mikrofonu basılı tutarak konuşun ve bırakın. Metin seçili alana yazılır. Alan seçili değilse konuşmanız komut olarak işlenir. Ses bu cihazda işlenir.</p>
    <label>Ses modeli <select data-model>
      <option value="base">Whisper Base · dengeli</option>
      <option value="small">Whisper Small · ayrı kurulum</option>
      <option value="tiny">Whisper Tiny · daha hafif</option>
    </select></label>
    <label>Mikrofon testi sessizlik süresi <select data-pause>
      <option value="1000">1 saniye · hızlı</option><option value="1500">1,5 saniye</option><option value="2000" selected>2 saniye</option><option value="3000">3 saniye</option><option value="4000">4 saniye</option>
    </select></label>
    <div class="actions">
      <button class="button small" type="button" data-mic-test>Mikrofonu test et</button>
      <button class="button small" type="button" data-typed>Yazılı komut gir</button>
    </div>
    <label>Terim sözlüğünde ara <input type="search" data-term-search placeholder="Ör. hemogram veya ilaç adı"></label>
    <ul data-terms hidden></ul>
    <label><input type="checkbox" data-diagnostics> Bu sekmede tanıma dökümlerini kaydet</label>
    <p>Dökümler bu sekmenin belleğinde tutulur. Klinik adları ve notları içerebilir.</p>
    <div class="actions">
      <button type="button" class="button small" data-clear-diagnostics>Kayıtları temizle</button>
      <button type="button" class="button small" data-export-diagnostics>Tanıma raporunu indir</button>
    </div>
    <p data-diagnostic-summary hidden></p>
    <pre data-diagnostic-output hidden></pre>`;
  document.body.append(launcher,dialog);
  const query = selector => dialog.querySelector(selector) ?? settings.querySelector(selector);
  const command = query("#voiceInput");
  const output = query(".voice-output");
  const status = query(".voice-status");
  const form = query(".voice-form");
  const controls = query(".voice-actions");
  const stop = query("[data-stop]");
  const cancel = query("[data-cancel]");
  const submit = query("[data-run]");
  const profile=query("[data-model]");
  const pauseSetting=query("[data-pause]");
  const level=query("meter");
  const micTest=query("[data-mic-test]");
  const diagnostics=query("[data-diagnostics]");
  const diagnosticOutput=query("[data-diagnostic-output]");
  const sessions=[];
  let entry, diagnosticScope;
  try {
    const saved=localStorage.getItem("vetnet-voice-model");
    if (["tiny","base","small"].includes(saved)) profile.value=saved;
    const pause=localStorage.getItem("vetnet-voice-pause-r26");
    if (["1000","1500","2000","3000","4000"].includes(pause)) pauseSetting.value=pause;
  } catch {}
  function renderDiagnostics() {
    diagnosticOutput.hidden=!sessions.length;
    const recent=sessions.at(-1);
    const summary=query("[data-diagnostic-summary]");
    const timed=sessions.filter(row=>Number.isFinite(row.decodeMs));
    summary.hidden=!sessions.length;
    summary.textContent=sessions.length+" deneme · "+sessions.filter(row=>row.correction).length+" düzeltme"+
      (timed.length ? " · Ortalama çözümleme "+Math.round(timed.reduce((total,row)=>total+row.decodeMs,0)/timed.length)+" ms" : "");
    diagnosticOutput.textContent=recent ? JSON.stringify(recent,null,2) : "";
    query("[data-export-diagnostics]").disabled=!sessions.length;
  }
  function resetDiagnostics() {
    entry=undefined;
    sessions.length=0;
    renderDiagnostics();
  }
  function recordOutcome(outcome) {
    if (!entry) return;
    entry.outcome=outcome;
    renderDiagnostics();
  }
  function noteTranscript(data) {
    entry=undefined;
    if (!diagnostics.checked || !active()) return;
    entry={model:data.profile ?? profile.value,raw:data.text ?? "",decodeMs:data.decodeMs,
      normalized:normalizeClinicalSpeech(data.text ?? ""),outcome:data.error ? "motor-hatasi" : "metne-cevrildi"};
    sessions.push(entry);
    if (sessions.length>40) sessions.shift();
    renderDiagnostics();
  }
  renderDiagnostics();

  const say = value => {status.textContent = value;};
  let context, openedScope, openedRoute, recorder, stream, worker, timer, mode="idle", audioTarget, sequence=0;
  let meter, meterTimer, warmTimer, selectedField, pinnedField, heldInput;
  let commandMode=false;

  function setMode(next) {
    mode=next;
    dialog.dataset.voiceMode=next;
    query("[data-voice-title]").textContent=next==="recording" ? (audioTarget ? "Dikte dinleniyor" : "Dinleniyor") :
      next==="processing" ? "İşleniyor" : next==="permission" ? "Mikrofon açılıyor" : "Sesli Komut";
    launcher.setAttribute("aria-pressed",String(next==="recording" && heldInput!==undefined));
    launcher.title="Basılı tutun, konuşun ve bırakın";
    stop.hidden=next!=="recording" || heldInput!==undefined;
    cancel.hidden=next==="idle";
    controls.hidden=next==="idle";
    form.hidden=next!=="idle" || !commandMode;
    submit.disabled=next!=="idle";
    profile.disabled=next!=="idle";
    pauseSetting.disabled=next!=="idle";
    micTest.disabled=next!=="idle";
    query("[data-meter]").hidden=next!=="recording";
    if (next!=="recording") level.value=0;
  }

  function clearOutput() {
    output.replaceChildren();
    output.hidden=true;
  }

  function stopMeter() {
    clearInterval(meterTimer);
    if (meter) void meter.close().catch(()=>{});
    meter = undefined;
  }

  function clearAudio({resetWorker=false} = {}) {
    sequence++;
    heldInput=undefined;
    clearTimeout(timer);
    stopMeter();
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state!=="inactive") recorder.stop();
    }
    recorder = undefined;
    stream?.getTracks().forEach(track=>track.stop());
    stream = undefined;
    if (resetWorker) {
      worker?.terminate();
      worker = undefined;
    }
    setMode("idle");
  }

  function close(resetWorker=false) {
    dialog.hidden=true;
    commandMode=false;
    clearAudio({resetWorker:resetWorker || mode==="processing"});
    clearTimeout(warmTimer);
    if (worker) warmTimer=setTimeout(()=>{
      worker?.terminate();
      worker=undefined;
    },300000);
    clearOutput();
    command.value="";
    context=openedScope=openedRoute=audioTarget=undefined;
  }

  function active() {
    return !dialog.hidden && allowed() && scope()===openedScope && location.hash===openedRoute;
  }

  function revealCommand() {
    commandMode=true;
    form.hidden=false;
  }

  function resultText(label) {
    output.hidden=false;
    const paragraph=document.createElement("p");
    paragraph.textContent=label;
    output.append(paragraph);
  }

  function action(label,onClick) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "button small";
    item.textContent = label;
    item.addEventListener("click",()=>{
      if (active() && mode==="idle") onClick();
    });
    return item;
  }

  function show(result) {
    clearOutput();
    recordOutcome(result.open || result.items ? "sonuc-gosterildi" : "sonuc-yok-veya-yetki-kisiti");
    say(result.message);
    if (result.items?.length) {
      const list = document.createElement("ul");
      for (const row of result.items) {
        const item = document.createElement("li");
        item.append(row.open ? action(row.label,()=>{close(); row.open();}) : document.createTextNode(row.label));
        list.append(item);
      }
      output.hidden=false;
      output.append(list);
    }
    if (result.open) {output.hidden=false;output.append(action(result.label || "Kaydı aç",()=>{close();result.open();}));}
  }

  function select(intent,patient,automatic=false) {
    if (!patients().some(row=>row.id===patient.id)) return say("Hasta artık bu çalışma alanında görünmüyor.");
    context = {patient:patient.id,kind:intent.kind || ""};
    if (intent.type !== "examDraft") {
      const result = run(intent,patient);
      if ((automatic || intent.type==="patient") && result.open && ["patient","labs","exam","prescriptions","patientAgenda"].includes(intent.type)) {
        recordOutcome("hasta-sekmesi-acma-istegi");
        close();
        result.open();
        return;
      }
      return show(result);
    }
    const result=run(intent,patient);
    if (!result.open) return say(result.message || "Muayene formunu açma yetkiniz yok.");
    recordOutcome("muayene-taslagi-istegi");
    close();
    result.open();
  }

  function choiceCard(patient,intent,automatic) {
    const card=action("",()=>select(intent,patient,automatic));
    card.className="voice-patient-card";
    card.setAttribute("aria-label",describe(patient));
    const {name,owner,photo,photoLabel,detail}=patientCard(patient);
    const thumb=document.createElement(photo ? "img" : "span");
    thumb.className="voice-patient-photo";
    if (photo) {
      thumb.src=photo;
      thumb.alt=photoLabel;
      thumb.loading="lazy";
    } else {
      thumb.textContent=name.slice(0,1);
      thumb.setAttribute("aria-hidden","true");
    }
    const copy=document.createElement("span");
    const title=document.createElement("strong");
    title.textContent=name;
    const subtitle=document.createElement("span");
    subtitle.textContent=owner ? "Hasta sahibi · "+owner : "Hasta sahibi bilgisi yok";
    copy.append(title,subtitle);
    if (detail) {
      const meta=document.createElement("small");
      meta.textContent=detail;
      copy.append(meta);
    }
    card.append(thumb,copy);
    return card;
  }

  function selectOwner(owner) {
    const result=run({type:"owner"},owner);
    if (!result.open) {recordOutcome("sahip-karti-acilmadi");return say(result.message);}
    recordOutcome("sahip-karti-acma-istegi");
    close();
    result.open();
  }

  function execute(automatic=false) {
    if (!active() || mode!=="idle") return;
    clearOutput();
    commandMode=false;
    form.hidden=true;
    const intent=voiceIntent(command.value,patients(),context || current(),owners());
    const hasRecordTarget=intent.type!=="patient" && ((intent.patients?.length ?? 0)>0 || (intent.owners?.length ?? 0)>0);
    const destinations=hasRecordTarget ? [] : voiceNavigation(command.value,sections());
    const navigate=id=>{
      const destination=sections().find(section=>section.id===id);
      if (!destination || !active()) return;
      recordOutcome("kategori-acildi");
      close();
      destination.open();
    };
    if (destinations.length) {
      if (entry) entry.intent="navigation";
      if (destinations.length===1) return navigate(destinations[0].id);
      recordOutcome("secim-bekliyor");
      say("Birden fazla bölüm eşleşti.");
      output.hidden=false;
      for (const destination of destinations) output.append(action(destination.label,()=>navigate(destination.id)));
      return;
    }
    if (entry) {
      entry.input=command.value;
      entry.normalized=normalizeClinicalSpeech(command.value);
      entry.intent=intent.type;
      entry.candidates=(intent.patients?.length ?? 0)+(intent.owners?.length ?? 0);
      entry.correction=command.value!==entry.raw;
    }
    recordOutcome(intent.type==="unknown" ? "komut-anlasilmadi" : "komut-cozumlendi");
    if (intent.type==="unknown") {revealCommand();return say("Komut tanınmadı. Metni düzeltebilir veya yeniden konuşabilirsiniz.");}
    if (!intent.patients) return show(run(intent));
    const customers=intent.owners ?? [];
    const matches=intent.patients.length+customers.length;
    if (!matches) {recordOutcome("kayit-bulunamadi");revealCommand();return say("Eşleşen hasta bulunamadı. Hasta sahibiyle hastanın adını birlikte yazın veya söyleyin.");}
    if (matches===1 && !intent.requiresChoice) {
      if (customers.length) return selectOwner(customers[0]);
      return select(intent,intent.patients[0],automatic);
    }
    recordOutcome("secim-bekliyor");
    say(intent.requiresChoice ? "Sesli metin tam eşleşmedi. Aşağıdan doğru hastayı seçin." : "Birden fazla kayıt eşleşti. Doğru kaydı seçin.");
    output.hidden=false;
    for (const owner of customers.slice(0,12)) output.append(action("Hasta sahibi · "+owner.name,()=>selectOwner(owner)));
    const list=document.createElement("div");
    list.className="voice-patient-list";
    list.setAttribute("aria-label","Eşleşen hastalar");
    list.append(...[...intent.patients].sort((a,b)=>a.name.localeCompare(b.name,"tr") ||
      (patientCard(a).owner || "").localeCompare(patientCard(b).owner || "","tr"))
      .slice(0,30).map(patient=>choiceCard(patient,intent,automatic)));
    output.append(list);
    if (intent.patients.length>30) resultText("Sonucu daraltmak için hasta sahibinin adını da ekleyin.");
  }

  async function toSamples(chunks,mime) {
    const audio = new AudioContext();
    try {
      const decoded = await audio.decodeAudioData(await new Blob(chunks,{type:mime}).arrayBuffer());
      const length = Math.min(480000,Math.floor(decoded.duration*16000));
      if (length<4000) return null;
      const converter = new OfflineAudioContext(1,length,16000);
      const source = converter.createBufferSource();
      source.buffer = decoded;
      source.connect(converter.destination);
      source.start();
      const samples = (await converter.startRendering()).getChannelData(0);
      return prepareVoiceSamples(samples,16000);
    } finally {
      await audio.close();
    }
  }

  function speechWorker() {
    if (!worker) {
      worker=new Worker("/voice-local-worker.js?v=r29",{type:"module"});
      worker.onmessage=onSpeech;
      worker.onerror=()=>onSpeech({data:{error:true}});
    }
    return worker;
  }

  async function start(testOnly=false, target=undefined) {
    if (!active() || mode!=="idle") return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext || !window.WebAssembly) {
      heldInput=undefined;
      say("Bu tarayıcıda yerel mikrofon kullanılamıyor. Komutu yazabilirsiniz.");
      return;
    }
    const attempt = ++sequence;
    audioTarget=target;
    commandMode=false;
    setMode("permission");
    say("Mikrofon izni bekleniyor…");
    try {
      const granted = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,noiseSuppression:true,echoCancellation:true,autoGainControl:true},video:false});
      if (!active() || attempt!==sequence) {
        granted.getTracks().forEach(track=>track.stop());
        return;
      }
      stream = granted;
      recorder = new MediaRecorder(stream);
      const chunks = [];
      const activity = createVoiceActivity();
      const pauseMs=Number(pauseSetting.value) || VOICE_PAUSE_MS;
      const mime = recorder.mimeType;
      recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
      recorder.onerror = () => {
        if (attempt!==sequence) return;
        clearAudio({resetWorker:true});
        say("Mikrofon kaydı kesildi. Tekrar deneyebilir veya yazabilirsiniz.");
      };
      recorder.onstop = async () => {
        if (attempt!==sequence) return;
        clearTimeout(timer);
        stopMeter();
        stream?.getTracks().forEach(track=>track.stop());
        stream = undefined;
        recorder = undefined;
        if (!active()) {close(true);return;}
        if (testOnly) {
          clearAudio();
          say(activity.heard ? "Mikrofon testi tamamlandı. Konuşma algılandı." : "Mikrofon testi tamamlandı. Konuşma algılanmadı.");
          return;
        }
        setMode("processing");
        say("Ses, cihazda metne dönüştürülüyor…");
        timer = setTimeout(()=>{
          clearAudio({resetWorker:true});
          say("Ses çözümleme zaman aşımına uğradı. Daha kısa bir komut deneyin.");
        },120000);
        try {
          const samples = await toSamples(chunks,mime);
          if (!active() || attempt!==sequence) return;
          if (!samples) {
            clearAudio();
            say("Yeterli ses algılanmadı. Tekrar deneyin veya komutu yazın.");
            return;
          }
          speechWorker().postMessage({samples,profile:profile.value},[samples.buffer]);
        } catch {
          clearAudio({resetWorker:true});
          say("Ses dosyası tarayıcıda okunamadı. Tekrar deneyin veya komutu yazın.");
        }
      };
      recorder.start();
      setMode("recording");
      const listening=testOnly ? "Dinliyorum… Konuşabilirsiniz." :
        (target ? "Dikte dinleniyor. Bitince mikrofonu bırakın." : "Dinliyorum. Bitince mikrofonu bırakın.");
      say(listening);
      if (!testOnly) {
        try {speechWorker().postMessage({prepare:true,profile:profile.value});} catch {}
      }
      timer = setTimeout(()=>{
        if (recorder?.state!=="recording") return;
        if (testOnly) recorder.stop();
        else {
          clearAudio();
          say("Kayıt 29 saniyeyi aştı. Daha kısa bölümler halinde konuşun.");
        }
      },29000);
      try {
        meter = new AudioContext();
        const analyser = meter.createAnalyser();
        analyser.fftSize = 1024;
        meter.createMediaStreamSource(stream).connect(analyser);
        const frame = new Float32Array(analyser.fftSize);
        let lastNotice;
        void meter.resume().catch(()=>{});
        meterTimer = setInterval(()=>{
          if (recorder?.state!=="recording" || meter?.state!=="running") return;
          analyser.getFloatTimeDomainData(frame);
          const amplitude=voiceLevel(frame);
          level.value=Math.min(1,amplitude*9);
          if (!testOnly) return;
          const pause=activity.sample(performance.now(),amplitude);
          if (pause >= pauseMs) {
            recorder.stop();
            return;
          }
          const remaining = !activity.heard || pause < 700 ? 0 : Math.ceil((pauseMs - pause)/1000);
          if (remaining !== lastNotice) {
            lastNotice = remaining;
            say(remaining ? `Sessizlik · ${remaining} sn` : listening);
          }
        },40);
      } catch {
        stopMeter();
        say(listening);
      }
    } catch {
      if (attempt!==sequence || !active()) return;
      clearAudio();
      say("Mikrofon açılamadı. Site iznini ve mikrofonu kontrol edin veya komutu yazın.");
    }
  }

  function onSpeech({data}) {
    if (!active() || mode!=="processing") return;
    if (data.stage==="load") {
      say("Yerel ses modeli yükleniyor · %"+data.progress);
      return;
    }
    if (data.stage==="transcribe") {
      say("Konuşma metne çevriliyor…");
      return;
    }
    const target=audioTarget;
    clearAudio({resetWorker:Boolean(data.error)});
    if (!target) noteTranscript(data);
    if (!data.text) {
      say(data.error ? "Ses modeli çalıştırılamadı. Genel Ayarlar’dan modeli kontrol edin." : "Anlaşılır ses algılanmadı. Tekrar konuşabilirsiniz.");
      return;
    }
    const words=voiceText(data.text).split(" ");
    const repeated=words.length>=6 && new Set(words).size<=words.length/3;
    command.value=data.text.slice(0,command.maxLength);
    if (repeated) {
      recordOutcome("metin-dogrulamasi-bekliyor");
      if (!target) revealCommand();
      say("Konuşma net çözümlenemedi. Metni kontrol edin veya tekrar konuşun.");
      return;
    }
    if (!target) {execute(true);return;}
    if (pinnedField!==target.field || !insertDictation(target,data.text.trim())) {
      say("Dikte bu alana eklenemedi. Alanı seçip yeniden deneyin.");
      resultText(data.text);
      return;
    }
    say("Dikte seçili alana eklendi.");
    if (target.field.isConnected && (document.activeElement===launcher || document.activeElement===stop)) target.field.focus({preventScroll:true});
  }

  function openDock() {
    if (!allowed()) return false;
    if (mode!=="idle") close(true);
    clearTimeout(warmTimer);
    openedScope=scope();
    openedRoute=location.hash;
    if (diagnosticScope!==openedScope) {
      resetDiagnostics();
      diagnostics.checked=false;
      diagnosticScope=openedScope;
    }
    entry=undefined;
    clearOutput();
    dialog.hidden=false;
    setMode("idle");
    return true;
  }

  function rememberField(event) {
    if (!(event.target instanceof Element) ||
        event.target.closest(".voice-launcher,.voice-dock,[data-voice-settings]")) return;
    const field=event.target.closest("input,textarea") ?? (event.type==="pointerdown" ? event.target.closest("label")?.control : undefined);
    selectedField=isDictationField(field) ? field : undefined;
    pinnedField=selectedField;
  }

  document.addEventListener("focusin",rememberField,true);
  document.addEventListener("pointerdown",rememberField,true);
  function beginHold(input) {
    if (mode!=="idle" || heldInput!==undefined || !openDock()) return false;
    const field=isDictationField(document.activeElement) ? document.activeElement : selectedField;
    const target=isDictationField(field) ? {field,value:field.value,
      start:field.selectionStart ?? field.value.length,end:field.selectionEnd ?? field.value.length} : undefined;
    pinnedField=target?.field;
    heldInput=input;
    void start(false,target);
    return true;
  }
  function endHold(input,canceled=false) {
    if (heldInput!==input) return;
    heldInput=undefined;
    if (canceled || mode==="permission") {
      clearAudio();
      say(canceled ? "Ses kaydı iptal edildi." : "Mikrofon hazır olana kadar basılı tutun.");
    } else if (recorder?.state==="recording") {
      recorder.stop();
    }
  }
  launcher.addEventListener("pointerdown",event=>{
    if (!event.isPrimary || event.button!==0) return;
    event.preventDefault();
    if (beginHold(event.pointerId)) launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener("pointerup",event=>endHold(event.pointerId));
  launcher.addEventListener("pointercancel",event=>endHold(event.pointerId,true));
  launcher.addEventListener("lostpointercapture",event=>endHold(event.pointerId,true));
  launcher.addEventListener("contextmenu",event=>event.preventDefault());
  launcher.addEventListener("keydown",event=>{
    if (![" ","Enter"].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) beginHold(event.key);
  });
  window.addEventListener("keyup",event=>{
    if (heldInput!==event.key) return;
    event.preventDefault();
    endHold(event.key);
  });
  window.addEventListener("blur",()=>{
    if (heldInput!==undefined && mode!=="permission") endHold(heldInput,true);
  });
  document.addEventListener("keydown",event=>{
    if (event.key==="Escape" && !dialog.hidden) close(true);
  });
  query("[data-close]").addEventListener("click",()=>close());
  micTest.addEventListener("click",()=>{if (openDock()) void start(true);});
  query("[data-typed]").addEventListener("click",()=>{
    if (!openDock()) return;
    say(idle);
    revealCommand();
    command.focus({preventScroll:true});
  });
  profile.addEventListener("change",()=>{
    try {localStorage.setItem("vetnet-voice-model",profile.value);} catch {}
  });
  pauseSetting.addEventListener("change",()=>{
    try {localStorage.setItem("vetnet-voice-pause-r26",pauseSetting.value);} catch {}
  });
  diagnostics.addEventListener("change",()=>{if (!diagnostics.checked) resetDiagnostics();});
  query("[data-clear-diagnostics]").addEventListener("click",resetDiagnostics);
  query("[data-export-diagnostics]").addEventListener("click",()=>{
    if (!allowed() || diagnosticScope!==scope() || !sessions.length) return;
    const link=document.createElement("a");
    link.href=URL.createObjectURL(new Blob([JSON.stringify(sessions,null,2)],{type:"application/json"}));
    link.download="vetnet-ses-tanima-raporu.json";
    link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  });
  query("[data-term-search]").addEventListener("input",event=>{
    const list=query("[data-terms]");
    list.replaceChildren();
    const term=voiceText(event.target.value);
    if (term.length<2 || !allowed()) {list.hidden=true;return;}
    const seen=new Set();
    for (const row of [...voiceTerms,...terms()]) {
      const label=[row.term,...(row.alternatives ?? [])].filter(Boolean).join(" · ");
      const key=label+" | "+row.module;
      if (!label || seen.has(key) || !voiceText(label).includes(term)) continue;
      seen.add(key);
      const li=document.createElement("li");
      li.textContent=label+" · "+row.module;
      list.append(li);
      if (seen.size===12) break;
    }
    list.hidden=!seen.size;
  });
  stop.addEventListener("click",()=>{if (recorder?.state==="recording") recorder.stop();});
  cancel.addEventListener("click",()=>{clearAudio({resetWorker:true});say("Ses işlemi iptal edildi.");});
  form.addEventListener("submit",event=>{event.preventDefault();execute(true);});
  document.addEventListener("visibilitychange",()=>{
    if (document.hidden && mode!=="idle") {
      clearAudio({resetWorker:true});
      say("Sekme arka plana geçtiği için ses işlemi durduruldu.");
    }
  });
  window.addEventListener("pagehide",()=>close(true));
  return function refresh(settingsMount) {
    if (settingsMount && !settingsMount.contains(settings)) settingsMount.append(settings);
    launcher.hidden = !allowed();
    if (diagnosticScope && (!allowed() || diagnosticScope!==scope())) {
      resetDiagnostics();
      diagnostics.checked=false;
      diagnosticScope=undefined;
      query("[data-term-search]").value="";
      query("[data-terms]").replaceChildren();
    }
    if (!dialog.hidden && !active()) close(true);
  };
}
