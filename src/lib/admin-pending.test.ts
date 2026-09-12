import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PENDING_ROUTES, countOnHoldAccounts, countOpenDiscountRequests,
  countOpenRefundRequests, countTaxonProposals, fetchPendingCounts,
} from './admin-pending'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

/** Records the filters a count applied, so the test can pin the definition. */
function counter(count: number | null, calls: string[] = []) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'not', 'is', 'in']) {
    b[m] = (...args: unknown[]) => { calls.push(`${m}(${args.map(String).join(',')})`); return b }
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ count, error: null }).then(res, rej)
  return b
}

beforeEach(() => from.mockReset())

describe('the counts', () => {
  it('counts on-hold accounts', async () => {
    const calls: string[] = []
    from.mockReturnValue(counter(3, calls))
    expect(await countOnHoldAccounts()).toBe(3)
    expect(from).toHaveBeenCalledWith('profiles')
    expect(calls).toContain('eq(status,pending)')
  })

  // Approving a refund cancels the booking, which is what drops it off the
  // queue this badge links to. Counting cancelled ones would keep a decided
  // request on the badge forever.
  it('counts open refund requests, excluding cancelled bookings', async () => {
    const calls: string[] = []
    from.mockReturnValue(counter(2, calls))
    expect(await countOpenRefundRequests()).toBe(2)
    expect(from).toHaveBeenCalledWith('bookings')
    expect(calls).toContain('not(refund_requested_at,is,null)')
    expect(calls).toContain('neq(status,cancelled)')
  })

  // decide_booking_discount refuses a cancelled booking, so a request on one
  // is a decision nobody can make.
  it('counts undecided discount requests, excluding cancelled bookings', async () => {
    const calls: string[] = []
    from.mockReturnValue(counter(1, calls))
    expect(await countOpenDiscountRequests()).toBe(1)
    expect(from).toHaveBeenCalledWith('booking_discounts')
    expect(calls).toContain('eq(status,requested)')
    expect(calls).toContain('neq(bookings.status,cancelled)')
  })

  it('counts wildlife proposals', async () => {
    const calls: string[] = []
    from.mockReturnValue(counter(5, calls))
    expect(await countTaxonProposals()).toBe(5)
    expect(from).toHaveBeenCalledWith('taxa')
    expect(calls).toContain('eq(status,pending)')
  })

  it('reads a null count as nothing waiting', async () => {
    from.mockReturnValue(counter(null))
    expect(await countOnHoldAccounts()).toBe(0)
  })
})

describe('fetchPendingCounts', () => {
  it('returns one entry per badgeable route', async () => {
    from.mockImplementation(() => counter(4))
    const counts = await fetchPendingCounts()
    expect(Object.keys(counts).sort()).toEqual([...PENDING_ROUTES].sort())
    expect(Object.values(counts)).toEqual([4, 4, 4, 4])
  })

  // One page an admin cannot read (or a query that breaks) must not blank the
  // other three chips — the hub then says nothing about that page, which is
  // exactly what it said before any of this existed.
  it('reports a failing queue as zero and keeps the rest', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'taxa') {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'neq', 'not', 'is', 'in']) b[m] = () => b
        b.then = (_res: unknown, rej?: (e: unknown) => unknown) =>
          Promise.reject(new Error('denied')).catch(e => rej ? rej(e) : Promise.reject(e))
        return b
      }
      return counter(2)
    })
    const counts = await fetchPendingCounts()
    expect(counts['/admin/wildlife']).toBe(0)
    expect(counts['/admin/refunds']).toBe(2)
  })
})
