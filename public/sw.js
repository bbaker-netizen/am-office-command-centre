/* A&M Inventory service worker.

   The point of this file is that a basement with no signal still opens the app.
   Everything the app is made of is stored on the phone the first time it runs,
   and after that the phone serves it whether there is a connection or not.

   Two behaviours, deliberately different:
   - The app itself (screens, code, the scanner) is served from the phone, out
     of one versioned cache that was filled in a single go. It changes rarely
     and it must never fail to load.
   - Anything under /api is tried on the network only. If there is no signal the
     request fails fast, the app writes to the phone's own queue instead, and
     the crew see a pending count rather than a spinner.

   ONE VERSION AT A TIME, AND WHY
   An earlier version of this file raced the network against a two second timer
   for every file separately. On a shop wifi that meant app.js could arrive from
   the network while office.js came off the phone, and the app was assembled
   half from today's deploy and half from yesterday's. What the office saw was a
   Settings button that appeared and disappeared between loads, which is exactly
   what a half-new app looks like from the outside. Files are never mixed now:
   a cache is filled completely or not at all, everything is served out of that
   one cache, and a new deploy arrives as a whole new cache which tells the open
   app to reload itself once.

   Note for whoever maintains this: background sync does not exist on iPhone.
   The queue drains when somebody opens the app, not on its own. That is why the
   app has to be installed to the home screen and why the pending count is on
   every screen. */

const VERSION = "am-inv-v68";
const SHELL = [
  "./",
  "./index.html",
  "./door.js",
  "./shop.html",
  "./command.html",
  "./styles.css",
  "./app.js",
  "./crew.js",
  "./office.js",
  "./tour.js",
  "./seed.json",
  "./seed.js",
  "./sop.js",
  "./manifest.webmanifest",
  "./am-logo.png",
  "./vendor/html5-qrcode.min.js",
  "./vendor/qrcode.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      // Straight off the network, never out of the browser's own cache, or a
      // new version can be built out of the old files and nothing changes.
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then(cs => cs.forEach(c => c.postMessage({ type: "version", version: VERSION })))
  );
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "version?") {
    e.source && e.source.postMessage({ type: "version", version: VERSION });
  }
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Anything that talks to the server is network only. No stale answers.
  if (url.pathname.startsWith("/api/")) return;

  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  /* One cache, one version. A hit is served as it is: every file in there
     landed together, so the app is always all of one deploy. A miss goes to the
     network and is kept, and with no signal a page request falls back to the
     app's own shell rather than a browser error. */
  e.respondWith(
    caches.open(VERSION).then(c =>
      c.match(e.request).then(hit => {
        if (hit) return hit;
        return fetch(e.request)
          .then(res => {
            if (res && res.ok) c.put(e.request, res.clone());
            return res;
          })
          .catch(() => c.match("./index.html"));
      })
    )
  );
});
