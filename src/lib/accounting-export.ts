// Fiscal-year accounting export. Pure TS (no Supabase / fflate / DOM) so the
// join + CSV + aggregation logic is unit-testable; the admin page does the
// fetch, zips the three CSVs with fflate, and triggers the download.
//
// The export is audit-style: every payment row is included regardless of
// status or method, each labeled. Money totals count `paid` as positive and
// `refunded` as negative; `voided` rows are shown for the audit trail but
// excluded from every sum (a void means "this payment never really happened").
//
// The money columns count CASH only. An 'account_credit' row settles a booking
// without anything arriving at the shop — the cash arrived earlier, on the
// booking that generated the credit — so folding it into revenue books the
// same money twice. It gets its own column and its own summary line instead,
// so the export still accounts for every row.
import { csvCell, CSV_BOM } from './dive-log-csv'
import { isExternalPayment, INTERNAL_PAYMENT_METHOD } from './payments'
import { siteConfig } from '../config/site'
import type { Booking, BookingDetails, Payment } from '../types/database'
import { usesCourseDays, EVENT_KINDS, type EventKind } from './event-kinds'
import { EVENT_KIND_LABELS } from './event-kind-labels'

export interface AccountingTransaction {
  paymentId: string
  /** ISO timestamp the payment row was created (when the admin marked it). */
  markedAtIso: string
  status: Payment['status']
  amount: number
  currency: string
  method: string | null
  note: string | null
  /** Receipt / transfer / online transaction id the row is evidence of.
   *  Empty on account-credit rows and on anything recorded before
   *  `payments.reference` existed. */
  reference: string | null
  diverName: string
  diverEmail: string | null
  /** Name of the admin who recorded the payment (recorded_by → profiles). */
  adminName: string
  bookingId: string | null
  bookingStatus: string | null
  /** The booking's quoted total (BookingDetails.total), for owed-vs-paid context. */
  bookingTotal: number | null
  eventType: EventKind | null
  eventId: string | null
  eventTitle: string | null
  /** YYYY-MM-DD (or null) — the event's date, for sorting the by-event sheet. */
  eventDate: string | null
}

type EventLite = { id: string; kind: EventKind; display_title: string | null; admin_title: string | null; start_date: string | null; course_days: string[] | null }
type ProfileLite = { id: string; name: string | null; email: string | null }
type BookingLite = Pick<Booking, 'id' | 'user_id' | 'event_id' | 'status' | 'details'>

/**
 * The half-open [start, end) UTC instant range covering one calendar year in
 * Asia/Taipei (fixed +08:00, no DST). `label` is the human range for the
 * summary sheet.
 */
export function fiscalYearRange(year: number): { startIso: string; endIso: string; label: string } {
  return {
    startIso: new Date(`${year}-01-01T00:00:00+08:00`).toISOString(),
    endIso: new Date(`${year + 1}-01-01T00:00:00+08:00`).toISOString(),
    label: `${year}-01-01 to ${year}-12-31 (${siteConfig.locale.timezone})`,
  }
}

function fmtTaipei(iso: string | null | undefined, withTime: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  if (!withTime) return date
  const time = d.toLocaleTimeString('en-GB', { timeZone: siteConfig.locale.timezone, hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

function eventTitleOf(e: EventLite | undefined): string | null {
  if (!e) return null
  return e.display_title || e.admin_title || null
}

/**
 * Join raw payment rows to their booking, event, diver, and recording admin.
 * Everything is looked up from the passed-in arrays (the page batches the
 * Supabase reads) — no I/O here. Payments whose booking/event can't be
 * resolved still appear, with null event fields, so nothing silently drops
 * out of the books.
 */
export function normalizeTransactions(input: {
  payments: Payment[]
  bookings: BookingLite[]
  events: EventLite[]
  profiles: ProfileLite[]
}): AccountingTransaction[] {
  const bookingById = new Map(input.bookings.map(b => [b.id, b]))
  const eventById = new Map(input.events.map(e => [e.id, e]))
  const profById = new Map(input.profiles.map(p => [p.id, p]))

  return input.payments.map(p => {
    const booking = p.booking_id ? bookingById.get(p.booking_id) ?? null : null
    const details = (booking?.details ?? {}) as BookingDetails

    let eventType: EventKind | null = null
    let eventId: string | null = null
    let eventTitle: string | null = null
    let eventDate: string | null = null
    if (booking?.event_id) {
      eventId = booking.event_id
      const ev = eventById.get(booking.event_id)
      if (ev) {
        eventType = ev.kind
        eventTitle = eventTitleOf(ev)
        if (usesCourseDays(ev.kind)) {
          const days = ev.course_days ?? []
          eventDate = days.length ? [...days].sort()[0].slice(0, 10) : null
        } else {
          eventDate = ev.start_date ? ev.start_date.slice(0, 10) : null
        }
      }
    }

    const diver = profById.get(p.user_id)
    const admin = p.recorded_by ? profById.get(p.recorded_by) : null

    return {
      paymentId: p.id,
      markedAtIso: p.created_at,
      status: p.status,
      amount: Number(p.amount) || 0,
      currency: p.currency,
      method: p.method,
      note: p.note,
      reference: p.reference,
      diverName: diver?.name ?? p.user_id,
      diverEmail: diver?.email ?? null,
      adminName: admin?.name ?? (p.recorded_by ?? ''),
      bookingId: booking?.id ?? p.booking_id ?? null,
      bookingStatus: booking?.status ?? null,
      bookingTotal: typeof details.total === 'number' ? details.total : null,
      eventType,
      eventId,
      eventTitle,
      eventDate,
    }
  })
}

function toCsv(header: readonly string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) lines.push(r.map(csvCell).join(','))
  return CSV_BOM + lines.join('\r\n') + '\r\n'
}

const TXN_HEADER = [
  'Payment ID', 'Marked At', 'Status', 'Amount', 'Currency', 'Method', 'Reference',
  'Diver', 'Diver Email', 'Marked By (admin)', 'Booking ID', 'Booking Status',
  'Booking Total', 'Event Type', 'Event Title', 'Event Date', 'Note',
] as const

export function buildTransactionsCsv(txns: AccountingTransaction[]): string {
  const sorted = [...txns].sort((a, b) => a.markedAtIso.localeCompare(b.markedAtIso))
  const rows = sorted.map(t => [
    t.paymentId, fmtTaipei(t.markedAtIso, true), t.status, t.amount, t.currency, t.method ?? '',
    t.reference ?? '', t.diverName, t.diverEmail ?? '', t.adminName, t.bookingId ?? '', t.bookingStatus ?? '',
    t.bookingTotal ?? '', t.eventType ?? '', t.eventTitle ?? '', fmtTaipei(t.eventDate, false), t.note ?? '',
  ])
  return toCsv(TXN_HEADER, rows)
}

const cash = (txns: AccountingTransaction[]) => txns.filter(isExternalPayment)

function sumPaid(txns: AccountingTransaction[]): number {
  return cash(txns).reduce((s, t) => s + (t.status === 'paid' ? t.amount : 0), 0)
}
function sumRefunded(txns: AccountingTransaction[]): number {
  return cash(txns).reduce((s, t) => s + (t.status === 'refunded' ? t.amount : 0), 0)
}
function net(txns: AccountingTransaction[]): number {
  return sumPaid(txns) - sumRefunded(txns)
}
/** Account credit spent, netted the same way. Reported alongside cash, never
 *  inside it. */
function sumCreditApplied(txns: AccountingTransaction[]): number {
  return txns
    .filter(t => !isExternalPayment(t))
    .reduce((s, t) => s + (t.status === 'paid' ? t.amount : t.status === 'refunded' ? -t.amount : 0), 0)
}

const BY_EVENT_HEADER = [
  'Event Type', 'Event Title', 'Event Date', 'Event ID',
  'Paid Count', 'Refunded Count', 'Voided Count', 'Distinct Divers Paid',
  'Gross Paid', 'Refunded', 'Net', 'Credit Applied',
] as const

const UNLINKED = ' ' // sorts first internally; rendered as a labeled bucket

export function buildByEventCsv(txns: AccountingTransaction[]): string {
  const groups = new Map<string, AccountingTransaction[]>()
  for (const t of txns) {
    const key = t.eventId ?? UNLINKED
    const arr = groups.get(key) ?? []
    arr.push(t)
    groups.set(key, arr)
  }

  const entries = [...groups.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === UNLINKED) return 1
    if (kb === UNLINKED) return -1
    const da = a[0].eventDate ?? ''
    const db = b[0].eventDate ?? ''
    return da.localeCompare(db) || (a[0].eventTitle ?? '').localeCompare(b[0].eventTitle ?? '')
  })

  const rows = entries.map(([key, g]) => {
    const first = g[0]
    const paidCount = g.filter(t => t.status === 'paid').length
    const refundedCount = g.filter(t => t.status === 'refunded').length
    const voidedCount = g.filter(t => t.status === 'voided').length
    const distinctDivers = new Set(g.filter(t => t.status === 'paid').map(t => t.diverName)).size
    return [
      key === UNLINKED ? '' : (first.eventType ?? ''),
      key === UNLINKED ? '(unlinked payments)' : (first.eventTitle ?? ''),
      key === UNLINKED ? '' : fmtTaipei(first.eventDate, false),
      key === UNLINKED ? '' : key,
      paidCount, refundedCount, voidedCount, distinctDivers,
      sumPaid(g), sumRefunded(g), net(g), sumCreditApplied(g),
    ]
  })

  rows.push([
    'TOTAL', '', '', '',
    txns.filter(t => t.status === 'paid').length,
    txns.filter(t => t.status === 'refunded').length,
    txns.filter(t => t.status === 'voided').length,
    new Set(txns.filter(t => t.status === 'paid').map(t => t.diverName)).size,
    sumPaid(txns), sumRefunded(txns), net(txns), sumCreditApplied(txns),
  ])

  return toCsv(BY_EVENT_HEADER, rows)
}

const SUMMARY_HEADER = ['Category', 'Item', 'Count', `Amount (${siteConfig.locale.currency})`] as const

export function buildSummaryCsv(txns: AccountingTransaction[], year: number): string {
  const { label } = fiscalYearRange(year)
  const rows: unknown[][] = []

  rows.push(['Fiscal Year', String(year), '', ''])
  rows.push(['Date Range', label, '', ''])
  rows.push(['Overview', 'Transactions (all statuses)', txns.length, ''])
  rows.push(['Overview', 'Gross paid', txns.filter(t => t.status === 'paid').length, sumPaid(txns)])
  rows.push(['Overview', 'Refunded', txns.filter(t => t.status === 'refunded').length, sumRefunded(txns)])
  rows.push(['Overview', 'Voided (excluded from totals)', txns.filter(t => t.status === 'voided').length, txns.filter(t => t.status === 'voided').reduce((s, t) => s + t.amount, 0)])
  rows.push(['Overview', 'Net revenue', '', net(txns)])
  rows.push([
    'Overview', 'Account credit applied (not cash)',
    txns.filter(t => !isExternalPayment(t) && t.status === 'paid').length,
    sumCreditApplied(txns),
  ])
  rows.push(['Overview', 'Distinct divers paid', new Set(txns.filter(t => t.status === 'paid').map(t => t.diverName)).size, ''])

  const methods = [...new Set(txns.filter(t => t.status === 'paid' || t.status === 'refunded').map(t => t.method ?? '(unspecified)'))].sort()
  for (const m of methods) {
    const g = txns.filter(t => (t.method ?? '(unspecified)') === m)
    // The account-credit line reports the credit spent; net() is cash-only and
    // would render it as a bare zero, which reads like nothing happened.
    const amount = m === INTERNAL_PAYMENT_METHOD ? sumCreditApplied(g) : net(g)
    rows.push(['Payment method', m, g.filter(t => t.status === 'paid').length, amount])
  }

  // One row per kind, driven by the vocabulary — a new kind gets its own
  // summary line instead of silently vanishing from the breakdown.
  const typeLabels: Array<[EventKind | null, string]> = [
    ...EVENT_KINDS.map(k => [k, EVENT_KIND_LABELS[k]] as [EventKind, string]),
    [null, 'Unlinked'],
  ]
  for (const [type, lbl] of typeLabels) {
    const g = txns.filter(t => t.eventType === type)
    if (!g.length) continue
    rows.push(['Event type', lbl, g.filter(t => t.status === 'paid').length, net(g)])
  }

  const monthOf = (t: AccountingTransaction) => fmtTaipei(t.markedAtIso, false).slice(0, 7)
  const months = [...new Set(txns.filter(t => t.status === 'paid' || t.status === 'refunded').map(monthOf))].filter(Boolean).sort()
  for (const mo of months) {
    const g = txns.filter(t => monthOf(t) === mo)
    rows.push(['Month', mo, g.filter(t => t.status === 'paid').length, net(g)])
  }

  return toCsv(SUMMARY_HEADER, rows)
}

/** Build the three fiscal-year CSVs. Returned keys are the in-zip filenames. */
export function buildAccountingCsvs(txns: AccountingTransaction[], year: number): Record<string, string> {
  return {
    [`transactions-${year}.csv`]: buildTransactionsCsv(txns),
    [`by-event-${year}.csv`]: buildByEventCsv(txns),
    [`summary-${year}.csv`]: buildSummaryCsv(txns, year),
  }
}
