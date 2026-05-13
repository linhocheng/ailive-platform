// AILIVE PWA — 最小可裝殼。第一版不快取任何 API/HTML，純走 network。
// 之後要加 offline page / asset cache 再升 SW_VERSION 強制換新。

const SW_VERSION = 'ailive-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉舊版快取（如果未來有的話）
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== SW_VERSION).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// 必要：要有 fetch handler 才算 installable PWA。直接 passthrough，不快取。
self.addEventListener('fetch', (event) => {
  // 不攔 chrome-extension / non-GET / 跨網域不必處理的請求
  if (event.request.method !== 'GET') return;
  // 預設走網路，瀏覽器自己處理。不 respondWith 等於不介入。
});
