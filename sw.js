/* Valise — service worker : met l'app en cache pour un fonctionnement hors-ligne.
   Les appels météo (Open-Meteo) ne sont jamais mis en cache : ils partent toujours au réseau. */
const CACHE = 'valise-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Les API météo partent toujours au réseau, jamais de cache (données fraîches).
  if (url.hostname.endsWith('open-meteo.com')) return;

  const isCore = e.request.mode === 'navigate'
    || /\.(html|js|css|webmanifest)$/.test(url.pathname);

  if (isCore) {
    // Réseau d'abord : les mises à jour de l'appli arrivent dès qu'on est connecté,
    // le cache sert uniquement de secours hors-ligne.
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
  } else {
    // Cache d'abord pour le reste (icônes) : figé.
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
