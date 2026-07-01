// Pure aggregation for the admin BI dashboard. No I/O — the page batches the
// Supabase reads and passes raw rows in, so all the grouping/netting logic is
// unit-testable and deterministic (the reference "now" is an argument).
//
// Money is netted the same way as the accounting export: `paid` counts
// positive, `refunded` negative, `voided` is excluded entirely.
import { canonicalCertLevel } from './cert-level'
import { siteConfig } from '../config/site'
import type { Booking, Payment } from '../types/database'

export interface MoneyPoint { label: string; value: number }
export interface CountPoint { label: string; value: number }

export interface UpcomingFillRow {
  id: string
  type: 'dive' | 'course'
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
    bookingsThisMonth: number
    confirmedBookingsThisMonth: number
    activeDivers: number
    pendingApplications: number
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
  topEventsByRevenue: MoneyPoint[]
  upcomingFill: UpcomingFillRow[]
}

export type PaymentLite = Pick<Payment, 'user_id' | 'booking_id' | 'amount' | 'status' | 'method' | 'created_at'>
export type BookingLite = Pick<Booking, 'id' | 'user_id' | 'eo_dive_id' | 'eo_course_id' | 'status' | 'created_at' | 'details'>
export interface ProfileLite { id: string; role: string; status: string; created_at: string; nationality: string | null; cert_level: string | null }
export interface EventLite { id: string; type: 'dive' | 'course'; title: string; capacity: number | null; dateKey: string | null }
export interface ConfirmedCount { eventId: string; count: number }

export interface DashboardInput {
  nowIso: string
  payments: PaymentLite[]
  bookings: BookingLite[]
  profiles: ProfileLite[]
  events: EventLite[]
  confirmed: ConfirmedCount[]
  pendingApplications: number
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
 *  (Jun–Aug) in the centre columns of any 12-point time series. */
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

export function computeDashboard(input: DashboardInput): Dashboard {
  const { nowIso, payments, bookings, profiles, events, confirmed } = input
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
    const id = b.eo_dive_id ?? b.eo_course_id
    return id ? eventById.get(id) ?? null : null
  }

  // --- Revenue ---
  const revenueByMonth = monthKeys.map(k => ({ label: k, value: netOf(payments.filter(p => taipeiMonth(p.created_at) === k)) }))
  const netRevenueThisMonth = netOf(payments.filter(p => taipeiMonth(p.created_at) === thisMonth))
  const netRevenueYear = netOf(payments)

  const revenueByMethod = [...groupBy(payments, p => p.method ?? '(unspecified)').entries()]
    .map(([label, ps]) => ({ label, value: netOf(ps) }))
    .sort((a, b) => b.value - a.value)

  const revenueByEventType = [...groupBy(payments, p => {
    const ev = eventOfPayment(p)
    return ev ? (ev.type === 'dive' ? 'Dives' : 'Courses') : 'Unlinked'
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
    const nat = prof?.nationality?.trim() || 'Unknown'
    const cert = canonicalCertLevel(prof?.cert_level) || 'Unknown'
    natTotals.set(nat, (natTotals.get(nat) ?? 0) + contrib)
    certTotals.set(cert, (certTotals.get(cert) ?? 0) + contrib)
  }
  const revenueByNationality = topWithOther([...natTotals.entries()], 8)
  const revenueByCertLevel = topWithOther([...certTotals.entries()], 8)

  // --- Events grouped revenue (top earners) ---
  const eventTotals = new Map<string, number>()
  for (const p of payments) {
    const ev = eventOfPayment(p)
    if (!ev) continue
    const contrib = p.status === 'paid' ? num(p.amount) : p.status === 'refunded' ? -num(p.amount) : 0
    eventTotals.set(ev.id, (eventTotals.get(ev.id) ?? 0) + contrib)
  }
  const topEventsByRevenue = [...eventTotals.entries()]
    .map(([id, value]) => ({ label: eventById.get(id)?.title ?? id, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

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
    const cert = canonicalCertLevel(p.cert_level) || 'Unknown'
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
      bookingsThisMonth,
      confirmedBookingsThisMonth,
      activeDivers,
      pendingApplications: input.pendingApplications,
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
    topEventsByRevenue,
    upcomingFill,
  }
}
