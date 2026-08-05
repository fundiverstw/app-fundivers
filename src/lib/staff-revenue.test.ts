import { describe, it, expect } from 'vitest'
import {
  earnsRevenue,
  eventSpan,
  buildStaffRevenue,
  type BuildStaffRevenueInput,
  type RevenueEvent,
} from './staff-revenue'

const TODAY = '2026-08-05'

function course(over: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    id: 'c1', kind: 'course', admin_title: 'OW', display_title: 'Open Water Course',
    start_date: null, end_date: null, course_days: ['2026-06-19', '2026-06-20', '2026-06-21'],
    cancelled_at: null, ...over,
  }
}
function dive(over: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    id: 'd1', kind: 'dive', admin_title: 'Secret Garden', display_title: null,
    start_date: '2026-06-13', end_date: null, course_days: null, cancelled_at: null, ...over,
  }
}

function build(over: Partial<BuildStaffRevenueInput> = {}) {
  return buildStaffRevenue({
    season: 2026,
    today: TODAY,
    events: [],
    duties: [],
    bookings: [],
    payments: [],
    people: [
      { id: 'billy', name: 'Billy Evalt', nickname: 'Billy', compensated: true },
      { id: 'dennis', name: 'Dennis Wong', nickname: 'Dennis', compensated: true },
      { id: 'eric', name: 'Eric Odle', nickname: null, compensated: false },
    ],
    ...over,
  })
}

/** One confirmed booking worth `amount`, fully paid. */
function sale(id: string, eventId: string, amount: number) {
  return {
    booking: { id, event_id: eventId, status: 'confirmed' },
    payment: { booking_id: id, status: 'paid', amount },
  }
}

describe('earnsRevenue', () => {
  it('pays only an instructor on a taught event', () => {
    expect(earnsRevenue('course', 'instructor')).toBe(true)
    expect(earnsRevenue('course', 'guide')).toBe(false)
  })

  it('pays an instructor or a guide on an event that is led, not taught', () => {
    for (const kind of ['dive', 'adventure'] as const) {
      expect(earnsRevenue(kind, 'instructor')).toBe(true)
      expect(earnsRevenue(kind, 'guide')).toBe(true)
    }
  })

  it('never pays support, on any kind', () => {
    expect(earnsRevenue('course', 'support')).toBe(false)
    expect(earnsRevenue('dive', 'support')).toBe(false)
    expect(earnsRevenue('adventure', 'support')).toBe(false)
  })
})

describe('eventSpan', () => {
  it('reads a taught event from its course_days, in order', () => {
    expect(eventSpan(course({ course_days: ['2026-06-21', '2026-06-19'] })))
      .toEqual({ first: '2026-06-19', last: '2026-06-21' })
  })

  it('reads everything else from start_date, falling back to it for the end', () => {
    expect(eventSpan(dive())).toEqual({ first: '2026-06-13', last: '2026-06-13' })
    expect(eventSpan(dive({ end_date: '2026-06-15' })))
      .toEqual({ first: '2026-06-13', last: '2026-06-15' })
  })
})

describe('buildStaffRevenue attribution', () => {
  it('gives one instructor the whole course', () => {
    const s = sale('b1', 'c1', 46200)
    const r = build({
      events: [course()],
      duties: [{ event_id: 'c1', assignee_id: 'billy', role: 'instructor' }],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(1)
    expect(r.people[0].personId).toBe('billy')
    expect(r.people[0].completed).toEqual({ events: 1, students: 1, collected: 46200 })
  })

  it('splits a course evenly between two instructors', () => {
    const s = sale('b1', 'c1', 77000)
    const r = build({
      events: [course()],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'c1', assignee_id: 'dennis', role: 'instructor' },
      ],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people.map(p => [p.personId, p.completed.collected]))
      .toEqual(expect.arrayContaining([['billy', 38500], ['dennis', 38500]]))
  })

  it('leaves a guide on a course out of the split', () => {
    const s = sale('b1', 'c1', 30000)
    const r = build({
      events: [course()],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'c1', assignee_id: 'dennis', role: 'guide' },
      ],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(1)
    expect(r.people[0].completed.collected).toBe(30000)
  })

  it('splits a dive between its instructor and its guide', () => {
    const s = sale('b1', 'd1', 12400)
    const r = build({
      events: [dive()],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'd1', assignee_id: 'dennis', role: 'guide' },
      ],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people.map(p => p.completed.collected)).toEqual([6200, 6200])
  })

  it('excludes uncompensated crew from the denominator entirely', () => {
    const s = sale('b1', 'd1', 13200)
    const r = build({
      events: [dive()],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd1', assignee_id: 'eric', role: 'guide' },
      ],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(1)
    expect(r.people[0].personId).toBe('billy')
    expect(r.people[0].completed.collected).toBe(13200)
    expect(r.unattributed.collected).toBe(0)
  })

  it('holds revenue nobody can earn from in the unattributed bucket', () => {
    const s = sale('b1', 'd1', 3750)
    const r = build({
      events: [dive()],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'support' }],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(0)
    expect(r.unattributed.collected).toBe(3750)
    expect(r.unattributed.events.map(e => e.eventId)).toEqual(['d1'])
  })

  it('leaves an empty unrostered event out of the bucket', () => {
    const r = build({ events: [dive()] })
    expect(r.unattributed.events).toHaveLength(0)
  })

  it('counts a whole dive as unattributed when only uncompensated crew led it', () => {
    const s = sale('b1', 'd1', 5000)
    const r = build({
      events: [dive()],
      duties: [{ event_id: 'd1', assignee_id: 'eric', role: 'guide' }],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(0)
    expect(r.unattributed.collected).toBe(5000)
  })
})

describe('buildStaffRevenue money', () => {
  const duty = { event_id: 'd1', assignee_id: 'billy', role: 'guide' as const }

  it('nets refunds off the collected figure', () => {
    const r = build({
      events: [dive()],
      duties: [duty],
      bookings: [{ id: 'b1', event_id: 'd1', status: 'confirmed' }],
      payments: [
        { booking_id: 'b1', status: 'paid', amount: 4000 },
        { booking_id: 'b1', status: 'refunded', amount: 1500 },
      ],
    })
    expect(r.people[0].completed.collected).toBe(2500)
  })

  it('ignores pending and voided payment rows', () => {
    const r = build({
      events: [dive()],
      duties: [duty],
      bookings: [{ id: 'b1', event_id: 'd1', status: 'confirmed' }],
      payments: [
        { booking_id: 'b1', status: 'paid', amount: 1000 },
        { booking_id: 'b1', status: 'pending', amount: 5000 },
        { booking_id: 'b1', status: 'voided', amount: 5000 },
      ],
    })
    expect(r.people[0].completed.collected).toBe(1000)
  })

  it('counts only confirmed bookings as students', () => {
    const r = build({
      events: [dive()],
      duties: [duty],
      bookings: [
        { id: 'b1', event_id: 'd1', status: 'confirmed' },
        { id: 'b2', event_id: 'd1', status: 'cancelled' },
        { id: 'b3', event_id: 'd1', status: 'pending' },
      ],
      payments: [
        { booking_id: 'b1', status: 'paid', amount: 1600 },
        { booking_id: 'b2', status: 'paid', amount: 1600 },
        { booking_id: 'b3', status: 'paid', amount: 1600 },
      ],
    })
    expect(r.people[0].completed).toEqual({ events: 1, students: 1, collected: 1600 })
  })

  it('drops a cancelled event and its money', () => {
    const s = sale('b1', 'd1', 9000)
    const r = build({
      events: [dive({ cancelled_at: '2026-06-01T00:00:00Z' })],
      duties: [duty],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(0)
    expect(r.unattributed.collected).toBe(0)
  })
})

describe('buildStaffRevenue periods', () => {
  it('separates events that have not happened yet from the season figure', () => {
    const past = sale('b1', 'd1', 1000)
    const future = sale('b2', 'd2', 5000)
    const r = build({
      events: [dive(), dive({ id: 'd2', start_date: '2026-08-23' })],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd2', assignee_id: 'billy', role: 'guide' },
      ],
      bookings: [past.booking, future.booking],
      payments: [past.payment, future.payment],
    })
    expect(r.people[0].completed.collected).toBe(1000)
    expect(r.people[0].upcoming.collected).toBe(5000)
  })

  it('treats an event ending today as still running', () => {
    const s = sale('b1', 'd1', 2000)
    const r = build({
      events: [dive({ start_date: TODAY })],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'guide' }],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people[0].completed.events).toBe(0)
    expect(r.people[0].upcoming.events).toBe(1)
  })

  it('books a straddling course to the month it began', () => {
    const s = sale('b1', 'c1', 30800)
    const r = build({
      events: [course({ course_days: ['2026-05-31', '2026-06-01'] })],
      duties: [{ event_id: 'c1', assignee_id: 'dennis', role: 'instructor' }],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people[0].months.map(m => m.month)).toEqual(['2026-05'])
  })

  it('keeps another season out of the report', () => {
    const s = sale('b1', 'd1', 4000)
    const r = build({
      events: [dive({ start_date: '2025-12-09' })],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'guide' }],
      bookings: [s.booking],
      payments: [s.payment],
    })
    expect(r.people).toHaveLength(0)
  })
})

describe('buildStaffRevenue breakdowns', () => {
  it('splits each month into taught and led work', () => {
    const a = sale('b1', 'c1', 46200)
    const b = sale('b2', 'd1', 12400)
    const r = build({
      events: [course(), dive()],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
      ],
      bookings: [a.booking, b.booking],
      payments: [a.payment, b.payment],
    })
    expect(r.people[0].months).toEqual([{
      month: '2026-06',
      taughtEvents: 1, taughtStudents: 1,
      ledEvents: 1, ledDivers: 1,
      students: 2, collected: 58600,
    }])
  })

  it('groups taught events by course type and leaves led events uncategorised', () => {
    const a = sale('b1', 'c1', 12500)
    const b = sale('b2', 'c2', 25000)
    const c = sale('b3', 'd1', 1600)
    const r = build({
      events: [
        course({ id: 'c1', admin_title: 'AOW' }),
        course({ id: 'c2', admin_title: 'AOW' }),
        dive(),
      ],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'c2', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
      ],
      bookings: [a.booking, b.booking, c.booking],
      payments: [a.payment, b.payment, c.payment],
    })
    expect(r.people[0].categories).toEqual([
      { kind: 'course', category: 'AOW', events: 2, students: 2, collected: 37500 },
      { kind: 'dive', category: '', events: 1, students: 1, collected: 1600 },
    ])
  })

  it('ranks people by what they collected', () => {
    const a = sale('b1', 'd1', 1000)
    const b = sale('b2', 'd2', 9000)
    const r = build({
      events: [dive(), dive({ id: 'd2', start_date: '2026-06-14' })],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd2', assignee_id: 'dennis', role: 'guide' },
      ],
      bookings: [a.booking, b.booking],
      payments: [a.payment, b.payment],
    })
    expect(r.people.map(p => p.personId)).toEqual(['dennis', 'billy'])
  })

  it('names a person by nickname, falling back to their full name', () => {
    const a = sale('b1', 'd1', 100)
    const b = sale('b2', 'd2', 100)
    const r = build({
      people: [
        { id: 'billy', name: 'Billy Evalt', nickname: 'Billy', compensated: true },
        { id: 'wessel', name: 'Wessel Jacobus Herbst', nickname: null, compensated: true },
      ],
      events: [dive(), dive({ id: 'd2' })],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd2', assignee_id: 'wessel', role: 'guide' },
      ],
      bookings: [a.booking, b.booking],
      payments: [a.payment, b.payment],
    })
    expect(r.people.map(p => p.name).sort()).toEqual(['Billy', 'Wessel Jacobus Herbst'])
  })
})
