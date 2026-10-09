/*
 * Crypto Lab service worker: makes the app installable and lets it open offline.
 * - Handles ONLY same-origin GET requests inside /crypto-lab/. Every cross-origin request
 *   (all price / blockchain APIs, coin images) is never intercepted and never cached.
 * - Network first: online behaviour is unchanged; the cache is only an offline fallback
 *   for the app's own files.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const CACHE = `crypto-lab-${VERSION}`;
const SCOPE = new URL(self.registration.scope);

const SHELL = [
  "./", "index.html", "manifest.webmanifest", "favicon.svg",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "css/app.css?v=1", "js/app.js?v=1", "js/api.js", "js/calc.js", "js/ui.js", "js/store.js", "js/btcaddr.js", "js/passive-data.js", "js/learn-data.js",
  "js/views/home.js", "js/views/markets.js", "js/views/portfolio.js", "js/views/trade.js", "js/views/mining.js", "js/views/project.js",
  "js/views/address.js", "js/views/whatif.js", "js/views/passive.js", "js/views/learn.js", "js/views/tools.js", "js/views/more.js",
  "js/views/sources.js", "js/views/settings.js",
];

function handled(request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return false;            // never touch API / cross-origin calls
  if (!url.pathname.startsWith(SCOPE.pathname)) return false;
  if (url.pathname === `${SCOPE.pathname}sw.js`) return false;
  return true;
}
const isPage = (r) => r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html");
function cacheKey(request) { const u = new URL(request.url); u.hash = ""; if (isPage(request)) u.search = ""; return u.href; }

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(SHELL.map((p) => {
      const u = new URL(p, SCOPE).href;
      return fetch(new Request(u, { cache: "reload" })).then((res) => (res.ok ? cache.put(u, res) : null)).catch(() => null);
    }))).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("crypto-lab-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!handled(request)) return;
  const key = cacheKey(request);
  event.respondWith(
    fetch(request).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {})); }
      return res;
    }).catch(async () => {
      const cache = await caches.open(CACHE);
      const hit = (await cache.match(key)) || (await cache.match(request.url, { ignoreSearch: isPage(request) }));
      if (hit) return hit;
      if (isPage(request)) { const shell = (await cache.match(SCOPE.href)) || (await cache.match(new URL("index.html", SCOPE).href)); if (shell) return shell; }
      return Response.error();
    }),
  );
});
