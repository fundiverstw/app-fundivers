import { useEffect, useRef } from 'react'

// Cloudflare Turnstile widget for the guest signup path.
//
// Renders an invisible-by-default challenge. Callback fires once the
// challenge succeeds (usually within a few hundred ms with no
// interaction); on token-expire we wipe state so submit re-challenges.
//
// Site key comes from VITE_TURNSTILE_SITE_KEY at build time. For
// local dev, Cloudflare publishes always-pass test keys:
//   site key: 1x00000000000000000000AA  (this file)
//   secret:   1x0000000000000000000000000000000AA  (edge function env)
// See https://developers.cloudflare.com/turnstile/troubleshooting/testing/
//
// The script is loaded the first time any TurnstileWidget mounts and
// stays loaded for the rest of the page lifetime; multiple widgets
// share it. We don't load it eagerly at app start because the only
// place that needs it is the guest /register flow.

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, opts: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback'?: () => void
        'error-callback'?:   () => void
        theme?: 'light' | 'dark' | 'auto'
      }) => string
      remove: (widgetId: string) => void
      reset:  (widgetId?: string) => void
    }
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// How long to wait for the widget to appear before calling it unavailable.
//
// A rejected fetch is the easy case. The one that actually strands people is a
// request that hangs — a proxy black-holing the host, a captive portal, a
// filtering extension that swallows it — where the script tag fires neither
// `load` nor `error` and the form waits forever. Generous enough that a slow
// connection still gets its challenge; short enough that nobody sits staring
// at a disabled button wondering.
const LOAD_TIMEOUT_MS = 15_000

let scriptLoaded: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (scriptLoaded) return scriptLoaded
  scriptLoaded = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_URL}"]`)
    if (existing) {
      if (window.turnstile) { resolve(); return }
      existing.addEventListener('load',  () => resolve())
      existing.addEventListener('error', () => reject(new Error('turnstile script load failed')))
      return
    }
    const el = document.createElement('script')
    el.src = SCRIPT_URL
    el.async = true
    el.defer = true
    el.addEventListener('load',  () => resolve())
    el.addEventListener('error', () => reject(new Error('turnstile script load failed')))
    document.head.appendChild(el)
  })
  return scriptLoaded
}

export interface TurnstileWidgetProps {
  siteKey: string
  onToken: (token: string | null) => void
  /**
   * The challenge cannot run at all — challenges.cloudflare.com is
   * unreachable (offline, a blocking extension, a corporate proxy) so the
   * widget never rendered. Without this the form is a dead end: no token can
   * ever arrive, the submit button stays disabled forever, and the diver is
   * left staring at a form with nothing to click and nothing explaining why.
   * Callers use it to swap in the "contact us" copy.
   */
  onUnavailable?: () => void
}

export function TurnstileWidget({ siteKey, onToken, onUnavailable }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef  = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let rendered  = false

    // Fires only if the widget hasn't rendered by then — cleared below the
    // moment it does, so an interactive challenge the diver is mid-way through
    // is never cut off. The deadline is on getting the challenge on screen,
    // not on solving it.
    const timer = setTimeout(() => {
      if (!cancelled && !rendered) onUnavailable?.()
    }, LOAD_TIMEOUT_MS)

    loadScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      rendered = true
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback:           (token) => { if (!cancelled) onToken(token) },
        'expired-callback': ()      => { if (!cancelled) onToken(null) },
        'error-callback':   ()      => { if (!cancelled) onToken(null) },
        theme: 'light',
      })
    }).catch(() => {
      if (!cancelled) onUnavailable?.()
    })

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* ignore */ }
        widgetIdRef.current = null
      }
    }
  }, [siteKey, onToken, onUnavailable])

  return <div ref={containerRef} className="cf-turnstile" />
}
