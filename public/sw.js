/* Original, dependency-free offline support. Only this app's own public assets are cached. */
const CACHE = "stone-viewer-v1";
const PREFIX = "stone-viewer-";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_INITIAL_ASSETS" || !Array.isArray(event.data.resources)) return;
  const resources = [...new Set(event.data.resources)].filter((value) => {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
    } catch { return false; }
  }).slice(0, 100);
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(resources.map((url) => cache.add(url)))));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_vercel/") || url.pathname.startsWith("/api/") || url.searchParams.has("_rsc") || request.headers.get("RSC")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === "/") {
          const cache = await caches.open(CACHE);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        return (await caches.match("/")) || new Response("オフラインです。一度オンラインで石を表示してください。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname) || /\.(?:png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
