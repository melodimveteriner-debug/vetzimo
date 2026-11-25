// Kurulum ekranı: yönetici 2FA anahtarını Google Authenticator ile okutulabilir QR koda çevirir (ağ isteği yok).
import {qrSvg} from "./qr.js?v=1";
const box = document.getElementById("setup-qr");
if (box && box.dataset.uri) box.innerHTML = qrSvg(box.dataset.uri, {size: 190, label: "Google Authenticator ile okutun"});
