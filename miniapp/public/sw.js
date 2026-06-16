// Service worker для PWA «Рой». Кэширует ТОЛЬКО статику.
// API (swarm-api, /functions/v1/) НЕ кэшируется — там приватные задачи/entries,
// они не должны оседать в кэше устройства (особенно общего).
const CACHE = "roj-static-v8";
const PRECACHE = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Никогда не кэшируем backend-вызовы (приватные данные).
  if (url.pathname.includes("/functions/v1/") || url.hostname.endsWith(".supabase.co")) return;
  // Только same-origin статика.
  if (url.origin !== self.location.origin) return;

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
