import { describe, it, expect } from 'vitest'
import {
  seriesAnchor, shiftFormToDate, occurrenceDate, sortOccurrences,
  laterOccurrences, sharedPatchFromForm,
} from './event-series'
import { EMPTY_FORM, type FormState } from '../components/admin/event-form-state'
import type { EventRow } from '../types/database'

const dive = (over: Partial<FormState> = {}): FormState => ({
  ...EMPTY_FORM,
  type: 'dive',
  admin_title: 'Saturday boat dive',
  start_date: '2026-08-01',
  ...over,
})

const course = (over: Partial<FormState> = {}): FormState => ({
  ...EMPTY_FORM,
  type: 'course',
  courseDays: ['2026-08-01', '2026-08-02'],
  ...over,
})

describe('seriesAnchor', () => {
  it('is the envelope start for a dive or adventure', () => {
    expect(seriesAnchor(dive())).toBe('2026-08-01')
    expect(seriesAnchor(dive({ type: 'adventure' }))).toBe('2026-08-01')
  })

  // A course's start lives in the day list, not start_date.
  it('is the earliest course day for a course, whatever order they were entered', () => {
    expect(seriesAnchor(course({ courseDays: ['2026-08-09', '2026-08-01'] }))).toBe('2026-08-01')
  })

  it('is null when there is no date to anchor on', () => {
    expect(seriesAnchor(dive({ start_date: '' }))).toBeNull()
    expect(seriesAnchor(course({ courseDays: [] }))).toBeNull()
  })
})

describe('shiftFormToDate — envelope kinds', () => {
  it('moves the start and end together, preserving the length', () => {
    const shifted = shiftFormToDate(dive({ start_date: '2026-08-01', end_date: '2026-08-03' }), '2026-08-08')
    expect(shifted.start_date).toBe('2026-08-08')
    expect(shifted.end_date).toBe('2026-08-10')
  })

  // The bug this guards: an occurrence eight weeks out keeping the template's
  // cancellation deadline would refuse refunds for a date already in the past.
  it('moves cancel_date and full_payment_deadline too', () => {
    const shifted = shiftFormToDate(
      dive({ cancel_date: '2026-07-30', full_payment_deadline: '2026-07-25' }),
      '2026-09-05',
    )
    // +35 days, the same offset the dive itself moved by.
    expect(shifted.cancel_date).toBe('2026-09-03')
    expect(shifted.full_payment_deadline).toBe('2026-08-29')
  })

  it('leaves unset dates unset rather than inventing them', () => {
    const shifted = shiftFormToDate(dive({ end_date: '', cancel_date: '' }), '2026-08-08')
    expect(shifted.end_date).toBe('')
    expect(shifted.cancel_date).toBe('')
  })

  it('returns the form untouched when the target is the anchor', () => {
    const form = dive({ end_date: '2026-08-02' })
    expect(shiftFormToDate(form, '2026-08-01')).toEqual(form)
  })

  it('shifts backwards for a target before the anchor', () => {
    expect(shiftFormToDate(dive(), '2026-07-25').start_date).toBe('2026-07-25')
  })

  it('crosses month and year boundaries', () => {
    expect(shiftFormToDate(dive({ start_date: '2026-12-26' }), '2027-01-02').start_date).toBe('2027-01-02')
    const overYear = shiftFormToDate(dive({ start_date: '2026-12-26', end_date: '2026-12-28' }), '2027-01-02')
    expect(overYear.end_date).toBe('2027-01-04')
  })

  it('leaves non-date fields alone', () => {
    const shifted = shiftFormToDate(dive({ capacity: '8', notes: 'bring a torch' }), '2026-08-08')
    expect(shifted.capacity).toBe('8')
    expect(shifted.notes).toBe('bring a torch')
    expect(shifted.admin_title).toBe('Saturday boat dive')
  })
})

describe('shiftFormToDate — courses', () => {
  it('moves every course day as a block, keeping the gaps', () => {
    // Sat, Sun, then the FOLLOWING Sat — a shape the shift must preserve.
    const shifted = shiftFormToDate(
      course({ courseDays: ['2026-08-01', '2026-08-02', '2026-08-08'] }),
      '2026-09-05',
    )
    expect(shifted.courseDays).toEqual(['2026-09-05', '2026-09-06', '2026-09-12'])
  })

  it('anchors on the earliest day even when the list is unsorted', () => {
    const shifted = shiftFormToDate(
      course({ courseDays: ['2026-08-08', '2026-08-01'] }),
      '2026-08-15',
    )
    // Delta is +14 from the earliest (Aug 1), applied to both in place.
    expect(shifted.courseDays).toEqual(['2026-08-22', '2026-08-15'])
  })

  it('does not fabricate an envelope for a course', () => {
    const shifted = shiftFormToDate(course(), '2026-08-08')
    expect(shifted.start_date).toBe(EMPTY_FORM.start_date)
  })
})

const row = (over: Partial<EventRow>): EventRow => ({
  id: 'e1', kind: 'dive', start_date: null, end_date: null, course_days: null,
  series_id: null,
  ...over,
} as EventRow)

describe('occurrenceDate', () => {
  it('reads start_date for an envelope kind', () => {
    expect(occurrenceDate(row({ start_date: '2026-08-01' }))).toBe('2026-08-01')
  })

  it('reads the earliest course day for a course', () => {
    expect(occurrenceDate(row({ kind: 'course', course_days: ['2026-08-09', '2026-08-02'] })))
      .toBe('2026-08-02')
  })

  it('tolerates a timestamp-shaped course day', () => {
    expect(occurrenceDate(row({ kind: 'course', course_days: ['2026-08-02T00:00:00Z'] })))
      .toBe('2026-08-02')
  })

  it('is null when the row carries no date', () => {
    expect(occurrenceDate(row({}))).toBeNull()
    expect(occurrenceDate(row({ kind: 'course', course_days: [] }))).toBeNull()
  })
})

describe('sortOccurrences', () => {
  // Ordering on start_date alone would scatter a course series, since a course
  // keeps its dates in course_days.
  it('orders dives and courses alike by the date they happen on', () => {
    const sorted = sortOccurrences([
      row({ id: 'c', kind: 'course', course_days: ['2026-08-15'] }),
      row({ id: 'a', start_date: '2026-08-01' }),
      row({ id: 'b', kind: 'course', course_days: ['2026-08-08'] }),
    ])
    expect(sorted.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const rows = [row({ id: 'b', start_date: '2026-08-08' }), row({ id: 'a', start_date: '2026-08-01' })]
    sortOccurrences(rows)
    expect(rows.map(r => r.id)).toEqual(['b', 'a'])
  })
})

describe('laterOccurrences', () => {
  const series = [
    row({ id: 'a', start_date: '2026-08-01' }),
    row({ id: 'b', start_date: '2026-08-08' }),
    row({ id: 'c', start_date: '2026-08-15', cancelled_at: '2026-07-01T00:00:00Z' }),
    row({ id: 'd', start_date: '2026-08-22' }),
  ]

  it('takes only what comes strictly after the given date', () => {
    expect(laterOccurrences(series, '2026-08-08').map(r => r.id)).toEqual(['d'])
  })

  it('excludes the given date itself, so an action never hits its own event', () => {
    expect(laterOccurrences(series, '2026-08-01').map(r => r.id)).not.toContain('a')
  })

  // Re-cancelling an already-cancelled occurrence would fire a second round of
  // notifications and credits at divers who already got them.
  it('skips occurrences that are already cancelled', () => {
    expect(laterOccurrences(series, '2026-07-01').map(r => r.id)).toEqual(['a', 'b', 'd'])
  })

  it('is empty for the last occurrence', () => {
    expect(laterOccurrences(series, '2026-08-22')).toEqual([])
  })
})

describe('sharedPatchFromForm', () => {
  // Copying dates onto later occurrences would collapse the whole series onto
  // one day. This is the guard against that.
  it('carries settings but never any date field', () => {
    const patch = sharedPatchFromForm(dive({
      capacity: '10', start_date: '2026-08-01', end_date: '2026-08-02',
      cancel_date: '2026-07-30', full_payment_deadline: '2026-07-25',
    }))
    expect(patch.capacity).toBe(10)
    expect(patch).not.toHaveProperty('start_date')
    expect(patch).not.toHaveProperty('end_date')
    expect(patch).not.toHaveProperty('cancel_date')
    expect(patch).not.toHaveProperty('full_payment_deadline')
    expect(patch).not.toHaveProperty('course_days')
  })

  it('carries a course\'s own settings without its day list', () => {
    const patch = sharedPatchFromForm(course({ course_name: 'Open Water', included: 'gear' }))
    expect(patch.course_name).toBe('Open Water')
    expect(patch.included).toBe('gear')
    expect(patch).not.toHaveProperty('course_days')
  })
})
