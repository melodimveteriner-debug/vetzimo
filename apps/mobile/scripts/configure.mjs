// capacitor.config.json üretir. Sunucu adresi VZ_SERVER ile değiştirilebilir (test sunucusu için).
import {writeFileSync} from "node:fs";
const server = (process.env.VZ_SERVER || "https://vetzimo.com").replace(/\/$/, "");
const host = new URL(server).host;
const config = {
  appId: "com.vetzimo.app",
  appName: "VetZimo",
  webDir: "www",
  server: {url: server + "/app", cleartext: false, allowNavigation: [host, "*." + host], errorPath: "offline.html", androidScheme: "https"},
  android: {allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: process.env.VZ_DEBUG === "1", appendUserAgent: "VetZimoApp/1.0 (Android)"},
  ios: {contentInset: "never", limitsNavigationsToAppBoundDomains: true, appendUserAgent: "VetZimoApp/1.0 (iOS)", scheme: "VetZimo"},
  plugins: {
    PushNotifications: {presentationOptions: ["badge", "sound", "alert"]},
    SplashScreen: {launchShowDuration: 900, launchAutoHide: true, backgroundColor: "#6a3df0", showSpinner: false, androidScaleType: "CENTER_CROP"},
    StatusBar: {style: "LIGHT", backgroundColor: "#6a3df0", overlaysWebView: false},
  },
};
writeFileSync(new URL("../capacitor.config.json", import.meta.url), JSON.stringify(config, null, 2) + "\n");
console.log("capacitor.config.json →", config.server.url);
