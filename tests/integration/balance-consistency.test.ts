import { describe, it, expect, afterAll } from 'vitest'
import { adminClient, userClient } from './helpers'
import { scenario, tracker, teardown } from './scenario'
import { bookingBalance, depositDue } from '../../src/lib/booking-balance'
import { netPaid } from '../../src/lib/payments'
import { amendmentsDelta } from '../../src/lib/booking-amendments'

// Every bug in this area has had the same shape: two surfaces looking at the
// same booking and disagreeing about it. The diver page said one thing and the
// admin page another; the screen said one thing and the RPC another; the push
// notification chased a figure the payments page had never heard of.
//
// So rather than assert a number, these assert AGREEMENT — and they assert
// invariants that must hold for any booking, not just the one in the fixture.
// An example-based test tells you the case you thought of still works. An
// invariant tells you the case you did not think of is impossible.
//
// Scenarios are driven through real transitions (see ./scenario.ts) because
// none of these bugs were reachable from a booking assembled at its end state.

const admin = adminClient()
const cleanup = tracker()
afterAll(() => teardown(cleanup, admin))

/** Recompute a booking's figures the way src/lib does, from raw rows. */
async function fromLibrary(bookingId: string, userId: string) {
  const [booking, amendments, payments, credits] = await Promise.all([
    admin.from('bookings').select('status, details').eq('id', bookingId).single(),
    admin.from('booking_amendments').select('*').eq('booking_id', bookingId),
    admin.from('payments').select('*').eq('booking_id', bookingId),
    admin.from('credits').select('*').eq('user_id', userId).eq('status', 'open'),
  ])
  const row = booking.data as { status: string; details: { total?: number; deposit?: number } | null }
  const details = row.details ?? {}
  const cancelled = row.status === 'cancelled'
  const owed = Number(details.total ?? 0) + amendmentsDelta(amendments.data ?? [])
  const paid = netPaid(payments.data ?? [])
  const credit = (credits.data ?? [])
    .filter(c => c.booking_id === bookingId)
    .reduce((s, c) => s + Number(c.amount), 0)
  return {
    owed, paid, credit, cancelled,
    bal: bookingBalance(owed, paid, credit, { cancelled }),
    depositDue: cancelled ? 0 : depositDue(Number(details.deposit ?? 0), owed, paid),
  }
}

describe('a booking means the same thing on every surface', () => {
  it('the scenario harness and the shared library agree, through a full lifecycle', async () => {
    // Booked, discounted, part-paid, part-refunded, and holding credit — the
    // combination none of the single-step tests ever produced.
    const s = await scenario(cleanup, admin).booking({ total: 3000, deposit: 1000 })
    await s.discount(400)
    await s.pay(2000)
    await s.refund(300)
    await s.awardCredit(500)

    const mine = await s.figures()
    const lib = await fromLibrary(s.bookingId, s.diver.id)

    expect(mine.owed).toBe(2600)     // 3000 − 400 discount
    expect(mine.paid).toBe(1700)     // 2000 paid − 300 refunded
    expect(mine.credit).toBe(500)
    expect(mine.net).toBe(400)       // 2600 − 1700 − 500

    expect(lib.owed).toBe(mine.owed)
    expect(lib.paid).toBe(mine.paid)
    expect(lib.credit).toBe(mine.credit)
    expect(lib.bal.net).toBe(mine.net)
  })

  it('what the page says is due is exactly what the RPC will settle', async () => {
    // The refund-netting bug lived precisely here: the screen said 2300 due,
    // apply_credit_to_booking would only ever settle 2000, and the diver was
    // left with a residue they could not clear and no error explaining it.
    const s = await scenario(cleanup, admin).booking({ total: 3000, deposit: 1000 })
    await s.pay(1000)
    await s.refund(300)
    await s.awardCredit(5000, 'general')

    const before = await s.figures()
    const applied = await s.applyCredit(before.net)

    expect(applied).toBe(before.net)
    expect((await s.figures()).net).toBe(0)
  })

  it('a discount cannot strand a deposit — settled means nothing is due', async () => {
    // The reported bug, as an invariant rather than an example.
    const s = await scenario(cleanup, admin).booking({ total: 3000, deposit: 3000 })
    await s.discount(400)
    await s.pay(2600)

    const f = await s.figures()
    expect(f.net).toBe(0)
    expect(f.depositDue).toBe(0)
    expect((await fromLibrary(s.bookingId, s.diver.id)).depositDue).toBe(0)
  })

  it('paying an amended balance in full confirms the booking', async () => {
    // The mirror of the same bug on the server: the frozen deposit outran the
    // discounted balance, so a diver who had paid everything stayed pending.
    const s = await scenario(cleanup, admin).booking({ total: 3000, deposit: 3000 }, 'pending')
    await s.discount(2200)          // owes 800
    await s.awardCredit(5000, 'general')
    await s.applyCredit(800)

    const f = await s.figures()
    expect(f.net).toBe(0)
    expect(f.status).toBe('confirmed')
  })

  it('a cancelled booking owes nothing, and no deposit either', async () => {
    const s = await scenario(cleanup, admin).booking({ total: 3000, deposit: 1000 })
    await s.pay(500)
    await s.setStatus('cancelled')

    const f = await s.figures()
    const lib = await fromLibrary(s.bookingId, s.diver.id)
    expect(f.net).toBe(0)
    expect(f.depositDue).toBe(0)
    expect(lib.bal.state).toBe('settled')
    expect(lib.depositDue).toBe(0)
  })

  it('the deposit never exceeds the balance, across a spread of shapes', async () => {
    // An invariant sweep rather than one example: whatever the discount, the
    // deposit is a down payment ON the balance and cannot outgrow it.
    for (const [total, deposit, discount, pay] of [
      [3000, 1000, 0, 0], [3000, 3000, 400, 2600], [3000, 1000, 2500, 500],
      [1000, 1000, 0, 1000], [5000, 2000, 4500, 500],
    ] as const) {
      const s = await scenario(cleanup, admin).booking({ total, deposit })
      if (discount) await s.discount(discount)
      if (pay) await s.pay(pay)
      const f = await s.figures()
      expect(f.depositDue).toBeLessThanOrEqual(Math.max(0, f.owed))
      if (f.net === 0) expect(f.depositDue).toBe(0)
    }
  })

  it('the diver sees the same balance the admin does', async () => {
    // Both read through RLS as their real selves — the parent/child bug was a
    // disagreement produced entirely by what each was allowed to select.
    const s = await scenario(cleanup, admin).booking({ total: 3000, deposit: 1000 })
    await s.discount(400)
    await s.pay(1000)
    await s.awardCredit(200)

    const asDiver = await userClient(s.diver.email, s.diver.password)
    const asAdmin = await userClient(s.adminUser.email, s.adminUser.password)

    async function balanceSeenBy(db: Awaited<ReturnType<typeof userClient>>) {
      const [b, a, p, c] = await Promise.all([
        db.from('bookings').select('status, details').eq('id', s.bookingId).single(),
        db.from('booking_amendments').select('*').eq('booking_id', s.bookingId),
        db.from('payments').select('*').eq('booking_id', s.bookingId),
        db.from('credits').select('*').eq('booking_id', s.bookingId).eq('status', 'open'),
      ])
      const details = (b.data as { details: { total?: number } | null }).details ?? {}
      const owed = Number(details.total ?? 0) + amendmentsDelta(a.data ?? [])
      return bookingBalance(owed, netPaid(p.data ?? []),
        (c.data ?? []).reduce((sum, x) => sum + Number(x.amount), 0)).net
    }

    expect(await balanceSeenBy(asDiver)).toBe(await balanceSeenBy(asAdmin))
    expect(await balanceSeenBy(asDiver)).toBe(1400) // 2600 − 1000 − 200
  })
})
