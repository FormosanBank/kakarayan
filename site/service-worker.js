/* Configuration is stamped by the Vite build, not inferred from a runtime URL. */
const config = __KAKARAYAN_SHELL__;
const prefix = "kakarayan-shell-";
const cacheName = prefix + config.generation;
const scope = self.registration.scope;
const entries = new Map(config.entries.map((entry) => [new URL(entry.path, scope).href, entry]));
const required = config.entries.filter((entry) => entry.required);

async function verified(entry) {
  const response = await fetch(new URL(entry.path, scope), {cache: "no-store"});
  if (!response.ok) throw new Error("Shell resource unavailable");
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== entry.bytes) throw new Error("Shell size mismatch");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== entry.sha256) throw new Error("Shell generation mismatch");
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (config.entries.length > 64 || config.entries.reduce((n, entry) => n + entry.bytes, 0) > 10 * 1024 * 1024) {
      throw new Error("Offline shell exceeds its budget");
    }
    const cache = await caches.open(cacheName);
    try {
      // Failure of an essential member rejects the entire new generation.
      for (const entry of required) await cache.put(new URL(entry.path, scope), await verified(entry));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
    for (const entry of config.entries.filter((item) => !item.required)) {
      try { await cache.put(new URL(entry.path, scope), await verified(entry)); }
      catch { /* An optional catalogue can be retried without invalidating the shell. */ }
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter((key) => key.startsWith(prefix));
    const previous = keys.filter((key) => key !== cacheName).at(-1);
    await Promise.all(keys.filter((key) => key !== cacheName && key !== previous).map((key) => caches.delete(key)));
    const legacy = (await caches.keys()).filter((key) => /^kakarayan-fb-\d{8}-[0-9a-f]{7,12}$/u.test(key));
    await Promise.all(legacy.map((key) => caches.delete(key)));
    // Existing pages stay on the old worker until they close or explicitly update.
    // No clients.claim(): an uncontrolled first visit takes control on its next load.
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "ACTIVATE") return;
  event.waitUntil((async () => {
    const tabs = (await self.clients.matchAll({type: "window", includeUncontrolled: true}))
      .filter((client) => client.url.startsWith(scope));
    if (tabs.length > 1) {
      event.ports[0]?.postMessage({status: "other_tabs"});
      return;
    }
    event.ports[0]?.postMessage({status: "activating"});
    await self.skipWaiting();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.href.startsWith(scope)) return;
  const key = request.mode === "navigate" ? new URL("./", scope).href : new URL(url.pathname, scope).href;
  const entry = entries.get(key);
  if (!entry) return; // No queries, exports, audio, model calls, or arbitrary paths.
  const response = (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(key);
    if (cached) return cached;
    try {
      const fetched = await verified(entry);
      try { await cache.put(key, fetched.clone()); }
      catch { /* Quota failure does not discard a valid network response. */ }
      return fetched;
    } catch {
      return new Response("This resource is unavailable in the installed site version.", {status: 503});
    }
  })();
  event.respondWith(response);
  event.waitUntil(response.then(() => undefined));
});
