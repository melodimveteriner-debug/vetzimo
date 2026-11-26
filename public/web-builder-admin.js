// VetZimo klinik panelinin içinde açıldığında: kendi üst çubuğunu gizle, yüksekliği panele bildir,
// düzenleyici dışına giden bağlantıları üst pencerede (VetZimo) ya da yayındaki siteyi yeni sekmede aç.
if (window.parent !== window) {
    try {
        if (window.parent.location.origin === location.origin) {
            document.body.classList.add("builder-embedded");
            const sendHeight = () => window.parent.postMessage({type: "clinic-module-height", height: Math.ceil(document.documentElement.scrollHeight)}, location.origin);
            new ResizeObserver(sendHeight).observe(document.body);
            addEventListener("load", sendHeight);
            document.addEventListener("click", event => {
                const a = event.target.closest("a[href]");
                if (!a || a.target) return;
                const url = new URL(a.href, location.href);
                if (url.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener"; return; }
                if (url.pathname.startsWith("/web-sitem/onizleme")) { a.target = "_blank"; return; }
                if (!url.pathname.startsWith("/web-sitem")) a.target = "_top";
            }, true);
        }
    } catch {}
}
const notice = document.querySelector("#builder-error");

function showError(message) {
    notice.textContent = message;
    notice.hidden = false;
    notice.focus();
}

function mapsUrl(value) {
    const text = value.trim();
    if (!text.startsWith("<")) return text;
    const template = document.createElement("template");
    template.innerHTML = text;
    const frame = template.content.firstElementChild;
    const source = frame?.localName === "iframe" && frame.getAttribute("src");
    if (!source) throw new Error("Google Haritalar — Paylaş → Harita yerleştir → HTML’yi kopyala adımlarını izleyin.");
    return source;
}

if (notice && typeof SubmitEvent !== "undefined" && "submitter" in SubmitEvent.prototype) {
    document.addEventListener("submit", async event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.matches(".editor") || !/^\/web-sitem(?:\/merkez\/[\w-]+)?$/.test(new URL(form.action).pathname)) return;
        event.preventDefault();
        if (form.getAttribute("aria-busy") === "true") return;
        const data = new FormData(form);
        if (event.submitter?.name) data.append(event.submitter.name, event.submitter.value);
        notice.hidden = true;
        form.setAttribute("aria-busy", "true");
        try {
            const maps = data.get("maps");
            if (typeof maps === "string") data.set("maps", mapsUrl(maps));
            let hasFile = false;
            for (const [name, value] of [...data]) {
                if (!(value instanceof File)) continue;
                if (value.name === "") data.delete(name);
                else hasFile = true;
            }
            const response = await fetch(form.action, {
                method: "POST",
                headers: {"X-VeTNeT-Editor": "1"},
                body: hasFile ? data : new URLSearchParams(data)
            });
            const result = response.headers.get("content-type")?.includes("application/json")
                ? await response.json() : null;
            if (response.ok && typeof result?.location === "string" && result.location.startsWith(new URL(form.action).pathname + "?")) {
                window.location.assign(result.location);
                return;
            }
            if (response.status === 403 && !result?.error) {
                showError("Hosting güvenlik filtresi kaydetme isteğini engelledi. İletişim adımında Google Haritalar için yerleştirme URL’sini kullanın. Dosya seçtiyseniz dosyasız kaydetmeyi deneyin. Uyarı sürerse bu sayfanın adresini ve işlem saatini hosting desteğine iletin.");
            } else {
                showError(result?.error || (response.status === 413
                    ? "Dosya sunucunun boyut sınırını aşıyor. Daha küçük bir görsel seçin veya görsel olmadan kaydedin."
                    : "Bilgiler kaydedilemedi. Biraz sonra tekrar deneyin."));
            }
        } catch (error) {
            showError(error.message.startsWith("Google Haritalar") ? error.message
                : "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
        } finally {
            form.removeAttribute("aria-busy");
        }
    });
}


document.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.files.length) return;
    const hint = input.closest(".upload-box")?.querySelector("[data-file-name]");
    if (hint) hint.textContent = input.files[0].name;
});

document.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== "palette") return;
    const suffix = input.value === "b" ? "-b-preview.webp?v=38" : "-preview.webp?v=38";
    for (const thumbnail of input.form.querySelectorAll("[data-theme-preview]")) {
        thumbnail.src = "/web-themes/" + thumbnail.dataset.themePreview + suffix;
    }
});

document.addEventListener("click", event => {
    const button = event.target.closest("[data-format]");
    if (!button) return;
    const body = button.form?.elements.body;
    if (!(body instanceof HTMLTextAreaElement)) return;
    const marks = {bold:"[b]", italic:"[i]", underline:"[u]", heading:"## ", list:"- "};
    const tool = button.dataset.format;
    const mark = marks[tool];
    const start = body.selectionStart;
    const end = body.selectionEnd;
    const block = tool === "heading" || tool === "list";
    const lineStart = start > 0 ? body.value.lastIndexOf("\n", start - 1) + 1 : 0;
    body.focus();
    if (block) {
        const lines = body.value.slice(lineStart, end).split("\n");
        const result = lines.map(line => line.startsWith(mark) ? line : mark + line).join("\n");
        body.setRangeText(result, lineStart, end, "end");
    } else {
        const close = mark.replace("[", "[/");
        body.setRangeText(mark + body.value.slice(start, end) + close, start, end);
        body.setSelectionRange(start + mark.length, end + mark.length);
    }
    body.dispatchEvent(new Event("input", {bubbles:true}));
});
