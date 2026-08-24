import { describe, it, expect } from 'vitest'
import {
  formStateFromEvent,
  eventPayloadFromForm,
  EMPTY_FORM,
  type EventRelations,
} from './event-form-state'
import type { EventRow } from '../../types/database'

// Minimal valid `events` rows. Dives and courses are one table now, told
// apart by `kind`. Override the columns each test cares about so the
// assertions stay focused on the field under test. Rooms/add-ons/destinations
// are NOT on the row — they come from the junction tables via the `rels`
// argument (see src/lib/event-relations.ts).
function baseRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    kind: 'dive',
    admin_title: null,
    display_title: null,
    calendar_title: null,
    price: null,
    dive_days: null,
    prereq_cert_id: null,
    cancel_date: null,
    cancel_policy: null,
    fully_booked: false,
    capacity: null,
    full_payment_deadline: null,
    cancelled_at: null,
    featured_image: null,
    prereqs: null,
    featured: false,
    req_dives: null,
    start_date: null,
    end_date: null,
    start_time: null,
    course_days: null,
    is_private: false,
    is_boat_dive: false,
    is_trip: false,
    nitrox_required: false,
    gear_rental: null,
    notes: null,
    trip_template_id: null,
    course_name: null,
    included: null,
    schedule: null,
    starting_at: null,
    ...overrides,
  }
}

function dive(overrides: Partial<EventRow> = {}): EventRow {
  return baseRow({
    id: 'd1',
    kind: 'dive',
    admin_title: 'Admin label',
    display_title: 'Display label',
    calendar_title: 'Cal',
    start_date: '2026-07-01',
    end_date: '2026-07-02',
    ...overrides,
  })
}

function course(overrides: Partial<EventRow> = {}): EventRow {
  return baseRow({
    id: 'c1',
    kind: 'course',
    admin_title: 'Course admin',
    display_title: 'Course display',
    calendar_title: 'CCal',
    ...overrides,
  })
}

const rels = (o: Partial<EventRelations> = {}): EventRelations => ({
  roomIds: [], addonIds: [], destinationIds: [], ...o,
})

describe('formStateFromEvent — dive', () => {
  it('maps every field from a fully-populated row + its relations', () => {
    const fs = formStateFromEvent(dive({
      admin_title: 'Internal',
      display_title: 'Public title',
      calendar_title: 'Cal',
      start_date: '2026-07-01',
      start_time: '09:30:00',
      end_date: '2026-07-03',
      capacity: 12,
      price: 'price_1',
      prereq_cert_id: 'cert_1',
      site_id: 'site_1',
      req_dives: 20,
      dive_days: 3,
      notes: 'Bring fins',
      featured: true,
      fully_booked: true,
      is_private: true,
      is_boat_dive: true,
      is_trip: true,
      nitrox_required: true,
      gear_rental: 'full',
      cancel_date: '2026-06-20',
      cancel_policy: 'No refunds',
      trip_template_id: 'dt_ref',
      full_payment_deadline: '2026-06-25',
      featured_image: 'https://cdn.example/hero.jpg',
    }), rels({ roomIds: ['rm1', 'rm2'], addonIds: ['ad1', 'ad2'], destinationIds: ['dest1'] }))
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
      site_id: 'site_1',
      req_dives: '20',
      dive_days: '3',
      addonIds: ['ad1', 'ad2'],
      notes: 'Bring fins',
      featured: true,
      fully_booked: true,
      is_private: true,
      is_boat_dive: true,
      is_trip: true,
      roomIds: ['rm1', 'rm2'],
      nitrox_required: true,
      gear_rental: 'full',
      cancel_date: '2026-06-20',
      cancel_policy: 'No refunds',
      destinationIds: ['dest1'],
      trip_template_reference: 'dt_ref',
      full_payment_deadline: '2026-06-25',
      featured_image: 'https://cdn.example/hero.jpg',
      courseDays: [],
      course_name: '',
      included: '',
      schedule: '',
    })
  })

  it('defaults relation ids to empty arrays when no rels are passed', () => {
    const fs = formStateFromEvent(dive())
    expect(fs.roomIds).toEqual([])
    expect(fs.addonIds).toEqual([])
    expect(fs.destinationIds).toEqual([])
  })

  it('sources relation ids from the rels argument, not the row', () => {
    const fs = formStateFromEvent(dive(), rels({ roomIds: ['r'], addonIds: ['a'], destinationIds: ['d'] }))
    expect(fs.roomIds).toEqual(['r'])
    expect(fs.addonIds).toEqual(['a'])
    expect(fs.destinationIds).toEqual(['d'])
  })

  it('represents a null capacity as empty string and a numeric one as a string', () => {
    expect(formStateFromEvent(dive({ capacity: null })).capacity).toBe('')
    expect(formStateFromEvent(dive({ capacity: 0 })).capacity).toBe('0')
    expect(formStateFromEvent(dive({ capacity: 8 })).capacity).toBe('8')
  })

  it('coerces null text/number columns to empty strings', () => {
    const fs = formStateFromEvent(dive({
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
      trip_template_id: null,
      full_payment_deadline: null,
      featured_image: null,
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
    expect(fs.trip_template_reference).toBe('')
    expect(fs.full_payment_deadline).toBe('')
    expect(fs.featured_image).toBe('')
  })

  it('strips the capacity suffix the DB trigger appends to display_title', () => {
    expect(formStateFromEvent(dive({ display_title: 'Green Island (3 spots open)' })).display_title)
      .toBe('Green Island')
    expect(formStateFromEvent(dive({
      display_title: 'Green Island (fully booked - register for waitlist)',
    })).display_title).toBe('Green Island')
  })

  it('normalizes the start_time column to HH:mm and blanks an unparseable one', () => {
    expect(formStateFromEvent(dive({ start_time: '9:05:00' })).start_time).toBe('09:05')
    expect(formStateFromEvent(dive({ start_time: '14:00' })).start_time).toBe('14:00')
    expect(formStateFromEvent(dive({ start_time: null })).start_time).toBe('')
    expect(formStateFromEvent(dive({ start_time: 'nonsense' })).start_time).toBe('')
  })

  it('coerces nullish booleans to false', () => {
    const fs = formStateFromEvent(dive({ nitrox_required: null, featured: null } as unknown as Partial<EventRow>))
    expect(fs.nitrox_required).toBe(false)
    expect(fs.featured).toBe(false)
  })
})

describe('formStateFromEvent — course', () => {
  it('maps every field from a fully-populated row + its relations', () => {
    const fs = formStateFromEvent(course({
      admin_title: 'Open Water',
      display_title: 'Open Water Diver',
      calendar_title: 'OW',
      course_name: 'PADI Open Water',
      start_time: '08:00:00',
      capacity: 6,
      course_days: ['2026-07-03', '2026-07-01', '2026-07-02'],
      price: 'price_c',
      prereq_cert_id: 'cert_c',
      req_dives: 4,
      dive_days: 4,
      included: 'Manual',
      schedule: 'Morning',
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: 'https://cdn.example/course.jpg',
    }), rels({ addonIds: ['ca1'] }))
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
      site_id: '',
      req_dives: '4',
      dive_days: '4',
      included: 'Manual',
      schedule: 'Morning',
      addonIds: ['ca1'],
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: 'https://cdn.example/course.jpg',
      notes: '',
      featured: false,
      fully_booked: false,
      is_private: false,
      is_boat_dive: false,
      is_trip: false,
      roomIds: [],
      nitrox_required: false,
      gear_rental: '',
      destinationIds: [],
      trip_template_reference: '',
    })
  })

  it('dedupes, sorts, and filters falsy course_days', () => {
    const fs = formStateFromEvent(course({
      course_days: ['2026-07-05', '2026-07-01', '2026-07-05', '', '2026-07-03'],
    }))
    expect(fs.courseDays).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
  })

  it('derives start_date/end_date from the sorted course days', () => {
    const fs = formStateFromEvent(course({ course_days: ['2026-08-10', '2026-08-01'] }))
    expect(fs.start_date).toBe('2026-08-01')
    expect(fs.end_date).toBe('2026-08-10')
  })

  it('leaves start/end dates empty when there are no course days', () => {
    const fs = formStateFromEvent(course({ course_days: null }))
    expect(fs.courseDays).toEqual([])
    expect(fs.start_date).toBe('')
    expect(fs.end_date).toBe('')
  })

  it('represents a numeric req_dives as its string value, nulling blank', () => {
    expect(formStateFromEvent(course({ req_dives: 10 })).req_dives).toBe('10')
    expect(formStateFromEvent(course({ req_dives: null })).req_dives).toBe('')
  })

  it('represents capacity null as empty and a number as a string (including 0)', () => {
    expect(formStateFromEvent(course({ capacity: null })).capacity).toBe('')
    expect(formStateFromEvent(course({ capacity: 0 })).capacity).toBe('0')
    expect(formStateFromEvent(course({ capacity: 5 })).capacity).toBe('5')
  })

  it('strips the capacity suffix from display_title', () => {
    expect(formStateFromEvent(course({ display_title: 'OW Course (2 spots open)' })).display_title)
      .toBe('OW Course')
  })
})

describe('eventPayloadFromForm — dive', () => {
  it('serializes a fully-populated dive form to the events row shape (no relation columns)', () => {
    const payload = eventPayloadFromForm({
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
      site_id: 'site_1',
      req_dives: '20',
      dive_days: '3',
      gear_rental: 'full',
      nitrox_required: true,
      is_boat_dive: true,
      is_trip: true,
      roomIds: ['rm1', 'rm2'],
      addonIds: ['ad1', 'ad2'],
      cancel_date: '2026-06-20',
      cancel_policy: 'Policy',
      destinationIds: ['dest1'],
      trip_template_reference: 'dt',
      full_payment_deadline: '2026-06-25',
      featured_image: '  https://cdn.example/hero.jpg  ',
    })
    expect(payload).toEqual({
      kind: 'dive',
      admin_title: 'Internal',
      display_title: 'Public',
      calendar_title: 'Cal',
      price: 'price_1',
      capacity: 12,
      prereq_cert_id: 'cert_1',
      site_id: 'site_1',
      req_dives: 20,
      dive_days: 3,
      cancel_date: '2026-06-20',
      cancel_policy: 'Policy',
      fully_booked: true,
      full_payment_deadline: '2026-06-25',
      featured_image: 'https://cdn.example/hero.jpg',
      start_time: '09:30:00',
      start_date: '2026-07-01',
      end_date: '2026-07-03',
      course_days: null,
      featured: true,
      is_private: true,
      is_boat_dive: true,
      is_trip: true,
      notes: 'Notes',
      nitrox_required: true,
      gear_rental: 'full',
      trip_template_id: 'dt',
      course_name: null,
      included: null,
      schedule: null,
    })
  })

  it('never emits the room/add-on/destination columns (they live in junctions now)', () => {
    const payload = eventPayloadFromForm({
      ...EMPTY_FORM,
      roomIds: ['rm1'],
      addonIds: ['ad1'],
      destinationIds: ['dest1'],
    })
    expect(payload).not.toHaveProperty('room_types')
    expect(payload).not.toHaveProperty('other_addons')
    expect(payload).not.toHaveProperty('has_rooms')
    expect(payload).not.toHaveProperty('hasotheraddons')
    expect(payload).not.toHaveProperty('destination_reference')
  })

  it('appends a :00 seconds suffix to start_time, and nulls an empty time', () => {
    expect(eventPayloadFromForm({ ...EMPTY_FORM, start_time: '07:15' }).start_time).toBe('07:15:00')
    expect(eventPayloadFromForm({ ...EMPTY_FORM, start_time: '' }).start_time).toBeNull()
  })

  it('maps blank text fields to null but keeps notes as an empty string', () => {
    const payload = eventPayloadFromForm({ ...EMPTY_FORM, notes: '' })
    expect(payload.display_title).toBeNull()
    expect(payload.calendar_title).toBeNull()
    expect(payload.start_date).toBeNull()
    expect(payload.end_date).toBeNull()
    expect(payload.price).toBeNull()
    expect(payload.prereq_cert_id).toBeNull()
    expect(payload.gear_rental).toBeNull()
    expect(payload.cancel_date).toBeNull()
    expect(payload.cancel_policy).toBeNull()
    expect(payload.trip_template_id).toBeNull()
    expect(payload.full_payment_deadline).toBeNull()
    expect(payload.featured_image).toBeNull()
    // notes is NOT NULL for a dive, so it stays an empty string rather than null.
    expect(payload.notes).toBe('')
  })

  it('treats capacity "0" as the number 0 and "" as null', () => {
    // The string '0' is truthy, so capacity "0" becomes the number 0, NOT null.
    expect(eventPayloadFromForm({ ...EMPTY_FORM, capacity: '0' }).capacity).toBe(0)
    expect(eventPayloadFromForm({ ...EMPTY_FORM, capacity: '' }).capacity).toBeNull()
    expect(eventPayloadFromForm({ ...EMPTY_FORM, capacity: '5' }).capacity).toBe(5)
  })

  it('converts req_dives and dive_days to numbers, nulling only blanks', () => {
    expect(eventPayloadFromForm({ ...EMPTY_FORM, req_dives: '12', dive_days: '4' }))
      .toMatchObject({ req_dives: 12, dive_days: 4 })
    expect(eventPayloadFromForm({ ...EMPTY_FORM, req_dives: '', dive_days: '' }))
      .toMatchObject({ req_dives: null, dive_days: null })
    // '0' is truthy, so it converts to the number 0 rather than null.
    expect(eventPayloadFromForm({ ...EMPTY_FORM, req_dives: '0', dive_days: '0' }))
      .toMatchObject({ req_dives: 0, dive_days: 0 })
  })

  it('trims admin_title and the featured image', () => {
    const payload = eventPayloadFromForm({
      ...EMPTY_FORM,
      admin_title: '  Title  ',
      featured_image: '  https://x/y.jpg  ',
    })
    expect(payload.admin_title).toBe('Title')
    expect(payload.featured_image).toBe('https://x/y.jpg')
    // A whitespace-only image trims to '' which is falsy → null.
    expect(eventPayloadFromForm({ ...EMPTY_FORM, featured_image: '   ' }).featured_image).toBeNull()
  })
})

describe('eventPayloadFromForm — course', () => {
  it('serializes a fully-populated course form to the events row shape (dive fields nulled)', () => {
    const payload = eventPayloadFromForm({
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
      site_id: '',
      req_dives: '4',
      dive_days: '4',
      included: 'Manual',
      schedule: 'Morning',
      addonIds: ['ca1'],
      full_payment_deadline: '2026-06-28',
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      featured_image: '  https://cdn.example/c.jpg  ',
    })
    expect(payload).toEqual({
      kind: 'course',
      admin_title: 'Course admin',
      display_title: 'Course display',
      calendar_title: 'CC',
      price: 'price_c',
      capacity: 6,
      prereq_cert_id: 'cert_c',
      // A course runs from the shop, so the payload never carries a site.
      site_id: null,
      req_dives: 4,
      dive_days: 4,
      cancel_date: '2026-06-25',
      cancel_policy: 'Policy',
      fully_booked: false,
      full_payment_deadline: '2026-06-28',
      featured_image: 'https://cdn.example/c.jpg',
      start_time: '08:00:00',
      start_date: null,
      end_date: null,
      course_days: ['2026-07-01', '2026-07-02', '2026-07-03'],
      featured: false,
      is_private: false,
      is_boat_dive: false,
      is_trip: false,
      notes: null,
      nitrox_required: false,
      gear_rental: null,
      trip_template_id: null,
      course_name: 'PADI OW',
      included: 'Manual',
      schedule: 'Morning',
    })
    expect(payload).not.toHaveProperty('other_addons')
  })

  it('dedupes and sorts course_days, nulling an empty list', () => {
    expect(eventPayloadFromForm({
      ...EMPTY_FORM,
      type: 'course',
      courseDays: ['2026-07-05', '2026-07-01', '2026-07-05', '', '2026-07-03'],
    }).course_days).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', courseDays: [] }).course_days).toBeNull()
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', courseDays: [''] }).course_days).toBeNull()
  })

  it('nulls the start/end envelope for a course (its dates live in course_days)', () => {
    const payload = eventPayloadFromForm({
      ...EMPTY_FORM, type: 'course',
      start_date: '2026-07-01', end_date: '2026-07-03',
      courseDays: ['2026-07-01', '2026-07-03'],
    })
    expect(payload.start_date).toBeNull()
    expect(payload.end_date).toBeNull()
    expect(payload.course_days).toEqual(['2026-07-01', '2026-07-03'])
  })

  it('converts req_dives to a number, nulling blank', () => {
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', req_dives: '10' }).req_dives).toBe(10)
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', req_dives: '' }).req_dives).toBeNull()
  })

  it('converts dive_days to a number, nulling only blank ("0" stays 0)', () => {
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', dive_days: '3' }).dive_days).toBe(3)
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', dive_days: '' }).dive_days).toBeNull()
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', dive_days: '0' }).dive_days).toBe(0)
  })

  it('treats capacity "0" as the number 0, "" as null, positive as a number', () => {
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', capacity: '0' }).capacity).toBe(0)
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', capacity: '' }).capacity).toBeNull()
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', capacity: '4' }).capacity).toBe(4)
  })

  it('appends :00 to start_time and nulls an empty time', () => {
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', start_time: '08:00' }).start_time).toBe('08:00:00')
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', start_time: '' }).start_time).toBeNull()
  })

  it('maps blank text fields to null', () => {
    const payload = eventPayloadFromForm({ ...EMPTY_FORM, type: 'course' })
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

  it('does not trim a course admin_title (unlike the dive payload)', () => {
    // For a course the builder uses `form.admin_title || null` with no .trim(),
    // so leading/trailing whitespace survives to the DB.
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', admin_title: '  Spaced  ' }).admin_title)
      .toBe('  Spaced  ')
    // display_title IS trimmed on courses.
    expect(eventPayloadFromForm({ ...EMPTY_FORM, type: 'course', display_title: '  D  ' }).display_title).toBe('D')
  })
})

describe('adventure events', () => {
  it('round-trips an adventure through the form without turning it into a dive', () => {
    // formFromEvent used to hardcode `type: 'dive'` on its non-course branch,
    // which would load an adventure as a dive and save it back as one.
    const form = formStateFromEvent(baseRow({
      kind: 'adventure',
      start_date: '2026-08-01',
      end_date: '2026-08-03',
      course_days: null,
    }))
    expect(form.type).toBe('adventure')
    expect(form.start_date).toBe('2026-08-01')
    expect(form.end_date).toBe('2026-08-03')

    const payload = eventPayloadFromForm(form)
    expect(payload.kind).toBe('adventure')
    expect(payload.start_date).toBe('2026-08-01')
    expect(payload.end_date).toBe('2026-08-03')
    expect(payload.course_days).toBeNull()
  })

  it('nulls the diving-only columns for an adventure but keeps the trip flag', () => {
    const payload = eventPayloadFromForm({
      ...EMPTY_FORM,
      type: 'adventure',
      start_date: '2026-08-01',
      admin_title: 'Camping weekend',
      is_boat_dive: true,
      nitrox_required: true,
      is_trip: true,
      notes: 'bring a tent',
    })
    // Diving specifics never apply to a camping trip...
    expect(payload.is_boat_dive).toBe(false)
    expect(payload.nitrox_required).toBe(false)
    // ...but "runs over several days away from the shop" does.
    expect(payload.is_trip).toBe(true)
    expect(payload.notes).toBe('bring a tent')
  })
})

