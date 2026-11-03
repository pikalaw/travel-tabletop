/// <reference lib="webworker" />
// The service worker. vite-plugin-pwa injects the build's file list (each with a revision) into
// self.__WB_MANIFEST; everything else here is ours.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// 1. Every built file, fetched at its exact revision, so a stale copy from the browser's HTTP
//    cache can never be mixed into a new build.
precacheAndRoute(self.__WB_MANIFEST);
// 2. Remove precaches left by earlier builds.
cleanupOutdatedCaches();
// 3. Every navigation gets the precached index.html, so game links (#game=…) open offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
// 4. No runtime caching: Scryfall's API and images go straight to the network.

// 5. The page's "Update now" asks the waiting worker to take over.
self.addEventListener('message', (e: ExtendableMessageEvent) => {
  if ((e.data as { type?: unknown } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
// 6. Take control of open pages once active.
clientsClaim();
