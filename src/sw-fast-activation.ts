/// <reference lib="webworker" />

// On first install (no prior active SW) we skipWaiting so the new SW takes
// over immediately. On *update* installs we deliberately do NOT skipWaiting —
// the in-app update banner posts a SKIP_WAITING message when the user clicks
// "Update", and only then does the new SW activate. Without that, every
// deploy would silently swap the running app code mid-session.
//
// Claiming open tabs lives in sw.ts's activate handler (via
// wipeCachesAndClaim). It MUST run after the cache wipe, so they share one
// waitUntil rather than racing as two separate activate listeners would.
export function enableFastActivation(scope: ServiceWorkerGlobalScope) {
  scope.addEventListener('install', () => {
    const isFirstInstall = !scope.registration.active
    if (isFirstInstall) scope.skipWaiting()
  })
  scope.addEventListener('message', (event) => {
    if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
      scope.skipWaiting()
    }
  })
}
