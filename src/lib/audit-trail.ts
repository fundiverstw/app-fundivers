import { supabase } from './supabase'
import { fetchCreditsForUser, openCreditForBooking, diverCreditBalance } from './credits'
import { fetchAmendmentsForBookings, amendmentsDelta } from './booking-amendments'
import { fetchEventsForBookings } from './events'
import { bookingBalance, type BookingBalance } from './booking-balance'
import type {
  AdminAuditLog,
  AppEvent,
  Booking,
  BookingAmendment,
  BookingDetails,
  Credit,
  Payment,
  Profile,
} from '../types/database'

// The Audits page reconstructs the money trail for a diver — and, drilled in,
// for each of their registrations — by merging every append-only source that
// touches a balance into one time-ordered feed. There is no single "ledger"
// table: money history is spread across `payments` (recorded receipts,
// refunds, voids), `credits` (issued/settled store credit), `booking_amendments`
// (admin balance adjustments) and `admin_audit_log` (booking/profile field
// changes). This module turns those rows into a uniform, language-neutral
// `AuditEntry[]` so the UI can render debug-grade logs, and reconciles each
// registration's balance with the *same* `bookingBalance()` every other surface
// uses (so the audit view can never silently disagree with the app).

export type AuditSource = 'payment' | 'credit' | 'amendment' | 'booking' | 'profile'

export type AuditKind =
  | 'payment_paid'
  | 'payment_refunded'
  | 'payment_voided'
  | 'payment_pending'
  | 'credit_issued'
  | 'credit_settled'
  | 'amendment'
  | 'booking_insert'
  | 'booking_update'
  | 'booking_delete'
  | 'profile_insert'
  | 'profile_update'
  | 'profile_delete'

export interface AuditEntry {
  /** Stable, unique key. Source-row id, suffixed when one row emits two
   *  events (a credit issues then settles). */
  id: string
  /** ISO timestamp the event happened at. */
  at: string
  source: AuditSource
  kind: AuditKind
  /** The registration this event belongs to, when it has one. */
  bookingId: string | null
  /** The diver this event belongs to, when the row carries it. */
  userId: string | null
  /** Raw amount as stored (unsigned for payments/credits; already signed for
   *  amendments). Sign *meaning* is carried by `kind`, and applied for display
   *  by `signedDisplayAmount()`. Null for pure field-change log rows. */
  amount: number | null
  currency: string | null
  /** Who performed the action: recorded_by / created_by / actor_id. */
  actorId: string | null
  /** Free-text context: payment note, credit reason, settle note. */
  note: string | null
  /** Payment method, when the source is a payment (`account_credit` marks a
   *  payment auto-created by applying store credit). */
  method: string | null
  /** For `*_update` log rows: the column names whose values changed. */
  changed: string[] | null
  /** The full underlying row (payment/credit/amendment) or `{ before, after }`
   *  for a log row — surfaced verbatim in the debug drawer. */
  raw: unknown
}

function paymentKind(status: Payment['status']): AuditKind {
  switch (status) {
    case 'paid':     return 'payment_paid'
    case 'refunded': return 'payment_refunded'
    case 'voided':   return 'payment_voided'
    default:         return 'payment_pending'
  }
}

export function paymentEntries(payments: Payment[]): AuditEntry[] {
  return payments.map(p => ({
    id:        `payment:${p.id}`,
    at:        p.created_at,
    source:    'payment' as const,
    kind:      paymentKind(p.status),
    bookingId: p.booking_id,
    userId:    p.user_id,
    amount:    Number(p.amount),
    currency:  p.currency,
    actorId:   p.recorded_by,
    note:      p.note,
    method:    p.method,
    changed:   null,
    raw:       p,
  }))
}

export function creditEntries(credits: Credit[]): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const c of credits) {
    out.push({
      id:        `credit:${c.id}:issued`,
      at:        c.created_at,
      source:    'credit',
      kind:      'credit_issued',
      bookingId: c.booking_id,
      userId:    c.user_id,
      amount:    Number(c.amount),
      currency:  c.currency,
      actorId:   c.created_by,
      note:      c.reason,
      method:    null,
      changed:   null,
      raw:       c,
    })
    if (c.status === 'settled' && c.settled_at) {
      out.push({
        id:        `credit:${c.id}:settled`,
        at:        c.settled_at,
        source:    'credit',
        kind:      'credit_settled',
        bookingId: c.booking_id,
        userId:    c.user_id,
        amount:    Number(c.amount),
        currency:  c.currency,
        actorId:   null,
        note:      c.settled_note,
        method:    null,
        changed:   null,
        raw:       c,
      })
    }
  }
  return out
}

export function amendmentEntries(amendments: BookingAmendment[]): AuditEntry[] {
  return amendments.map(a => ({
    id:        `amendment:${a.id}`,
    at:        a.created_at,
    source:    'amendment' as const,
    kind:      'amendment' as const,
    bookingId: a.booking_id,
    userId:    null,
    amount:    a.amount,
    currency:  null,
    actorId:   a.created_by,
    note:      a.note,
    method:    null,
    changed:   null,
    raw:       a,
  }))
}

/** Column names whose values differ between two audit-log snapshots. */
export function diffChangedColumns(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>
  const a = (after ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const changed: string[] = []
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k)
  }
  return changed.sort()
}

const LOG_TABLE_SOURCE: Record<string, AuditSource> = {
  bookings: 'booking',
  profiles: 'profile',
}

export function auditLogEntries(rows: AdminAuditLog[]): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const r of rows) {
    const source = LOG_TABLE_SOURCE[r.target_table]
    if (!source) continue
    const kind = `${source}_${r.action}` as AuditKind
    out.push({
      id:        `log:${r.id}`,
      at:        r.created_at,
      source,
      kind,
      bookingId: r.target_table === 'bookings' ? r.target_id : null,
      userId:    r.target_table === 'profiles' ? r.target_id : null,
      amount:    null,
      currency:  null,
      actorId:   r.actor_id,
      note:      null,
      method:    null,
      changed:   r.action === 'update' ? diffChangedColumns(r.before, r.after) : null,
      raw:       { before: r.before, after: r.after },
    })
  }
  return out
}

// Deterministic source order for tiebreaking equal timestamps so a feed
// renders the same way every load.
const SOURCE_ORDER: Record<AuditSource, number> = {
  booking: 0, profile: 1, payment: 2, credit: 3, amendment: 4,
}

/** Flatten and sort ascending (oldest first), stable on equal timestamps. */
export function mergeEntries(...groups: AuditEntry[][]): AuditEntry[] {
  return groups.flat().sort((x, y) => {
    if (x.at !== y.at) return x.at < y.at ? -1 : 1
    if (x.source !== y.source) return SOURCE_ORDER[x.source] - SOURCE_ORDER[y.source]
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
  })
}

/** Net money received on a set of payments: paid counts up, refunded counts
 *  back down, voided/pending are ignored. Matches the accounting export and
 *  every balance surface. */
export function paymentsNetPaid(payments: Payment[]): number {
  return payments.reduce((sum, p) => {
    if (p.status === 'paid')     return sum + Number(p.amount)
    if (p.status === 'refunded') return sum - Number(p.amount)
    return sum
  }, 0)
}

export interface RegistrationAudit {
  booking: Booking
  event: AppEvent | null
  /** `details.total` — the frozen charge snapshot. */
  owedBase: number
  /** Net of all balance amendments. */
  amendmentsDelta: number
  /** owedBase + amendmentsDelta. */
  owed: number
  /** Net paid (paid − refunded). */
  paid: number
  /** Open credit tied to this booking. */
  openCredit: number
  balance: BookingBalance
  /** This registration's slice of the feed, oldest first. */
  entries: AuditEntry[]
}

export interface DiverAuditTrail {
  profile: Profile
  registrations: RegistrationAudit[]
  /** Open credits not tied to any one booking (e.g. general account credit). */
  generalCredits: Credit[]
  /** The diver's spendable account credit (open credit + overpayments). */
  accountCreditBalance: number
  totals: {
    paid: number
    refunded: number
    credited: number
    adjusted: number
  }
  /** Every event across every source, oldest first. */
  allEntries: AuditEntry[]
}

export interface AuditTrailInput {
  profile: Profile
  bookings: Booking[]
  events: Map<string, AppEvent>
  payments: Payment[]
  credits: Credit[]
  amendmentsByBooking: Map<string, BookingAmendment[]>
  auditLog: AdminAuditLog[]
}

/** Pure assembler — given every fetched source, build the diver's full trail.
 *  Split out from `fetchDiverAuditTrail` so the reconciliation math is
 *  unit-testable without a database. */
export function assembleDiverAuditTrail(input: AuditTrailInput): DiverAuditTrail {
  const { profile, bookings, events, payments, credits, amendmentsByBooking, auditLog } = input

  const registrations: RegistrationAudit[] = bookings.map(booking => {
    const details = (booking.details ?? {}) as BookingDetails
    const owedBase = Number(details.total ?? 0)
    const amend = amendmentsByBooking.get(booking.id) ?? []
    const delta = amendmentsDelta(amend)
    const owed = owedBase + delta
    const bookingPayments = payments.filter(p => p.booking_id === booking.id)
    const paid = paymentsNetPaid(bookingPayments)
    const openCredit = openCreditForBooking(credits, booking.id)
    const bookingCredits = credits.filter(c => c.booking_id === booking.id)
    const bookingLog = auditLog.filter(
      r => r.target_table === 'bookings' && r.target_id === booking.id,
    )
    return {
      booking,
      event: booking.event_id ? events.get(booking.event_id) ?? null : null,
      owedBase,
      amendmentsDelta: delta,
      owed,
      paid,
      openCredit,
      balance: bookingBalance(owed, paid, openCredit),
      entries: mergeEntries(
        paymentEntries(bookingPayments),
        creditEntries(bookingCredits),
        amendmentEntries(amend),
        auditLogEntries(bookingLog),
      ),
    }
  })

  // Spendable account credit — same figure the diver sees on Profile/Payments:
  // open credit plus per-booking overpayments, dropping bookings a lead pays for.
  const coveredIds = new Set(
    bookings.filter(b => b.payer_id && b.payer_id !== b.user_id).map(b => b.id),
  )
  const activeRows = registrations
    .filter(r => r.booking.status !== 'cancelled')
    .map(r => ({ id: r.booking.id, owed: r.owed, paid: r.paid }))
  const accountCreditBalance = diverCreditBalance(credits, activeRows, coveredIds)

  const allAmendments = [...amendmentsByBooking.values()].flat()
  const totals = {
    paid:     payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0),
    refunded: payments.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0),
    credited: credits.reduce((s, c) => s + Number(c.amount), 0),
    adjusted: allAmendments.reduce((s, a) => s + a.amount, 0),
  }

  return {
    profile,
    registrations,
    generalCredits: credits.filter(c => !c.booking_id),
    accountCreditBalance,
    totals,
    allEntries: mergeEntries(
      paymentEntries(payments),
      creditEntries(credits),
      amendmentEntries(allAmendments),
      auditLogEntries(auditLog),
    ),
  }
}

/** Gather every money source for one diver and assemble their audit trail. */
export async function fetchDiverAuditTrail(userId: string): Promise<DiverAuditTrail> {
  const [profileRes, bookingsRes, paymentsRes, credits] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('payments').select('*').eq('user_id', userId),
    fetchCreditsForUser(userId),
  ])
  if (profileRes.error) throw profileRes.error
  if (bookingsRes.error) throw bookingsRes.error
  if (paymentsRes.error) throw paymentsRes.error

  const profile = profileRes.data as Profile
  const bookings = (bookingsRes.data ?? []) as Booking[]
  const payments = (paymentsRes.data ?? []) as Payment[]
  const bookingIds = bookings.map(b => b.id)
  const eventIds = [...new Set(bookings.map(b => b.event_id).filter((x): x is string => !!x))]

  // Booking-target log rows for this diver's bookings + profile-target log rows
  // for the diver themselves. Booking and profile ids never collide, and the
  // assembler re-filters by target_table, so an over-broad match is harmless.
  const targetIds = [userId, ...bookingIds]
  const [events, amendmentsByBooking, auditLogRes] = await Promise.all([
    fetchEventsForBookings(eventIds),
    fetchAmendmentsForBookings(bookingIds),
    supabase.from('admin_audit_log').select('*').in('target_id', targetIds).order('created_at', { ascending: true }),
  ])
  if (auditLogRes.error) throw auditLogRes.error

  return assembleDiverAuditTrail({
    profile,
    bookings,
    events,
    payments,
    credits,
    amendmentsByBooking,
    auditLog: (auditLogRes.data ?? []) as AdminAuditLog[],
  })
}

/** Display sign for an entry's amount: negatives are money leaving the diver's
 *  balance-owed toward zero (payments, refunds returned, credit reducing owed).
 *  Used purely for rendering; the raw `amount` stays as stored. */
export function signedDisplayAmount(entry: AuditEntry): number | null {
  if (entry.amount == null) return null
  switch (entry.kind) {
    case 'payment_paid':     return -entry.amount
    case 'payment_refunded': return entry.amount
    case 'amendment':        return entry.amount
    default:                 return entry.amount
  }
}
