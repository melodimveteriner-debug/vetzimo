// Web arayüzüne yalnız gereken masaüstü özellikleri açılır (bağlam yalıtımı açık, Node erişimi yok).
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("vetzimoDesktop", {
  platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
  version: "1.0.0",
  build: 1,
  notify: n => ipcRenderer.invoke("vz-notify", n),
  setBadge: count => ipcRenderer.invoke("vz-badge", count),
  touchId: reason => ipcRenderer.invoke("vz-touchid", reason),
  onOpen: fn => ipcRenderer.on("vz-open", (_e, data) => fn(data)),
});
