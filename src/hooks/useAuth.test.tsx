import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

type SessionLike = { user: { id: string } } | null

const unsubscribe = vi.fn()
const authStateListeners: Array<(event: string, session: SessionLike) => void> = []

const getSession = vi.fn<() => Promise<{ data: { session: SessionLike } }>>()
const onAuthStateChange = vi.fn((cb: (event: string, session: SessionLike) => void) => {
  authStateListeners.push(cb)
  return { data: { subscription: { unsubscribe } } }
})
const signOut = vi.fn(async () => ({ error: null }))

const profileSingle = vi.fn<() => Promise<{ data: unknown }>>()

const from = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      single: profileSingle,
    }),
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession, onAuthStateChange, signOut },
    from,
  },
}))

beforeEach(() => {
  authStateListeners.length = 0
  unsubscribe.mockClear()
  getSession.mockReset()
  onAuthStateChange.mockClear()
  signOut.mockClear()
  profileSingle.mockReset()
  from.mockClear()
})

async function importHook() {
  // Both the provider and the consumer hook must be imported AFTER
  // vi.mock above has registered, since the provider's useEffect
  // touches supabase.auth.* at first render.
  const provider = await import('./AuthProvider')
  const hook     = await import('./useAuth')
  const wrapper  = ({ children }: { children: ReactNode }) =>
    <provider.AuthProvider>{children}</provider.AuthProvider>
  return { useAuth: hook.useAuth, wrapper }
}

describe('useAuth', () => {
  it('starts in loading state, resolves to null session when signed out', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toBe(null)
    expect(result.current.user).toBe(null)
    expect(result.current.profile).toBe(null)
  })

  it('fetches profile when session exists', async () => {
    const session = { user: { id: 'u1' } }
    const profile = { id: 'u1', name: 'Ada', role: 'customer' }
    getSession.mockResolvedValue({ data: { session } })
    profileSingle.mockResolvedValue({ data: profile })

    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.user?.id).toBe('u1')
    expect(result.current.profile).toEqual(profile)
    expect(from).toHaveBeenCalledWith('profiles')
  })

  it('reacts to auth state change (sign in later)', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    profileSingle.mockResolvedValue({ data: { id: 'u2', role: 'staff' } })

    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      authStateListeners.forEach(cb => cb('SIGNED_IN', { user: { id: 'u2' } }))
    })
    await waitFor(() => expect(result.current.user?.id).toBe('u2'))
    await waitFor(() => expect(result.current.profile).not.toBeNull())
  })

  it('clears profile on sign out event', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u3' } } } })
    profileSingle.mockResolvedValue({ data: { id: 'u3' } })

    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.profile).not.toBeNull())

    act(() => {
      authStateListeners.forEach(cb => cb('SIGNED_OUT', null))
    })
    await waitFor(() => expect(result.current.profile).toBe(null))
    expect(result.current.session).toBe(null)
    expect(result.current.user).toBe(null)
  })

  it('calls supabase.auth.signOut with scope:local so other devices stay signed in', async () => {
    // The default global scope revokes the user's refresh tokens, which
    // kicks them out on every other device. Sessions should be
    // per-environment — signing out on desktop must not log out the
    // Android PWA.
    getSession.mockResolvedValue({ data: { session: null } })
    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.signOut() })
    expect(signOut).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('posts CLEAR_SUPABASE_CACHE to the SW after sign-out (audit H4)', async () => {
    // The previous user's RLS-scoped reads sit in the supabase-api SW
    // cache. After sign-out, the next user on the same device must
    // not see them — so we wipe the cache via postMessage. Without
    // this signal, /rest/v1/profiles?id=... could return another
    // account's row offline.
    getSession.mockResolvedValue({ data: { session: null } })
    const postMessage = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: { postMessage } },
    })

    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.signOut() })

    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_SUPABASE_CACHE' })
  })

  it('sign-out is safe when no SW controller is registered', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: null },
    })

    const { useAuth, wrapper } = await importHook()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(act(async () => { await result.current.signOut() })).resolves.not.toThrow()
  })

  it('unsubscribes on unmount', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { useAuth, wrapper } = await importHook()
    const { unmount } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(onAuthStateChange).toHaveBeenCalled())
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
