/*
 * Service worker de "Capacitación - Comunicaciones".
 *
 * Objetivo: permitir instalar la app en el celular SIN afectar los datos.
 *  - Las peticiones a otros dominios (Firebase / Firestore / Auth, CDNs) NO se
 *    interceptan: van siempre directo a la red, así la información de Firebase
 *    está siempre actualizada en tiempo real.
 *  - La página (index.html) se pide primero a la red (sin caché); solo si no hay
 *    conexión se muestra la última copia guardada.
 *  - Los iconos y el manifest se guardan para que el ícono cargue rápido.
 *  - Recibe las notificaciones (push) que envía el administrador al cambiar la
 *    programación y abre la app al tocarlas.
 */
const VERSION = 'v2';
const CACHE = 'comunicaciones-' + VERSION;
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/icon.svg',
  '/icons/badge-96.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('comunicaciones-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase, Firestore, Auth, fuentes y CDNs: siempre directo a la red.
  if (url.origin !== self.location.origin) return;
  // Funciones del servidor (/api): siempre directo a la red, nunca desde la caché.
  if (url.pathname.startsWith('/api/')) return;

  const isPage = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');

  if (isPage) {
    // Red primero (siempre la versión más reciente); copia guardada solo sin conexión.
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname === '/index.html' ? '/' : req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Archivos estáticos propios (iconos, manifest): caché y se actualiza en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// ================= NOTIFICACIONES =================
// Firebase Cloud Messaging entrega el aviso como un evento "push".
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { p = { data: { body: event.data ? event.data.text() : '' } }; }
  const n = p.notification || {};
  const d = p.data || {};
  const title = d.title || n.title || 'Comunicaciones';
  const opciones = {
    body: d.body || n.body || 'Hay novedades en la programación.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || n.tag || 'programacion',
    renotify: true,
    data: { url: d.url || (p.fcmOptions && p.fcmOptions.link) || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, opciones));
});

// Al tocar la notificación se abre (o se enfoca) la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        try { c.postMessage({ tipo: 'abrir-programacion' }); } catch (e) {}
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
