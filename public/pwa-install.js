const install = document.querySelector('[data-install]');
const guide = document.querySelector('[data-install-guide]');
const state = document.querySelector('[data-install-state]');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let invitation;

function installed() {
  invitation = undefined;
  if (install) install.hidden = true;
  if (guide) guide.hidden = true;
  if (state) state.textContent = 'VetZimo uygulama penceresinde açık.';
}

window.addEventListener('beforeinstallprompt', event => {
  if (!install) return;
  event.preventDefault();
  invitation = event;
  install.hidden = false;
});
install?.addEventListener('click', async () => {
  if (!invitation) return;
  const prompt = invitation;
  invitation = undefined;
  install.hidden = true;
  try {
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted' && state) state.textContent = 'Tarayıcı kurulum isteğini kabul etti.';
  } catch {
    if (state) state.textContent = 'Kurulum için tarayıcınızın menüsünü kullanın.';
  }
});
window.addEventListener('appinstalled', installed);
if (standalone) installed();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/vetzimo-sw.js', {scope: '/', updateViaCache: 'none'}).catch(() => {
    if (state && !standalone) state.textContent = 'Tarayıcı kurulum özelliği kullanılamıyor. Klinik panelini tarayıcıda açabilirsiniz.';
  });
}

// Use the existing notice count on platforms that expose a home-screen badge.
if (standalone && typeof navigator.setAppBadge === 'function' && typeof navigator.clearAppBadge === 'function') {
  const bell = document.querySelector('#bell');
  let shown;
  const syncBadge = () => {
    const value = bell?.querySelector('.alert-count')?.textContent?.trim() || '';
    const count = /^\d{1,2}\+?$/.test(value) ? Number.parseInt(value,10) : 0;
    if (count === shown) return;
    shown = count;
    const operation = count ? navigator.setAppBadge(count) : navigator.clearAppBadge();
    operation.catch(() => {});
  };
  if (bell) new MutationObserver(syncBadge).observe(bell,{childList:true,subtree:true,characterData:true});
  if (bell || location.pathname === '/app') syncBadge();
}
