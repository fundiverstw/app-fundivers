import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { fromMock, upsert, del, eq, getUser } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsert:   vi.fn(),
  del:      vi.fn(),
  eq:       vi.fn(),
  getUser:  vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...a),
    auth: { getUser: () => getUser() },
  },
}))

type PartialSubscription = {
  endpoint: string
  unsubscribe: () => Promise<boolean>
  toJSON: () => PushSubscriptionJSON
}

function fakeSubscription(endpoint = 'https://push.example/abc'): PartialSubscription {
  return {
    endpoint,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
  }
}

function installServiceWorker(subscription: PartialSubscription | null, subscribeImpl?: () => Promise<PartialSubscription>) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn(subscribeImpl ?? (() => Promise.resolve(fakeSubscription()))),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  })
  return pushManager
}

beforeEach(() => {
  fromMock.mockReset(); upsert.mockReset(); del.mockReset(); eq.mockReset(); getUser.mockReset()
  upsert.mockResolvedValue({ error: null })
  eq.mockResolvedValue({ error: null })
  fromMock.mockReturnValue({
    upsert: (...a: unknown[]) => { upsert(...a); return Promise.resolve({ error: null }) },
    delete: () => ({ eq: (...a: unknown[]) => { del(...a); return eq(...a) } }),
  })
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

  Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} })
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: Object.assign(function () {}, { requestPermission: vi.fn().mockResolvedValue('granted') }),
  })
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BKd0N2Xg7vX8xK2L3m4N5o6P7q8R9sTuVwXyZa1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4Y')
  installServiceWorker(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('pushSupported', () => {
  it('is true when SW, PushManager and Notification are all present', async () => {
    const { pushSupported } = await import('./push')
    expect(pushSupported()).toBe(true)
  })

  it('is false when PushManager is missing (iOS not-installed-to-homescreen)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).PushManager
    const { pushSupported } = await import('./push')
    expect(pushSupported()).toBe(false)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('round-trips a VAPID-style base64url key', async () => {
    const { urlBase64ToUint8Array } = await import('./push')
    const out = urlBase64ToUint8Array('Zm9v')
    expect(Array.from(out)).toEqual([0x66, 0x6f, 0x6f]) // 'foo'
  })

  it('tolerates url-safe chars and missing padding', async () => {
    const { urlBase64ToUint8Array } = await import('./push')
    expect(() => urlBase64ToUint8Array('ab-_')).not.toThrow()
  })
})

describe('subscribeToPush', () => {
  it('requests permission, subscribes, and persists to Supabase', async () => {
    const pushManager = installServiceWorker(null)
    const { subscribeToPush } = await import('./push')
    await subscribeToPush()

    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    )
    expect(fromMock).toHaveBeenCalledWith('push_subscriptions')
    expect(upsert).toHaveBeenCalledOnce()
    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.user_id).toBe('u1')
    expect(payload.endpoint).toMatch(/^https:\/\/push\.example\//)
    expect(payload.p256dh).toBe('p256dh-value')
    expect(payload.auth).toBe('auth-value')
  })

  it('reuses an existing subscription instead of re-subscribing', async () => {
    const existing = fakeSubscription('https://push.example/existing')
    const pushManager = installServiceWorker(existing)
    const { subscribeToPush } = await import('./push')
    const result = await subscribeToPush()
    expect(result).toBe(existing)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledOnce()
  })

  it('throws when permission is denied and does not hit Supabase', async () => {
    ;(window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce('denied')
    const { subscribeToPush } = await import('./push')
    await expect(subscribeToPush()).rejects.toThrow(/not granted/i)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when VAPID key is missing', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    vi.resetModules()
    const { subscribeToPush } = await import('./push')
    await expect(subscribeToPush()).rejects.toThrow(/VAPID/i)
  })
})

describe('unsubscribeFromPush', () => {
  it('removes the Supabase row then unsubscribes the browser sub', async () => {
    const existing = fakeSubscription('https://push.example/bye')
    installServiceWorker(existing)
    const { unsubscribeFromPush } = await import('./push')
    await unsubscribeFromPush()

    expect(fromMock).toHaveBeenCalledWith('push_subscriptions')
    expect(del).toHaveBeenCalledWith('endpoint', 'https://push.example/bye')
    expect(existing.unsubscribe).toHaveBeenCalled()
  })

  it('is a no-op when no subscription exists', async () => {
    installServiceWorker(null)
    const { unsubscribeFromPush } = await import('./push')
    await unsubscribeFromPush()
    expect(fromMock).not.toHaveBeenCalled()
  })
})
