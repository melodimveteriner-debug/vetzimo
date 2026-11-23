const imageIcon='<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>';
export function fileZone({id="",name="",label}) {
  return `<label class="photo-zone file-drop" data-file-zone><span>${imageIcon}<strong>${label}</strong><small>Fotoğrafı buraya bırakın veya alana dokunun</small><small>JPG, PNG, WebP · En fazla 12 MB</small><small data-file-name aria-live="polite"></small></span>
    <input type="file" ${id?`id="${id}"`:""} ${name?`name="${name}"`:""} accept="image/jpeg,image/png,image/webp" aria-label="${label}"></label>`;
}

export function bindFileZones(root,notify) {
  for (const type of ["dragover","dragleave","drop"]) root.addEventListener(type,event=>{
    const zone=event.target.closest("[data-file-zone]");
    if (!zone || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    zone.classList.toggle("dragging",type==="dragover");
    if (type!=="drop") return;
    const input=zone.querySelector('input[type="file"]');
    const [file]=event.dataTransfer.files;
    if (!file || input.disabled) return;
    if (event.dataTransfer.files.length!==1) { notify("Bir seferde bir fotoğraf ekleyin."); return; }
    try {
      input.files=event.dataTransfer.files;
      input.dispatchEvent(new Event("change",{bubbles:true}));
    } catch { notify("Fotoğraf eklemek için seçim alanına dokunun."); }
  });
  root.addEventListener("change",event=>{
    if (event.target.type!=="file") return;
    const name=event.target.closest("[data-file-zone]")?.querySelector("[data-file-name]");
    if (name) name.textContent=event.target.files[0]?.name || "";
  });
}
