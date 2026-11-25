// VetZimo masaüstü: merkezi VetZimo sistemini güvenli bir pencerede açar; bildirimler işletim sistemine,
// okunmamış sayısı simgeye (macOS/Linux rozeti, Windows görev çubuğu kaplaması ve tepsi) yansır.
const {app, BrowserWindow, Notification, Tray, Menu, shell, ipcMain, nativeImage, session, systemPreferences} = require("electron");
const path = require("node:path");
const SERVER = (process.env.VZ_SERVER || "https://vetzimo.com").replace(/\/$/, "");
const ORIGIN = new URL(SERVER).origin;
let win = null, tray = null, unread = 0;
const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));

// Yalnız yerel test sunucusu için (VZ_INSECURE_LOCAL=1 ve localhost adresi): kendinden imzalı sertifika kabul edilir.
if (process.env.VZ_INSECURE_LOCAL === "1" && /^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(SERVER)) app.commandLine.appendSwitch("ignore-certificate-errors");
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("com.vetzimo.desktop");
app.setAsDefaultProtocolClient("vetzimo");

function openHref(href) {
  if (!win) return;
  const target = typeof href === "string" && href.startsWith("/") ? ORIGIN + href : SERVER + "/app";
  win.show(); win.focus();
  win.webContents.send("vz-open", {href: new URL(target).pathname + new URL(target).search + new URL(target).hash});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 380, minHeight: 600, title: "VetZimo", icon, backgroundColor: "#f6f3ff", show: false,
    webPreferences: {preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true},
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(SERVER + "/app").catch(() => win.loadFile(path.join(__dirname, "offline.html")));
  win.webContents.on("did-fail-load", (_e, code, _d, url, main) => { if (main && code !== -3) win.loadFile(path.join(__dirname, "offline.html")); });
  // Yalnız VetZimo adresi pencerede açılır; diğer bağlantılar varsayılan tarayıcıda.
  win.webContents.setWindowOpenHandler(({url}) => { if (new URL(url).origin !== ORIGIN) shell.openExternal(url); else return {action: "allow"}; return {action: "deny"}; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:") && new URL(url).origin !== ORIGIN) { e.preventDefault(); shell.openExternal(url); } });
  win.on("close", e => { if (!app.isQuitting && process.platform !== "linux") { e.preventDefault(); win.hide(); } });
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(unread ? `VetZimo · ${unread} okunmamış bildirim` : "VetZimo");
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: unread ? `${unread} okunmamış bildirim` : "Okunmamış bildirim yok", click: () => openHref("/clinic#bildirimler")},
    {type: "separator"},
    {label: "VetZimo'yu aç", click: () => { win.show(); win.focus(); }},
    {label: "Oturum açılınca başlat", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({openAtLogin: m.checked})},
    {type: "separator"},
    {label: "Çıkış", click: () => { app.isQuitting = true; app.quit(); }},
  ]));
}

ipcMain.handle("vz-notify", (_e, n) => {
  if (!Notification.isSupported()) return false;
  const note = new Notification({title: String(n.title || "VetZimo").slice(0, 120), body: String(n.body || "").slice(0, 300), icon, silent: false});
  note.on("click", () => openHref(n.href));
  note.show();
  return true;
});
ipcMain.handle("vz-badge", (_e, count) => {
  unread = Math.max(0, Number(count) || 0);
  app.setBadgeCount(unread); // macOS ve Linux (Unity) rozet
  if (process.platform === "win32" && win) {
    if (!unread) win.setOverlayIcon(null, "");
    else {
      const label = unread > 99 ? "99+" : String(unread);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#d9304f"/><text x="16" y="21" font-size="${label.length > 2 ? 11 : 15}" font-family="Segoe UI,Arial" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`;
      win.setOverlayIcon(nativeImage.createFromDataURL("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")), `${unread} okunmamış`);
    }
  }
  updateTray();
  return true;
});
ipcMain.handle("vz-touchid", async (_e, reason) => {
  if (process.platform !== "darwin" || !systemPreferences.canPromptTouchID()) return false;
  await systemPreferences.promptTouchID(String(reason || "VetZimo"));
  return true;
});

app.on("second-instance", (_e, argv) => { const url = argv.find(a => a.startsWith("vetzimo://")); if (url) openHref(new URL(url).searchParams.get("href")); else if (win) { win.show(); win.focus(); } });
app.on("open-url", (e, url) => { e.preventDefault(); openHref(new URL(url).searchParams.get("href")); });
app.whenReady().then(() => {
  // Yalnız gerekli izinler: bildirim, mikrofon (Bas Konuş), kamera (hasta fotoğrafı), konum (evde hizmet) ve yalnız VetZimo kökeninde.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = new URL(wc.getURL()).origin === ORIGIN && ["notifications", "media", "geolocation", "clipboard-sanitized-write", "fullscreen"].includes(permission);
    cb(ok);
  });
  createWindow();
  tray = new Tray(icon.resize({width: 18, height: 18}));
  tray.on("click", () => { win.isVisible() ? win.focus() : win.show(); });
  updateTray();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{role: "appMenu"}] : []),
    {label: "Dosya", submenu: [{label: "Yenile", accelerator: "CmdOrCtrl+R", click: () => win.reload()}, {type: "separator"}, {role: "quit", label: "Çıkış"}]},
    {label: "Düzen", submenu: [{role: "undo", label: "Geri al"}, {role: "redo", label: "Yinele"}, {type: "separator"}, {role: "cut", label: "Kes"}, {role: "copy", label: "Kopyala"}, {role: "paste", label: "Yapıştır"}, {role: "selectAll", label: "Tümünü seç"}]},
    {label: "Görünüm", submenu: [{role: "zoomIn", label: "Yakınlaştır"}, {role: "zoomOut", label: "Uzaklaştır"}, {role: "resetZoom", label: "Gerçek boyut"}, {role: "togglefullscreen", label: "Tam ekran"}]},
    {label: "Yardım", submenu: [{label: "VetZimo destek", click: () => shell.openExternal(SERVER + "/platform/iletisim")}, {label: "Gizlilik", click: () => shell.openExternal(SERVER + "/platform/gizlilik")}]},
  ]));
});
app.on("activate", () => { if (win) win.show(); });
app.on("before-quit", () => { app.isQuitting = true; });
app.on("window-all-closed", () => { if (process.platform === "linux") app.quit(); });
