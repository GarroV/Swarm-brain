// Service worker для PWA «Рой». Кэширует ТОЛЬКО статику.
// API НЕ кэшируется — приватные задачи/entries/тезисы не должны оседать в кэше устройства
// (особенно общего). ВАЖНО: фронт ходит на SAME-ORIGIN /api/* (NEXT_PUBLIC_API_URL=/api,
// прокси — CF Pages Function functions/api/[[path]].ts), а не только на /functions/v1/.
// Пока исключение проверяло лишь /functions/v1/, весь бэкенд проваливался в cache-first
// ветку ниже: экран показывал вчерашние данные (сохранил тезисы → видишь прежние, помогает
// только рефреш), а личные записи оседали в Cache Storage (issue #71). Правило закреплено
// тестом miniapp/sw.test.ts — гонять при любой правке этого файла.
//
// HTML/навигация — NETWORK-FIRST: после деплоя на CF Pages меняются хэши ассетов;
// если отдавать старый закэшированный index, он сошлётся на несуществующие чанки →
// страница без стилей и со старым кодом (классический «залипший SW»). Поэтому оболочку
// всегда берём из сети, кэш — только офлайн-фолбэк. Хэш-ассеты (_next) — cache-first.
const CACHE = "roj-static-v32";  // v32: вычистка приватных API-ответов, осевших до фикса #71
const PRECACHE = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Backend-вызовы (приватные данные) — мимо кэша: и same-origin прокси /api/*, и прямой режим.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  if (url.pathname.includes("/functions/v1/") || url.hostname.endsWith(".supabase.co")) return;
  // Только same-origin статика.
  if (url.origin !== self.location.origin) return;

  // Навигация/HTML — network-first (свежая оболочка), кэш как офлайн-фолбэк.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match("/")))
    );
    return;
  }

  // Остальная статика (хэшированные _next-ассеты, immutable) — cache-first + фон.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
