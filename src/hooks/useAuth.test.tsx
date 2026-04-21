import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

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
  const mod = await import('./useAuth')
  return mod.useAuth
}

describe('useAuth', () => {
  it('starts in loading state, resolves to null session when signed out', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const useAuth = await importHook()
    const { result } = renderHook(() => useAuth())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toBe(null)
    expect(result.current.user).toBe(null)
    expect(result.current.profile).toBe(null)
  })

  it('fetches profile when session exists', async () => {
    const session = { user: { id: 'u1' } }
    const profile = { id: 'u1', full_name: 'Ada', role: 'customer' }
    getSession.mockResolvedValue({ data: { session } })
    profileSingle.mockResolvedValue({ data: profile })

    const useAuth = await importHook()
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.user?.id).toBe('u1')
    expect(result.current.profile).toEqual(profile)
    expect(from).toHaveBeenCalledWith('profiles')
  })

  it('reacts to auth state change (sign in later)', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    profileSingle.mockResolvedValue({ data: { id: 'u2', role: 'staff' } })

    const useAuth = await importHook()
    const { result } = renderHook(() => useAuth())
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

    const useAuth = await importHook()
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.profile).not.toBeNull())

    act(() => {
      authStateListeners.forEach(cb => cb('SIGNED_OUT', null))
    })
    await waitFor(() => expect(result.current.profile).toBe(null))
    expect(result.current.session).toBe(null)
    expect(result.current.user).toBe(null)
  })

  it('calls supabase.auth.signOut when signOut() is invoked', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const useAuth = await importHook()
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.signOut() })
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('unsubscribes on unmount', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const useAuth = await importHook()
    const { unmount } = renderHook(() => useAuth())
    await waitFor(() => expect(onAuthStateChange).toHaveBeenCalled())
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
