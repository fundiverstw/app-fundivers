import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePWAInstall } from './usePWAInstall'

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
