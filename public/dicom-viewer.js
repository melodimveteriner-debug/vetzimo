// VetZimo DICOM görüntüleyici: röntgen, ultrason, BT ve MR dosyalarını tamamen tarayıcıda açar.
// Dosya sunucuya gönderilmez; hekim pencere/seviye ayarını yapıp "Tetkike ekle" dediğinde yalnız görüntü (JPEG) tetkik kaydına eklenir.
// Desteklenen aktarım sözdizimleri: sıkıştırılmamış (örtük/açık VR, küçük/büyük uç) ve JPEG temel (1.2.840.10008.1.2.4.50/51).

const IMPLICIT = "1.2.840.10008.1.2", EXPLICIT_LE = "1.2.840.10008.1.2.1", EXPLICIT_BE = "1.2.840.10008.1.2.2";
const JPEG_BASELINE = ["1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51"];
const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC", "UN", "UR", "UT", "UV"]);
const TEXT_TAGS = {
  "00020010": "transfer", "00080060": "modality", "00080020": "studyDate", "00081030": "study", "0008103E": "series",
  "00180015": "bodyPart", "00280004": "photometric", "00281050": "windowCenter", "00281051": "windowWidth",
  "00281052": "intercept", "00281053": "slope", "00280008": "frames", "00080070": "manufacturer",
  "00280030": "pixelSpacing", "00181164": "imagerPixelSpacing"
};
const NUMBER_TAGS = { "00280002": "samples", "00280010": "rows", "00280011": "columns", "00280100": "bitsAllocated", "00280101": "bitsStored", "00280103": "signed", "00280006": "planar" };

export class DicomError extends Error {}

const hex = (group, element) => (group.toString(16).padStart(4, "0") + element.toString(16).padStart(4, "0")).toUpperCase();

export function parseDicom(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  if (bytes.length > 132 && String.fromCharCode(...bytes.subarray(128, 132)) === "DICM") offset = 132;
  else if (!(bytes.length > 8 && (view.getUint16(0, true) === 0x0002 || view.getUint16(0, true) === 0x0008))) {
    throw new DicomError("Bu dosya DICOM biçiminde görünmüyor.");
  }
  const info = {};
  let mode = { explicit: true, little: true };
  // Başlıksız (DICM işaretsiz) eski dosyalarda VR alanı harf değilse kodlama örtük VR'dir.
  if (offset === 0 && !/^[A-Z]{2}$/.test(String.fromCharCode(bytes[4], bytes[5]))) mode = { explicit: false, little: true };
  const text = (start, length) => {
    let value = "";
    for (let i = start; i < start + length && i < bytes.length; i++) value += String.fromCharCode(bytes[i]);
    return value.replace(/\0/g, "").trim();
  };
  const number = (start, length, little) => length >= 2 ? view.getUint16(start, little) : 0;
  const readElement = (position, current) => {
    const little = current.little;
    const group = view.getUint16(position, little), element = view.getUint16(position + 2, little);
    let vr = "", length, header;
    if (group === 0xFFFE) return { group, element, vr: "", length: view.getUint32(position + 4, little), header: 8 };
    if (current.explicit) {
      vr = String.fromCharCode(bytes[position + 4], bytes[position + 5]);
      if (LONG_VR.has(vr)) { length = view.getUint32(position + 8, little); header = 12; }
      else { length = view.getUint16(position + 6, little); header = 8; }
    } else { length = view.getUint32(position + 4, little); header = 8; }
    return { group, element, vr, length, header };
  };
  // Tanımsız uzunluktaki dizileri (SQ) atlar; iç içe ögeleri aynı kodlamayla dolaşır.
  const skipUndefined = (position, current) => {
    while (position + 8 <= bytes.length) {
      const item = readElement(position, { ...current, explicit: false });
      if (item.group === 0xFFFE && item.element === 0xE0DD) return position + 8;
      if (item.group === 0xFFFE && item.element === 0xE000) {
        if (item.length === 0xFFFFFFFF) {
          position += 8;
          while (position + 8 <= bytes.length) {
            const inner = readElement(position, current);
            if (inner.group === 0xFFFE && inner.element === 0xE00D) { position += 8; break; }
            position += inner.header;
            position = inner.length === 0xFFFFFFFF ? skipUndefined(position, current) : position + inner.length;
          }
        } else position += 8 + item.length;
      } else throw new DicomError("DICOM dizisi okunamadı.");
    }
    return position;
  };
  while (offset + 8 <= bytes.length) {
    const current = mode;
    const groupPeek = view.getUint16(offset, true);
    const element = readElement(offset, groupPeek === 0x0002 ? { explicit: true, little: true } : current);
    const tag = hex(element.group, element.element);
    const start = offset + element.header;
    if (tag === "7FE00010") {
      info.pixelOffset = start;
      info.pixelLength = element.length;
      info.pixelUndefined = element.length === 0xFFFFFFFF;
      break;
    }
    if (element.length === 0xFFFFFFFF) { offset = skipUndefined(start, groupPeek === 0x0002 ? { explicit: true, little: true } : current); continue; }
    if (TEXT_TAGS[tag]) info[TEXT_TAGS[tag]] = text(start, element.length);
    if (NUMBER_TAGS[tag]) info[NUMBER_TAGS[tag]] = number(start, element.length, groupPeek === 0x0002 ? true : current.little);
    offset = start + element.length;
    if (groupPeek === 0x0002 && offset + 2 <= bytes.length && view.getUint16(offset, true) !== 0x0002) {
      const syntax = info.transfer || EXPLICIT_LE;
      mode = { explicit: syntax !== IMPLICIT, little: syntax !== EXPLICIT_BE };
    }
  }
  if (!info.pixelOffset) throw new DicomError("Dosyada görüntü verisi yok (yalnız rapor veya yapılandırılmış belge olabilir).");
  info.little = mode.little;
  info.samples ||= 1; info.bitsAllocated ||= 16; info.bitsStored ||= info.bitsAllocated;
  info.frameCount = Math.max(1, parseInt(info.frames || "1", 10) || 1);
  info.compressed = !!info.pixelUndefined;
  return { info, bytes, view };
}

// Kapsüllenmiş piksel verisinden ilk karenin parçalarını toplar.
function firstFrameFragments(dicom) {
  const { info, bytes, view } = dicom;
  let position = info.pixelOffset;
  const fragments = [];
  let offsets = [];
  let index = 0;
  while (position + 8 <= bytes.length) {
    const group = view.getUint16(position, true), element = view.getUint16(position + 2, true), length = view.getUint32(position + 4, true);
    if (group !== 0xFFFE) break;
    if (element === 0xE0DD) break;
    const start = position + 8;
    if (index === 0) {
      for (let i = 0; i + 4 <= length; i += 4) offsets.push(view.getUint32(start + i, true));
    } else fragments.push(bytes.subarray(start, start + length));
    position = start + length;
    index++;
  }
  if (info.frameCount > 1 && offsets.length > 1) {
    let total = 0, take = [];
    for (const fragment of fragments) { if (total >= offsets[1]) break; take.push(fragment); total += fragment.length + 8; }
    return take;
  }
  return info.frameCount > 1 ? fragments.slice(0, 1) : fragments;
}

export async function decodeDicom(dicom) {
  const { info, bytes, view } = dicom;
  const rows = info.rows, columns = info.columns;
  if (!rows || !columns) throw new DicomError("Görüntü boyutu okunamadı.");
  if (info.compressed) {
    if (!JPEG_BASELINE.includes(info.transfer)) {
      throw new DicomError("Bu DICOM dosyası tarayıcının açamadığı bir sıkıştırmayla kaydedilmiş (" + (info.transfer || "bilinmiyor") + "). Cihazdan 'sıkıştırılmamış' DICOM ya da JPEG olarak dışa aktarın.");
    }
    const fragments = firstFrameFragments(dicom);
    const blob = new Blob(fragments, { type: "image/jpeg" });
    const bitmap = await createImageBitmap(blob).catch(() => { throw new DicomError("JPEG sıkıştırılmış görüntü çözülemedi."); });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const values = new Float32Array(bitmap.width * bitmap.height);
    for (let i = 0; i < values.length; i++) values[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return { width: bitmap.width, height: bitmap.height, values, rgb: info.samples === 3 ? rgba : null, min: 0, max: 255 };
  }
  const pixels = rows * columns, frameBytes = pixels * info.samples * (info.bitsAllocated / 8);
  const start = info.pixelOffset;
  if (start + frameBytes > bytes.length) throw new DicomError("Görüntü verisi eksik veya bozuk.");
  if (info.samples === 3) {
    const rgba = new Uint8ClampedArray(pixels * 4), values = new Float32Array(pixels);
    for (let i = 0; i < pixels; i++) {
      const at = info.planar === 1 ? [start + i, start + pixels + i, start + 2 * pixels + i] : [start + i * 3, start + i * 3 + 1, start + i * 3 + 2];
      rgba[i * 4] = bytes[at[0]]; rgba[i * 4 + 1] = bytes[at[1]]; rgba[i * 4 + 2] = bytes[at[2]]; rgba[i * 4 + 3] = 255;
      values[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    }
    return { width: columns, height: rows, values, rgb: rgba, min: 0, max: 255 };
  }
  const slope = parseFloat(info.slope || "1") || 1, intercept = parseFloat(info.intercept || "0") || 0;
  const values = new Float32Array(pixels);
  const mask = info.bitsStored < 32 ? (1 << info.bitsStored) - 1 : 0xFFFFFFFF;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < pixels; i++) {
    let raw;
    if (info.bitsAllocated === 8) raw = bytes[start + i];
    else if (info.bitsAllocated === 16) {
      raw = view.getUint16(start + i * 2, info.little) & mask;
      if (info.signed && raw & (1 << (info.bitsStored - 1))) raw -= 1 << info.bitsStored;
    } else if (info.bitsAllocated === 32) raw = info.signed ? view.getInt32(start + i * 4, info.little) : view.getUint32(start + i * 4, info.little);
    else throw new DicomError("Desteklenmeyen piksel derinliği: " + info.bitsAllocated + " bit.");
    const value = raw * slope + intercept;
    values[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { width: columns, height: rows, values, rgb: null, min, max };
}

export function defaultWindow(info, image) {
  const first = value => parseFloat(String(value || "").split("\\")[0]);
  let center = first(info.windowCenter), width = first(info.windowWidth);
  if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 0) {
    center = (image.min + image.max) / 2;
    width = Math.max(1, image.max - image.min);
  }
  return { center, width };
}

export function render(image, canvas, { center, width, invert, monochrome1 }) {
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  const output = context.createImageData(image.width, image.height);
  const low = center - width / 2, scale = 255 / Math.max(1, width);
  const flip = !!invert !== !!monochrome1;
  for (let i = 0; i < image.values.length; i++) {
    if (image.rgb && !flip && width >= 255 && center === 127.5) {
      output.data[i * 4] = image.rgb[i * 4]; output.data[i * 4 + 1] = image.rgb[i * 4 + 1]; output.data[i * 4 + 2] = image.rgb[i * 4 + 2];
    } else {
      let value = (image.values[i] - low) * scale;
      value = value < 0 ? 0 : value > 255 ? 255 : value;
      if (flip) value = 255 - value;
      output.data[i * 4] = output.data[i * 4 + 1] = output.data[i * 4 + 2] = value;
    }
    output.data[i * 4 + 3] = 255;
  }
  context.putImageData(output, 0, 0);
}

const MODALITY = { CR: "Röntgen", DX: "Röntgen", RF: "Röntgen", MG: "Röntgen", US: "Ultrason", MR: "MR", CT: "Tomografi" };
const formatDate = value => /^\d{8}$/.test(value || "") ? value.slice(6, 8) + "." + value.slice(4, 6) + "." + value.slice(0, 4) : "";

export function summary(info) {
  return [
    info.modality && "DICOM · " + info.modality + (MODALITY[info.modality] ? " (" + MODALITY[info.modality] + ")" : ""),
    formatDate(info.studyDate) && "Çekim tarihi " + formatDate(info.studyDate),
    info.bodyPart && "Bölge " + info.bodyPart,
    info.study && "Çalışma " + info.study,
    info.series && "Seri " + info.series,
    info.rows && info.columns && info.columns + " × " + info.rows + " piksel",
    (info.pixelSpacing || info.imagerPixelSpacing) && "Piksel aralığı " + String(info.pixelSpacing || info.imagerPixelSpacing).replace("\\", " × ") + " mm",
  ].filter(Boolean).join(" · ");
}
export const modalityKind = info => MODALITY[info.modality] || "";

// Görüntüleyici penceresi: pencere/seviye, ters çevirme, döndürme, yakınlaştırma; "Tetkike ekle" bir JPEG File döndürür.
export function openViewer(file, { onAttach, esc = value => String(value) } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "dicom-dialog";
  dialog.setAttribute("aria-label", "DICOM görüntüleyici");
  dialog.innerHTML = `<header><div><strong>DICOM görüntüleyici</strong><small data-dicom-meta>${esc(file.name)}</small></div>
    <button type="button" class="button small" data-dicom-close aria-label="Kapat">Kapat</button></header>
    <div class="dicom-stage" data-dicom-stage><canvas data-dicom-canvas aria-label="DICOM görüntüsü"></canvas><p data-dicom-status role="status">Dosya açılıyor…</p></div>
    <div class="dicom-controls">
      <label>Seviye (merkez)<input type="range" data-dicom-center></label>
      <label>Pencere (genişlik)<input type="range" data-dicom-width></label>
      <label>Yakınlaştır<input type="range" data-dicom-zoom min="1" max="4" step="0.25" value="1"></label>
      <div class="dicom-buttons"><button type="button" class="button small" data-dicom-invert aria-pressed="false">Ters çevir</button>
      <button type="button" class="button small" data-dicom-rotate>90° döndür</button>
      <button type="button" class="button small" data-dicom-reset>Sıfırla</button></div>
    </div>
    <p class="dicom-hint">Görüntünün üstünde sürükleyerek de pencere ve seviyeyi ayarlayabilirsiniz. Dosya sunucuya gönderilmez; yalnız eklediğiniz görüntü tetkik kaydına kaydedilir.</p>
    <footer><button type="button" class="button" data-dicom-close>Vazgeç</button><button type="button" class="button primary" data-dicom-attach disabled>Tetkike ekle</button></footer>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const canvas = $("[data-dicom-canvas]"), status = $("[data-dicom-status]");
  const centerInput = $("[data-dicom-center]"), widthInput = $("[data-dicom-width]"), zoomInput = $("[data-dicom-zoom]");
  let image, info, base, state = { center: 0, width: 1, invert: false, monochrome1: false }, rotation = 0;
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelectorAll("[data-dicom-close]").forEach(button => button.addEventListener("click", close));
  dialog.addEventListener("close", () => dialog.remove());
  const draw = () => {
    render(image, canvas, state);
    canvas.style.transform = `rotate(${rotation}deg) scale(${zoomInput.value})`;
  };
  const sync = () => { centerInput.value = state.center; widthInput.value = state.width; };
  (async () => {
    try {
      const dicom = parseDicom(await file.arrayBuffer());
      info = dicom.info;
      image = await decodeDicom(dicom);
      base = defaultWindow(info, image);
      state = { ...base, invert: false, monochrome1: info.photometric === "MONOCHROME1" };
      const span = Math.max(1, image.max - image.min);
      centerInput.min = image.min - span * 0.5; centerInput.max = image.max + span * 0.5; centerInput.step = span / 400;
      widthInput.min = Math.max(1, span / 200); widthInput.max = span * 2; widthInput.step = span / 400;
      sync(); draw();
      status.hidden = true;
      $("[data-dicom-meta]").textContent = summary(info) || file.name;
      $("[data-dicom-attach]").disabled = false;
    } catch (error) {
      status.textContent = error instanceof DicomError ? error.message : "DICOM dosyası açılamadı: " + error.message;
      status.classList.add("dicom-error");
    }
  })();
  centerInput.addEventListener("input", () => { state.center = Number(centerInput.value); draw(); });
  widthInput.addEventListener("input", () => { state.width = Number(widthInput.value); draw(); });
  zoomInput.addEventListener("input", draw);
  $("[data-dicom-invert]").addEventListener("click", event => { state.invert = !state.invert; event.currentTarget.setAttribute("aria-pressed", String(state.invert)); draw(); });
  $("[data-dicom-rotate]").addEventListener("click", () => { rotation = (rotation + 90) % 360; draw(); });
  $("[data-dicom-reset]").addEventListener("click", () => { if (!image) return; state = { ...state, ...base, invert: false }; rotation = 0; zoomInput.value = 1; sync(); draw(); });
  let drag = null;
  canvas.addEventListener("pointerdown", event => { if (!image) return; drag = { x: event.clientX, y: event.clientY, center: state.center, width: state.width }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", event => {
    if (!drag) return;
    const span = Math.max(1, image.max - image.min) / 300;
    state.width = Math.max(1, drag.width + (event.clientX - drag.x) * span);
    state.center = drag.center + (event.clientY - drag.y) * span;
    sync(); draw();
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  $("[data-dicom-attach]").addEventListener("click", () => {
    const out = document.createElement("canvas");
    const turned = rotation % 180 !== 0;
    out.width = turned ? canvas.height : canvas.width;
    out.height = turned ? canvas.width : canvas.height;
    const context = out.getContext("2d");
    context.translate(out.width / 2, out.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    out.toBlob(blob => {
      if (!blob) return;
      onAttach?.(new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" }), { info, summary: summary(info), kind: modalityKind(info) });
      close();
    }, "image/jpeg", 0.92);
  });
  dialog.showModal();
  return dialog;
}
