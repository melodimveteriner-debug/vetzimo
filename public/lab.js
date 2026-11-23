import {fileZone} from "./file-zone.js";
import {operationApi} from "./operations.js";

const numberPattern="[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)";
const numberRE=new RegExp("^"+numberPattern+"$");
const rangeRE=new RegExp(`(?:^|\\s|\\[|\\()(${numberPattern})\\s*[-–—−]\\s*(${numberPattern})(?=$|\\s|[\\])])`);
const resultRE=new RegExp(`^([\\p{L}][\\p{L}\\d %./+()_-]{0,38}?)\\s*[:=]?\\s+(${numberPattern})(?=$|\\s|[HL↑↓*%])\\s*(.*)$`,"u");
const numeric=value=>numberRE.test(value.trim())?Number(value.trim().replace(",",".")):NaN;
const flagRE=/(?:^|\s)([HL])(?![\p{L}\d/])|[↑↓*]/giu;
const flagValue=marker=>({H:"H",L:"L","↑":"H","↓":"L","*":"*"})[marker.toUpperCase()];

export function parseLabText(raw) {
  const parsed=raw.split(/\r?\n/).flatMap(line=>{
    const pieces=line.trim().replace(/[⇧⬆▲]/g,"↑").replace(/[⇩⬇▼]/g,"↓")
      .split(/\s{3,}(?=[\p{L}][\p{L}\d %./+()_-]{0,28}\s+[:=]?\s*[+-]?\d)/u);
    return pieces.flatMap(piece=>{
      const initialFlag=piece.match(/^[↑↓*]/)?.[0];
      const result=piece.replace(/^[↑↓*]+\s*/,"").match(resultRE);
      if (!result) return [];
      const [,analyte,value,rawTail]=result;
      const tail=rawTail.replace(/^([HL])(?=\d)/,"$1 ").replace(/(\/[a-zµμ]+)(?=[+-]?\d)/gi,"$1 ");
      const range=tail.match(rangeRE);
      const flags=[...tail.matchAll(flagRE)].map(match=>flagValue(match[1]||match[0]));
      if (initialFlag) flags.push(flagValue(initialFlag));
      const marker=flags.includes("H")?"H":flags.includes("L")?"L":flags.includes("*")?"*":"";
      const unit=(range?tail.replace(range[0]," ").replace(/^[\s)\]]+/,""):tail).replace(flagRE," ").replace(/[\[\]()]/g,"").trim();
      if (!range && !marker && !/^(?:%|(?:[pfnµμumkcd]?g|[pfnµμumkcd]?mol|[µμuml]?L|U|IU)(?:\/[a-zµμ]+)?|mmHg|kPa|fL|pH|(?:[x×]?10\^?\d+)(?:\/[a-zµμ]+)?)$/i.test(unit)) return [];
      if (range && numeric(range[1])>numeric(range[2])) return [];
      const cells=[analyte.trim(),value,unit,range?.[1]||"",range?.[2]||""];
      if (marker) cells.push(marker);
      return [cells.join(" | ")];
    });
  });
  return [...new Set(parsed)].join("\n");
}

export function labValues(text) {
  return String(text||"").split(/\r?\n/).flatMap(line=>{
    const fields=line.split("|").map(value=>value.trim());
    if (fields.length<5 || fields.length>8 || !fields[0]) return [];
    const [,value,unit,min,max,marker,code,review]=fields;
    const v=numeric(value),low=numeric(min),high=numeric(max);
    const comparable=Number.isFinite(v)&&Number.isFinite(low)&&Number.isFinite(high)&&low<=high;
    const inferred=comparable?v<low?"L":v>high?"H":"=":"";
    const uncertain=!Number.isFinite(v) || (unit==="%" && (v<0 || v>100 || high>100)) || review==="?" || /^[<>≤≥]/.test(value) || marker==="#" || (["H","L"].includes(marker) && inferred && marker!==inferred);
    const status=!value?"unknown":marker==="H"?"high":marker==="L"?"low":comparable && v<low?"low":comparable && v>high?"high":marker==="*"?"flagged":comparable?"normal":"unknown";
    return [{fields:fields.slice(0,5),status,uncertain,code,marker}];
  }).sort((a,b)=>Number(!a.uncertain && !["low","high","flagged"].includes(a.status))-Number(!b.uncertain && !["low","high","flagged"].includes(b.status)));
}

export function labLayoutLines(blocks) {
  return (blocks||[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.map(line=>{
    let end=0;
    return line.words.map(word=>{
      const gap=word.bbox.x0-end;
      const height=word.bbox.y1-word.bbox.y0;
      const space=end && gap>Math.max(20,height*2.1)?"    ":" ";
      end=word.bbox.x1;
      const boldResult=/bold|black|heavy/i.test(word.font_name||"") && numberRE.test(word.text);
      return space+word.text+(boldResult?" *":"");
    }).join("").trim();
  }))).join("\n");
}

let enginePromise;
function getEngine() {
  if (!enginePromise) enginePromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="/vendor/ocr.js";
    script.onload=()=>resolve(window.Tesseract);
    script.onerror=()=>reject(Error("Yerel fotoğraf okuyucu açılamadı."));
    document.head.append(script);
  }).catch(error=>{enginePromise=null;throw error;});
  return enginePromise;
}

async function enhanceLabPhoto(photo,rotation) {
  const source=photo instanceof Blob?photo:await (await fetch(photo)).blob();
  const bitmap=await createImageBitmap(source);
  try {
    const scale=Math.min(1.6,3300/Math.max(bitmap.width,bitmap.height));
    const width=Math.round(bitmap.width*scale),height=Math.round(bitmap.height*scale);
    const canvas=document.createElement("canvas");
    [canvas.width,canvas.height]=rotation%180?[height,width]:[width,height];
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2,canvas.height/2);
    ctx.rotate(rotation*Math.PI/180);
    ctx.drawImage(bitmap,-width/2,-height/2,width,height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const hist=new Uint32Array(256);
    const data=pixels.data;
    for(let i=0;i<data.length;i+=4) {
      const value=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
      data[i]=data[i+1]=data[i+2]=value;
      hist[value]++;
    }
    const quantile=fraction=>{
      let total=0;
      for(let i=0;i<256;i++) if((total+=hist[i])>=data.length/4*fraction) return i;
      return 255;
    };
    const black=quantile(.012),white=quantile(.96);
    if(white-black>18) for(let i=0;i<data.length;i+=4) {
      data[i]=data[i+1]=data[i+2]=(data[i]-black)*255/(white-black);
    }
    const threshold=document.createElement("canvas");
    threshold.width=canvas.width;threshold.height=canvas.height;
    const ink=threshold.getContext("2d",{willReadFrequently:true});
    ink.fillStyle="#fff";ink.fillRect(0,0,canvas.width,canvas.height);
    const grayscale=new ImageData(new Uint8ClampedArray(data),canvas.width,canvas.height);
    ctx.putImageData(pixels,0,0);
    ink.filter="blur(12px)";
    ink.drawImage(canvas,0,0);
    const background=ink.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=0;i<data.length;i+=4) {
      const value=background[i]-grayscale.data[i]>12?0:255;
      data[i]=data[i+1]=data[i+2]=value;
    }
    ink.putImageData(pixels,0,0);
    return {enhanced:canvas,threshold};
  } finally {bitmap.close();}
}

export async function recognize(photo,progress=()=>{},{structured=false,rotation=0,signal}={}) {
  signal?.throwIfAborted();
  const engine=await getEngine();
  signal?.throwIfAborted();
  const worker=await engine.createWorker("eng",1,{
    workerPath:"/vendor/ocr-worker.js",corePath:"/vendor/tesseract-core-lstm.wasm.js",
    langPath:location.origin+"/vendor/lang",workerBlobURL:false,cacheMethod:"none",
  });
  let timeout,abortHandler;
  const aborted=new Promise((_,reject)=>{
    abortHandler=()=>reject(signal.reason||Error("Tarama durduruldu."));
    if(signal?.aborted)abortHandler();
    else signal?.addEventListener("abort",abortHandler,{once:true});
  });
  const run=async()=>{
    await worker.setParameters({preserve_interword_spaces:"1",user_defined_dpi:"300"});
    if(!structured) return (await worker.recognize(photo)).data.text;
    const [{mergeLabPasses},{enhanced,threshold}]=await Promise.all([
      import("./lab-report.js"),enhanceLabPhoto(photo,rotation),
    ]);
    const passes=[];
    for (const [index,[image,mode]] of [[rotation?enhanced:photo,"6"],[threshold,"6"],[enhanced,"3"],[threshold,"3"]].entries()) {
      progress(`Fotoğraf taranıyor · ${index+1}/4`);
      await worker.setParameters({tessedit_pageseg_mode:mode});
      passes.push((await worker.recognize(image,{}, {text:true,blocks:true})).data);
    }
    return {text:passes.map(pass=>pass.text).join("\n\n──────────\n\n"),
      values:mergeLabPasses(passes.map(pass=>labLayoutLines(pass.blocks)||pass.text)).slice(0,18000)};
  };
  try {
    return await Promise.race([aborted,run(),new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(Error("Tarama zaman aşımına uğradı. Daha net ve düz çekilmiş bir fotoğrafla tekrar deneyin.")),90000);
    })]);
  } finally {clearTimeout(timeout);signal?.removeEventListener("abort",abortHandler);await worker.terminate();}
}

export function labEditor(row,esc) {
  return `<section class="lab-editor wide"><header><h2>Laboratuvar ve görüntüleme eki</h2><p>Fotoğraf yükleyin. Yazılı laboratuvar raporlarında değerleri yerel olarak okuyup düzenleyebilirsiniz.</p></header>
  <div class="lab-tools">${fileZone({id:"labPhoto",label:"Tetkik fotoğrafı ekle"})}
  <button type="button" class="button" id="labRecognize" disabled>Fotoğrafı yazıya çevir</button><button type="button" class="button" id="labRotate" disabled>90° döndür</button></div>
  <img id="labPreview" class="attachment-preview" alt="Tetkik fotoğrafı" hidden>
  <p id="labProgress" role="status"></p><details id="labRawWrap" ${row?.ocrRaw?"":"hidden"}><summary>Fotoğraftan okunan ham metin</summary><pre id="labRaw">${esc(row?.ocrRaw||"")}</pre></details>
  <input type="hidden" name="ocrRaw" id="labRawInput" value="${esc(row?.ocrRaw||"")}">
  <label class="form-field"><span>Rapor türü</span><select id="labProfile" name="labProfile"><option value="">Seçiniz</option>${["HEM","BİYO","Karma"].map(value=>`<option ${row?.labProfile===value?"selected":""}>${value}</option>`).join("")}</select></label>
  <label class="form-field"><span>Sonuç tablosu</span><textarea id="labTableText" name="values" rows="6" maxlength="18000" placeholder="Test | Sonuç | Birim | Alt sınır | Üst sınır | H/L/* (varsa)">${esc(row?.values || "")}</textarea></label>
  <p class="lab-hint">Her belgeyi ayrı tetkik kaydında tarayın. Tablodaki hücreleri düzenleyebilirsiniz. Karşılaştırma işareti, eksik aralık veya okumalar arası fark olduğunda doğrulama uyarısı gösterilir.</p>
  <div id="labValueTable"></div>
  <label class="check-field"><input type="checkbox" name="verified" value="Evet" id="labVerified" ${row?.verified==="Evet"?"checked":""}> Tabloyu kaynak raporla kontrol ettim</label></section>`;
}

export function bindLab(root,row,editor,{esc,photo}) {
  const field=root.querySelector("#labTableText");
  const preview=root.querySelector("#labPreview");
  const upload=root.querySelector("#labPhoto");
  const run=root.querySelector("#labRecognize");
  const rotate=root.querySelector("#labRotate");
  let rotation=0;
  rotate.addEventListener("click",()=>{rotation=(rotation+90)%360;preview.dataset.rotation=rotation;});
  const progress=root.querySelector("#labProgress");
  const verified=root.querySelector("#labVerified");
  let activePhoto="";
  let originalPhoto=null;
  const display=value=>{
    activePhoto=value;
    if(value) preview.src=value;
    preview.hidden=!value;
    run.disabled=rotate.disabled=!value;
    rotation=0;preview.dataset.rotation=0;
  };
  const table=root.querySelector("#labValueTable");
  const draw=()=>{
    const rows=labValues(field.value);
    const counts=Object.fromEntries(["all","review","high","low","normal"].map(key=>[key,key==="all"?rows.length:rows.filter(row=>key==="review"?row.uncertain||row.status==="unknown":row.status===key).length]));
    table.innerHTML=rows.length?`<div class="lab-filters" role="group" aria-label="Sonuçları filtrele">${Object.entries({all:"Tümü",review:"Doğrulama",high:"Yüksek",low:"Düşük",normal:"Normal"}).map(([key,label])=>
      `<button type="button" class="button small" data-lab-filter="${key}" aria-pressed="${key==="all"}">${label} · ${counts[key]}</button>`).join("")}</div>
      <div class="table-wrap"><table><thead><tr><th>Parametre</th><th>Sonuç</th><th>Birim</th><th>Alt</th><th>Üst</th><th>Durum</th></tr></thead><tbody>${rows.map(({fields,status,code,uncertain})=>{
        const line=field.value.split("\n").findIndex(value=>fields.every((cell,index)=>cell===value.split("|")[index]?.trim()) && (!code || value.split("|")[6]?.trim()===code));
        return `<tr class="lab-${status}" data-status="${status}" data-review="${uncertain || status==="unknown"}">${fields.map((value,index)=>
          `<td><input aria-label="${esc(fields[0])} ${["parametre","sonuç","birim","alt sınır","üst sınır"][index]}" data-lab-cell="${line}:${index}" value="${esc(value)}"></td>`).join("")}
          <td>${{low:"↓ Düşük",high:"↑ Yüksek",normal:"Aralıkta",unknown:"Referans okunamadı",flagged:"İşaretli"}[status]}
          ${uncertain?'<small class="lab-review">⚠ Doğrulama gerekiyor</small>':""}</td></tr>`;
      }).join("")}</tbody></table></div>`:"";
  };
  table.addEventListener("click",event=>{
    const button=event.target.closest("[data-lab-filter]");
    if(!button) return;
    const key=button.dataset.labFilter;
    for (const item of table.querySelectorAll("[data-lab-filter]")) item.setAttribute("aria-pressed",String(item===button));
    for (const row of table.querySelectorAll("tbody tr")) row.hidden=key!=="all" && (key==="review"?row.dataset.review!=="true":row.dataset.status!==key);
  });
  table.addEventListener("change",event=>{
    const cell=event.target.dataset.labCell;
    if(!cell) return;
    const [line,index]=cell.split(":").map(Number);
    if(line<0) return;
    const lines=field.value.split("\n");
    const values=lines[line].split("|").map(value=>value.trim());
    values[index]=event.target.value.trim().replace(/[|\r\n]/g," ");
    lines[line]=values.join(" | ");
    field.value=lines.join("\n");verified.checked=false;draw();
  });
  field.addEventListener("input",()=>{verified.checked=false;draw();});
  draw();
  if (row?.id) void operationApi("lab-files/"+row.id).then(result=>{
    if(root.contains(preview) && !editor.labPhoto && !editor.photoPending) display(result.photo);
  }).catch(error=>{if(root.contains(progress)) progress.textContent=error.message;});
  upload.addEventListener("change",async()=>{
    if (!upload.files[0]) return;
    editor.photoPending=true;
    try { const selected=upload.files[0];editor.labPhoto=await photo(selected);originalPhoto=selected;display(editor.labPhoto);verified.checked=false;progress.textContent="Fotoğraf hazır."; }
    catch(error) { progress.textContent=error.message; }
    finally { editor.photoPending=false;upload.value=""; }
  });
  run.addEventListener("click",async()=>{
    if (!activePhoto) return;
    run.disabled=rotate.disabled=true;upload.disabled=true;editor.photoPending=true;
    progress.textContent="Fotoğraf okuyucu başlatılıyor…";
    try {
      const {text,values:parsed}=await recognize(originalPhoto || activePhoto,message=>{progress.textContent=message;},{structured:true,rotation});
      const raw=text.slice(0,6000);
      root.querySelector("#labRaw").textContent=raw;
      root.querySelector("#labRawInput").value=raw;
      const profile=root.querySelector("#labProfile");
      if (!profile.value) {
        const hem=/\b(?:WBC|RBC|MCHC|PLT)\b/i.test(text);
        const bio=/\b(?:ALT|GPT|CRE|GLU|BUN|GLOB)\b/i.test(text);
        profile.value=hem&&bio?"Karma":hem?"HEM":bio?"BİYO":"";
      }
      root.querySelector("#labRawWrap").hidden=false;
      if (parsed) { field.value=parsed;verified.checked=false;draw(); }
      progress.textContent=parsed?"Tarama taslağı hazır. Eksik veya yanlış hücreleri kaynak rapordan kontrol edip düzeltin.":"Tabloya dönüştürülebilecek güvenilir satır bulunamadı. Ham metni kontrol edin veya tabloyu elle girin.";
    } catch(error) { progress.textContent=error.message || "Fotoğraf okunamadı."; }
    finally { run.disabled=rotate.disabled=false;upload.disabled=false;editor.photoPending=false; }
  });
}
