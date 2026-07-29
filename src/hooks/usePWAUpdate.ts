import { useRegisterSW } from 'virtual:pwa-register/react'

// How often to ask the SW to re-check for a new precache manifest while a
// tab is open. The default registerSW only checks on page load + visibility
// regain — for users who keep the PWA open for days that means a deploy
// can sit unseen indefinitely. 5 minutes keeps a fresh deploy close behind:
// UpdateBannerHost applies it at the next navigation, so a short poll means
// the waiting SW is detected before the user next moves between pages.
const POLL_INTERVAL_MS = 5 * 60 * 1000

// Wraps useRegisterSW with the polling cadence and a dismiss helper, so
// AppShell's update banner has a single hook to call.
export function usePWAUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      // Manual periodic update check. registration.update() is a no-op if
      // the SW byte-for-byte matches the deployed one, so this is cheap.
      setInterval(() => { registration.update().catch(() => {}) }, POLL_INTERVAL_MS)
    },
  })

  return {
    needRefresh,
    update: () => updateServiceWorker(true),
  }
}
