import { describe, it, expect } from 'vitest'
import { computeDashboard, calendarYearMonths, type DashboardInput } from './admin-dashboard'

describe('calendarYearMonths', () => {
  it('returns Jan→Dec so the peak season sits in the centre columns', () => {
    const keys = calendarYearMonths(2026)
    expect(keys).toHaveLength(12)
    expect(keys[0]).toBe('2026-01')
    expect(keys[11]).toBe('2026-12')
    // Jun/Jul/Aug occupy the centre of a 12-column chart (indices 5,6,7).
    expect(keys.slice(5, 8)).toEqual(['2026-06', '2026-07', '2026-08'])
  })
})

const NOW = '2026-06-15T12:00:00+08:00'

const input: DashboardInput = {
  nowIso: NOW,
  pendingApplications: 2,
  payments: [
    { user_id: 'd1', booking_id: 'b1', amount: 1000, status: 'paid', method: 'bank_transfer', created_at: '2026-06-10T00:00:00+08:00' },
    { user_id: 'd1', booking_id: 'b1', amount: 200, status: 'refunded', method: 'bank_transfer', created_at: '2026-06-12T00:00:00+08:00' },
    { user_id: 'd2', booking_id: 'b2', amount: 500, status: 'paid', method: 'cash', created_at: '2026-06-05T00:00:00+08:00' },
    { user_id: 'd1', booking_id: 'b1', amount: 9999, status: 'voided', method: 'bank_transfer', created_at: '2026-06-11T00:00:00+08:00' },
  ],
  bookings: [
    { id: 'b1', user_id: 'd1', eo_dive_id: 'dive1', eo_course_id: null, status: 'confirmed', created_at: '2026-06-09T00:00:00+08:00', details: { total: 1000 } },
    { id: 'b2', user_id: 'd2', eo_dive_id: null, eo_course_id: 'course1', status: 'pending', created_at: '2026-06-04T00:00:00+08:00', details: { total: 500 } },
  ],
  profiles: [
    { id: 'd1', role: 'diver', status: 'active', created_at: '2026-06-02T00:00:00+08:00', nationality: 'Taiwan', cert_level: 'AOW' },
    { id: 'd2', role: 'diver', status: 'active', created_at: '2026-05-02T00:00:00+08:00', nationality: 'Japan', cert_level: 'OW' },
    { id: 'a1', role: 'admin', status: 'active', created_at: '2026-06-01T00:00:00+08:00', nationality: null, cert_level: null },
  ],
  events: [
    { id: 'dive1', type: 'dive', title: 'Long Dong', capacity: 10, dateKey: '2026-07-01' },
    { id: 'course1', type: 'course', title: 'OW Course', capacity: 6, dateKey: '2026-06-20' },
  ],
  confirmed: [{ eventId: 'dive1', count: 5 }, { eventId: 'course1', count: 3 }],
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
    expect(d.revenueByEventType).toEqual([
      { label: 'Dives', value: 800 },
      { label: 'Courses', value: 500 },
    ])
  })

  it('attributes revenue to payer demographics', () => {
    expect(d.revenueByNationality).toEqual([
      { label: 'Taiwan', value: 800 },
      { label: 'Japan', value: 500 },
    ])
    // Cert levels are canonicalized: 'AOW' → 'Advanced Open Water', 'OW' → 'Open Water'.
    expect(d.revenueByCertLevel).toEqual([
      { label: 'Advanced Open Water', value: 800 },
      { label: 'Open Water', value: 500 },
    ])
    expect(d.topEventsByRevenue).toEqual([
      { label: 'Long Dong', value: 800 },
      { label: 'OW Course', value: 500 },
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
      { label: 'Advanced Open Water', value: 1 },
      { label: 'Open Water', value: 1 },
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
  })

  it('treats past-dated events as not upcoming', () => {
    const past = computeDashboard({
      ...input,
      events: [{ id: 'dive1', type: 'dive', title: 'Old', capacity: 10, dateKey: '2026-01-01' }],
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
