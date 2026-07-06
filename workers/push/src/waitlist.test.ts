import { describe, it, expect, vi, beforeEach } from 'vitest'

// web-push is the real reason we can't import index.ts in jsdom — it
// pulls in node:crypto. Mock it before the import so the worker code
// loads cleanly under happy-dom too.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}))

// supabase-js gets mocked per-test below via the createClient export.
const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...a: unknown[]) => createClientMock(...a),
}))

const { processWaitlistOffers } = await import('./index')

interface QueryResult { data: unknown; error: unknown }

// Builds a chainable Supabase query builder that captures the chain of
// method calls so a test can assert "this query happened with these
// filters" — used to verify the worker's RPC and update calls.
function builder(result: QueryResult) {
  const calls: Array<[string, unknown[]]> = []
  const b: Record<string, unknown> = {}
  const passthrough = ['select', 'eq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'order', 'limit']
  for (const m of passthrough) {
    b[m] = (...a: unknown[]) => { calls.push([m, a]); return b }
  }
  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    b[m] = (...a: unknown[]) => { calls.push([m, a]); return b }
  }
  b.maybeSingle = () => Promise.resolve(result)
  b.single      = () => Promise.resolve(result)
  b.then        = (fn?: (r: QueryResult) => unknown) => Promise.resolve(result).then(fn)
  b._calls      = calls
  return b as Record<string, unknown> & { _calls: Array<[string, unknown[]]> }
}

const env = {
  SUPABASE_URL: 'http://test',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
  VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:t@t',
} as const

beforeEach(() => {
  createClientMock.mockReset()
})

describe('processWaitlistOffers', () => {
  it('returns zero counts when there are no pending offers', async () => {
    const offersBuilder = builder({ data: [], error: null })
    createClientMock.mockReturnValue({
      from: () => offersBuilder,
      functions: { invoke: vi.fn() },
      rpc: vi.fn(),
    })
    const result = await processWaitlistOffers(env)
    expect(result).toEqual({ sent: 0, expired: 0 })
  })

  it('expires an offer whose expires_at has passed AND chains to the next waitlister via RPC', async () => {
    const expiredOffer = {
      id: 'o-stale', booking_id: 'b-stale',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      notified_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      status: 'pending',
    }
    const updateCalls: Array<{ values: unknown; eqArgs: unknown[] }> = []
    const rpcMock = vi.fn().mockResolvedValue({ data: 'next-offer-id', error: null })
    let offersFetched = false

    createClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'waitlist_offers' && !offersFetched) {
          offersFetched = true
          return builder({ data: [expiredOffer], error: null })
        }
        if (table === 'waitlist_offers') {
          const b = builder({ data: null, error: null })
          const orig = b.update as (v: unknown) => unknown
          b.update = (v: unknown) => {
            updateCalls.push({ values: v, eqArgs: [] })
            const wrapped = orig.call(b, v) as Record<string, unknown>
            const origEq = wrapped.eq as (...a: unknown[]) => unknown
            wrapped.eq = (...a: unknown[]) => {
              updateCalls[updateCalls.length - 1].eqArgs = a
              return origEq.apply(wrapped, a)
            }
            return wrapped
          }
          return b
        }
        if (table === 'bookings') {
          return builder({ data: { event_id: 'd-fully' }, error: null })
        }
        return builder({ data: [], error: null })
      },
      functions: { invoke: vi.fn() },
      rpc: rpcMock,
    })

    const result = await processWaitlistOffers(env)
    expect(result.expired).toBe(1)
    expect(result.sent).toBe(0)
    const expireUpdate = updateCalls.find(c => (c.values as { status?: string }).status === 'expired')
    expect(expireUpdate).toBeTruthy()
    expect(expireUpdate?.eqArgs).toEqual(['id', 'o-stale'])
    expect(rpcMock).toHaveBeenCalledWith(
      'offer_next_waitlist_spot',
      { p_event_id: 'd-fully' },
    )
  })

  it('skips offers that already have notified_at — idempotent re-runs do not double-send', async () => {
    const alreadySent = {
      id: 'o-sent', booking_id: 'b1',
      // future expiry, but already-notified — worker should leave it alone.
      expires_at: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      notified_at: new Date().toISOString(),
      status: 'pending',
    }
    const invokeMock = vi.fn()
    const rpcMock    = vi.fn()

    createClientMock.mockReturnValue({
      from: () => builder({ data: [alreadySent], error: null }),
      functions: { invoke: invokeMock },
      rpc: rpcMock,
    })

    const result = await processWaitlistOffers(env)
    expect(result).toEqual({ sent: 0, expired: 0 })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('sends push + email + writes the inbox row + stamps notified_at for an unnotified live offer', async () => {
    const liveOffer = {
      id: 'o-new', booking_id: 'b-new',
      expires_at: new Date(Date.now() + 23 * 3_600_000).toISOString(),
      notified_at: null,
      status: 'pending',
    }
    const inserted: unknown[] = []
    const updates:  Array<{ values: unknown; eqArgs: unknown[] }> = []
    const invokeMock = vi.fn().mockResolvedValue({ data: { ok: true } })

    let offersFetched = false
    createClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'waitlist_offers' && !offersFetched) {
          offersFetched = true
          return builder({ data: [liveOffer], error: null })
        }
        if (table === 'waitlist_offers') {
          const b = builder({ data: null, error: null })
          const origUpdate = b.update as (v: unknown) => unknown
          b.update = (v: unknown) => {
            updates.push({ values: v, eqArgs: [] })
            const wrapped = origUpdate.call(b, v) as Record<string, unknown>
            const origEq = wrapped.eq as (...a: unknown[]) => unknown
            wrapped.eq = (...a: unknown[]) => {
              updates[updates.length - 1].eqArgs = a
              return origEq.apply(wrapped, a)
            }
            return wrapped
          }
          return b
        }
        if (table === 'bookings') {
          return builder({ data: { user_id: 'u1', event_id: 'd-full' }, error: null })
        }
        if (table === 'events') {
          return builder({ data: { display_title: 'Green Island Fun Dive', admin_title: null }, error: null })
        }
        if (table === 'notifications') {
          const b = builder({ data: null, error: null })
          const orig = b.insert as (v: unknown) => unknown
          b.insert = (v: unknown) => { inserted.push(v); return orig.call(b, v) }
          return b
        }
        if (table === 'push_subscriptions') {
          // No subscribers — exercises the "inbox-only" path. Push fan-out
          // is the same code as the duty/broadcast paths (already tested
          // separately) so we don't need a subscription fixture here.
          return builder({ data: [], error: null })
        }
        return builder({ data: [], error: null })
      },
      functions: { invoke: invokeMock },
      rpc: vi.fn(),
    })

    const result = await processWaitlistOffers(env)
    expect(result.sent).toBe(1)
    expect(result.expired).toBe(0)

    // Inbox row written with the new 'waitlist_offer' kind so the inbox
    // tab can render it like any other notification.
    expect(inserted.length).toBe(1)
    const inbox = inserted[0] as { kind: string; user_id: string; event_id: string | null; url: string }
    expect(inbox.kind).toBe('waitlist_offer')
    expect(inbox.user_id).toBe('u1')
    expect(inbox.event_id).toBe('d-full')
    expect(inbox.url).toBe('/records/bookings')

    // Email delegated to the edge function (worker can't talk SMTP).
    expect(invokeMock).toHaveBeenCalledWith('notify-waitlist-offer', { body: { offer_id: 'o-new' } })

    // notified_at stamped so the next tick won't re-deliver.
    const stamp = updates.find(u => (u.values as { notified_at?: string }).notified_at)
    expect(stamp).toBeTruthy()
    expect(stamp?.eqArgs).toEqual(['id', 'o-new'])
  })
})
