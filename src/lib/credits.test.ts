import { describe, it, expect, vi, beforeEach } from 'vitest'
import { siteConfig } from '../config/site'

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

describe('cancellationKept', () => {
  // Net paid alone used to answer this, because a cancelled booking was either
  // kept whole or returned whole. A non-refundable deposit splits it.
  const credits = [
    { id: 'c1', booking_id: 'b1', amount: 10400, status: 'open', source: 'booking_cancellation_return' },
    { id: 'c2', booking_id: 'b2', amount: 3000, status: 'settled', source: 'booking_cancellation_return' },
    { id: 'c3', booking_id: 'b3', amount: 2000, status: 'open', source: 'manual' },
  ] as unknown as import('../types/database').Credit[]

  it('is net paid less what was returned as a cancellation credit', async () => {
    const { cancellationKept } = await import('./credits')
    expect(cancellationKept(15400, credits, 'b1')).toBe(5000)
  })

  it('still counts a returned credit the diver has already spent', async () => {
    const { cancellationKept } = await import('./credits')
    expect(cancellationKept(3000, credits, 'b2')).toBe(0)
  })

  it('ignores credits that did not return this booking money', async () => {
    const { cancellationKept } = await import('./credits')
    expect(cancellationKept(2000, credits, 'b3')).toBe(2000)
  })

  it('is the whole net paid when nothing came back', async () => {
    const { cancellationKept } = await import('./credits')
    expect(cancellationKept(5000, credits, 'b9')).toBe(5000)
  })

  it('never goes negative when more was credited than paid', async () => {
    const { cancellationKept } = await import('./credits')
    expect(cancellationKept(9000, credits, 'b1')).toBe(0)
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

  it('returns a cancelled booking\'s tied credit to the spendable balance', async () => {
    const { diverCreditBalance } = await import('./credits')
    // What trg_bookings_return_account_credit_on_cancel writes: an open credit
    // pinned to the booking the diver just had cancelled. Callers pass only
    // NON-cancelled bookings, so that booking is absent from the list and its
    // credit falls into the general term — spendable again, which is the whole
    // point of the reversal.
    const credits = [
      { id: 'c1', booking_id: 'b-cancelled', amount: 2800, status: 'open' },
    ] as unknown as import('../types/database').Credit[]
    expect(diverCreditBalance(credits, [{ id: 'b-live', owed: 3000, paid: 0 }])).toBe(2800)
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

// createCredit / createAccountCharge end in
// .insert(...).select('*').single(); this stub captures the write payload and
// resolves the chain to a canned row.
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
      reason: 'Goodwill', created_by: 'admin', status: 'open', source: 'manual',
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

describe('createAccountCharge', () => {
  it('stores the charge as a negative row, untied, stamped admin_charge', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountCharge } = await import('./credits')
    await createAccountCharge({ user_id: 'u1', amount: 1200, reason: 'Mask bought in the shop', created_by: 'admin' })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1', booking_id: null, amount: -1200, currency: siteConfig.locale.currency,
      reason: 'Mask bought in the shop', created_by: 'admin', status: 'open', source: 'admin_charge',
    })
  })

  // The caller says how much to charge; the sign is the function's business.
  // A caller passing -1200 "to be helpful" must not end up issuing credit.
  it('refuses a non-positive amount rather than flipping it into a credit', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountCharge } = await import('./credits')
    await expect(createAccountCharge({ user_id: 'u1', amount: -1200, reason: 'r', created_by: 'a' }))
      .rejects.toThrow(/positive/)
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses a blank reason — an unexplained charge is unanswerable later', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountCharge } = await import('./credits')
    await expect(createAccountCharge({ user_id: 'u1', amount: 100, reason: '  ', created_by: 'a' }))
      .rejects.toThrow(/reason/)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('createAccountRefund', () => {
  it('writes the same negative untied row as a charge, stamped admin_refund', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountRefund } = await import('./credits')
    await createAccountRefund({ user_id: 'u1', amount: 3000, reason: 'Bank transfer #4821', created_by: 'admin' })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1', booking_id: null, amount: -3000, currency: siteConfig.locale.currency,
      reason: 'Bank transfer #4821', created_by: 'admin', status: 'open', source: 'admin_refund',
    })
  })

  // The whole reason a refund is not just a charge with a different reason
  // string: a payout the shop made must never surface as a sale.
  it('never stamps admin_charge, whatever the reason says', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountRefund } = await import('./credits')
    await createAccountRefund({ user_id: 'u1', amount: 500, reason: 'Cash back', created_by: 'a' })
    expect(insert).toHaveBeenCalledWith(expect.not.objectContaining({ source: 'admin_charge' }))
  })

  it('refuses a non-positive amount rather than flipping it into a credit', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountRefund } = await import('./credits')
    await expect(createAccountRefund({ user_id: 'u1', amount: -3000, reason: 'r', created_by: 'a' }))
      .rejects.toThrow(/positive/)
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses a blank reason — a payout nobody can trace is the worst kind', async () => {
    const { insert } = setupCreditWrite({ data: settledRow })
    const { createAccountRefund } = await import('./credits')
    await expect(createAccountRefund({ user_id: 'u1', amount: 100, reason: '  ', created_by: 'a' }))
      .rejects.toThrow(/reason/)
    expect(insert).not.toHaveBeenCalled()
  })

  // A refund is spent money: it must reduce what the diver can spend, exactly
  // as a charge does. The ledger being signed is what makes that free.
  it('nets out of spendable credit like any other negative row', async () => {
    const { openCreditBalance } = await import('./credits')
    const rows = [
      { status: 'open', amount: 3000, source: 'manual', booking_id: null },
      { status: 'open', amount: -3000, source: 'admin_refund', booking_id: null },
    ] as unknown as import('../types/database').Credit[]
    expect(openCreditBalance(rows)).toBe(0)
  })
})

describe('a charge on the ledger', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'x', user_id: 'u1', booking_id: null, currency: 'TWD', reason: 'r',
    status: 'open', created_at: '2026-08-01T00:00:00Z', created_by: 'a',
    settled_at: null, settled_note: null, settled_by: null, source: 'manual',
    ...over,
  }) as unknown as import('../types/database').Credit

  it('nets against credit in the spendable balance', async () => {
    const { openCreditBalance } = await import('./credits')
    expect(openCreditBalance([
      row({ amount: 3000 }),
      row({ id: 'y', amount: -1200, source: 'admin_charge' }),
    ])).toBe(1800)
  })

  it('never leaves a negative amount to spend', async () => {
    const { openCreditBalance } = await import('./credits')
    expect(openCreditBalance([
      row({ amount: 500 }),
      row({ id: 'y', amount: -1200, source: 'admin_charge' }),
    ])).toBe(0)
  })

  it('reduces the account credit a diver can put toward bookings', async () => {
    const { diverCreditBalance } = await import('./credits')
    const credits = [row({ amount: 3000 }), row({ id: 'y', amount: -1200, source: 'admin_charge' })]
    expect(diverCreditBalance(credits, [{ id: 'b1', owed: 0, paid: 0 }])).toBe(1800)
  })

  it('is never itself drained by a credit sweep', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const credits = [row({ amount: 3000 }), row({ id: 'y', amount: -1200, source: 'admin_charge' })]
    // 1,800 spendable against a 5,000 balance — not 3,000, and not 4,200 from
    // "consuming" the charge.
    expect(plannedCreditApplication(credits, [{ id: 'b1', due: 5000 }])).toBe(1800)
  })
})

// The one-tap "use my credit" button promised min(openCreditBalance, totalOwed).
// Both halves lie: totalOwed counts groups the sweep never visits, and
// openCreditBalance counts credit tied to a booking the RPC will not spend
// against itself. plannedCreditApplication replays the RPC instead.
describe('plannedCreditApplication', () => {
  type C = import('../types/database').Credit
  const credit = (id: string, amount: number, bookingId: string | null, createdAt: string): C =>
    ({ id, amount, booking_id: bookingId, status: 'open', created_at: createdAt }) as unknown as C

  it('spends general credit up to what is due', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const credits = [credit('c1', 5000, null, '2026-01-01')]
    expect(plannedCreditApplication(credits, [{ id: 'b1', due: 2000 }])).toBe(2000)
  })

  it('is capped by the pool when the pool is the smaller side', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const credits = [credit('c1', 800, null, '2026-01-01')]
    expect(plannedCreditApplication(credits, [{ id: 'b1', due: 2000 }])).toBe(800)
  })

  it('promises nothing when the only credit is tied to the booking itself', async () => {
    const { plannedCreditApplication } = await import('./credits')
    // The exact case the old label got wrong: a 3000 credit awarded against
    // b1, which owes 2000 after that credit offsets it. The RPC excludes a
    // booking's own credit from its spendable pool, so it applies 0.
    const credits = [credit('c1', 3000, 'b1', '2026-01-01')]
    expect(plannedCreditApplication(credits, [{ id: 'b1', due: 2000 }])).toBe(0)
  })

  it('spends a credit tied to another booking against this one', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const credits = [credit('c1', 3000, 'b-cancelled', '2026-01-01')]
    expect(plannedCreditApplication(credits, [{ id: 'b1', due: 2000 }])).toBe(2000)
  })

  it('drains the pool across targets so the second sees what the first left', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const credits = [credit('c1', 2500, null, '2026-01-01')]
    expect(plannedCreditApplication(credits, [
      { id: 'b1', due: 2000 },
      { id: 'b2', due: 2000 },
    ])).toBe(2500)
  })

  it('consumes rows oldest-first, so a later target can still use a younger row tied to an earlier one', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const credits = [
      credit('c1', 1000, 'b1', '2026-01-01'),
      credit('c2', 1000, null, '2026-02-01'),
    ]
    // b1 cannot touch c1 (its own), so it takes 1000 from c2. b2 then has only
    // c1 left, which is not its own, so it takes that.
    expect(plannedCreditApplication(credits, [
      { id: 'b1', due: 1000 },
      { id: 'b2', due: 1000 },
    ])).toBe(2000)
  })

  it('ignores settled rows and non-positive dues', async () => {
    const { plannedCreditApplication } = await import('./credits')
    const settled = { ...credit('c1', 5000, null, '2026-01-01'), status: 'settled' } as C
    expect(plannedCreditApplication([settled], [{ id: 'b1', due: 2000 }])).toBe(0)
    expect(plannedCreditApplication([credit('c2', 5000, null, '2026-01-01')], [{ id: 'b1', due: 0 }])).toBe(0)
  })

  it('is zero with no targets and no credit', async () => {
    const { plannedCreditApplication } = await import('./credits')
    expect(plannedCreditApplication([], [])).toBe(0)
  })
})
