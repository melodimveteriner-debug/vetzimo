const labels = {pending: "Bekliyor", done: "Uygulandı", cancelled: "İptal edildi"};

function orders(stay) {
  return JSON.parse(stay?.careOrders || "[]");
}
function sorted(items) {
  return [...items].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}
function node(tag, text = "", classes = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = classes;
  return el;
}
function data(tag, value) {
  const el = node(tag, value);
  el.setAttribute("data-ui-preserve", "");
  el.dir = "auto";
  return el;
}
function localTime(value) {
  const locale = document.documentElement.lang || "tr";
  return new Intl.DateTimeFormat(locale, {dateStyle:"short",timeStyle:"short"}).format(new Date(value));
}
function ensureStyle() {
  if (document.querySelector("link[data-stay-care]")) return;
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL("./stay-care.css?v=r69", import.meta.url).href;
  style.dataset.stayCare = "";
  document.head.append(style);
}
function action(label, callback) {
  const button = node("button", label, "button small");
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
}

function orderCard(order) {
  const item = node("li", "", "vz-care-item");
  const meta = node("div", "", "vz-care-meta");
  const time = data("time", localTime(order.due));
  time.dateTime = order.due;
  meta.append(time, node("span", labels[order.status], "badge"));
  item.append(meta, data("strong", order.text));
  if (order.closedBy && order.closedAt) {
    item.append(data("small", order.closedBy + " · " + localTime(order.closedAt)));
  }
  return item;
}

let lookupStay;

document.addEventListener("toggle", event => {
  const details = event.target;
  if (!details.matches?.("details[data-stay-care-id]") || !details.open || !lookupStay) return;
  const stay = lookupStay(details.dataset.stayCareId);
  if (!stay) return;
  const ul = details.querySelector("ol");
  ul.replaceChildren(...sorted(orders(stay)).map(orderCard));
}, true);

export function stayCareSummary(stay, lookup) {
  if (!stay?.careOrders || stay.careOrders === "[]") return "";
  ensureStyle();
  lookupStay = lookup;
  const details = node("details", "", "vz-care-summary");
  details.dataset.stayCareId = stay.id;
  details.append(node("summary", "Yatış talimatları"), node("ol", "", "vz-care-list"));
  return details.outerHTML;
}

export function mountStayCare(formBody, stay) {
  ensureStyle();
  const items = orders(stay);
  const saved = new Set(items.map(item => item.id));
  const section = node("section", "", "wide lab-editor vz-care-editor");
  section.append(node("h2", "Yatış talimatları"));
  const list = node("ol", "", "vz-care-list");
  const hidden = node("input");
  hidden.type = "hidden";
  hidden.name = "careOrders";
  const field = (caption, input) => {
    const label = node("label", "", "form-field");
    label.append(node("strong", caption), input);
    return label;
  };
  const due = node("input");
  due.type = "datetime-local";
  const text = node("input");
  text.type = "text";
  text.maxLength = 400;
  const error = node("p", "", "form-error");
  error.setAttribute("role", "alert");
  const controls = node("div", "", "vz-care-fields");
  const status = formBody.querySelector('[name="status"]');
  const start = formBody.querySelector('[name="start"]');
  const end = formBody.querySelector('[name="end"]');
  function add() {
    if (!due.value || !text.value.trim() || !due.checkValidity() ||
        items.some(o => o.status === "pending" && o.due === due.value && o.text === text.value.trim())) {
      error.textContent = "Yatış talimatının saatini, açıklamasını ve durumunu kontrol edin.";
      return;
    }
    items.push({id:crypto.randomUUID(), due:due.value, text:text.value.trim(), status:"pending"});
    due.value = "";
    text.value = "";
    error.textContent = "";
    draw();
    due.focus();
  }
  controls.append(field("Planlanan saat", due), field("Bakım talimatı", text), action("Talimat ekle", add));
  function draw() {
    const closed = ["Taburcu", "İptal"].includes(status.value);
    controls.hidden = closed;
    due.min = start.value;
    due.max = end.value;
    list.replaceChildren();
    if (!items.length) list.append(node("li", "Henüz talimat eklenmedi.", "muted"));
    for (const order of sorted(items)) {
      const card = orderCard(order);
      if (order.status === "pending") {
        const actions = node("div", "", "vz-care-actions");
        if (saved.has(order.id)) {
          if (status.value === "Yatışta" || stay?.status === "Yatışta") {
            actions.append(action("Uygulandı olarak işaretle", () => { order.status = "done"; draw(); }));
          }
          actions.append(action("Talimatı iptal et", () => { order.status = "cancelled"; draw(); }));
        } else {
          actions.append(action("Talimatı kaldır", () => { items.splice(items.indexOf(order), 1); draw(); }));
        }
        card.append(actions);
      }
      list.append(card);
    }
    hidden.value = JSON.stringify(items);
  }
  section.append(list, controls, error, hidden);
  formBody.append(section);
  for (const input of [status, start, end]) input.addEventListener("change", draw);
  // Capture submission before the generic record editor serializes the form.
  const form = formBody.closest("form");
  if (form) {
    const onSubmit = event => {
      if (!section.isConnected) { form.removeEventListener("submit", onSubmit, true); return; }
      if (controls.hidden || !(due.value || text.value.trim())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      error.textContent = "Önce talimatı ekleyin veya alanları temizleyin.";
      text.focus();
    };
    form.addEventListener("submit", onSubmit, true);
    // Drop the listener when navigating between records, including unsaved forms.
    const cleanup = new MutationObserver(() => {
      if (!section.isConnected) {
        form.removeEventListener("submit", onSubmit, true);
        cleanup.disconnect();
      }
    });
    cleanup.observe(formBody, {childList:true});
  }
  draw();
}
