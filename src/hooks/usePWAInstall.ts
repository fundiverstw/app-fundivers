import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// iOS Safari does not fire `beforeinstallprompt` and exposes no
// programmatic install API — the only way onto the home screen is
// the user tapping Share → Add to Home Screen. We detect "iOS Safari,
// not already installed" so the AppShell can offer an instruction
// modal in lieu of a native prompt.
function detectIOSInstallable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as Mac; the touch-points check disambiguates
  // a real Mac (0) from an iPad masquerading as one.
  const isIPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  const isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOS
  if (!isIOS) return false
  // In-app browsers (FB, Line, etc.) can't add to home screen — only
  // mobile Safari can. CriOS/FxiOS/EdgiOS are Chrome/Firefox/Edge on
  // iOS, which also can't install.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|FBAN|FBAV|Line/.test(ua)
  if (!isSafari) return false
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return !standalone
}

export function usePWAInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOSInstallable] = useState(detectIOSInstallable)

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!promptEvent) return
    await promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    if (outcome === 'accepted') setPromptEvent(null)
  }

  return {
    canInstall: !!promptEvent,
    install,
    isIOSInstallable,
  }
}
