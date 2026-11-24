const CACHE = 'vetzimo-public-offline-r68';
const OFFLINE = '/vetzimo-offline.html';
const PANELS = new Set(['/app', '/giris', '/klinik', '/hasta-sahibi', '/yonetim', '/uygulama']);

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
