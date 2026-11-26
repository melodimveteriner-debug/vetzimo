// İş Takibi (Kanban): klinik ekibinin görevleri. Sütunlar arasında sürükle-bırak (masaüstü) ya da "Taşı" menüsü (dokunmatik),
// sorumlu/öncelik/son tarih, hasta bağlantısı ve kontrol listesi. Kayıtlar "tasks" koleksiyonunda tutulur.

function el(tag, text = "", props = {}) {
  const node = document.createElement(tag);
  if (text !== "") node.textContent = text;
  Object.assign(node, props);
  return node;
}
export const COLUMNS = [["Yapılacak", "todo"], ["Devam ediyor", "doing"], ["Bekliyor", "waiting"], ["Tamamlandı", "done"]];
const PRIORITIES = ["Düşük", "Normal", "Yüksek", "Acil"];
const json = s => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toLocaleUpperCase("tr");

export const TEAM = "@team";
export function mountTasksBoard(root, api) {
  const {tr} = api;
  const isManager = () => !!api.isManager?.();
  const whoLabel = a => a === TEAM ? tr("Tüm ekip") : a;
  // Görev kime verildiyse yalnızca o ilerletir/tamamlar; "Tüm ekip" ya da sorumlusu olmayan görevi herkes ilerletebilir.
  const canProgress = t => api.canWrite && (!t.assignee || t.assignee === TEAM || t.assignee === api.me());
  const canEdit = t => api.canWrite && (!t || canProgress(t) || isManager() || t.createdBy === api.me());
  const lockText = t => tr("Bu görevi yalnızca şu kişi ilerletebilir ve tamamlayabilir:") + " " + t.assignee;
  const lang = document.documentElement.lang || "tr";
  const ui = {who: sessionGet("vz-task-who") || "", text: "", archive: false, drag: null};
  function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
  const today = new Date().toISOString().slice(0, 10);

  const tasks = () => api.list().filter(t => ui.archive ? t.status === "Arşiv" : t.status !== "Arşiv")
    .filter(t => !ui.who || (ui.who === "@me" ? t.assignee === api.me() || t.assignee === TEAM : t.assignee === ui.who))
    .filter(t => !ui.text || [t.title, t.notes, t.assignee, api.patientName(t.patient)].some(v => String(v || "").toLocaleLowerCase("tr").includes(ui.text.toLocaleLowerCase("tr"))));
  const order = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || String(a.due || "9").localeCompare(String(b.due || "9"));

  async function save(next, prior, action) {
    try { await api.save(next, prior, tr(action)); draw(); return true; }
    catch (e) { api.toast(e.message); draw(); return false; }
  }
  function move(task, status, before = null) {
    if (task.status !== status && !canProgress(task)) { api.toast(lockText(task)); return; }
    const column = api.list().filter(t => t.status === status && t.id !== task.id).sort(order);
    const index = before ? column.findIndex(t => t.id === before) : column.length;
    const prev = column[index - 1], nextT = column[index];
    const o = prev && nextT ? ((Number(prev.order) || 0) + (Number(nextT.order) || 0)) / 2 : prev ? (Number(prev.order) || 0) + 1000 : nextT ? (Number(nextT.order) || 0) - 1000 : Date.now() / 1000;
    if (task.status === status && String(task.order) === String(o)) return;
    const next = {...task, status, order: String(Math.round(o * 1000) / 1000)};
    if (status === "Tamamlandı" && task.status !== "Tamamlandı") next.doneAt = new Date().toISOString();
    if (status !== "Tamamlandı") delete next.doneAt;
    save(next, task, task.status === status ? "Görev sırası değişti" : "Görev taşındı");
  }

  function card(t) {
    const c = el("article", "", {className: "tb-card", tabIndex: 0});
    c.dataset.id = t.id;
    c.dataset.priority = t.priority || "Normal";
    if (canProgress(t)) c.draggable = true;
    const title = el("strong", t.title); title.setAttribute("data-ui-preserve", ""); title.dir = "auto";
    c.append(title);
    const meta = el("div", "", {className: "tb-meta"});
    if (t.priority && t.priority !== "Normal") meta.append(el("span", tr(t.priority), {className: "tb-pri"}));
    if (t.due) {
      const d = el("span", new Intl.DateTimeFormat(lang, {day: "numeric", month: "short"}).format(new Date(t.due + "T12:00:00")), {className: "tb-due"});
      d.dataset.state = t.status === "Tamamlandı" ? "done" : t.due < today ? "late" : t.due === today ? "today" : "";
      meta.append(d);
    }
    const list = json(t.checklist);
    if (list.length) meta.append(el("span", "☑ " + list.filter(x => x.done).length + "/" + list.length, {className: "tb-check"}));
    if (t.patient) { const p = el("a", "🐾 " + api.patientName(t.patient), {href: "#patient/" + encodeURIComponent(t.patient), className: "tb-patient"}); p.setAttribute("data-ui-preserve", ""); meta.append(p); }
    if (t.assignee) { const a = el("span", t.assignee === TEAM ? "👥" : initials(t.assignee), {className: "tb-avatar", title: whoLabel(t.assignee)}); meta.append(a); }
    c.append(meta);
    c.addEventListener("click", e => { if (!e.target.closest("a")) editor(t); });
    c.addEventListener("keydown", e => { if (e.key === "Enter") editor(t); });
    return c;
  }

  function column([label, key]) {
    const items = tasks().filter(t => t.status === label).sort(order);
    const col = el("section", "", {className: "tb-col"});
    col.dataset.status = label;
    col.dataset.key = key;
    const head = el("header");
    head.append(el("h2", tr(label)), el("span", String(items.length), {className: "tb-count"}));
    col.append(head);
    if (api.canWrite && !ui.archive && key !== "done") {
      const form = el("form", "", {className: "tb-quick"});
      const input = el("input", "", {placeholder: "+ " + tr("Görev ekle"), maxLength: 200});
      input.setAttribute("aria-label", tr("Görev ekle") + " · " + tr(label));
      form.append(input);
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        input.disabled = true;
        const first = api.list().filter(t => t.status === label).sort(order)[0];
        const ok = await save({id: crypto.randomUUID(), title, status: label, priority: "Normal", assignee: ui.who && ui.who !== "@me" ? ui.who : ui.who === "@me" ? api.me() : "", order: String(first ? (Number(first.order) || 0) - 1000 : Date.now() / 1000)}, null, "Görev eklendi");
        if (ok) root.querySelector(`.tb-col[data-key="${key}"] .tb-quick input`)?.focus();
      });
      col.append(form);
    }
    const body = el("div", "", {className: "tb-list"});
    body.append(...items.map(card));
    if (!items.length) body.append(el("p", tr("Görev yok"), {className: "tb-empty"}));
    col.append(body);
    return col;
  }

  function editor(task) {
    const isNew = !task;
    const t = task || {id: crypto.randomUUID(), title: "", status: "Yapılacak", priority: "Normal", assignee: "", order: String(Date.now() / 1000)};
    const dialog = el("dialog", "", {className: "tb-dialog"});
    const form = el("form");
    const field = (label, input, wide = false) => { const l = el("label", "", {className: wide ? "wide" : ""}); l.append(el("span", tr(label)), input); return l; };
    const title = el("input", "", {value: t.title, required: true, maxLength: 200});
    const notes = el("textarea", "", {value: t.notes || "", rows: 4, maxLength: 3000});
    const status = el("select"); for (const [l] of [...COLUMNS, ["Arşiv"]]) status.append(el("option", tr(l), {value: l, selected: t.status === l}));
    const priority = el("select"); for (const p of PRIORITIES) priority.append(el("option", tr(p), {value: p, selected: (t.priority || "Normal") === p}));
    const assignee = el("select");
    const names = api.staff().filter(n => n && n !== TEAM);
    if (t.assignee && t.assignee !== TEAM && !names.includes(t.assignee)) names.unshift(t.assignee);
    assignee.append(el("option", tr("Seçin"), {value: ""}), el("option", "👥 " + tr("Tüm ekip"), {value: TEAM}));
    for (const n of names) { const o = el("option", n, {value: n}); o.setAttribute("data-ui-preserve", ""); assignee.append(o); }
    assignee.value = t.assignee || "";
    const progress = isNew || canProgress(t), editable = isNew || canEdit(t);
    const staff = el("p", progress ? "" : "🔒 " + lockText(t), {className: "tb-muted tb-lock wide"});
    staff.hidden = progress;
    if (!progress) status.disabled = true;
    if (!editable) assignee.disabled = true;
    const due = el("input", "", {type: "date", value: t.due || ""});
    const patient = el("input", "", {value: t.patient ? api.patientName(t.patient) : "", placeholder: tr("Hasta adı (isteğe bağlı)"), autocomplete: "off"});
    let patientId = t.patient || "";
    const results = el("div", "", {className: "tb-results"});
    patient.addEventListener("input", () => {
      patientId = "";
      clearTimeout(patient.t);
      patient.t = setTimeout(() => {
        results.replaceChildren(...api.searchPatients(patient.value).map(p => {
          const b = el("button", p.label, {type: "button"});
          b.addEventListener("click", () => { patientId = p.id; patient.value = p.name; results.replaceChildren(); });
          return b;
        }));
      }, 200);
    });
    const checklist = json(t.checklist);
    const checks = el("div", "", {className: "tb-checks"});
    const drawChecks = () => {
      checks.replaceChildren(...checklist.map((item, i) => {
        const row = el("div", "", {className: "tb-check-row"});
        const box = el("input", "", {type: "checkbox", checked: !!item.done, disabled: !progress});
        box.addEventListener("change", () => { item.done = box.checked; });
        const text = el("input", "", {value: item.text, maxLength: 200});
        text.addEventListener("input", () => { item.text = text.value; });
        const rm = el("button", "×", {type: "button", className: "button small ghost"});
        rm.setAttribute("aria-label", tr("Kaldır"));
        rm.addEventListener("click", () => { checklist.splice(i, 1); drawChecks(); });
        row.append(box, text, rm);
        return row;
      }));
      const add = el("button", "+ " + tr("Madde ekle"), {type: "button", className: "button small"});
      add.addEventListener("click", () => { if (checklist.length < 30) { checklist.push({text: "", done: false}); drawChecks(); checks.querySelector(".tb-check-row:last-of-type input:not([type])")?.focus(); } });
      checks.append(add);
    };
    drawChecks();
    const grid = el("div", "", {className: "tb-form"});
    grid.append(field("Görev", title, true), field("Durum", status), field("Öncelik", priority), field("Sorumlu", assignee), field("Son tarih", due),
      field("Hasta", patient, true), results, field("Açıklama", notes, true), field("Kontrol listesi", checks, true), staff);
    const error = el("p", "", {className: "form-error", role: "alert"});
    const foot = el("div", "", {className: "tb-foot"});
    const cancel = el("button", tr("Vazgeç"), {type: "button", className: "button"});
    const ok = el("button", tr("Kaydet"), {type: "submit", className: "button primary"});
    cancel.addEventListener("click", () => dialog.close());
    if (!isNew && api.canWrite && t.status !== "Arşiv" && (progress || isManager())) {
      const arch = el("button", tr("Arşivle"), {type: "button", className: "button ghost tb-left"});
      arch.addEventListener("click", async () => { dialog.close(); await save({...t, status: "Arşiv"}, t, "Görev arşivlendi"); });
      foot.append(arch);
    }
    if (api.canWrite && editable) foot.append(cancel, ok); else foot.append(cancel);
    form.append(el("h2", tr(isNew ? "Yeni görev" : "Görevi düzenle")), grid, error, foot);
    if (!isNew && t.createdBy) form.append(el("p", [t.createdBy, t.createdAt ? new Intl.DateTimeFormat(lang, {dateStyle: "medium", timeStyle: "short"}).format(new Date(t.createdAt)) : ""].filter(Boolean).join(" · "), {className: "tb-muted"}));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!api.canWrite || !editable) return;
      if (!title.value.trim()) { error.textContent = tr("Görev adını yazın."); return; }
      if (patient.value.trim() && !patientId) { error.textContent = tr("Hastayı listeden seçin ya da alanı boşaltın."); return; }
      const next = {...t, title: title.value.trim(), notes: notes.value.trim(), status: progress ? status.value : t.status, priority: priority.value, assignee: assignee.value, due: due.value,
        patient: patientId, client: patientId ? api.patientOwner(patientId) : "", checklist: JSON.stringify(checklist.filter(x => x.text.trim()).map(x => ({text: x.text.trim().slice(0, 200), done: !!x.done})))};
      if (!progress) { // ilerleme yetkisi yoksa durum ve işaretler eski hâliyle kalır
        const old = json(t.checklist);
        next.checklist = JSON.stringify(json(next.checklist).map(x => ({...x, done: !!old.find(o => o.text === x.text)?.done})));
      }
      if (next.status === "Tamamlandı" && t.status !== "Tamamlandı") next.doneAt = new Date().toISOString();
      for (const k of ["notes", "due", "patient", "client", "assignee"]) if (!next[k]) delete next[k];
      if (next.checklist === "[]") delete next.checklist;
      ok.disabled = true;
      if (await save(next, isNew ? null : t, isNew ? "Görev eklendi" : "Görev güncellendi")) dialog.close();
      else ok.disabled = false;
    });
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    title.focus();
  }

  function draw() {
    if (!root.isConnected) return;
    const all = api.list().filter(t => t.status !== "Arşiv");
    const mine = all.filter(t => (t.assignee === api.me() || t.assignee === TEAM) && t.status !== "Tamamlandı").length;
    const late = all.filter(t => t.due && t.due < today && t.status !== "Tamamlandı").length;
    const head = el("div", "", {className: "tb-head"});
    const titles = el("div");
    titles.append(el("h1", tr("İş Takibi")), el("p", tr("Klinik ekibinin görevleri. Kartları sürükleyerek durumunu değiştirin.")));
    const tools = el("div", "", {className: "tb-tools"});
    if (api.canWrite) { const add = el("button", tr("Yeni görev"), {type: "button", className: "button primary"}); add.addEventListener("click", () => editor(null)); tools.append(add); }
    head.append(titles, tools);
    const bar = el("div", "", {className: "tb-bar"});
    const who = el("select");
    who.setAttribute("aria-label", tr("Sorumlu"));
    who.append(el("option", tr("Tüm görevler"), {value: ""}), el("option", tr("Benim işlerim") + (mine ? " (" + mine + ")" : ""), {value: "@me"}), el("option", "👥 " + tr("Tüm ekip"), {value: TEAM}));
    for (const n of api.staff()) if (n !== TEAM) { const o = el("option", n, {value: n}); o.setAttribute("data-ui-preserve", ""); who.append(o); }
    who.value = ui.who;
    who.addEventListener("change", () => { ui.who = who.value; sessionSet("vz-task-who", ui.who); draw(); });
    const search = el("input", "", {type: "search", value: ui.text, placeholder: tr("Görevlerde ara")});
    search.addEventListener("input", () => { ui.text = search.value; clearTimeout(search.t); search.t = setTimeout(() => { draw(); root.querySelector(".tb-bar input[type=search]")?.focus(); }, 250); });
    const archive = el("button", tr(ui.archive ? "Panoya dön" : "Arşiv"), {type: "button", className: "button small"});
    archive.addEventListener("click", () => { ui.archive = !ui.archive; draw(); });
    bar.append(who, search, archive);
    if (late) bar.append(el("span", late + " " + tr("gecikmiş görev"), {className: "tb-late"}));
    let board;
    if (ui.archive) {
      board = el("div", "", {className: "tb-archive"});
      const items = tasks().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      board.append(...items.map(t => {
        const c = card(t);
        if (api.canWrite && (canProgress(t) || isManager())) { const back = el("button", tr("Panoya geri al"), {type: "button", className: "button small"}); back.addEventListener("click", e => { e.stopPropagation(); save({...t, status: "Yapılacak"}, t, "Görev geri alındı"); }); c.append(back); }
        return c;
      }));
      if (!items.length) board.append(el("p", tr("Arşivde görev yok."), {className: "tb-empty"}));
    } else {
      board = el("div", "", {className: "tb-board"});
      board.append(...COLUMNS.map(column));
    }
    root.replaceChildren(head, bar, board);
  }

  // Sürükle-bırak (masaüstü). Dokunmatik cihazlarda kart açılıp "Durum" seçilir.
  root.addEventListener("dragstart", e => {
    const c = e.target.closest?.(".tb-card[draggable=true]");
    if (!c) return;
    ui.drag = c.dataset.id;
    c.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", c.dataset.id);
  });
  root.addEventListener("dragend", e => { e.target.closest?.(".tb-card")?.classList.remove("dragging"); root.querySelectorAll(".drop").forEach(x => x.classList.remove("drop")); ui.drag = null; });
  root.addEventListener("dragover", e => {
    const col = e.target.closest?.(".tb-col");
    if (!col || !ui.drag) return;
    e.preventDefault();
    root.querySelectorAll(".drop").forEach(x => x !== col && x.classList.remove("drop"));
    col.classList.add("drop");
  });
  root.addEventListener("drop", e => {
    const col = e.target.closest?.(".tb-col");
    if (!col || !ui.drag) return;
    e.preventDefault();
    const task = api.list().find(t => t.id === ui.drag);
    const before = e.target.closest?.(".tb-card")?.dataset.id || null;
    ui.drag = null;
    col.classList.remove("drop");
    if (task && before !== task.id) move(task, col.dataset.status, before);
  });
  draw();
  return {draw};
}
