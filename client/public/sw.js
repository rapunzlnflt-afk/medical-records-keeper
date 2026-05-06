// Service worker for the Medical Records Keeper PWA.
//
// Caching strategy:
//   * App shell (index.html and root) — *network-first*. We never want a stale
//     index.html to keep an installed PWA pinned to an old hashed JS bundle.
//   * Hashed build assets (anything under /assets/) — *network-first* with
//     cache fallback. Filenames are content-hashed so a new build introduces
//     new URLs; serving an old cached entry only happens when fully offline.
//   * Static icons / manifest — cache-first (rarely change, safe to serve old).
//
// The cache name MUST change on every deployment so the previous SW evicts the
// old shell. The build pipeline rewrites BUILD_TAG via the GitHub Actions
// workflow; locally we fall back to a fixed string.
const BUILD_TAG = "__BUILD_TAG__"; // replaced at build time
const CACHE_NAME = `medical-records-${BUILD_TAG}`;

const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  // Pre-cache the shell so the very first launch can render offline. We do
  // not pre-cache hashed bundles because their names change every build.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL_URLS).catch(() => {
        // Best-effort: if pre-caching fails (e.g., 404 during a deploy
        // transition) we still want the SW to install so future fetches can
        // self-heal.
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isHashedAsset(url) {
  return url.pathname.includes("/assets/");
}

function isStaticIconOrManifest(url) {
  return /\.(png|svg|ico|webmanifest)$/i.test(url.pathname) ||
    url.pathname.endsWith("/manifest.json");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle same-origin GETs. Cross-origin (fonts, Supabase) goes straight
  // through the network so we never serve a stale auth/session response.
  if (url.origin !== self.location.origin) return;

  // App shell — network-first so a new index.html (referencing new hashed
  // bundle filenames) is always picked up while online.
  if (request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) => cached || caches.match("./index.html"),
          ),
        ),
    );
    return;
  }

  // Hashed build assets — network-first. Old cached entries can reference
  // bundles that no longer exist on the server, so we prefer fresh fetches
  // while online and only fall back to cache when offline.
  if (isHashedAsset(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              new Response("Offline", { status: 503, statusText: "Offline" }),
          ),
        ),
    );
    return;
  }

  // Icons / manifest — cache-first.
  if (isStaticIconOrManifest(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Everything else — network with cache fallback (no new caching, to avoid
  // poisoning).
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then(
        (cached) =>
          cached ||
          new Response("Offline", { status: 503, statusText: "Offline" }),
      ),
    ),
  );
});

// === Web Push ===
// Payload shape (sent by the Edge Function):
//   { title, body, tag, url, source, sourceId }
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "Reminder", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Medical Records reminder";
  const options = {
    body: payload.body || "",
    tag: payload.tag || `${payload.source || "reminder"}-${payload.sourceId || Date.now()}`,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || "./",
      source: payload.source || null,
      sourceId: payload.sourceId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            try {
              client.navigate(targetUrl);
            } catch (_) {
              // ignore — focus is enough
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("pushsubscriptionchange", () => {
  // Page-side detect/enable flow re-creates the subscription on next open.
});
