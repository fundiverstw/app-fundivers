/// <reference lib="webworker" />

// Make a newly-installed service worker take control immediately instead
// of waiting for every PWA instance to fully close. Without this, deployed
// updates only apply after the user force-closes the app — reloading from
// inside the PWA keeps serving the old precache.
export function enableFastActivation(scope: ServiceWorkerGlobalScope) {
  scope.addEventListener('install', () => { scope.skipWaiting() })
  scope.addEventListener('activate', (event) => { event.waitUntil(scope.clients.claim()) })
}
