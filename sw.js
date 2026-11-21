const CACHE_NAME = 'expense-tracker-static-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/app.js',
  './js/domain/hkTime.js',
  './js/domain/money.js',
  './js/domain/fixedEngine.js',
  './js/domain/analytics.js',
  './js/domain/merge.js',
  './js/storage/localStore.js',
  './js/storage/driveClient.js',
  './js/ui/pinLock.js',
  './js/ui/recordsView.js',
  './js/ui/homeView.js',
  './js/ui/recordsPage.js',
  './js/ui/chartsView.js',
  './js/ui/settingsView.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isConfigOrCode =
    url.pathname.endsWith('/js/config.js') ||
    url.pathname.endsWith('/js/app.js') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname === '/';

  if (isConfigOrCode) {
    // 优先拉取最新配置与主入口，离线或失败时再回退缓存
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});