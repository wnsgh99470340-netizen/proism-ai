/* 3M 프로이즘 PWA 서비스워커
 * - 정적 자산(/_next/static, /icons): 캐시 우선
 * - 페이지 이동: 네트워크 우선, 오프라인일 때만 캐시 사용
 * - /api 요청: 캐시하지 않음 (글 생성·CRM 데이터는 항상 최신)
 */
const VERSION = 'proism-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 정적 자산: 캐시 우선
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // 페이지 이동: 네트워크 우선 (로그인 리다이렉트는 캐시하지 않음)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            caches.open(PAGE_CACHE).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return cached || new Response('<!doctype html><meta charset="utf-8"><title>오프라인</title><body style="font-family:sans-serif;background:#1a1a1f;color:#ededef;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:32px;color:#E4002B">◆</div><p>인터넷 연결이 없습니다.<br>연결 후 다시 열어주세요.</p></div></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        })
    );
  }
});
