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
}

export function TurnstileWidget({ siteKey, onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef  = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback:           (token) => { if (!cancelled) onToken(token) },
        'expired-callback': ()      => { if (!cancelled) onToken(null) },
        'error-callback':   ()      => { if (!cancelled) onToken(null) },
        theme: 'light',
      })
    }).catch(() => { /* widget will simply not render; submit guard will block */ })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* ignore */ }
        widgetIdRef.current = null
      }
    }
  }, [siteKey, onToken])

  return <div ref={containerRef} className="cf-turnstile" />
}
