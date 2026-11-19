// SPARK Admin service worker — offline shell + push
const CACHE = 'spark-admin-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add('/admin').then(()=>{},()=>{})));
  self.skipWaiting();
});
self.addEventListener('fetch', e => {
  // Only cache GET requests: a failed POST/PATCH/DELETE must never fall
  // through to caches.match (which returns undefined for non-GET and
  // breaks respondWith).
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'SPARK Admin', body: 'New update' };
  e.waitUntil(self.registration.showNotification(d.title || 'SPARK Admin', {
    body: d.body || '', icon: '/assets/logo.webp', badge: '/assets/logo.webp'
  }));
});
