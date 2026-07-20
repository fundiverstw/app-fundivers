import { describe, it, expect } from 'vitest'
import {
  fiscalYearRange,
  normalizeTransactions,
  buildTransactionsCsv,
  buildByEventCsv,
  buildSummaryCsv,
  buildAccountingCsvs,
  type AccountingTransaction,
} from './accounting-export'
import { siteConfig } from '../config/site'
import type { Payment } from '../types/database'
import { EVENT_KIND_LABELS } from './event-kind-labels'

function payment(over: Partial<Payment>): Payment {
  return {
    id: 'pay-1',
    created_at: '2026-03-01T08:00:00.000Z',
    user_id: 'diver-1',
    booking_id: 'bk-1',
    amount: 1000,
    currency: 'TWD',
    status: 'paid',
    method: 'bank_transfer',
    note: null,
    recorded_by: 'admin-1',
    ...over,
  }
}

const diver = { id: 'diver-1', name: 'Dana Diver', email: 'dana@example.com' }
const admin = { id: 'admin-1', name: 'Avi Admin', email: 'avi@example.com' }
const diveBooking = { id: 'bk-1', user_id: 'diver-1', event_id: 'dive-1', status: 'confirmed', details: { total: 1000 } }
const dive = { id: 'dive-1', kind: 'dive' as const, display_title: 'Long Dong Bay', admin_title: null, start_date: '2026-03-14', course_days: null }

describe('fiscalYearRange', () => {
  it('covers Jan 1 to next Jan 1 in Asia/Taipei', () => {
    const r = fiscalYearRange(2026)
    expect(r.startIso).toBe('2025-12-31T16:00:00.000Z') // 2026-01-01 00:00 +08:00
    expect(r.endIso).toBe('2026-12-31T16:00:00.000Z')   // 2027-01-01 00:00 +08:00
    expect(r.label).toBe(`2026-01-01 to 2026-12-31 (${siteConfig.locale.timezone})`)
  })
})

describe('normalizeTransactions', () => {
  it('joins diver, recording admin, and dive event', () => {
    const [t] = normalizeTransactions({
      payments: [payment({})],
      bookings: [diveBooking],
      events: [dive],
      profiles: [diver, admin],
    })
    expect(t.diverName).toBe('Dana Diver')
    expect(t.diverEmail).toBe('dana@example.com')
    expect(t.adminName).toBe('Avi Admin')
    expect(t.eventType).toBe('dive')
    expect(t.eventTitle).toBe('Long Dong Bay')
    expect(t.eventDate).toBe('2026-03-14')
    expect(t.bookingTotal).toBe(1000)
  })

  it('keeps a payment whose booking/event is unresolved, with null event fields', () => {
    const [t] = normalizeTransactions({
      payments: [payment({ booking_id: 'missing', recorded_by: null })],
      bookings: [], events: [], profiles: [diver],
    })
    expect(t.eventType).toBeNull()
    expect(t.eventTitle).toBeNull()
    expect(t.bookingId).toBe('missing')
    expect(t.adminName).toBe('')
  })

  it('falls back to the raw id when a profile is missing', () => {
    const [t] = normalizeTransactions({
      payments: [payment({ user_id: 'ghost', recorded_by: 'ghost-admin' })],
      bookings: [diveBooking], events: [dive], profiles: [],
    })
    expect(t.diverName).toBe('ghost')
    expect(t.adminName).toBe('ghost-admin')
  })

  it('uses the earliest course day as the course event date', () => {
    const [t] = normalizeTransactions({
      payments: [payment({})],
      bookings: [{ ...diveBooking, event_id: 'c-1' }],
      events: [{ id: 'c-1', kind: 'course' as const, display_title: 'OW', admin_title: null, start_date: null, course_days: ['2026-05-10', '2026-05-09'] }],
      profiles: [diver, admin],
    })
    expect(t.eventType).toBe('course')
    expect(t.eventDate).toBe('2026-05-09')
  })
})

function txn(over: Partial<AccountingTransaction>): AccountingTransaction {
  return {
    paymentId: 'p', markedAtIso: '2026-03-01T08:00:00.000Z', status: 'paid',
    amount: 1000, currency: 'TWD', method: 'bank_transfer', note: null,
    diverName: 'Dana Diver', diverEmail: 'dana@example.com', adminName: 'Avi Admin',
    bookingId: 'bk', bookingStatus: 'confirmed', bookingTotal: 1000,
    eventType: 'dive', eventId: 'dive-1', eventTitle: 'Long Dong Bay', eventDate: '2026-03-14',
    ...over,
  }
}

describe('buildTransactionsCsv', () => {
  it('emits a header and one row per payment, RFC-4180 quoting commas', () => {
    const csv = buildTransactionsCsv([txn({ note: 'Balance, paid in cash' })])
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toContain('Payment ID')
    expect(lines[0]).toContain('Marked By (admin)')
    expect(lines[1]).toContain('"Balance, paid in cash"')
    expect(lines[1]).toContain('Long Dong Bay')
  })
})

describe('buildByEventCsv', () => {
  it('aggregates paid/refunded/net per event with a TOTAL row, voided excluded from sums', () => {
    const csv = buildByEventCsv([
      txn({ paymentId: 'a', status: 'paid', amount: 1000 }),
      txn({ paymentId: 'b', status: 'paid', amount: 500, diverName: 'Sam Sea' }),
      txn({ paymentId: 'c', status: 'refunded', amount: 200 }),
      txn({ paymentId: 'd', status: 'voided', amount: 9999 }),
    ])
    const rows = csv.trimEnd().split('\r\n')
    const eventRow = rows.find(r => r.startsWith('dive,'))!
    // Paid=2, Refunded=1, Voided=1, DistinctDivers=2, Gross=1500, Refunded=200, Net=1300
    expect(eventRow).toBe('dive,Long Dong Bay,2026-03-14,dive-1,2,1,1,2,1500,200,1300')
    const total = rows.find(r => r.startsWith('TOTAL'))!
    expect(total).toContain(',1500,200,1300')
  })

  it('buckets payments with no event under an unlinked row', () => {
    const csv = buildByEventCsv([txn({ eventId: null, eventType: null, eventTitle: null, eventDate: null })])
    expect(csv).toContain('(unlinked payments)')
  })
})

describe('buildSummaryCsv', () => {
  it('reports net revenue as paid minus refunded and excludes voided', () => {
    const csv = buildSummaryCsv([
      txn({ status: 'paid', amount: 1000 }),
      txn({ status: 'refunded', amount: 250 }),
      txn({ status: 'voided', amount: 5000 }),
    ], 2026)
    expect(csv).toContain('Fiscal Year,2026')
    expect(csv).toContain('Overview,Net revenue,,750')
    expect(csv).toContain('Voided (excluded from totals),1,5000')
  })

  it('breaks down net by payment method and event type', () => {
    const csv = buildSummaryCsv([
      txn({ method: 'cash', amount: 300, eventType: 'course' }),
      txn({ method: 'bank_transfer', amount: 700, eventType: 'dive' }),
    ], 2026)
    expect(csv).toContain('Payment method,bank_transfer,1,700')
    expect(csv).toContain('Payment method,cash,1,300')
    // Labelled from the shared kind vocabulary, so the breakdown follows the
    // deployment's language and gains a row when a kind is added.
    expect(csv).toContain(`Event type,${EVENT_KIND_LABELS.dive},1,700`)
    expect(csv).toContain(`Event type,${EVENT_KIND_LABELS.course},1,300`)
  })
})

describe('buildAccountingCsvs', () => {
  it('returns three year-stamped files', () => {
    const files = buildAccountingCsvs([txn({})], 2026)
    expect(Object.keys(files).sort()).toEqual([
      'by-event-2026.csv', 'summary-2026.csv', 'transactions-2026.csv',
    ])
  })
})
