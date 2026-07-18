/* Valise — service worker : met l'app en cache pour un fonctionnement hors-ligne.
   Les appels météo (Open-Meteo) ne sont jamais mis en cache : ils partent toujours au réseau. */
const CACHE = 'valise-v10';
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
  './icons/apple-touch-icon.png',
  './img/bg-home.jpg',
  './img/bg-plage.jpg',
  './img/bg-montagne.jpg',
  './img/bg-ville.jpg',
  './img/bg-roadtrip.jpg',
  './img/bg-camping.jpg',
  './img/bg-ski.jpg',
  './img/bg-rando.jpg',
  './img/bg-business.jpg',
  './img/bg-croisiere.jpg',
  './img/bg-festival.jpg',
  './img/bg-bienetre.jpg',
  './img/pays-fr.jpg',
  './img/pays-es.jpg',
  './img/pays-it.jpg',
  './img/pays-gb.jpg',
  './img/pays-de.jpg',
  './img/pays-nl.jpg',
  './img/pays-ch.jpg',
  './img/pays-gr.jpg',
  './img/pays-pt.jpg',
  './img/pays-tr.jpg',
  './img/pays-ma.jpg',
  './img/pays-eg.jpg',
  './img/pays-us.jpg',
  './img/pays-ca.jpg',
  './img/pays-mx.jpg',
  './img/pays-jp.jpg',
  './img/pays-th.jpg',
  './img/pays-id.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

// Le bouton "Mettre à jour" de l'appli demande au nouveau worker de prendre la main.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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
    // Réseau d'abord, en CONTOURNANT le cache HTTP du navigateur (no-store) : sinon il pouvait
    // resservir un ancien app.js et bloquer la mise à jour. Le cache SW sert de secours hors-ligne.
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then((res) => {
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
