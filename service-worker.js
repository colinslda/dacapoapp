/*
  Simple service worker for DaCapo. Implements an offline‑first
  strategy by caching the core application shell during installation
  and serving cached resources when offline. On activation, old
  caches are purged. This file must live at the root of your
  deployment for GitHub Pages because the service worker scope is
  restricted to its location.
*/

const CACHE_NAME = 'dacapo-cache-v1';
// Files listed here are cached during the installation phase. Using
// relative URLs ensures the service worker functions correctly when
// deployed from a subdirectory (e.g. GitHub Pages). The first entry
// "." represents the default document.
const URLS_TO_CACHE = [
  '.',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return (
        response ||
        fetch(event.request).catch(() => {
          // Optionally return offline fallback page here
          return response;
        })
      );
    })
  );
});