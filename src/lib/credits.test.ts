import { describe, it, expect, vi, beforeEach } from 'vitest'
import { siteConfig } from '../config/site'
import type { AppEvent } from '../types/database'

const { from, rpc, creditsInsert } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  creditsInsert: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
  creditsInsert.mockReset().mockResolvedValue({ error: null })
})

// Chainable + awaitable stand-in: every filter method returns the same
// object, and awaiting it yields the table's canned result.
function tableBuilder(result: unknown, insert?: typeof creditsInsert) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order']) b[m] = () => b
  b.then = (f: (r: unknown) => unknown) => Promise.resolve(result).then(f)
  if (insert) b.insert = insert
  return b
}

function setup(opts: {
  bookings?: { data: unknown; error?: unknown }
  payments?: { data: unknown; error?: unknown }
  credits?: { data: unknown; error?: unknown }
}) {
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return tableBuilder(opts.bookings ?? { data: [], error: null })
    if (table === 'payments') return tableBuilder(opts.payments ?? { data: [], error: null })
    if (table === 'credits') return tableBuilder(opts.credits ?? { data: [], error: null }, creditsInsert)
    throw new Error(`unexpected table: ${table}`)
  })
}

const event = {
  id: 'evt1',
  type: 'dive',
  title: 'Green Island Fun Dive',
  start_time: '2026-05-18T00:00:00+08:00',
} as unknown as AppEvent

describe('openCreditForBooking', () => {
  const credits = [
    { id: 'c1', booking_id: 'b1', amount: 1000, status: 'open' },
    { id: 'c2', booking_id: 'b1', amount: 500, status: 'open' },
    { id: 'c3', booking_id: 'b1', amount: 9999, status: 'settled' },
    { id: 'c4', booking_id: 'b2', amount: 700, status: 'open' },
    { id: 'c5', booking_id: null, amount: 300, status: 'open' },
  ] as unknown as import('../types/database').Credit[]

  it('sums only open credits tied to the given booking', async () => {
    const { openCreditForBooking } = await import('./credits')
    expect(openCreditForBooking(credits, 'b1')).toBe(1500)
    expect(openCreditForBooking(credits, 'b2')).toBe(700)
  })

  it('returns 0 when a booking has no open credits', async () => {
    const { openCreditForBooking } = await import('./credits')
    expect(openCreditForBooking(credits, 'b3')).toBe(0)
  })
})

describe('diverCreditBalance', () => {
  it('counts an overpayment as credit owed to the diver', async () => {
    const { diverCreditBalance } = await import('./credits')
    // owed 8,150, paid 8,700 → 550 credit; no awarded rows.
    expect(diverCreditBalance([], [{ id: 'b1', owed: 8150, paid: 8700 }])).toBe(550)
  })

  it('adds awarded open credits to overpayments and ignores underpayments', async () => {
    const { diverCreditBalance } = await import('./credits')
    const credits = [
      { id: 'c1', booking_id: null, amount: 1000, status: 'open' },   // general
      { id: 'c2', booking_id: 'b2', amount: 200, status: 'open' },    // tied to b2
      { id: 'c3', booking_id: 'bX', amount: 999, status: 'settled' }, // settled → ignored
    ] as unknown as import('../types/database').Credit[]
    const bookings = [
      { id: 'b1', owed: 100, paid: 250 },   // 150 overpaid
      { id: 'b2', owed: 500, paid: 100 },   // owes 400, but +200 awarded credit → still owes, contributes 0
      { id: 'b3', owed: 300, paid: 300 },   // settled, 0
    ]
    // general 1000 + b1 overpay 150 + b2 max(0,100+200-500)=0 + b3 0 = 1150
    expect(diverCreditBalance(credits, bookings)).toBe(1150)
  })

  it('excludes lead-covered bookings — their overpayment belongs to the lead, not this diver', async () => {
    const { diverCreditBalance } = await import('./credits')
    const bookings = [
      { id: 'b1', owed: 100, paid: 250 },   // 150 overpaid by the diver
      { id: 'b2', owed: 500, paid: 800 },   // lead overpaid 300 — NOT the diver's
    ]
    // Without exclusion both overpayments would count (450); with b2 covered, only b1's 150.
    expect(diverCreditBalance([], bookings)).toBe(450)
    expect(diverCreditBalance([], bookings, new Set(['b2']))).toBe(150)
  })

  it('drops a covered booking\'s tied credit from the per-booking term', async () => {
    const { diverCreditBalance } = await import('./credits')
    const credits = [
      { id: 'c1', booking_id: 'b2', amount: 200, status: 'open' }, // tied to the covered booking
    ] as unknown as import('../types/database').Credit[]
    const bookings = [{ id: 'b2', owed: 500, paid: 800 }] // lead overpaid 300
    // b2 is covered → excluded from per-booking; its tied credit is then treated
    // as general (counted once): result 200, not 300+200.
    expect(diverCreditBalance(credits, bookings, new Set(['b2']))).toBe(200)
  })
})

describe('issueCancellationCredits', () => {
  it('credits each registrant their paid total, skipping zero-paid and already-credited bookings', async () => {
    setup({
      bookings: { data: [{ id: 'b1', user_id: 'u1' }, { id: 'b2', user_id: 'u2' }, { id: 'b3', user_id: 'u3' }], error: null },
      payments: {
        data: [
          { booking_id: 'b1', amount: 3000 },
          { booking_id: 'b1', amount: 2000 },
          { booking_id: 'b2', amount: 4000 },
          // b3 paid nothing → no credit
        ],
        error: null,
      },
      credits: { data: [{ booking_id: 'b2' }], error: null }, // b2 already credited → skip
    })

    const { issueCancellationCredits } = await import('./credits')
    const res = await issueCancellationCredits({ event, createdBy: 'admin1' })

    expect(res).toEqual({ issued: 1, totalAmount: 5000 })
    const rows = creditsInsert.mock.calls[0][0]
    expect(rows).toEqual([
      {
        user_id: 'u1',
        booking_id: 'b1',
        amount: 5000,
        reason: 'Refund credit for cancelled event: Green Island Fun Dive (May 18, 2026)',
        created_by: 'admin1',
        status: 'open',
      },
    ])
  })

  it('no-ops when the event has no non-cancelled bookings', async () => {
    setup({ bookings: { data: [], error: null } })
    const { issueCancellationCredits } = await import('./credits')
    const res = await issueCancellationCredits({ event, createdBy: 'admin1' })
    expect(res).toEqual({ issued: 0, totalAmount: 0 })
    expect(creditsInsert).not.toHaveBeenCalled()
  })

  it('no-ops (no insert) when every registrant has either paid nothing or already been credited', async () => {
    setup({
      bookings: { data: [{ id: 'b1', user_id: 'u1' }], error: null },
      payments: { data: [], error: null },
    })
    const { issueCancellationCredits } = await import('./credits')
    const res = await issueCancellationCredits({ event, createdBy: 'admin1' })
    expect(res).toEqual({ issued: 0, totalAmount: 0 })
    expect(creditsInsert).not.toHaveBeenCalled()
  })

  it('throws when the bookings lookup fails', async () => {
    setup({ bookings: { data: null, error: { message: 'boom' } } })
    const { issueCancellationCredits } = await import('./credits')
    await expect(issueCancellationCredits({ event, createdBy: 'admin1' })).rejects.toEqual({ message: 'boom' })
  })

  it('filters bookings by event_id for course events', async () => {
    const eqSpy = vi.fn()
    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              eqSpy(col, val)
              return { neq: () => Promise.resolve({ data: [], error: null }) }
            },
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const courseEvent = { ...event, type: 'course', id: 'crs9' } as unknown as AppEvent
    const { issueCancellationCredits } = await import('./credits')
    await issueCancellationCredits({ event: courseEvent, createdBy: 'admin1' })
    expect(eqSpy).toHaveBeenCalledWith('event_id', 'crs9')
  })
})

describe('applyCreditToBooking', () => {
  it('forwards booking + amount to the RPC and returns the applied figure', async () => {
    rpc.mockResolvedValue({ data: 1500, error: null })
    const { applyCreditToBooking } = await import('./credits')

    const applied = await applyCreditToBooking({ bookingId: 'b1', amount: 2000 })

    expect(applied).toBe(1500)
    expect(rpc).toHaveBeenCalledWith('apply_credit_to_booking', { p_booking_id: 'b1', p_amount: 2000 })
  })

  it('coerces a null result to 0', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { applyCreditToBooking } = await import('./credits')
    expect(await applyCreditToBooking({ bookingId: 'b1', amount: 500 })).toBe(0)
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not your booking' } })
    const { applyCreditToBooking } = await import('./credits')
    await expect(applyCreditToBooking({ bookingId: 'b1', amount: 500 })).rejects.toBeTruthy()
  })
})

describe('openCreditBalance', () => {
  it('sums only open credits, ignoring settled, and coerces string amounts', async () => {
    const { openCreditBalance } = await import('./credits')
    const credits = [
      { id: 'c1', status: 'open', amount: 5000 },
      { id: 'c2', status: 'open', amount: '2500' },
      { id: 'c3', status: 'settled', amount: 9999 },
    ] as unknown as import('../types/database').Credit[]
    expect(openCreditBalance(credits)).toBe(7500)
  })

  it('returns 0 for an empty list', async () => {
    const { openCreditBalance } = await import('./credits')
    expect(openCreditBalance([])).toBe(0)
  })
})

// createCredit / settleCredit / reopenCredit all end in
// .insert|update(...).select('*').single(); this stub captures the write
// payload and resolves the chain to a canned row.
function setupCreditWrite(result: { data: unknown; error?: unknown }) {
  const single = () => Promise.resolve({ data: result.data, error: result.error ?? null })
  const select = vi.fn(() => ({ single }))
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn(() => ({ eq }))
  const insert = vi.fn(() => ({ select }))
  from.mockImplementation((table: string) => {
    if (table === 'credits') return { insert, update }
    throw new Error(`unexpected table: ${table}`)
  })
  return { insert, update }
}

const settledRow = { id: 'c9', status: 'open', amount: 1000 } as unknown as import('../types/database').Credit

describe('createCredit', () => {
  it('inserts an open credit, defaulting currency to the shop default and booking_id to null', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createCredit } = await import('./credits')
    await createCredit({ user_id: 'u1', amount: 1500, reason: 'Goodwill', created_by: 'admin' })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1', booking_id: null, amount: 1500, currency: siteConfig.locale.currency,
      reason: 'Goodwill', created_by: 'admin', status: 'open',
    })
  })

  it('passes through an explicit currency and booking_id', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createCredit } = await import('./credits')
    await createCredit({ user_id: 'u1', amount: 200, reason: 'r', created_by: 'a', booking_id: 'b1', currency: 'USD' })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ booking_id: 'b1', currency: 'USD' }))
  })

  it('throws when the insert returns no row', async () => {
    setupCreditWrite({ data: null, error: { message: 'insert failed' } })
    const { createCredit } = await import('./credits')
    await expect(createCredit({ user_id: 'u1', amount: 1, reason: 'r', created_by: 'a' })).rejects.toBeTruthy()
  })
})

describe('settleCredit', () => {
  it('marks the credit settled with a note and a timestamp', async () => {
    const { update } = setupCreditWrite({ data: { ...settledRow, status: 'settled' } })
    const { settleCredit } = await import('./credits')
    const result = await settleCredit({ creditId: 'c9', note: 'Refunded by bank transfer' })
    expect(result.status).toBe('settled')
    const payload = update.mock.calls[0][0] as { status: string; settled_note: string; settled_at: string }
    expect(payload.status).toBe('settled')
    expect(payload.settled_note).toBe('Refunded by bank transfer')
    expect(typeof payload.settled_at).toBe('string')
  })

  it('throws when the update returns no row', async () => {
    setupCreditWrite({ data: null })
    const { settleCredit } = await import('./credits')
    await expect(settleCredit({ creditId: 'c9', note: 'x' })).rejects.toBeTruthy()
  })
})

describe('reopenCredit', () => {
  it('clears the settled fields and flips status back to open', async () => {
    const { update } = setupCreditWrite({ data: settledRow })
    const { reopenCredit } = await import('./credits')
    await reopenCredit('c9')
    expect(update).toHaveBeenCalledWith({ status: 'open', settled_at: null, settled_note: null })
  })

  it('throws when the update returns no row', async () => {
    setupCreditWrite({ data: null })
    const { reopenCredit } = await import('./credits')
    await expect(reopenCredit('c9')).rejects.toBeTruthy()
  })
})
