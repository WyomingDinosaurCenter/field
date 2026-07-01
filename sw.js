// ════════════════════════════════════════════════════════════
//  WDC Field App — Service Worker
//  Strategy: NETWORK-FIRST for the app shell.
//    • Online  → always fetch the latest, and refresh the cache.
//    • Offline → serve the last-used cached copy.
//  This guarantees an online device never gets stuck on an old
//  version (the previous stale-while-revalidate strategy did),
//  while keeping the app fully usable offline.
//
//  iPhone-first (iOS Safari / standalone PWA); also works on
//  Android/Chromium. Uses relative URLs so it is path-portable.
// ════════════════════════════════════════════════════════════
const CACHE_NAME = 'wdc-field-v26';
const APP_SHELL  = [
  './',
  './index.html',
  './manifest.json',
  './WDC_fieldApp.png'
];

self.addEventListener('install', event => {
  // Take over as soon as installed — don't wait for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Let the page promote a freshly-installed worker immediately.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache writes
  const url = new URL(req.url);

  // ── Supabase API + storage: straight to network ─────────────
  // The app handles its own offline behaviour (local cache + queue),
  // so the SW must not fabricate fake responses here.
  if (url.hostname.includes('supabase.co')) return;

  // ── CDN libraries (versioned, immutable): cache-first ───────
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('cdn.')) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // ── App shell (same-origin): NETWORK-FIRST ──────────────────
  if (url.origin === location.origin) {
    // For the HTML document, bypass the HTTP cache entirely so a stale
    // GitHub Pages / Safari cached page can never shadow a new deploy.
    const isDoc = req.mode === 'navigate'
      || req.destination === 'document'
      || url.pathname.endsWith('.html')
      || url.pathname.endsWith('/');

    event.respondWith(
      fetch(req, isDoc ? { cache: 'no-store' } : {})
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(c => c || (isDoc ? caches.match('./index.html') : undefined))
        )
    );
    return;
  }
  // Everything else: default browser handling.
});
