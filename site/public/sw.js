const version = new URL(self.location.href).searchParams.get("v") || "development";
const cacheName = `kakarayan-${version}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add("./")));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("kakarayan-") && key !== cacheName).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const shellRequest =
    request.mode === "navigate" ||
    url.pathname.includes("/assets/") ||
    /\/api\/v1\/[^/]+\.json$/u.test(url.pathname) ||
    /\/(icon\.svg|manifest\.webmanifest|robots\.txt|sitemap\.xml)$/u.test(url.pathname);
  if (!shellRequest) return;
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && request.mode !== "navigate") {
          const copy = response.clone();
          void caches.open(cacheName).then((cache) => cache.put(request, copy));
        }
        return response;
      } catch {
        if (request.mode === "navigate") {
          const shell = await caches.match("./");
          if (shell) return shell;
        }
        throw new Error("Offline shell resource is not cached");
      }
    }),
  );
});
