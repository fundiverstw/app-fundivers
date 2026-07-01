import { describe, it, expect } from 'vitest'
import type { ReminderKind } from '../../../src/lib/push-reminders'
import {
  buildReminderInputs,
  todayInZone,
  addDays,
  toHhmm,
  formatDayLabel,
  rescheduleNotificationText,
  cancellationNotificationText,
  type Booking,
  type DiveRow,
  type CourseRow,
} from './pure'

describe('formatDayLabel', () => {
  it('renders a timezone-independent weekday/month/day label', () => {
    expect(formatDayLabel('2026-05-18')).toBe('Mon, May 18')
    expect(formatDayLabel('2026-05-16')).toBe('Sat, May 16')
  })
})

describe('rescheduleNotificationText', () => {
  it('names the move when both dates are given (single-day drag)', () => {
    const { title, body } = rescheduleNotificationText('Open Water Course', '2026-05-16', '2026-05-18')
    expect(title).toBe('Schedule change: Open Water Course')
    expect(body).toContain('Sat, May 16')
    expect(body).toContain('Mon, May 18')
  })

  it('falls back to a generic body when dates are omitted (edit-form change)', () => {
    const { title, body } = rescheduleNotificationText('Open Water Course')
    expect(title).toBe('Schedule change: Open Water Course')
    expect(body).toMatch(/schedule has changed/i)
    expect(body).not.toMatch(/May/)
  })
})

describe('cancellationNotificationText', () => {
  it('names the cancelled event in the title and body', () => {
    const { title, body } = cancellationNotificationText('Green Island Trip')
    expect(title).toBe('Cancelled: Green Island Trip')
    expect(body).toContain('Green Island Trip')
    expect(body).toMatch(/cancelled/i)
  })
})

describe('todayInZone', () => {
  it('returns the shop-local date for the given timezone', () => {
    const tz = 'Asia/Taipei'
    // 2026-05-01 23:00 UTC is already 2026-05-02 07:00 in Taipei
    expect(todayInZone(Date.UTC(2026, 4, 1, 23, 0, 0), tz)).toBe('2026-05-02')
    // 2026-05-01 00:00 UTC → 2026-05-01 08:00 Taipei
    expect(todayInZone(Date.UTC(2026, 4, 1, 0, 0, 0), tz)).toBe('2026-05-01')
    // 2026-05-01 15:59 UTC → 2026-05-01 23:59 Taipei (same day)
    expect(todayInZone(Date.UTC(2026, 4, 1, 15, 59, 0), tz)).toBe('2026-05-01')
    // 2026-05-01 16:00 UTC → 2026-05-02 00:00 Taipei (flips)
    expect(todayInZone(Date.UTC(2026, 4, 1, 16, 0, 0), tz)).toBe('2026-05-02')
  })

  it('honors a different timezone', () => {
    // 2026-05-01 02:00 UTC → still 2026-04-30 in New York (UTC-4 in May)
    expect(todayInZone(Date.UTC(2026, 4, 1, 2, 0, 0), 'America/New_York')).toBe('2026-04-30')
  })
})

describe('addDays', () => {
  it('advances by whole days, rolling months', () => {
    expect(addDays('2026-05-01', 1)).toBe('2026-05-02')
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-05-10', -5)).toBe('2026-05-05')
  })
})

function dive(id: string, start: string, title = 'Green Island'): DiveRow {
  return { _id: id, admin_title: title, display_title: null, start_date: start }
}
function course(id: string, start: string, title = 'Open Water'): CourseRow {
  return { _id: id, display_title: title, admin_title: null, start_date: start }
}
function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    user_id: 'u1',
    status: 'confirmed',
    eo_dive_id: 'd1',
    eo_course_id: null,
    details: { total: 3000, deposit: 1000 },
    ...overrides,
  }
}

describe('buildReminderInputs', () => {
  it('joins a dive booking to its event and carries money state through', () => {
    const paid = new Map<string, number>([['b1', 500]])
    const sent = new Map<string, Set<ReminderKind>>()
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [dive('d1', '2026-05-08')],
      courses: [],
      bookings: [booking()],
      paidByBooking: paid,
      sentMap: sent,
    })
    expect(input.userId).toBe('u1')
    expect(input.eventId).toBe('d1')
    expect(input.eventType).toBe('dive')
    expect(input.eventTitle).toBe('Green Island')
    expect(input.eventStartDate).toBe('2026-05-08')
    expect(input.totalAmount).toBe(3000)
    expect(input.depositAmount).toBe(1000)
    expect(input.paidAmount).toBe(500)
    expect(input.currency).toBe('TWD')
  })

  it('routes course bookings to the course map', () => {
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [],
      courses: [course('c1', '2026-06-01', 'Advanced')],
      bookings: [booking({ eo_dive_id: null, eo_course_id: 'c1' })],
      paidByBooking: new Map(),
      sentMap: new Map(),
    })
    expect(input.eventType).toBe('course')
    expect(input.eventId).toBe('c1')
    expect(input.eventTitle).toBe('Advanced')
  })

  it('skips bookings whose event was not fetched or lacks a start_date', () => {
    const out = buildReminderInputs({ currency: 'TWD',
      dives:  [dive('d1', '2026-05-08')],
      courses: [],
      bookings: [
        booking({ id: 'b-missing', eo_dive_id: 'd-unknown' }),
        booking({ id: 'b-nostart', eo_dive_id: 'd2' }),
      ],
      paidByBooking: new Map(),
      sentMap: new Map(),
    })
    // d-unknown absent, d2 absent — no inputs emitted
    expect(out).toEqual([])
  })

  it('passes alreadySent keyed by (user_id, event_id)', () => {
    const sent = new Map<string, Set<ReminderKind>>([
      ['u1:d1', new Set<ReminderKind>(['event_7d'])],
    ])
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [dive('d1', '2026-05-08')],
      courses: [],
      bookings: [booking()],
      paidByBooking: new Map(),
      sentMap: sent,
    })
    expect(input.alreadySent.has('event_7d')).toBe(true)
    expect(input.alreadySent.has('event_1d')).toBe(false)
  })

  it('defaults missing total/deposit in details to zero', () => {
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [dive('d1', '2026-05-08')],
      courses: [],
      bookings: [booking({ details: null })],
      paidByBooking: new Map(),
      sentMap: new Map(),
    })
    expect(input.totalAmount).toBe(0)
    expect(input.depositAmount).toBe(0)
  })

  it('carries dive time through as eventStartTimeHhmm when set', () => {
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [{ ...dive('d1', '2026-05-08'), time: '09:00:00.000' }],
      courses: [],
      bookings: [booking()],
      paidByBooking: new Map(),
      sentMap: new Map(),
    })
    expect(input.eventStartTimeHhmm).toBe('09:00')
  })

  it('carries course start_time through as eventStartTimeHhmm when set', () => {
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [],
      courses: [{ ...course('c1', '2026-06-01'), start_time: '14:30:00' }],
      bookings: [booking({ eo_dive_id: null, eo_course_id: 'c1' })],
      paidByBooking: new Map(),
      sentMap: new Map(),
    })
    expect(input.eventStartTimeHhmm).toBe('14:30')
  })

  it('emits null eventStartTimeHhmm when source row has no time', () => {
    const [input] = buildReminderInputs({ currency: 'TWD',
      dives: [dive('d1', '2026-05-08')],
      courses: [],
      bookings: [booking()],
      paidByBooking: new Map(),
      sentMap: new Map(),
    })
    expect(input.eventStartTimeHhmm).toBeNull()
  })
})

describe('toHhmm', () => {
  it('normalizes Bubble time formats to HH:mm', () => {
    expect(toHhmm('09:00:00.000')).toBe('09:00')
    expect(toHhmm('14:30:00')).toBe('14:30')
    expect(toHhmm('14:30')).toBe('14:30')
    expect(toHhmm('9:00:00')).toBe('09:00')
  })
  it('returns null for empty / null / unparseable input', () => {
    expect(toHhmm('')).toBeNull()
    expect(toHhmm(null)).toBeNull()
    expect(toHhmm(undefined)).toBeNull()
    expect(toHhmm('garbage')).toBeNull()
  })
})
