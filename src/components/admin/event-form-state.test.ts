import { describe, it, expect } from 'vitest'
import {
  parseAddonIds,
  parseCsvIds,
  formStateFromDive,
  formStateFromCourse,
  divePayloadFromForm,
  coursePayloadFromForm,
  EMPTY_FORM,
} from './event-form-state'
import type { EOCourse, EODive } from '../../types/database'

// Minimal valid EO_* rows. Override the columns each test cares about so the
// assertions stay focused on the field under test.
function dive(overrides: Partial<EODive> = {}): EODive {
  return {
    _id: 'd1',
    admin_title: 'Admin label',
    display_title: 'Display label',
    calendar_title: 'Cal',
    start_date: '2026-07-01',
    time: null,
    end_date: '2026-07-02',
    featured: false,
    fully_booked: false,
    price: null,
    has_rooms: false,
    room_types: null,
    hasotheraddons: false,
    other_addons: null,
    gear_rental: null,
    nitrox_required: false,
    dive_days: null,
    featured_image: null,
    second_image: null,
    prereqs: null,
    req_dives: null,
    notes: null,
    cancel_date: null,
    cancel_policy: null,
    destination_reference: null,
    DiveTravel_reference: null,
    prereq_cert_id: null,
    cancelled_at: null,
    full_payment_deadline: null,
    capacity: null,
    is_private: false,
    ...overrides,
  }
}

function course(overrides: Partial<EOCourse> = {}): EOCourse {
  return {
    _id: 'c1',
    admin_title: 'Course admin',
    display_title: 'Course display',
    calendar_title: 'CCal',
    start_time: null,
    price: null,
    other_addons: null,
    dive_days: null,
    course_days: null,
    course_name: null,
    featured_image: null,
    prereqs: null,
    req_dives: null,
    included: null,
    schedule: null,
    starting_at: null,
    prereq_cert_id: null,
    cancelled_at: null,
    full_payment_deadline: null,
    cancel_date: null,
    cancel_policy: null,
    fully_booked: false,
    capacity: null,
    ...overrides,
  }
}

describe('parseAddonIds', () => {
  it('parses a JSON-array string', () => {
    expect(parseAddonIds('["a","b","c"]')).toEqual(['a', 'b', 'c'])
  })

  it('coerces non-string JSON array members to strings', () => {
    expect(parseAddonIds('[1, 2, 3]')).toEqual(['1', '2', '3'])
  })

  it('trims whitespace inside JSON array members and drops blanks', () => {
    expect(parseAddonIds('[" a ", "", "  ", "b"]')).toEqual(['a', 'b'])
  })

  it('falls back to CSV parsing for a plain comma list', () => {
    expect(parseAddonIds('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('falls back to CSV when the JSON is malformed', () => {
    expect(parseAddonIds('[a,b,c')).toEqual(['[a', 'b', 'c'])
  })

  it('treats a non-array JSON value by falling back to CSV', () => {
    // '{...}' does not start with '[', so it skips JSON entirely and CSV-splits.
    expect(parseAddonIds('{"x":1}')).toEqual(['{"x":1}'])
  })

  it('returns [] for null, undefined, empty, and whitespace-only', () => {
    expect(parseAddonIds(null)).toEqual([])
    expect(parseAddonIds(undefined)).toEqual([])
    expect(parseAddonIds('')).toEqual([])
    expect(parseAddonIds('   ')).toEqual([])
  })

  it('handles a single CSV id with surrounding whitespace', () => {
    expect(parseAddonIds('  solo  ')).toEqual(['solo'])
  })

  it('drops empty CSV segments and trims each', () => {
    expect(parseAddonIds('a, ,b,,c,')).toEqual(['a', 'b', 'c'])
  })
})

describe('parseCsvIds', () => {
  it('splits a comma list', () => {
    expect(parseCsvIds('r1,r2,r3')).toEqual(['r1', 'r2', 'r3'])
  })

  it('returns [] for null, undefined, and empty', () => {
    expect(parseCsvIds(null)).toEqual([])
    expect(parseCsvIds(undefined)).toEqual([])
    expect(parseCsvIds('')).toEqual([])
  })

  it('drops trailing commas and empty segments, trimming whitespace', () => {
    expect(parseCsvIds(' a , , b ,, c , ')).toEqual(['a', 'b', 'c'])
  })

  it('does not JSON-parse — a bracketed string is treated literally', () => {
    expect(parseCsvIds('["a","b"]')).toEqual(['["a"', '"b"]'])
  })
})

describe('formStateFromDive', () => {
  it('maps every field from a fully-populated row', () => {
    const fs = formStateFromDive(dive({
      admin_title: 'Internal',
      display_title: 'Public title',
      calendar_title: 'Cal',
      start_date: '2026-07-01',
      time: '09:30:00',
      end_date: '2026-07-03',
      capacity: 12,
      price: 'price_1',
      prereq_cert_id: 'cert_1',
      req_dives: 20,
      dive_days: 3,
      other_addons: '["ad1","ad2"]',
      notes: 'Bring fins',
      featured: true,
      fully_booked: true,
      is_private: true,
      has_rooms: true,
      room_types: 'rm1,rm2',
      nitrox_required: true,
      gear_rental: 'full',
      cancel_date: '2026-06-20',
      cancel_policy: 'No refunds',
      destination_reference: '["dest1"]',
      DiveTravel_reference: 'dt_ref',
      full_payment_deadline: '2026-06-25',
      featured_image: 'wix:image://hero',
      second_image: 'wix:image://second',
    }))
    expect(fs).toEqual({
      type: 'dive',
      admin_title: 'Internal',
      display_title: 'Public title',
      calendar_title: 'Cal',
      start_date: '2026-07-01',
      start_time: '09:30',
      end_date: '2026-07-03',
      capacity: '12',
      price: 'price_1',
      prereq_cert_id: 'cert_1',
      req_dives: '20',
      dive_days: '3',
      addonIds: ['ad1', 'ad2'],
      notes: 'Bring fins',
      featured: true,
      fully_booked: true,
      is_private: true,
      has_rooms: true,
      roomIds: ['rm1', 'rm2'],
      nitrox_required: true,
      gear_rental: 'full',
      cancel_date: '2026-06-20',
      cancel_policy: 'No refunds',
      destinationIds: ['dest1'],
      divetravel_reference: 'dt_ref',
      full_payment_deadline: '2026-06-25',
      featured_image: 'wix:image://hero',
      second_image: 'wix:image://second',
      courseDays: [],
      course_name: '',
      included: '',
      schedule: '',
    })
  })

  it('represents a null capacity as empty string and a numeric one as a string', () => {
    expect(formStateFromDive(dive({ capacity: null })).capacity).toBe('')
    expect(formStateFromDive(dive({ capacity: 0 })).capacity).toBe('0')
    expect(formStateFromDive(dive({ capacity: 8 })).capacity).toBe('8')
  })

  it('coerces null text/number columns to empty strings', () => {
    const fs = formStateFromDive(dive({
      admin_title: null,
      calendar_title: null,
      start_date: null,
      end_date: null,
      price: null,
      prereq_cert_id: null,
      req_dives: null,
      dive_days: null,
      gear_rental: null,
      cancel_date: null,
      cancel_policy: null,
      DiveTravel_reference: null,
      full_payment_deadline: null,
      featured_image: null,
      second_image: null,
    }))
    expect(fs.admin_title).toBe('')
    expect(fs.calendar_title).toBe('')
    expect(fs.start_date).toBe('')
    expect(fs.end_date).toBe('')
    expect(fs.price).toBe('')
    expect(fs.prereq_cert_id).toBe('')
    expect(fs.req_dives).toBe('')
    expect(fs.dive_days).toBe('')
    expect(fs.gear_rental).toBe('')
    expect(fs.cancel_date).toBe('')
    expect(fs.cancel_policy).toBe('')
    expect(fs.divetravel_reference).toBe('')
    expect(fs.full_payment_deadline).toBe('')
    expect(fs.featured_image).toBe('')
    expect(fs.second_image).toBe('')
  })

  it('strips the capacity suffix the DB trigger appends to display_title', () => {
    expect(formStateFromDive(dive({ display_title: 'Green Island (3 spots open)' })).display_title)
      .toBe('Green Island')
    expect(formStateFromDive(dive({
      display_title: 'Green Island (fully booked - register for waitlist)',
    })).display_title).toBe('Green Island')
  })

  it('normalises the time column to HH:mm and blanks an unparseable one', () => {
    expect(formStateFromDive(dive({ time: '9:05:00' })).start_time).toBe('09:05')
    expect(formStateFromDive(dive({ time: '14:00' })).start_time).toBe('14:00')
    expect(formStateFromDive(dive({ time: null })).start_time).toBe('')
    expect(formStateFromDive(dive({ time: 'nonsense' })).start_time).toBe('')
  })

  it('parses addon ids from CSV as well as JSON', () => {
    expect(formStateFromDive(dive({ other_addons: 'a1,a2' })).addonIds).toEqual(['a1', 'a2'])
    expect(formStateFromDive(dive({ other_addons: null })).addonIds).toEqual([])
  })

  it('parses room ids as CSV only (never JSON)', () => {
    expect(formStateFromDive(dive({ room_types: 'rm1, rm2 ,' })).roomIds).toEqual(['rm1', 'rm2'])
    expect(formStateFromDive(dive({ room_types: null })).roomIds).toEqual([])
  })

  it('coerces nullish booleans to false', () => {
    const fs = formStateFromDive(dive({ nitrox_required: null, featured: null, has_rooms: null }))
    expect(fs.nitrox_required).toBe(false)
    expect(fs.featured).toBe(false)
    expect(fs.has_rooms).toBe(false)
  })
})

describe('formStateFromCourse', () => {
  it('maps every field from a fully-populated row', () => {
    const fs = formStateFromCourse(course({
      admin_title: 'Open Water',
      display_title: 'Open Water Diver',
      calendar_title: 'OW',
      course_name: 'PADI Open Water',
      start_time: '08:00:00',
      capacity: 6,
      course_days: ['2026-07-03', '2026-07-01', '2026-07-02'],
      price: 'price_c',
      prereq_cert_id: 'cert_c',
      req_dives: 'none',
      dive_days: 4,
      included: 'Manual',
      schedule: 'Morning',
      other_addons: '["ca1"]',
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: 'wix:image://c',
    }))
    expect(fs).toEqual({
      type: 'course',
      admin_title: 'Open Water',
      display_title: 'Open Water Diver',
      calendar_title: 'OW',
      course_name: 'PADI Open Water',
      start_date: '2026-07-01',
      start_time: '08:00',
      end_date: '2026-07-03',
      capacity: '6',
      courseDays: ['2026-07-01', '2026-07-02', '2026-07-03'],
      price: 'price_c',
      prereq_cert_id: 'cert_c',
      req_dives: 'none',
      dive_days: '4',
      included: 'Manual',
      schedule: 'Morning',
      addonIds: ['ca1'],
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: 'wix:image://c',
      second_image: '',
      notes: '',
      featured: false,
      fully_booked: false,
      is_private: false,
      has_rooms: false,
      roomIds: [],
      nitrox_required: false,
      gear_rental: '',
      destinationIds: [],
      divetravel_reference: '',
    })
  })

  it('dedupes, sorts, and filters falsy course_days', () => {
    const fs = formStateFromCourse(course({
      course_days: ['2026-07-05', '2026-07-01', '2026-07-05', '', '2026-07-03'],
    }))
    expect(fs.courseDays).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
  })

  it('derives start_date/end_date from the sorted course days', () => {
    const fs = formStateFromCourse(course({ course_days: ['2026-08-10', '2026-08-01'] }))
    expect(fs.start_date).toBe('2026-08-01')
    expect(fs.end_date).toBe('2026-08-10')
  })

  it('leaves start/end dates empty when there are no course days', () => {
    const fs = formStateFromCourse(course({ course_days: null }))
    expect(fs.courseDays).toEqual([])
    expect(fs.start_date).toBe('')
    expect(fs.end_date).toBe('')
  })

  it('keeps course req_dives as its text value', () => {
    expect(formStateFromCourse(course({ req_dives: '10' })).req_dives).toBe('10')
    expect(formStateFromCourse(course({ req_dives: null })).req_dives).toBe('')
  })

  it('represents capacity null as empty and a number as a string (including 0)', () => {
    expect(formStateFromCourse(course({ capacity: null })).capacity).toBe('')
    expect(formStateFromCourse(course({ capacity: 0 })).capacity).toBe('0')
    expect(formStateFromCourse(course({ capacity: 5 })).capacity).toBe('5')
  })

  it('strips the capacity suffix from display_title', () => {
    expect(formStateFromCourse(course({ display_title: 'OW Course (2 spots open)' })).display_title)
      .toBe('OW Course')
  })
})

describe('divePayloadFromForm', () => {
  it('serialises a fully-populated form to the EO_dives row shape', () => {
    const payload = divePayloadFromForm({
      ...EMPTY_FORM,
      type: 'dive',
      admin_title: '  Internal  ',
      display_title: 'Public',
      calendar_title: 'Cal',
      start_date: '2026-07-01',
      start_time: '09:30',
      end_date: '2026-07-03',
      capacity: '12',
      price: 'price_1',
      notes: 'Notes',
      featured: true,
      fully_booked: true,
      is_private: true,
      prereq_cert_id: 'cert_1',
      req_dives: '20',
      dive_days: '3',
      gear_rental: 'full',
      nitrox_required: true,
      has_rooms: true,
      roomIds: ['rm1', 'rm2'],
      addonIds: ['ad1', 'ad2'],
      cancel_date: '2026-06-20',
      cancel_policy: 'Policy',
      destinationIds: ['dest1'],
      divetravel_reference: 'dt',
      full_payment_deadline: '2026-06-25',
      featured_image: '  wix:hero  ',
      second_image: '  wix:second  ',
    })
    expect(payload).toEqual({
      admin_title: 'Internal',
      display_title: 'Public',
      calendar_title: 'Cal',
      start_date: '2026-07-01',
      time: '09:30:00',
      end_date: '2026-07-03',
      capacity: 12,
      price: 'price_1',
      notes: 'Notes',
      featured: true,
      fully_booked: true,
      is_private: true,
      prereq_cert_id: 'cert_1',
      req_dives: 20,
      dive_days: 3,
      gear_rental: 'full',
      nitrox_required: true,
      has_rooms: true,
      room_types: 'rm1,rm2',
      hasotheraddons: true,
      other_addons: '["ad1","ad2"]',
      cancel_date: '2026-06-20',
      cancel_policy: 'Policy',
      destination_reference: '["dest1"]',
      DiveTravel_reference: 'dt',
      full_payment_deadline: '2026-06-25',
      featured_image: 'wix:hero',
      second_image: 'wix:second',
    })
  })

  it('appends a :00 seconds suffix to the time, and nulls an empty time', () => {
    expect(divePayloadFromForm({ ...EMPTY_FORM, start_time: '07:15' }).time).toBe('07:15:00')
    expect(divePayloadFromForm({ ...EMPTY_FORM, start_time: '' }).time).toBeNull()
  })

  it('maps blank text fields to null but keeps notes as an empty string', () => {
    const payload = divePayloadFromForm({ ...EMPTY_FORM, notes: '' })
    expect(payload.display_title).toBeNull()
    expect(payload.calendar_title).toBeNull()
    expect(payload.start_date).toBeNull()
    expect(payload.end_date).toBeNull()
    expect(payload.price).toBeNull()
    expect(payload.prereq_cert_id).toBeNull()
    expect(payload.gear_rental).toBeNull()
    expect(payload.cancel_date).toBeNull()
    expect(payload.cancel_policy).toBeNull()
    expect(payload.DiveTravel_reference).toBeNull()
    expect(payload.full_payment_deadline).toBeNull()
    expect(payload.featured_image).toBeNull()
    expect(payload.second_image).toBeNull()
    // notes is NOT NULL in the DB, so it stays an empty string rather than null.
    expect(payload.notes).toBe('')
  })

  it('treats capacity "0" as the number 0 and "" as null', () => {
    // The string '0' is truthy, so capacity "0" becomes the number 0, NOT null.
    expect(divePayloadFromForm({ ...EMPTY_FORM, capacity: '0' }).capacity).toBe(0)
    expect(divePayloadFromForm({ ...EMPTY_FORM, capacity: '' }).capacity).toBeNull()
    expect(divePayloadFromForm({ ...EMPTY_FORM, capacity: '5' }).capacity).toBe(5)
  })

  it('converts req_dives and dive_days to numbers, nulling only blanks', () => {
    expect(divePayloadFromForm({ ...EMPTY_FORM, req_dives: '12', dive_days: '4' }))
      .toMatchObject({ req_dives: 12, dive_days: 4 })
    expect(divePayloadFromForm({ ...EMPTY_FORM, req_dives: '', dive_days: '' }))
      .toMatchObject({ req_dives: null, dive_days: null })
    // '0' is truthy, so it converts to the number 0 rather than null.
    expect(divePayloadFromForm({ ...EMPTY_FORM, req_dives: '0', dive_days: '0' }))
      .toMatchObject({ req_dives: 0, dive_days: 0 })
  })

  it('serialises addon ids as a JSON string, empty form gives "" and hasotheraddons false', () => {
    expect(divePayloadFromForm({ ...EMPTY_FORM, addonIds: ['x', 'y'] }))
      .toMatchObject({ other_addons: '["x","y"]', hasotheraddons: true })
    expect(divePayloadFromForm({ ...EMPTY_FORM, addonIds: [] }))
      .toMatchObject({ other_addons: '', hasotheraddons: false })
  })

  it('joins room ids with commas, empty gives an empty string', () => {
    expect(divePayloadFromForm({ ...EMPTY_FORM, roomIds: ['a', 'b'] }).room_types).toBe('a,b')
    expect(divePayloadFromForm({ ...EMPTY_FORM, roomIds: [] }).room_types).toBe('')
  })

  it('serialises destination ids as JSON, empty gives null', () => {
    expect(divePayloadFromForm({ ...EMPTY_FORM, destinationIds: ['d1', 'd2'] }).destination_reference)
      .toBe('["d1","d2"]')
    expect(divePayloadFromForm({ ...EMPTY_FORM, destinationIds: [] }).destination_reference).toBeNull()
  })

  it('trims admin_title and the image fields', () => {
    const payload = divePayloadFromForm({
      ...EMPTY_FORM,
      admin_title: '  Title  ',
      featured_image: '   ',
      second_image: '  url  ',
    })
    expect(payload.admin_title).toBe('Title')
    // A whitespace-only image trims to '' which is falsy → null.
    expect(payload.featured_image).toBeNull()
    expect(payload.second_image).toBe('url')
  })
})

describe('coursePayloadFromForm', () => {
  it('serialises a fully-populated form to the EO_courses row shape', () => {
    const payload = coursePayloadFromForm({
      ...EMPTY_FORM,
      type: 'course',
      admin_title: 'Course admin',
      display_title: '  Course display  ',
      calendar_title: 'CC',
      course_name: 'PADI OW',
      start_time: '08:00',
      capacity: '6',
      courseDays: ['2026-07-03', '2026-07-01', '2026-07-02'],
      price: 'price_c',
      prereq_cert_id: 'cert_c',
      req_dives: 'none',
      dive_days: '4',
      included: 'Manual',
      schedule: 'Morning',
      addonIds: ['ca1'],
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: '  wix:c  ',
    })
    expect(payload).toEqual({
      admin_title: 'Course admin',
      display_title: 'Course display',
      calendar_title: 'CC',
      course_name: 'PADI OW',
      start_time: '08:00:00',
      capacity: 6,
      course_days: ['2026-07-01', '2026-07-02', '2026-07-03'],
      price: 'price_c',
      prereq_cert_id: 'cert_c',
      req_dives: 'none',
      dive_days: 4,
      included: 'Manual',
      schedule: 'Morning',
      other_addons: '["ca1"]',
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: 'wix:c',
    })
  })

  it('dedupes and sorts course_days, nulling an empty list', () => {
    expect(coursePayloadFromForm({
      ...EMPTY_FORM,
      courseDays: ['2026-07-05', '2026-07-01', '2026-07-05', '', '2026-07-03'],
    }).course_days).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
    expect(coursePayloadFromForm({ ...EMPTY_FORM, courseDays: [] }).course_days).toBeNull()
    expect(coursePayloadFromForm({ ...EMPTY_FORM, courseDays: [''] }).course_days).toBeNull()
  })

  it('keeps course req_dives as text (no Number coercion) and nulls blank', () => {
    expect(coursePayloadFromForm({ ...EMPTY_FORM, req_dives: '10' }).req_dives).toBe('10')
    expect(coursePayloadFromForm({ ...EMPTY_FORM, req_dives: '' }).req_dives).toBeNull()
  })

  it('converts dive_days to a number, nulling only blank ("0" stays 0)', () => {
    expect(coursePayloadFromForm({ ...EMPTY_FORM, dive_days: '3' }).dive_days).toBe(3)
    expect(coursePayloadFromForm({ ...EMPTY_FORM, dive_days: '' }).dive_days).toBeNull()
    expect(coursePayloadFromForm({ ...EMPTY_FORM, dive_days: '0' }).dive_days).toBe(0)
  })

  it('treats capacity "0" as the number 0, "" as null, positive as a number', () => {
    expect(coursePayloadFromForm({ ...EMPTY_FORM, capacity: '0' }).capacity).toBe(0)
    expect(coursePayloadFromForm({ ...EMPTY_FORM, capacity: '' }).capacity).toBeNull()
    expect(coursePayloadFromForm({ ...EMPTY_FORM, capacity: '4' }).capacity).toBe(4)
  })

  it('appends :00 to start_time and nulls an empty time', () => {
    expect(coursePayloadFromForm({ ...EMPTY_FORM, start_time: '08:00' }).start_time).toBe('08:00:00')
    expect(coursePayloadFromForm({ ...EMPTY_FORM, start_time: '' }).start_time).toBeNull()
  })

  it('serialises addon ids as JSON, empty gives an empty string', () => {
    expect(coursePayloadFromForm({ ...EMPTY_FORM, addonIds: ['z'] }).other_addons).toBe('["z"]')
    expect(coursePayloadFromForm({ ...EMPTY_FORM, addonIds: [] }).other_addons).toBe('')
  })

  it('maps blank text fields to null', () => {
    const payload = coursePayloadFromForm({ ...EMPTY_FORM, type: 'course' })
    expect(payload.admin_title).toBeNull()
    expect(payload.display_title).toBeNull()
    expect(payload.calendar_title).toBeNull()
    expect(payload.course_name).toBeNull()
    expect(payload.price).toBeNull()
    expect(payload.prereq_cert_id).toBeNull()
    expect(payload.included).toBeNull()
    expect(payload.schedule).toBeNull()
    expect(payload.full_payment_deadline).toBeNull()
    expect(payload.cancel_date).toBeNull()
    expect(payload.cancel_policy).toBeNull()
    expect(payload.featured_image).toBeNull()
  })

  it('does not trim admin_title (unlike the dive payload)', () => {
    // coursePayloadFromForm uses `form.admin_title || null` with no .trim(),
    // so leading/trailing whitespace survives to the DB.
    expect(coursePayloadFromForm({ ...EMPTY_FORM, admin_title: '  Spaced  ' }).admin_title)
      .toBe('  Spaced  ')
    // display_title IS trimmed on courses.
    expect(coursePayloadFromForm({ ...EMPTY_FORM, display_title: '  D  ' }).display_title).toBe('D')
  })
})
