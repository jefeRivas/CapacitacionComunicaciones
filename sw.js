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
 */
const VERSION = 'v1';
const CACHE = 'comunicaciones-' + VERSION;
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/icon.svg'
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
