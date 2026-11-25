// Ajan erişimi: klinik ajanı ve telefon ajanı yalnız ücretli bayilere açıktır. Demo/deneme hesabında ajan bölümleri yerine
// tek satır bilgi gösterilir; bağlantı ve kurulum ayrıntısı verilmez. Sunucu da indirmeyi ve eşleştirmeyi ayrıca reddeder.
const STYLE = "/agent-access.css?v=2";
let cache = null;
const h = (tag, cls, text, props = {}) => { const n = Object.assign(document.createElement(tag), props); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const css = () => { if (!document.querySelector(`link[href="${STYLE}"]`)) document.head.append(Object.assign(document.createElement("link"), {rel: "stylesheet", href: STYLE})); };

/** {paid, manager, items:[{key,name,version,size,sha256,url}]} — oturum başına bir kez sorulur. */
export function agentAccess(force = false) {
  if (force) cache = null;
  return cache ||= fetch("/api/clinic/agents", {credentials: "same-origin", cache: "no-store"})
    .then(r => r.ok ? r.json() : {paid: false, manager: false, items: []})
    .catch(() => ({paid: false, manager: false, items: []}));
}

/** Demo/deneme hesabı için ajan bölümünün yerine geçen kart. */
export function paidNotice(tr = s => s) {
  css();
  const box = h("section", "agent-paid");
  box.append(h("span", "agent-paid-icon", "🔒"), h("strong", "", tr("Ücretli versiyona entegre edilmiştir.")));
  return box;
}

const size = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const LABEL = {agent: "Klinik ajanını indir (.zip)", phone: "Telefon ajanı kurulum betiği"};
const NOTE = {
  agent: "Klinik bilgisayarına bir kez kurulur: Bakanlık köprüsü, e-Fatura/e-Arşiv/e-SMM, WhatsApp ve laboratuvar/görüntüleme cihazları. Windows 10/11.",
  phone: "Telefon ajanını kurmak için Telefon Bağlantısı bölümündeki tek satırlık komutu kullanın; betik yalnız geçerli eşleştirme koduyla iner.",
};

/** Ücretli bayide indirme bağlantıları; demo/deneme hesabında yalnız bilgi satırı. keys: hangi ajanlar gösterilsin. */
export async function mountAgentDownloads(root, {tr = s => s, keys = ["agent", "phone"], compact = false} = {}) {
  css();
  const a = await agentAccess();
  if (!root.isConnected) return a;
  if (!a.paid) { root.replaceChildren(paidNotice(tr)); return a; }
  if (!a.manager) { root.replaceChildren(h("p", "agent-note", tr("Ajan kurulumunu klinik yöneticisi yapar."))); return a; }
  const list = h("div", "agent-dl" + (compact ? " compact" : ""));
  for (const item of a.items.filter(i => keys.includes(i.key))) {
    const card = h("article", "agent-dl-card");
    const link = h("a", "button primary agent-dl-link", null, {href: item.url, download: ""});
    link.append(h("span", "", tr(LABEL[item.key] || item.name)), h("small", "", [item.version ? "v" + item.version : "", size(item.size)].filter(Boolean).join(" · ")));
    card.append(link);
    if (!compact) card.append(h("p", "agent-note", tr(NOTE[item.key] || "")));
    const sum = h("details", "agent-sum"); sum.append(h("summary", "", tr("SHA-256 doğrulama")), h("code", "", item.sha256));
    card.append(sum);
    list.append(card);
  }
  root.replaceChildren(list.childElementCount ? list : h("p", "agent-note", tr("Ajan dosyaları hazırlanıyor. Lütfen daha sonra tekrar bakın.")));
  return a;
}
