// Service worker для PWA «Рой». Кэширует ТОЛЬКО статику.
// API (swarm-api, /functions/v1/) НЕ кэшируется — приватные задачи/entries не должны
// оседать в кэше устройства (особенно общего).
//
// HTML/навигация — NETWORK-FIRST: после деплоя на CF Pages меняются хэши ассетов;
// если отдавать старый закэшированный index, он сошлётся на несуществующие чанки →
// страница без стилей и со старым кодом (классический «залипший SW»). Поэтому оболочку
// всегда берём из сети, кэш — только офлайн-фолбэк. Хэш-ассеты (_next) — cache-first.
const CACHE = "roj-static-v17";
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
  // Backend-вызовы (приватные данные) — мимо кэша.
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
