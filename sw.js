// CELESTA Admin service worker — offline shell + push
const CACHE = 'celesta-admin-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add('/admin').then(()=>{},()=>{})));
  self.skipWaiting();
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'CELESTA Admin', body: 'New update' };
  e.waitUntil(self.registration.showNotification(d.title || 'CELESTA Admin', {
    body: d.body || '', icon: '/assets/logo.webp', badge: '/assets/logo.webp'
  }));
});
