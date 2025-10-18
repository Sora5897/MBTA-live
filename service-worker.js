const CACHE = "mbta-live-v1";
const ASSETS = [
  "/MBTA-live/",
  "/MBTA-live/index.html",
  "/MBTA-live/app.js",
  "/MBTA-live/styles.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached ||
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => cached)
    )
  );
});
const CACHE = "mbta-live-v2"; // bump version from v1 -> v2
const CACHE = "mbta-live-v3"; // was v2