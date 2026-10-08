/* Portal service worker: app-shell cache + web push. API responses are NEVER cached (they contain personal data). */
const CACHE = 'gmc-portal-v2';
const SHELL = ['/portal/', '/portal/portal.css', '/portal/core.js', '/portal/student.js', '/portal/teacher.js', '/portal/admin.js', '/portal/boot.js', '/portal/portal-i18n.js', '/styles.css', '/ui.js', '/icons.js', '/xlsx.js', '/i18n.js', '/icons/logo.jpg', '/icons/favicon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('gmc-portal-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;      // network only
  if (!(u.pathname.startsWith('/portal/') || SHELL.includes(u.pathname))) return;
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return res; }).catch(() => caches.match(e.request).then(h => h || caches.match('/portal/'))));   // network-first, cache when offline
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'GMC Check-in', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'GMC Check-in', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/favicon.png', data: { url: d.url || '/portal/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/portal/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => x.url.includes('/portal/')); return c ? c.focus().then(() => c.navigate(url)) : self.clients.openWindow(url); }));
});
