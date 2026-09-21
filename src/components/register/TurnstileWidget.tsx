import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react'

// Cloudflare Turnstile widget for the guest signup path.
//
// Renders an invisible-by-default challenge. Callback fires once the
// challenge succeeds (usually within a few hundred ms with no
// interaction); on token-expire we wipe state so submit re-challenges.
//
// A token is good for 300 seconds and verifies exactly once, which is
// shorter than a diver takes over a four-step form — so callers don't
// submit the token they were handed. They ask for one through the
// `freshToken` handle below, which re-runs the challenge whenever the
// one in hand has aged out or was already spent.
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

// How long to wait for a re-challenge to produce a token.
//
// A reset normally resolves in well under a second, invisibly. It can instead
// put an interactive challenge on screen, which a caller who has moved the
// diver past the widget cannot let them solve — so the wait is short and a
// null answer means "send them back to where the challenge is visible" rather
// than "this diver is a robot".
const REFRESH_TIMEOUT_MS = 10_000

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

export interface TurnstileHandle {
  /**
   * A token no older than `maxAgeMs`, re-running the challenge when the one in
   * hand has aged out (or was spent on a rejected submit). Pass 0 — the
   * default — to force a fresh one.
   *
   * Resolves null when no token can be produced: the widget never rendered, or
   * the re-challenge went interactive and nobody solved it. Callers treat that
   * as "show the diver the challenge again", not as a failed registration.
   */
  freshToken(maxAgeMs?: number): Promise<string | null>
}

export interface TurnstileWidgetProps {
  siteKey: string
  onToken: (token: string | null) => void
  /** Handle for `freshToken` — see TurnstileHandle. */
  ref?: Ref<TurnstileHandle>
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

export function TurnstileWidget({ siteKey, onToken, onUnavailable, ref }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef  = useRef<string | null>(null)
  // The token in hand and when Cloudflare minted it, so freshToken can answer
  // without a round trip while it is still young.
  const tokenRef    = useRef<string | null>(null)
  const mintedAtRef = useRef(0)
  // Resolver for a freshToken() call waiting on the next challenge result.
  const pendingRef  = useRef<((token: string | null) => void) | null>(null)

  const record = useCallback((token: string | null) => {
    tokenRef.current = token
    mintedAtRef.current = token ? Date.now() : 0
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.(token)
    onToken(token)
  }, [onToken])

  useImperativeHandle(ref, () => ({
    freshToken: (maxAgeMs = 0) => {
      const held = tokenRef.current
      if (held && maxAgeMs > 0 && Date.now() - mintedAtRef.current < maxAgeMs) {
        return Promise.resolve(held)
      }
      const widgetId = widgetIdRef.current
      if (!widgetId || !window.turnstile) return Promise.resolve(null)
      return new Promise<string | null>(resolve => {
        pendingRef.current?.(null)
        let timer = 0
        const settle = (token: string | null) => {
          window.clearTimeout(timer)
          if (pendingRef.current === settle) pendingRef.current = null
          resolve(token)
        }
        timer = window.setTimeout(() => settle(null), REFRESH_TIMEOUT_MS)
        pendingRef.current = settle
        tokenRef.current = null
        mintedAtRef.current = 0
        try { window.turnstile!.reset(widgetId) } catch { settle(null) }
      })
    },
  }), [])

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
        callback:           (token) => { if (!cancelled) record(token) },
        'expired-callback': ()      => { if (!cancelled) record(null) },
        'error-callback':   ()      => { if (!cancelled) record(null) },
        theme: 'light',
      })
    }).catch(() => {
      if (!cancelled) onUnavailable?.()
    })

    return () => {
      cancelled = true
      clearTimeout(timer)
      const pending = pendingRef.current
      pendingRef.current = null
      pending?.(null)
      tokenRef.current = null
      mintedAtRef.current = 0
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* ignore */ }
        widgetIdRef.current = null
      }
    }
  }, [siteKey, record, onUnavailable])

  return <div ref={containerRef} className="cf-turnstile" />
}
