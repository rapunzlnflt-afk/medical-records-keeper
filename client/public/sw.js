const CACHE_NAME = "medical-records-v4-push";

// Install: cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        "./",
        "./index.html",
        "./manifest.json",
        "./icon-192.png",
        "./icon-512.png",
      ]);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigation, cache-first for assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => new Response("Offline", { status: 503 }));
    })
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

// Some browsers report subscription churn; surface it so the page can
// re-subscribe on next open. We can't write to Supabase from here without
// stored creds, so we just log.
self.addEventListener("pushsubscriptionchange", (event) => {
  // The page-side detect/enable flow will re-create the subscription the
  // next time the user opens the app.
});
