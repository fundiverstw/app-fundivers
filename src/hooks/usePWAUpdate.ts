import { useRegisterSW } from 'virtual:pwa-register/react'

// How often to ask the SW to re-check for a new precache manifest while a
// tab is open. The default registerSW only checks on page load + visibility
// regain — for users who keep the PWA open for days that means a deploy
// can sit unseen indefinitely. 30 minutes is a balance: short enough that
// a morning deploy is visible by lunch, long enough that we're not hitting
// the network on a tight loop.
const POLL_INTERVAL_MS = 30 * 60 * 1000

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
