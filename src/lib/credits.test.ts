import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppEvent } from '../types/database'

const { from, creditsInsert } = vi.hoisted(() => ({
  from: vi.fn(),
  creditsInsert: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
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

  it('targets eo_course_id for course events', async () => {
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
    expect(eqSpy).toHaveBeenCalledWith('eo_course_id', 'crs9')
  })
})
