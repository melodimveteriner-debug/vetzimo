const CACHE = 'vetzimo-public-offline-r77';
const OFFLINE = '/vetzimo-offline.html';
const PANELS = new Set(['/app', '/giris', '/clinic', '/klinik', '/hasta-sahibi', '/yonetim', '/uygulama']);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE, {cache: 'reload'}))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('vetzimo-public-offline-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' ||
      url.origin !== self.location.origin || !PANELS.has(url.pathname)) return;
  event.respondWith((async () => {
    try {
      return await fetch(request, {cache: 'no-store'});
    } catch {
      return (await caches.open(CACHE)).match(OFFLINE).then(page => page || Response.error());
    }
  })());
});

// ── Web Push (VAPID): bildirim gösterimi, simge rozeti, dokununca ilgili sayfa.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {title: 'VetZimo', body: event.data ? event.data.text() : ''}; }
  const title = data.title || 'VetZimo';
  event.waitUntil((async () => {
    if (typeof data.badge === 'number' && self.navigator?.setAppBadge) { try { data.badge ? await self.navigator.setAppBadge(data.badge) : await self.navigator.clearAppBadge(); } catch {} }
    await self.registration.showNotification(title, {
      body: data.body || '', tag: 'vz' + (data.id || Date.now()), renotify: true, silent: !!data.silent, vibrate: data.silent ? undefined : [180, 90, 180],
      icon: '/vetzimo-pwa-192.png', badge: '/vetzimo-pwa-192.png', timestamp: Date.now(),
      data: {href: typeof data.href === 'string' && data.href.startsWith('/') ? data.href : '/app', id: data.id, membership: data.membership || ''},
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = new URL(d.href || '/app', self.location.origin);
  if (d.id) target.searchParams.set('vzn', String(d.id));
  if (d.membership) target.searchParams.set('vzm', d.membership);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const same = all.find(c => new URL(c.url).origin === self.location.origin);
    if (same) { await same.focus(); same.postMessage({type: 'vz-open', href: target.pathname + target.search + target.hash, id: d.id, membership: d.membership}); return; }
    await self.clients.openWindow(target.href);
  })());
});
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({type: 'window'}).then(cs => cs.forEach(c => c.postMessage({type: 'vz-resubscribe'}))));
});
