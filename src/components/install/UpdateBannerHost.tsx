import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { usePWAUpdate } from '../../hooks/usePWAUpdate'

// Mounted once at the App root (inside BrowserRouter) so it registers the
// service worker exactly once and can watch route changes app-wide.
//
// Update policy: when a new build is waiting we neither nag with a banner nor
// hard-reload on the spot — we apply it at the next in-app navigation, a
// natural break where the user isn't mid-form. updateServiceWorker(true)
// skip-waits and reloads onto the fresh assets, so a route change quietly
// becomes a full refresh onto the new version. A user who never navigates
// stays on the old build until they do (or a cold start) — the deliberate
// tradeoff for never yanking anyone out of a half-filled registration form.
export function UpdateBannerHost() {
  const { needRefresh, update } = usePWAUpdate()
  const location = useLocation()
  // The path where the waiting update was first observed. We reload only once
  // the user navigates AWAY from it — never on the detecting render itself, so
  // a reload can't fire on the page (or form) they're currently working on,
  // and an update detected on first load can't cause a reload loop.
  const armedAtPath = useRef<string | null>(null)

  useEffect(() => {
    if (!needRefresh) { armedAtPath.current = null; return }
    if (armedAtPath.current === null) { armedAtPath.current = location.pathname; return }
    if (location.pathname !== armedAtPath.current) update()
  }, [needRefresh, location.pathname, update])

  return null
}
