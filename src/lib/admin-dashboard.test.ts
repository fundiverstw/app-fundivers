import { describe, it, expect } from 'vitest'
import { computeDashboard, calendarYearMonths, type DashboardInput } from './admin-dashboard'
import { EVENT_KIND_LABELS } from './event-kind-labels'
import type { CertLadderRow } from './cert-level'

// Enough of the shop's cert ladder to exercise the resolver; the full table and
// its cross-agency equivalences are covered in cert-level.test.ts.
const LADDER: CertLadderRow[] = [
  { id: 'open_water', code: 'open_water', name: 'OW', padi_equivalent_id: 'open_water' },
  { id: 'advanced_open_water', code: 'advanced_open_water', name: 'AOW', padi_equivalent_id: 'advanced_open_water' },
  { id: 'rescue', code: 'rescue', name: 'Rescue', padi_equivalent_id: 'rescue' },
  { id: 'naui_advanced_scuba_diver', code: 'naui_advanced_scuba_diver', name: 'Advanced Scuba Diver', padi_equivalent_id: 'advanced_open_water' },
]

describe('calendarYearMonths', () => {
  it('returns Jan→Dec so the peak season sits in the center columns', () => {
    const keys = calendarYearMonths(2026)
    expect(keys).toHaveLength(12)
    expect(keys[0]).toBe('2026-01')
    expect(keys[11]).toBe('2026-12')
    // Jun/Jul/Aug occupy the center of a 12-column chart (indices 5,6,7).
    expect(keys.slice(5, 8)).toEqual(['2026-06', '2026-07', '2026-08'])
  })
})

const NOW = '2026-06-15T12:00:00+08:00'

const input: DashboardInput = {
  nowIso: NOW,
  pendingApplications: 2,
  pendingRefundRequests: 3,
  payments: [
    { user_id: 'd1', booking_id: 'b1', amount: 1000, status: 'paid', method: 'bank_transfer', created_at: '2026-06-10T00:00:00+08:00' },
    { user_id: 'd1', booking_id: 'b1', amount: 200, status: 'refunded', method: 'bank_transfer', created_at: '2026-06-12T00:00:00+08:00' },
    { user_id: 'd2', booking_id: 'b2', amount: 500, status: 'paid', method: 'cash', created_at: '2026-06-05T00:00:00+08:00' },
    { user_id: 'd1', booking_id: 'b1', amount: 9999, status: 'voided', method: 'bank_transfer', created_at: '2026-06-11T00:00:00+08:00' },
  ],
  bookings: [
    { id: 'b1', user_id: 'd1', event_id: 'dive1', status: 'confirmed', created_at: '2026-06-09T00:00:00+08:00', details: { total: 1000 } },
    { id: 'b2', user_id: 'd2', event_id: 'course1', status: 'pending', created_at: '2026-06-04T00:00:00+08:00', details: { total: 500 } },
  ],
  profiles: [
    { id: 'd1', role: 'diver', status: 'active', created_at: '2026-06-02T00:00:00+08:00', nationality: 'Taiwan', cert_level: 'AOW' },
    { id: 'd2', role: 'diver', status: 'active', created_at: '2026-05-02T00:00:00+08:00', nationality: 'Japan', cert_level: 'OW' },
    { id: 'a1', role: 'admin', status: 'active', created_at: '2026-06-01T00:00:00+08:00', nationality: null, cert_level: null },
  ],
  events: [
    { id: 'dive1', type: 'dive', title: 'Long Dong', capacity: 10, dateKey: '2026-07-01', isBoatDive: false, isTrip: false, courseLabel: null },
    { id: 'course1', type: 'course', title: 'OW Course', capacity: 6, dateKey: '2026-06-20', isBoatDive: false, isTrip: false, courseLabel: 'Open Water Course' },
  ],
  confirmed: [{ eventId: 'dive1', count: 5 }, { eventId: 'course1', count: 3 }],
  certLadder: LADDER,
}

describe('computeDashboard', () => {
  const d = computeDashboard(input)

  it('nets revenue paid minus refunded, excluding voided', () => {
    expect(d.kpis.netRevenueThisMonth).toBe(1300) // 1000 - 200 + 500
    expect(d.kpis.netRevenueYear).toBe(1300)
    expect(d.revenueByMonth).toHaveLength(12)
    expect(d.revenueByMonth[0].label).toBe('2026-01')
    expect(d.revenueByMonth.find(p => p.label === '2026-06')).toEqual({ label: '2026-06', value: 1300 })
    expect(d.revenueByMonth.filter(p => p.value !== 0)).toHaveLength(1)
  })

  it('breaks revenue down by method and event type', () => {
    expect(d.revenueByMethod).toEqual([
      { label: 'bank_transfer', value: 800 },
      { label: 'cash', value: 500 },
    ])
    // Labelled with the localised event-kind label, so the chart follows the
    // deployment's language instead of two hardcoded English plurals.
    expect(d.revenueByEventType).toEqual([
      { label: EVENT_KIND_LABELS.dive,   value: 800 },
      { label: EVENT_KIND_LABELS.course, value: 500 },
    ])
  })

  it('attributes revenue to payer demographics', () => {
    expect(d.revenueByNationality).toEqual([
      { label: 'Taiwan', value: 800 },
      { label: 'Japan', value: 500 },
    ])
    // Cert levels resolve to the PADI rung the shop's own ladder names.
    expect(d.revenueByCertLevel).toEqual([
      { label: 'AOW', value: 800 },
      { label: 'OW', value: 500 },
    ])
    expect(d.revenueByActivity).toEqual([
      { label: 'Shore dives', value: 800 },
      { label: 'Open Water Course', value: 500 },
    ])
  })

  it('counts bookings by status and month', () => {
    expect(d.bookingsByStatus).toEqual([
      { label: 'waitlisted', value: 0 },
      { label: 'pending', value: 1 },
      { label: 'confirmed', value: 1 },
      { label: 'cancelled', value: 0 },
    ])
    expect(d.kpis.bookingsThisMonth).toBe(2)
    expect(d.kpis.confirmedBookingsThisMonth).toBe(1)
    expect(d.bookingsByMonth).toHaveLength(12)
    expect(d.bookingsByMonth.find(p => p.label === '2026-06')).toEqual({ label: '2026-06', value: 2 })
  })

  it('counts only divers for signups, active divers, and cert mix', () => {
    expect(d.kpis.activeDivers).toBe(2) // admin excluded
    expect(d.signupsByMonth.find(p => p.label === '2026-06')).toEqual({ label: '2026-06', value: 1 }) // only d1
    expect(d.certLevelMix).toEqual([
      { label: 'AOW', value: 1 },
      { label: 'OW', value: 1 },
    ])
  })

  it('computes upcoming fill and average', () => {
    expect(d.kpis.upcomingEvents).toBe(2)
    expect(d.kpis.avgFillPct).toBe(50)
    // sorted by date — the June course comes before the July dive
    expect(d.upcomingFill.map(r => r.id)).toEqual(['course1', 'dive1'])
    expect(d.upcomingFill[1]).toMatchObject({ confirmed: 5, capacity: 10, fillPct: 50 })
  })

  it('passes pending applications straight through', () => {
    expect(d.kpis.pendingApplications).toBe(2)
    expect(d.kpis.pendingRefundRequests).toBe(3)
  })

  it('treats past-dated events as not upcoming', () => {
    const past = computeDashboard({
      ...input,
      events: [{ id: 'dive1', type: 'dive', title: 'Old', capacity: 10, dateKey: '2026-01-01', isBoatDive: false, isTrip: false, courseLabel: null }],
      confirmed: [],
    })
    expect(past.kpis.upcomingEvents).toBe(0)
    expect(past.kpis.avgFillPct).toBeNull()
  })

  it('folds demographics beyond the top 8 into Other', () => {
    const many = computeDashboard({
      ...input,
      payments: Array.from({ length: 10 }, (_, i) => ({
        user_id: `u${i}`, booking_id: null, amount: (i + 1) * 100, status: 'paid' as const,
        method: 'cash', created_at: '2026-06-10T00:00:00+08:00',
      })),
      profiles: Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`, role: 'diver', status: 'active', created_at: '2026-06-10T00:00:00+08:00',
        nationality: `Country${i}`, cert_level: null,
      })),
    })
    expect(many.revenueByNationality).toHaveLength(9) // top 8 + Other
    expect(many.revenueByNationality.at(-1)?.label).toBe('Other')
  })
})

// An 'account_credit' payment settles a booking without money arriving. Summing
// it as revenue books the same cash twice: once when the diver actually paid,
// again when the credit that money became is spent on the next booking.
describe('account credit is reported beside revenue, never inside it', () => {
  const withCredit = computeDashboard({
    ...input,
    payments: [
      ...input.payments,
      { user_id: 'd2', booking_id: 'b2', amount: 800, status: 'paid', method: 'account_credit', created_at: '2026-06-06T00:00:00+08:00' },
    ],
  })

  it('leaves every revenue figure unchanged', () => {
    expect(withCredit.kpis.netRevenueThisMonth).toBe(1300)
    expect(withCredit.kpis.netRevenueYear).toBe(1300)
    expect(withCredit.revenueByMonth.find(p => p.label === '2026-06')!.value).toBe(1300)
  })

  it('reports the credit spent as its own KPI', () => {
    expect(withCredit.kpis.creditAppliedYear).toBe(800)
    expect(computeDashboard(input).kpis.creditAppliedYear).toBe(0)
  })

  it('keeps it out of the by-method, by-event-type and per-diver breakdowns', () => {
    expect(withCredit.revenueByMethod.map(p => p.label)).not.toContain('account_credit')
    const course = withCredit.revenueByEventType.find(p => p.label === EVENT_KIND_LABELS.course)
    expect(course?.value ?? 0).toBe(500)
    expect(withCredit.revenueByNationality.find(p => p.label === 'Japan')!.value).toBe(500)
  })
})

// The three panes the admin reported as showing the same thing several times.
describe('computeDashboard collapses duplicate labels', () => {
  const at = (created_at: string) => created_at

  // "USA" and "United States" stood as two bars, halving one country's takings.
  it('reports one country however each diver spelled it', () => {
    const d = computeDashboard({
      ...input,
      payments: [
        { user_id: 'd1', booking_id: 'b1', amount: 100, status: 'paid', method: 'cash', created_at: at('2026-06-10T00:00:00+08:00') },
        { user_id: 'd2', booking_id: 'b2', amount: 200, status: 'paid', method: 'cash', created_at: at('2026-06-10T00:00:00+08:00') },
        { user_id: 'd3', booking_id: 'b3', amount: 300, status: 'paid', method: 'cash', created_at: at('2026-06-10T00:00:00+08:00') },
      ],
      profiles: [
        { id: 'd1', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: 'USA', cert_level: 'OW' },
        { id: 'd2', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: 'United States', cert_level: 'OW' },
        { id: 'd3', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: 'American', cert_level: 'OW' },
      ],
    })
    expect(d.revenueByNationality).toEqual([{ label: 'United States', value: 600 }])
  })

  // Every one of these is an AOW diver under a different agency's name for it.
  it('reports one rung however each diver named their certification', () => {
    const d = computeDashboard({
      ...input,
      payments: [],
      profiles: [
        { id: 'd1', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: null, cert_level: 'AOW' },
        { id: 'd2', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: null, cert_level: 'Advanced Open Water' },
        { id: 'd3', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: null, cert_level: 'Advanced Scuba Diver' },
        { id: 'd4', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: null, cert_level: 'AOW & nitrox' },
      ],
    })
    expect(d.certLevelMix).toEqual([{ label: 'AOW', value: 4 }])
  })

  it('buckets a certification the ladder cannot place on its own, not into a rung', () => {
    const d = computeDashboard({
      ...input,
      payments: [],
      profiles: [
        { id: 'd1', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: null, cert_level: 'PE40' },
        { id: 'd2', role: 'diver', status: 'active', created_at: at('2026-01-01T00:00:00+08:00'), nationality: null, cert_level: null },
      ],
    })
    expect(d.certLevelMix).toEqual([
      { label: 'PE40', value: 1 },
      { label: 'Unknown', value: 1 },
    ])
  })

  // The weekly shore dive used to fill the pane with a dozen identical titles.
  it('sums repeat outings of the same kind instead of listing each occurrence', () => {
    const occurrences = ['e1', 'e2', 'e3']
    const d = computeDashboard({
      ...input,
      payments: occurrences.map(id => ({
        user_id: 'd1', booking_id: `b-${id}`, amount: 100, status: 'paid' as const,
        method: 'cash', created_at: at('2026-06-10T00:00:00+08:00'),
      })),
      bookings: occurrences.map(id => ({
        id: `b-${id}`, user_id: 'd1', event_id: id, status: 'confirmed' as const,
        created_at: at('2026-06-09T00:00:00+08:00'), details: {},
      })),
      events: occurrences.map(id => ({
        id, type: 'dive' as const, title: 'Long Dong Shore Dive', capacity: 10,
        dateKey: '2026-06-10', isBoatDive: false, isTrip: false, courseLabel: null,
      })),
    })
    expect(d.revenueByActivity).toEqual([{ label: 'Shore dives', value: 300 }])
  })

  it('tells shore dives, boat dives and trips apart', () => {
    const kinds = [
      { id: 'shore', isBoatDive: false, isTrip: false, amount: 100 },
      { id: 'boat', isBoatDive: true, isTrip: false, amount: 200 },
      { id: 'trip', isBoatDive: false, isTrip: true, amount: 400 },
      // A liveaboard is a trip that happens to involve boats; reporting it as a
      // boat dive would hide the shop's most distinct line of business.
      { id: 'liveaboard', isBoatDive: true, isTrip: true, amount: 800 },
    ]
    const d = computeDashboard({
      ...input,
      payments: kinds.map(k => ({
        user_id: 'd1', booking_id: `b-${k.id}`, amount: k.amount, status: 'paid' as const,
        method: 'cash', created_at: at('2026-06-10T00:00:00+08:00'),
      })),
      bookings: kinds.map(k => ({
        id: `b-${k.id}`, user_id: 'd1', event_id: k.id, status: 'confirmed' as const,
        created_at: at('2026-06-09T00:00:00+08:00'), details: {},
      })),
      events: kinds.map(k => ({
        id: k.id, type: 'dive' as const, title: k.id, capacity: 10, dateKey: '2026-06-10',
        isBoatDive: k.isBoatDive, isTrip: k.isTrip, courseLabel: null,
      })),
    })
    expect(d.revenueByActivity).toEqual([
      { label: 'Trips', value: 1200 },
      { label: 'Boat dives', value: 200 },
      { label: 'Shore dives', value: 100 },
    ])
  })

  it('reports a course under its catalog title, and falls back when it has none', () => {
    const courses = [
      { id: 'c1', courseLabel: 'Open Water Course', amount: 100 },
      { id: 'c2', courseLabel: 'Open Water Course', amount: 200 },
      { id: 'c3', courseLabel: null, amount: 400 },
    ]
    const d = computeDashboard({
      ...input,
      payments: courses.map(c => ({
        user_id: 'd1', booking_id: `b-${c.id}`, amount: c.amount, status: 'paid' as const,
        method: 'cash', created_at: at('2026-06-10T00:00:00+08:00'),
      })),
      bookings: courses.map(c => ({
        id: `b-${c.id}`, user_id: 'd1', event_id: c.id, status: 'confirmed' as const,
        created_at: at('2026-06-09T00:00:00+08:00'), details: {},
      })),
      events: courses.map(c => ({
        id: c.id, type: 'course' as const, title: c.id, capacity: 6, dateKey: '2026-06-10',
        isBoatDive: false, isTrip: false, courseLabel: c.courseLabel,
      })),
    })
    expect(d.revenueByActivity).toEqual([
      { label: 'Courses', value: 400 },
      { label: 'Open Water Course', value: 300 },
    ])
  })
})
