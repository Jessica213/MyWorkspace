/* 成长工作台 Service Worker
 * 提供 PWA 安装能力 + 应用外壳离线缓存
 * 策略：网络优先，离线时回退缓存（stale-while-revalidate）
 */
const CACHE_NAME = 'wb-growth-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './config.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => self.skipWaiting())
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 同源请求走缓存兜底；跨域仅对白名单（supabase cdn）做缓存兜底
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (url.origin === location.origin || url.href.startsWith('https://cdn.jsdelivr.net/'))) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || (url.origin === location.origin ? caches.match('./index.html') : undefined)))
  );
});
