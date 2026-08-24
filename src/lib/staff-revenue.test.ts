import { describe, it, expect } from 'vitest'
import {
  earnsRevenue,
  eventSpan,
  bookingBase,
  buildStaffRevenue,
  type BuildStaffRevenueInput,
  type RevenueEvent,
} from './staff-revenue'

const TODAY = '2026-08-05'

function course(over: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    id: 'c1', kind: 'course', admin_title: 'OW', display_title: 'Open Water Course',
    start_date: null, end_date: null, course_days: ['2026-06-19', '2026-06-20', '2026-06-21'],
    cancelled_at: null, base_price: 15400, ...over,
  }
}
function dive(over: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    id: 'd1', kind: 'dive', admin_title: 'Secret Garden', display_title: null,
    start_date: '2026-06-13', end_date: null, course_days: null,
    cancelled_at: null, base_price: 1600, ...over,
  }
}

function build(over: Partial<BuildStaffRevenueInput> = {}) {
  return buildStaffRevenue({
    season: 2026,
    today: TODAY,
    events: [],
    duties: [],
    bookings: [],
    people: [
      { id: 'billy', name: 'Billy Evalt', nickname: 'Billy' },
      { id: 'dennis', name: 'Dennis Wong', nickname: 'Dennis' },
      { id: 'eric', name: 'Eric Odle', nickname: null },
    ],
    ...over,
  })
}

/** `n` confirmed bookings on `eventId`, none carrying a charge snapshot. */
function heads(eventId: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${eventId}-b${i}`, event_id: eventId, status: 'confirmed', details: null,
  }))
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

describe('bookingBase', () => {
  it('takes the snapshotted base line over the live catalog price', () => {
    const details = { charges: [{ kind: 'base', amount: 14400 }] }
    expect(bookingBase(details, 15400)).toBe(14400)
  })

  it('counts only the base line — gear, transport and add-ons are not teaching', () => {
    const details = {
      charges: [
        { kind: 'base', amount: 15400 },
        { kind: 'gear', amount: 1600 },
        { kind: 'transport', amount: 1300 },
        { kind: 'addon', amount: 500 },
        { kind: 'surcharge', amount: 900 },
      ],
    }
    expect(bookingBase(details, 15400)).toBe(15400)
  })

  it('falls back to the catalog price for a booking with no snapshot', () => {
    expect(bookingBase(null, 15400)).toBe(15400)
    expect(bookingBase({ charges: [] }, 15400)).toBe(15400)
    expect(bookingBase({ charges: [{ kind: 'gear', amount: 400 }] }, 15400)).toBe(15400)
  })

  it('is zero when neither a snapshot nor a price exists', () => {
    expect(bookingBase(null, null)).toBe(0)
  })
})

describe('buildStaffRevenue revenue basis', () => {
  const duty = { event_id: 'c1', assignee_id: 'billy', role: 'instructor' as const }

  it('is the base price times the confirmed heads', () => {
    const r = build({ events: [course()], duties: [duty], bookings: heads('c1', 3) })
    expect(r.people[0].completed.revenue).toBe(15400 * 3)
    expect(r.people[0].completed.students).toBe(3)
  })

  it('prices dives the same way — base fee times divers', () => {
    const r = build({
      events: [dive()],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'guide' }],
      bookings: heads('d1', 6),
    })
    expect(r.people[0].completed.revenue).toBe(1600 * 6)
  })

  it('uses each booking’s own snapshot, so a group discount is respected', () => {
    const r = build({
      events: [course()],
      duties: [duty],
      bookings: [
        { id: 'b1', event_id: 'c1', status: 'confirmed', details: { charges: [{ kind: 'base', amount: 14400 }] } },
        { id: 'b2', event_id: 'c1', status: 'confirmed', details: { charges: [{ kind: 'base', amount: 14400 }] } },
      ],
    })
    expect(r.people[0].completed.revenue).toBe(28800)
  })

  it('ignores gear, transport and add-ons on top of the base', () => {
    const r = build({
      events: [course()],
      duties: [duty],
      bookings: [{
        id: 'b1', event_id: 'c1', status: 'confirmed',
        details: { charges: [{ kind: 'base', amount: 15400 }, { kind: 'gear', amount: 2200 }, { kind: 'transport', amount: 1300 }] },
      }],
    })
    expect(r.people[0].completed.revenue).toBe(15400)
  })

  it('counts only confirmed bookings as heads', () => {
    const r = build({
      events: [course()],
      duties: [duty],
      bookings: [
        { id: 'b1', event_id: 'c1', status: 'confirmed', details: null },
        { id: 'b2', event_id: 'c1', status: 'cancelled', details: null },
        { id: 'b3', event_id: 'c1', status: 'pending', details: null },
      ],
    })
    expect(r.people[0].completed).toEqual({ events: 1, students: 1, revenue: 15400 })
  })

  it('is unaffected by what has actually been paid', () => {
    // No payments anywhere in the input: revenue is what the work was worth,
    // not what has been banked.
    const r = build({ events: [course()], duties: [duty], bookings: heads('c1', 2) })
    expect(r.people[0].completed.revenue).toBe(30800)
  })
})

describe('buildStaffRevenue attribution', () => {
  it('gives one instructor the whole course', () => {
    const r = build({
      events: [course()],
      duties: [{ event_id: 'c1', assignee_id: 'billy', role: 'instructor' }],
      bookings: heads('c1', 3),
    })
    expect(r.people).toHaveLength(1)
    expect(r.people[0].personId).toBe('billy')
    expect(r.people[0].completed.revenue).toBe(46200)
  })

  it('splits a course evenly between two instructors', () => {
    const r = build({
      events: [course()],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'c1', assignee_id: 'dennis', role: 'instructor' },
      ],
      bookings: heads('c1', 2),
    })
    expect(r.people.map(p => p.completed.revenue)).toEqual([15400, 15400])
  })

  it('leaves a guide on a course out of the split', () => {
    const r = build({
      events: [course()],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'c1', assignee_id: 'dennis', role: 'guide' },
      ],
      bookings: heads('c1', 1),
    })
    expect(r.people).toHaveLength(1)
    expect(r.people[0].completed.revenue).toBe(15400)
  })

  it('splits a dive between its instructor and its guide', () => {
    const r = build({
      events: [dive()],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'd1', assignee_id: 'dennis', role: 'guide' },
      ],
      bookings: heads('d1', 4),
    })
    expect(r.people.map(p => p.completed.revenue)).toEqual([3200, 3200])
  })

  it('splits between every rostered guide — who is paid is not the app’s to know', () => {
    const r = build({
      events: [dive()],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd1', assignee_id: 'eric', role: 'guide' },
      ],
      bookings: heads('d1', 2),
    })
    expect(r.people.map(p => p.completed.revenue)).toEqual([1600, 1600])
    expect(r.unattributed.revenue).toBe(0)
  })

  it('holds revenue nobody can earn from in the unattributed bucket', () => {
    const r = build({
      events: [dive()],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'support' }],
      bookings: heads('d1', 3),
    })
    expect(r.people).toHaveLength(0)
    expect(r.unattributed.revenue).toBe(4800)
    expect(r.unattributed.events.map(e => e.eventId)).toEqual(['d1'])
  })

  it('leaves an unbooked unrostered event out of the bucket', () => {
    const r = build({ events: [dive()] })
    expect(r.unattributed.events).toHaveLength(0)
  })

  it('credits a guide the app has never been told anything about', () => {
    // Attribution keys off the duty roster, not a roster of known people, so a
    // crew member missing from `people` still earns — they just show by id.
    const r = build({
      events: [dive()],
      duties: [{ event_id: 'd1', assignee_id: 'stranger', role: 'guide' }],
      bookings: heads('d1', 1),
    })
    expect(r.people).toHaveLength(1)
    expect(r.people[0].personId).toBe('stranger')
  })

  it('drops a cancelled event and its bookings', () => {
    const r = build({
      events: [dive({ cancelled_at: '2026-06-01T00:00:00Z' })],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'guide' }],
      bookings: heads('d1', 5),
    })
    expect(r.people).toHaveLength(0)
    expect(r.unattributed.revenue).toBe(0)
  })
})

describe('buildStaffRevenue periods', () => {
  it('separates events that have not happened yet from the season figure', () => {
    const r = build({
      events: [dive(), dive({ id: 'd2', start_date: '2026-08-23' })],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd2', assignee_id: 'billy', role: 'guide' },
      ],
      bookings: [...heads('d1', 1), ...heads('d2', 5)],
    })
    expect(r.people[0].completed.revenue).toBe(1600)
    expect(r.people[0].upcoming.revenue).toBe(8000)
  })

  it('treats an event ending today as still running', () => {
    const r = build({
      events: [dive({ start_date: TODAY })],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'guide' }],
      bookings: heads('d1', 1),
    })
    expect(r.people[0].completed.events).toBe(0)
    expect(r.people[0].upcoming.events).toBe(1)
  })

  it('books a straddling course to the month it began', () => {
    const r = build({
      events: [course({ course_days: ['2026-05-31', '2026-06-01'] })],
      duties: [{ event_id: 'c1', assignee_id: 'dennis', role: 'instructor' }],
      bookings: heads('c1', 2),
    })
    expect(r.people[0].months.map(m => m.month)).toEqual(['2026-05'])
  })

  it('keeps another season out of the report', () => {
    const r = build({
      events: [dive({ start_date: '2025-12-09' })],
      duties: [{ event_id: 'd1', assignee_id: 'billy', role: 'guide' }],
      bookings: heads('d1', 3),
    })
    expect(r.people).toHaveLength(0)
  })
})

describe('buildStaffRevenue breakdowns', () => {
  function twoKinds() {
    return build({
      events: [course(), dive()],
      duties: [
        { event_id: 'c1', assignee_id: 'billy', role: 'instructor' },
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
      ],
      bookings: [...heads('c1', 2), ...heads('d1', 5)],
    })
  }

  it('counts taught and led events per month, and carries the events behind them', () => {
    const [m] = twoKinds().people[0].months
    expect(m).toMatchObject({
      month: '2026-06', taughtEvents: 1, ledEvents: 1, students: 7, revenue: 30800 + 8000,
    })
    expect(m.events.map(e => e.eventId).sort()).toEqual(['c1', 'd1'])
  })

  it('splits the type breakdown into a taught group and a led group', () => {
    const groups = twoKinds().people[0].groups
    expect(groups.map(g => [g.taught, g.events, g.revenue]))
      .toEqual([[true, 1, 30800], [false, 1, 8000]])
    expect(groups[0].categories.map(c => c.category)).toEqual(['OW'])
    expect(groups[1].categories.map(c => c.category)).toEqual(['Secret Garden'])
  })

  it('drops a group nobody worked rather than showing an empty one', () => {
    const r = build({
      events: [course()],
      duties: [{ event_id: 'c1', assignee_id: 'billy', role: 'instructor' }],
      bookings: heads('c1', 1),
    })
    expect(r.people[0].groups.map(g => g.taught)).toEqual([true])
  })

  it('groups repeated course types together and ranks them by revenue', () => {
    const r = build({
      events: [
        course({ id: 'c1', admin_title: 'AOW', base_price: 12500 }),
        course({ id: 'c2', admin_title: 'AOW', base_price: 12500, course_days: ['2026-07-04'] }),
        course({ id: 'c3', admin_title: 'EANx', base_price: 7200, course_days: ['2026-07-11'] }),
      ],
      duties: ['c1', 'c2', 'c3'].map(id => ({ event_id: id, assignee_id: 'billy', role: 'instructor' as const })),
      bookings: [...heads('c1', 1), ...heads('c2', 1), ...heads('c3', 2)],
    })
    expect(r.people[0].groups[0].categories).toEqual([
      { kind: 'course', category: 'AOW', events: 2, students: 2, revenue: 25000 },
      { kind: 'course', category: 'EANx', events: 1, students: 2, revenue: 14400 },
    ])
  })

  it('ranks people by what they generated', () => {
    const r = build({
      events: [dive(), dive({ id: 'd2', start_date: '2026-06-14' })],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd2', assignee_id: 'dennis', role: 'guide' },
      ],
      bookings: [...heads('d1', 1), ...heads('d2', 9)],
    })
    expect(r.people.map(p => p.personId)).toEqual(['dennis', 'billy'])
  })

  it('names a person by nickname, falling back to their full name', () => {
    const r = build({
      people: [
        { id: 'billy', name: 'Billy Evalt', nickname: 'Billy' },
        { id: 'wessel', name: 'Wessel Jacobus Herbst', nickname: null },
      ],
      events: [dive(), dive({ id: 'd2' })],
      duties: [
        { event_id: 'd1', assignee_id: 'billy', role: 'guide' },
        { event_id: 'd2', assignee_id: 'wessel', role: 'guide' },
      ],
      bookings: [...heads('d1', 1), ...heads('d2', 1)],
    })
    expect(r.people.map(p => p.name).sort()).toEqual(['Billy', 'Wessel Jacobus Herbst'])
  })
})
