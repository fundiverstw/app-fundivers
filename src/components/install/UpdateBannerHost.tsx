import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { usePWAUpdate } from '../../hooks/usePWAUpdate'

// Mounted once at the App root (inside BrowserRouter) so it registers the
// service worker exactly once and can watch route changes app-wide.
//
// Update policy: when a new build is waiting we neither nag with a banner nor
// hard-reload on the spot — we wait for a moment the user isn't in the middle
// of something. updateServiceWorker(true) skip-waits and reloads onto the
// fresh assets, so applying it is always a full refresh onto the new version.
//
// Three moments count as safe, and any of them will do:
//   1. An in-app navigation away from the page the update was spotted on.
//   2. The tab going hidden — nobody is looking, so the reload is free.
//   3. A long stretch with no interaction at all — they walked away.
// (2) and (3) exist for the diver who opens one page and never moves; without
// them a waiting update could sit unapplied for days.
//
// (2) and (3) are gated on the user not having typed into a form on this page:
// they fire while the page is still mounted, so a reload would take half-filled
// work with it. (1) needs no such gate — the form is already gone by the time
// the route has changed.
//
// The app has no central dirty-form state, so "typed since the last route
// change" is the signal. It costs nothing, and unlike scanning inputs for
// values it doesn't mistake a pre-filled edit form for unsaved work.

/** No pointer, key, wheel or touch for this long ⇒ nobody is at the keyboard. */
const IDLE_MS = 15 * 60 * 1000
const IDLE_CHECK_MS = 60 * 1000

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

export function UpdateBannerHost() {
  const { needRefresh, update } = usePWAUpdate()
  const location = useLocation()
  // The path where the waiting update was first observed. We reload only once
  // the user navigates AWAY from it — never on the detecting render itself, so
  // a reload can't fire on the page (or form) they're currently working on,
  // and an update detected on first load can't cause a reload loop.
  const armedAtPath = useRef<string | null>(null)
  // 0 until the activity effect stamps it on mount — Date.now() during render
  // is impure, and the React Compiler rejects it.
  const lastActivity = useRef(0)
  const typedOnThisPage = useRef(false)
  const applied = useRef(false)

  // updateServiceWorker(true) reloads, but a reload that somehow leaves the
  // worker waiting would otherwise let the idle timer fire again and again.
  const apply = useCallback(() => {
    if (applied.current) return
    applied.current = true
    update()
  }, [update])

  useEffect(() => { typedOnThisPage.current = false }, [location.pathname])

  useEffect(() => {
    if (!needRefresh) { armedAtPath.current = null; return }
    if (armedAtPath.current === null) { armedAtPath.current = location.pathname; return }
    if (location.pathname !== armedAtPath.current) apply()
  }, [needRefresh, location.pathname, apply])

  // Always listening, update or not: the idle clock has to already be running
  // by the time one arrives, or the first check would call a fresh page idle.
  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now() }
    bump()
    const noteTyped = (e: Event) => {
      bump()
      if ((e.target as HTMLElement | null)?.closest?.('form')) typedOnThisPage.current = true
    }
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, bump, { passive: true, capture: true })
    }
    window.addEventListener('input', noteTyped, { capture: true })
    window.addEventListener('change', noteTyped, { capture: true })
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, bump, { capture: true })
      }
      window.removeEventListener('input', noteTyped, { capture: true })
      window.removeEventListener('change', noteTyped, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (!needRefresh) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && !typedOnThisPage.current) apply()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(() => {
      if (typedOnThisPage.current) return
      if (Date.now() - lastActivity.current >= IDLE_MS) apply()
    }, IDLE_CHECK_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [needRefresh, apply])

  return null
}
