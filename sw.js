// Service worker: cache-first for the app shell so the app runs fully offline.
// VERSION and FILES are rewritten by tools/gen-sw-list.js on every release.

const VERSION = '0.1.0-2976fae5c7';
const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./styles.css",
  "./src/client/net.js",
  "./src/client/session.js",
  "./src/engine/engine.js",
  "./src/engine/view.js",
  "./src/host/describe.js",
  "./src/host/host.js",
  "./src/host/replay.js",
  "./src/storage/backup.js",
  "./src/storage/db.js",
  "./src/storage/fixtures.js",
  "./src/storage/scryfall.js",
  "./src/storage/sha256.js",
  "./src/storage/starters.js",
  "./src/transport/codec.js",
  "./src/transport/qr.js",
  "./src/transport/webrtc.js",
  "./src/ui/app.js",
  "./src/ui/board.js",
  "./src/ui/cards.js",
  "./src/ui/decks.js",
  "./src/ui/files.js",
  "./src/ui/game.js",
  "./src/ui/gestures.js",
  "./src/ui/h.js",
  "./src/ui/link.js",
  "./src/ui/overlays.js",
  "./src/ui/pairing.js",
  "./src/version.js",
  "./vendor/fflate.js",
  "./vendor/htm.js",
  "./vendor/idb/index.js",
  "./vendor/jsqr.js",
  "./vendor/preact/hooks.js",
  "./vendor/preact/preact.js",
  "./vendor/uqr.js",
  "./assets/back.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png"
];

const CACHE = `tabletop-${VERSION}`;

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages allows 10 minutes), so a new
  // version never stores files left over from the previous one.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tabletop-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The app asks to activate a waiting update only between games.
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Scryfall requests go to the network.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    try { return await fetch(req); }
    catch { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
  })());
});
