import { describe, it, expect } from 'vitest'
import { bookingBalance } from './booking-balance'
import { diverCreditBalance, openCreditForBooking } from './credits'
import type { Credit } from '../types/database'

// Two admin surfaces render the same money two different ways:
//
//   • /admin/events/:id shows ONE registrant at a time — bookingBalance(owed,
//     paid, creditForThisBooking), and when negative says "the shop owes this
//     diver X, included in their account credit".
//   • /admin/users shows ONE figure per diver — diverCreditBalance(), the sum
//     of their open credits and every overpayment.
//
// An admin reading both must not be shown two different numbers. That holds
// only while each active booking's credit balance is exactly its contribution
// to the account credit, which is what these tests pin. A production booking
// once read "7,200 credit" on the event page and fed the same inflated 7,200
// into the account credit — the pages agreed, the underlying data did not, so
// agreement between the two is necessary but never sufficient.

type Row = { id: string; owed: number; paid: number }

const credit = (id: string, amount: number, bookingId: string | null): Credit =>
  ({ id, amount, booking_id: bookingId, status: 'open', created_at: '2026-01-01' }) as unknown as Credit

/** What the event page prints for one registrant, as a signed figure: positive
 *  = money in the diver's favor, matching how account credit counts it. */
function eventPageCredit(row: Row, credits: Credit[], cancelled = false): number {
  const bal = bookingBalance(row.owed, row.paid, openCreditForBooking(credits, row.id), { cancelled })
  return bal.state === 'credit' ? bal.amount : 0
}

describe('event page and users page agree on what a diver is owed', () => {
  it('matches for a plain overpayment', () => {
    const rows: Row[] = [{ id: 'b1', owed: 3100, paid: 6700 }]
    expect(eventPageCredit(rows[0], [])).toBe(3600)
    expect(diverCreditBalance([], rows)).toBe(3600)
  })

  it('matches when an awarded credit sits on the booking', () => {
    const credits = [credit('c1', 1000, 'b1')]
    const rows: Row[] = [{ id: 'b1', owed: 3000, paid: 3000 }]
    expect(eventPageCredit(rows[0], credits)).toBe(1000)
    expect(diverCreditBalance(credits, rows)).toBe(1000)
  })

  it('matches across several bookings — the sum is the account credit', () => {
    const credits = [credit('c1', 4800, 'b2'), credit('c2', 4300, 'b3')]
    const rows: Row[] = [
      { id: 'b1', owed: 3100, paid: 6700 },  // overpaid 3,600
      { id: 'b2', owed: 5900, paid: 5900 },  // 4,800 awarded
      { id: 'b3', owed: 4300, paid: 4300 },  // 4,300 awarded
      { id: 'b4', owed: 3100, paid: 3100 },  // settled
    ]
    const perEvent = rows.reduce((s, r) => s + eventPageCredit(r, credits), 0)
    expect(perEvent).toBe(12700)
    expect(diverCreditBalance(credits, rows)).toBe(12700)
  })

  it('does not let a booking that owes money cancel out another that is in credit', () => {
    // The event page never shows a negative credit, and the account credit
    // floors each booking at zero, so a debt on one booking must not silently
    // reduce what the shop owes on another.
    const rows: Row[] = [
      { id: 'b1', owed: 1000, paid: 3000 },  // 2,000 in credit
      { id: 'b2', owed: 5000, paid: 1000 },  // 4,000 owing
    ]
    expect(rows.reduce((s, r) => s + eventPageCredit(r, []), 0)).toBe(2000)
    expect(diverCreditBalance([], rows)).toBe(2000)
  })

  it('agrees on a cancelled booking: no live balance, but the credit is still owed', () => {
    // The event page short-circuits a cancelled booking to settled, so it
    // contributes no balance. The users page counts its tied credit as general
    // account credit — callers pass only NON-cancelled rows. Both are right:
    // nothing more is owed for the trip, and the credit is still the diver's.
    const credits = [credit('c1', 3000, 'b-cancelled')]
    const cancelledRow: Row = { id: 'b-cancelled', owed: 3000, paid: 3000 }
    expect(eventPageCredit(cancelledRow, credits, true)).toBe(0)
    expect(diverCreditBalance(credits, [])).toBe(3000)
  })

  it('keeps a lead-covered booking out of the diver own account credit', () => {
    // The money on a booking someone else pays for belongs to the payer. The
    // event page must not claim it is in THIS diver's account credit — hence
    // the separate shopOwesPayer wording — because the users page drops it.
    const rows: Row[] = [{ id: 'b1', owed: 1000, paid: 3000 }]
    expect(eventPageCredit(rows[0], [])).toBe(2000)
    expect(diverCreditBalance([], rows, new Set(['b1']))).toBe(0)
  })
})
