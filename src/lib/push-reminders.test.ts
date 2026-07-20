import { describe, it, expect } from 'vitest'
import { selectReminders, daysBetween, type ReminderInput, type ReminderKind } from './push-reminders'

const TODAY = '2026-05-01'

function mk(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    userId:         'u1',
    eventId:        'e1',
    eventType:      'dive',
    eventTitle:     'Green Island Fun Dive',
    eventStartDate: '2026-05-02', // 1 day away by default
    bookingStatus:  'confirmed',
    totalAmount:    3000,
    depositAmount:  1000,
    paidAmount:     0,
    creditAmount:   0,
    currency:       'TWD',
    alreadySent:    new Set<ReminderKind>(),
    ...overrides,
  }
}

describe('daysBetween', () => {
  it('treats inputs as date-only regardless of DST', () => {
    expect(daysBetween('2026-03-08', '2026-03-15')).toBe(7)
    expect(daysBetween('2026-05-01', '2026-05-01')).toBe(0)
    expect(daysBetween('2026-05-02', '2026-05-01')).toBe(-1)
  })
})

describe('selectReminders', () => {
  it('fires event_1d + payment_1d for a day-away booking with outstanding deposit', () => {
    const out = selectReminders(TODAY, [mk()])
    expect(out.map(r => r.kind).sort()).toEqual(['event_1d', 'payment_1d'])
    const pay = out.find(r => r.kind === 'payment_1d')!
    expect(pay.title).toContain('Deposit due')
    expect(pay.body).toContain('1,000')
    expect(pay.url).toBe('/records/payments')
  })

  it('fires only event reminder when fully paid', () => {
    const out = selectReminders(TODAY, [mk({ paidAmount: 3000 })])
    expect(out.map(r => r.kind)).toEqual(['event_1d'])
  })

  it('switches from Deposit to Balance once deposit is covered', () => {
    const out = selectReminders(TODAY, [mk({ paidAmount: 1500 })])
    const pay = out.find(r => r.kind === 'payment_1d')!
    expect(pay.title).toContain('Balance due')
    expect(pay.body).toContain('1,500') // 3000 - 1500
  })

  it('uses the 21-day window exactly', () => {
    const in21 = mk({ eventStartDate: '2026-05-22' })
    const in20 = mk({ eventStartDate: '2026-05-21' })
    expect(selectReminders(TODAY, [in21]).map(r => r.kind)).toEqual(['payment_21d'])
    expect(selectReminders(TODAY, [in20])).toEqual([]) // 20 isn't a reminder day
  })

  it('skips cancelled bookings entirely', () => {
    expect(selectReminders(TODAY, [mk({ bookingStatus: 'cancelled' })])).toEqual([])
  })

  it('skips events that are already in the past', () => {
    expect(selectReminders(TODAY, [mk({ eventStartDate: '2026-04-30' })])).toEqual([])
  })

  it('respects already-sent kinds (idempotent re-run)', () => {
    const out = selectReminders(TODAY, [
      mk({ alreadySent: new Set<ReminderKind>(['event_1d', 'payment_1d']) })
    ])
    expect(out).toEqual([])
  })

  it('fires 7-day windows for both event and payment simultaneously', () => {
    const out = selectReminders(TODAY, [mk({ eventStartDate: '2026-05-08' })])
    expect(out.map(r => r.kind).sort()).toEqual(['event_7d', 'payment_7d'])
  })

  it('fires payment-only windows when no event window aligns', () => {
    const out = selectReminders(TODAY, [mk({ eventStartDate: '2026-05-15' })]) // 14 days
    expect(out.map(r => r.kind)).toEqual(['payment_14d'])
  })

  it('deep-links event reminders to the Records bookings tab and payment reminders to the Records payments tab', () => {
    const out = selectReminders(TODAY, [mk()])
    expect(out.find(r => r.kind === 'event_1d')!.url).toBe('/records/bookings')
    expect(out.find(r => r.kind === 'payment_1d')!.url).toBe('/records/payments')
  })
})

describe('selectReminders — the balance it chases', () => {
  it('nets a discount off the amount demanded', () => {
    // totalAmount is owed, i.e. details.total plus the amendment ledger. The
    // reminder used to be built from details.total alone, so a discounted
    // diver was chased for the full pre-discount price.
    const out = selectReminders(TODAY, [mk({
      totalAmount: 2500, depositAmount: 0, paidAmount: 0,
    })])
    const pay = out.find(r => r.kind === 'payment_1d')!
    expect(pay.body).toContain('2,500')
  })

  it('counts open credit against the balance, as /records/payments does', () => {
    // The notification links to that page; the figures have to agree.
    const out = selectReminders(TODAY, [mk({
      totalAmount: 3000, depositAmount: 0, paidAmount: 1000, creditAmount: 500,
    })])
    const pay = out.find(r => r.kind === 'payment_1d')!
    expect(pay.body).toContain('1,500')
  })

  it('stays silent when credit already covers the whole balance', () => {
    // Nagging someone whose balance the shop has already covered is worse than
    // saying nothing.
    const out = selectReminders(TODAY, [mk({
      totalAmount: 3000, depositAmount: 0, paidAmount: 0, creditAmount: 3000,
    })])
    expect(out.map(r => r.kind)).not.toContain('payment_1d')
  })

  it('stays silent when a discount clears what was left to pay', () => {
    const out = selectReminders(TODAY, [mk({
      totalAmount: 1000, depositAmount: 0, paidAmount: 1000, creditAmount: 0,
    })])
    expect(out.map(r => r.kind)).not.toContain('payment_1d')
  })
})
