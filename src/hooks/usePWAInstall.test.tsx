import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePWAInstall } from './usePWAInstall'

// JSDOM doesn't expose a writable userAgent, navigator.standalone, or
// matchMedia by default — these helpers stub them per-test so we can
// exercise the iOS detection branch.
function stubNavigator(opts: {
  userAgent: string
  maxTouchPoints?: number
  standalone?: boolean
}) {
  const original = {
    userAgent: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
    maxTouchPoints: Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints'),
    standalone: Object.getOwnPropertyDescriptor(navigator, 'standalone'),
  }
  Object.defineProperty(navigator, 'userAgent', { value: opts.userAgent, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: opts.maxTouchPoints ?? 0, configurable: true })
  if (opts.standalone !== undefined) {
    Object.defineProperty(navigator, 'standalone', { value: opts.standalone, configurable: true })
  }
  return () => {
    if (original.userAgent) Object.defineProperty(navigator, 'userAgent', original.userAgent)
    if (original.maxTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', original.maxTouchPoints)
    if (original.standalone) Object.defineProperty(navigator, 'standalone', original.standalone)
    else delete (navigator as Navigator & { standalone?: boolean }).standalone
  }
}

function stubMatchMedia(standalone: boolean) {
  const original = window.matchMedia
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('standalone') ? standalone : false,
    media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
  return () => { window.matchMedia = original }
}

function fireBeforeInstallPrompt(options: {
  prompt?: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
} = {}) {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = options.prompt ?? vi.fn(async () => {})
  event.userChoice = options.userChoice ?? Promise.resolve({ outcome: 'accepted' as const })
  window.dispatchEvent(event)
  return event
}

describe('usePWAInstall', () => {
  it('starts with canInstall=false', () => {
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.canInstall).toBe(false)
  })

  it('flips canInstall=true when beforeinstallprompt fires', async () => {
    const { result } = renderHook(() => usePWAInstall())
    act(() => { fireBeforeInstallPrompt() })
    await waitFor(() => expect(result.current.canInstall).toBe(true))
  })

  it('install() calls prompt() and clears state when accepted', async () => {
    const prompt = vi.fn(async () => {})
    const { result } = renderHook(() => usePWAInstall())
    act(() => {
      fireBeforeInstallPrompt({
        prompt,
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      })
    })
    await waitFor(() => expect(result.current.canInstall).toBe(true))

    await act(async () => { await result.current.install() })
    expect(prompt).toHaveBeenCalledOnce()
    await waitFor(() => expect(result.current.canInstall).toBe(false))
  })

  it('install() keeps canInstall=true when user dismisses', async () => {
    const prompt = vi.fn(async () => {})
    const { result } = renderHook(() => usePWAInstall())
    act(() => {
      fireBeforeInstallPrompt({
        prompt,
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      })
    })
    await waitFor(() => expect(result.current.canInstall).toBe(true))

    await act(async () => { await result.current.install() })
    expect(result.current.canInstall).toBe(true)
  })

  it('install() is a no-op before the prompt event fires', async () => {
    const { result } = renderHook(() => usePWAInstall())
    await act(async () => { await result.current.install() })
    expect(result.current.canInstall).toBe(false)
  })

  it('removes the listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => usePWAInstall())
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
    removeSpy.mockRestore()
  })
})

describe('usePWAInstall iOS detection', () => {
  const restorers: Array<() => void> = []
  afterEach(() => {
    while (restorers.length) restorers.pop()!()
  })

  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const CHROME_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
  const SAFARI_IPAD_AS_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Safari/605.1.15'
  const CHROME_DESKTOP =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

  it('flags iPhone Safari (not yet installed) as iOS-installable', () => {
    restorers.push(stubNavigator({ userAgent: SAFARI_IPHONE, standalone: false }))
    restorers.push(stubMatchMedia(false))
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.isIOSInstallable).toBe(true)
  })

  it('does NOT flag iPhone Safari when already running standalone', () => {
    restorers.push(stubNavigator({ userAgent: SAFARI_IPHONE, standalone: true }))
    restorers.push(stubMatchMedia(true))
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.isIOSInstallable).toBe(false)
  })

  it('does NOT flag Chrome on iOS (CriOS) — Apple blocks add-to-home-screen there', () => {
    restorers.push(stubNavigator({ userAgent: CHROME_IPHONE, standalone: false }))
    restorers.push(stubMatchMedia(false))
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.isIOSInstallable).toBe(false)
  })

  it('flags iPadOS Safari (which spoofs the Mac UA) when touch points > 1', () => {
    restorers.push(stubNavigator({ userAgent: SAFARI_IPAD_AS_MAC, maxTouchPoints: 5, standalone: false }))
    restorers.push(stubMatchMedia(false))
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.isIOSInstallable).toBe(true)
  })

  it('does NOT flag a real Mac (same UA, no touch points)', () => {
    restorers.push(stubNavigator({ userAgent: SAFARI_IPAD_AS_MAC, maxTouchPoints: 0 }))
    restorers.push(stubMatchMedia(false))
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.isIOSInstallable).toBe(false)
  })

  it('does NOT flag desktop Chrome', () => {
    restorers.push(stubNavigator({ userAgent: CHROME_DESKTOP }))
    restorers.push(stubMatchMedia(false))
    const { result } = renderHook(() => usePWAInstall())
    expect(result.current.isIOSInstallable).toBe(false)
  })
})
