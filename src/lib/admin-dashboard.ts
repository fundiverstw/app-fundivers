// Pure aggregation for the admin BI dashboard. No I/O — the page batches the
// Supabase reads and passes raw rows in, so all the grouping/netting logic is
// unit-testable and deterministic (the reference "now" is an argument).
//
// Money is netted the same way as the accounting export: `paid` counts
// positive, `refunded` negative, `voided` is excluded entirely.
//
// Revenue counts only payments that moved real money. An 'account_credit' row
// settles a booking without anything arriving at the shop, so summing it as
// revenue reports the same cash twice — once when it came in, again when the
// credit it became is spent. Credit applied is reported on its own instead.
import { buildCertLevelResolver, type CertLadderRow } from './cert-level'
import { canonicalNationality } from './nationality'
import { hasDiveFlags, usesCourseDays } from './event-kinds'
import { isExternalPayment } from './payments'
import { siteConfig } from '../config/site'
import { EVENT_KIND_LABELS } from './event-kind-labels'
import { t } from '../i18n'
import type { Booking, Payment, EventKind } from '../types/database'

export interface MoneyPoint { label: string; value: number }
export interface CountPoint { label: string; value: number }

export interface UpcomingFillRow {
  id: string
  type: EventKind
  title: string
  date: string | null
  confirmed: number
  capacity: number | null
  fillPct: number | null
}

export interface Dashboard {
  kpis: {
    netRevenueThisMonth: number
    netRevenueYear: number
    /** Account credit spent this calendar year. Not revenue — an internal
     *  transfer of money banked earlier — but worth seeing beside it. */
    creditAppliedYear: number
    bookingsThisMonth: number
    confirmedBookingsThisMonth: number
    activeDivers: number
    pendingApplications: number
    pendingRefundRequests: number
    upcomingEvents: number
    avgFillPct: number | null
  }
  revenueByMonth: MoneyPoint[]
  revenueByMethod: MoneyPoint[]
  revenueByEventType: MoneyPoint[]
  bookingsByMonth: CountPoint[]
  bookingsByStatus: CountPoint[]
  signupsByMonth: CountPoint[]
  revenueByNationality: MoneyPoint[]
  revenueByCertLevel: MoneyPoint[]
  certLevelMix: CountPoint[]
  /** Net revenue per kind of outing — shore dives, boat dives, trips, each
   *  course. Replaces a per-event list, which split one weekly shore dive
   *  across a dozen identically-titled rows and answered nothing. */
  revenueByActivity: MoneyPoint[]
  upcomingFill: UpcomingFillRow[]
}

export type PaymentLite = Pick<Payment, 'user_id' | 'booking_id' | 'amount' | 'status' | 'method' | 'created_at'>
export type BookingLite = Pick<Booking, 'id' | 'user_id' | 'event_id' | 'status' | 'created_at' | 'details'>
export interface ProfileLite { id: string; role: string; status: string; created_at: string; nationality: string | null; cert_level: string | null }
export interface EventLite {
  id: string
  type: EventKind
  title: string
  capacity: number | null
  dateKey: string | null
  /** Dive kinds only; false elsewhere. */
  isBoatDive: boolean
  isTrip: boolean
  /** Course kinds only: the catalog title of the course being run, when the
   *  event names one. Null elsewhere, and for a course with no catalog row. */
  courseLabel: string | null
}
export interface ConfirmedCount { eventId: string; count: number }

export interface DashboardInput {
  nowIso: string
  payments: PaymentLite[]
  bookings: BookingLite[]
  profiles: ProfileLite[]
  events: EventLite[]
  confirmed: ConfirmedCount[]
  /** The shop's whole `cert_levels` table — every agency, so a diver who typed
   *  an SSI or CMAS rung still resolves to its PADI equivalent. */
  certLadder: CertLadderRow[]
  pendingApplications: number
  pendingRefundRequests: number
}

const num = (v: unknown): number => Number(v) || 0

function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
}
function taipeiMonth(iso: string): string {
  return taipeiDate(iso).slice(0, 7)
}

/** The twelve 'YYYY-MM' keys of a calendar year, Jan→Dec. Using the calendar
 *  year (rather than a trailing window) puts the mid-year peak season
 *  (Jun–Aug) in the center columns of any 12-point time series. */
export function calendarYearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = keyFn(it)
    const arr = m.get(k)
    if (arr) arr.push(it)
    else m.set(k, [it])
  }
  return m
}

function netOf(payments: PaymentLite[]): number {
  return payments.reduce((s, p) => {
    if (p.status === 'paid') return s + num(p.amount)
    if (p.status === 'refunded') return s - num(p.amount)
    return s
  }, 0)
}

/** Sort entries by value descending, keep the top n, fold the rest into "Other". */
function topWithOther(entries: Array<[string, number]>, n: number): MoneyPoint[] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, n).map(([label, value]) => ({ label, value }))
  const rest = sorted.slice(n)
  const other = rest.reduce((s, [, v]) => s + v, 0)
  if (rest.length) head.push({ label: 'Other', value: other })
  return head
}

/**
 * What kind of outing an event is, for the revenue breakdown.
 *
 * Branches on what the kind *does* rather than on the kind itself, so a fourth
 * kind has to answer here instead of silently inheriting the dive branch. A
 * trip beats a boat dive: a Green Island weekend is a trip that happens to
 * involve boats, and reporting it as a boat dive would hide the shop's most
 * distinct line of business inside its most ordinary one.
 */
function activityOf(event: EventLite): string {
  const a = t.admin.dashboard.activities
  if (usesCourseDays(event.type)) return event.courseLabel?.trim() || a.course
  if (hasDiveFlags(event.type)) {
    if (event.isTrip) return a.trip
    if (event.isBoatDive) return a.boatDive
    return a.shoreDive
  }
  return EVENT_KIND_LABELS[event.type]
}

export function computeDashboard(input: DashboardInput): Dashboard {
  const { nowIso, payments: allPayments, bookings, profiles, events, confirmed, certLadder } = input
  const certLevel = buildCertLevelResolver(certLadder)
  const unknown = t.admin.dashboard.unknownBucket
  // Every revenue series below reads `payments`; only the credit-applied KPI
  // reads the internal rows, so the split happens once, here.
  const payments = allPayments.filter(isExternalPayment)
  const creditPayments = allPayments.filter(p => !isExternalPayment(p))
  const thisMonth = taipeiMonth(nowIso)
  const today = taipeiDate(nowIso)
  const year = Number(thisMonth.slice(0, 4))
  const monthKeys = calendarYearMonths(year)

  const bookingById = new Map(bookings.map(b => [b.id, b]))
  const profileById = new Map(profiles.map(p => [p.id, p]))
  const eventById = new Map(events.map(e => [e.id, e]))
  const confirmedById = new Map(confirmed.map(c => [c.eventId, c.count]))

  const eventOfPayment = (p: PaymentLite): EventLite | null => {
    const b = p.booking_id ? bookingById.get(p.booking_id) : undefined
    if (!b) return null
    return eventById.get(b.event_id) ?? null
  }

  // --- Revenue ---
  const revenueByMonth = monthKeys.map(k => ({ label: k, value: netOf(payments.filter(p => taipeiMonth(p.created_at) === k)) }))
  const netRevenueThisMonth = netOf(payments.filter(p => taipeiMonth(p.created_at) === thisMonth))
  const netRevenueYear = netOf(payments)
  const creditAppliedYear = netOf(creditPayments)

  const revenueByMethod = [...groupBy(payments, p => p.method ?? '(unspecified)').entries()]
    .map(([label, ps]) => ({ label, value: netOf(ps) }))
    .sort((a, b) => b.value - a.value)

  const revenueByEventType = [...groupBy(payments, p => {
    const ev = eventOfPayment(p)
    return ev ? EVENT_KIND_LABELS[ev.type] : 'Unlinked'
  }).entries()]
    .map(([label, ps]) => ({ label, value: netOf(ps) }))
    .sort((a, b) => b.value - a.value)

  // --- Demographics that earn money (net revenue attributed to the payer) ---
  const natTotals = new Map<string, number>()
  const certTotals = new Map<string, number>()
  for (const p of payments) {
    const contrib = p.status === 'paid' ? num(p.amount) : p.status === 'refunded' ? -num(p.amount) : 0
    if (!contrib) continue
    const prof = profileById.get(p.user_id)
    const nat = canonicalNationality(prof?.nationality) || unknown
    const cert = certLevel(prof?.cert_level) || unknown
    natTotals.set(nat, (natTotals.get(nat) ?? 0) + contrib)
    certTotals.set(cert, (certTotals.get(cert) ?? 0) + contrib)
  }
  const revenueByNationality = topWithOther([...natTotals.entries()], 8)
  const revenueByCertLevel = topWithOther([...certTotals.entries()], 8)

  // --- Revenue per kind of outing ---
  // Grouping by event id put one row per occurrence, so a shore dive the shop
  // runs every weekend appeared a dozen times under the same title and the
  // pane read as a list of duplicates. What earns money is the *kind* of
  // outing, which the event's own flags already say.
  const activityTotals = new Map<string, number>()
  for (const p of payments) {
    const ev = eventOfPayment(p)
    if (!ev) continue
    const contrib = p.status === 'paid' ? num(p.amount) : p.status === 'refunded' ? -num(p.amount) : 0
    if (!contrib) continue
    const label = activityOf(ev)
    activityTotals.set(label, (activityTotals.get(label) ?? 0) + contrib)
  }
  const revenueByActivity = [...activityTotals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  // --- Bookings ---
  const bookingsByMonth = monthKeys.map(k => ({ label: k, value: bookings.filter(b => taipeiMonth(b.created_at) === k).length }))
  const STATUSES: Booking['status'][] = ['waitlisted', 'pending', 'confirmed', 'cancelled']
  const bookingsByStatus = STATUSES.map(s => ({ label: s, value: bookings.filter(b => b.status === s).length }))
  const bookingsThisMonth = bookings.filter(b => taipeiMonth(b.created_at) === thisMonth).length
  const confirmedBookingsThisMonth = bookings.filter(b => b.status === 'confirmed' && taipeiMonth(b.created_at) === thisMonth).length

  // --- Divers ---
  const divers = profiles.filter(p => p.role === 'diver')
  const signupsByMonth = monthKeys.map(k => ({ label: k, value: divers.filter(p => taipeiMonth(p.created_at) === k).length }))
  const activeDivers = divers.filter(p => p.status === 'active').length
  const certMix = new Map<string, number>()
  for (const p of divers) {
    if (p.status !== 'active') continue
    const cert = certLevel(p.cert_level) || unknown
    certMix.set(cert, (certMix.get(cert) ?? 0) + 1)
  }
  const certLevelMix = [...certMix.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  // --- Event fill (upcoming only) ---
  const upcoming = events.filter(e => e.dateKey && e.dateKey >= today)
  const upcomingFill: UpcomingFillRow[] = upcoming
    .map(e => {
      const c = confirmedById.get(e.id) ?? 0
      const fillPct = e.capacity && e.capacity > 0 ? Math.round((c / e.capacity) * 100) : null
      return { id: e.id, type: e.type, title: e.title, date: e.dateKey, confirmed: c, capacity: e.capacity, fillPct }
    })
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const fillable = upcomingFill.filter(r => r.fillPct != null)
  const avgFillPct = fillable.length ? Math.round(fillable.reduce((s, r) => s + (r.fillPct ?? 0), 0) / fillable.length) : null

  return {
    kpis: {
      netRevenueThisMonth,
      netRevenueYear,
      creditAppliedYear,
      bookingsThisMonth,
      confirmedBookingsThisMonth,
      activeDivers,
      pendingApplications: input.pendingApplications,
      pendingRefundRequests: input.pendingRefundRequests,
      upcomingEvents: upcoming.length,
      avgFillPct,
    },
    revenueByMonth,
    revenueByMethod,
    revenueByEventType,
    bookingsByMonth,
    bookingsByStatus,
    signupsByMonth,
    revenueByNationality,
    revenueByCertLevel,
    certLevelMix,
    revenueByActivity,
    upcomingFill,
  }
}
