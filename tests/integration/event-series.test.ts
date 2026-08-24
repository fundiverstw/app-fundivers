import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, type TestUser,
} from './helpers'
import { occurrenceDates } from '../../src/lib/recurrence'
import { shiftFormToDate, seriesAnchor } from '../../src/lib/event-series'
import { eventPayloadFromForm, EMPTY_FORM, type FormState } from '../../src/components/admin/event-form-state'

// The recurring-events schema (20260804000000_event_series.sql).
//
// The properties worth pinning are the ones that keep a batch of real,
// bookable events safe: the stored rule can't describe a pattern it doesn't
// have, divers can't read the rule, only admins can write it, and — the one
// that matters most — deleting a series never deletes the events it produced.

const admin = adminClient()
let adminUser: TestUser
let staffUser: TestUser
let diverUser: TestUser

const WEEKLY = { kind: 'dive', freq: 'weekly', interval: 1, weekdays: [6] } as const

async function mintSeries(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('event_series')
    .insert({ ...WEEKLY, ...over } as never).select('id').single()
  if (error) throw new Error(`mintSeries failed: ${error.message}`)
  return (data as { id: string }).id
}

async function mintEvent(seriesId: string | null, date: string): Promise<string> {
  const { data, error } = await admin.from('events').insert({
    kind: 'dive', admin_title: 'Series test dive', start_date: date, notes: '',
    series_id: seriesId,
  } as never).select('id').single()
  if (error) throw new Error(`mintEvent failed: ${error.message}`)
  return (data as { id: string }).id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staffUser = await createTestUser(admin, { role: 'staff' })
  diverUser = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const u of [adminUser, staffUser, diverUser]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('event_series constraints', () => {
  it('accepts a weekly rule with weekdays', async () => {
    const id = await mintSeries({ label: 'Saturday boat dives' })
    const { data } = await admin.from('event_series').select('*').eq('id', id).single()
    expect((data as { weekdays: number[] }).weekdays).toEqual([6])
    await admin.from('event_series').delete().eq('id', id)
  })

  // A weekly rule with no weekdays would expand to nothing; a non-weekly rule
  // carrying them would imply a pattern it does not have.
  it('requires weekdays for a weekly rule and forbids them otherwise', async () => {
    const missing = await admin.from('event_series')
      .insert({ kind: 'dive', freq: 'weekly', interval: 1 } as never)
    expect(missing.error).not.toBeNull()

    const spurious = await admin.from('event_series')
      .insert({ kind: 'dive', freq: 'daily', interval: 1, weekdays: [6] } as never)
    expect(spurious.error).not.toBeNull()
  })

  it('rejects a weekday outside 1..7', async () => {
    for (const weekdays of [[0, 6], [6, 8], [-1]]) {
      const { error } = await admin.from('event_series')
        .insert({ ...WEEKLY, weekdays } as never)
      expect(error).not.toBeNull()
    }
  })

  it('rejects an interval outside the range the client enforces', async () => {
    for (const interval of [0, 13, -2]) {
      const { error } = await admin.from('event_series')
        .insert({ ...WEEKLY, interval } as never)
      expect(error).not.toBeNull()
    }
  })

  it('rejects an unknown freq or kind', async () => {
    expect((await admin.from('event_series')
      .insert({ ...WEEKLY, freq: 'fortnightly' } as never)).error).not.toBeNull()
    expect((await admin.from('event_series')
      .insert({ ...WEEKLY, kind: 'party' } as never)).error).not.toBeNull()
  })

  it('accepts daily and monthly_weekday rules with no weekdays', async () => {
    for (const freq of ['daily', 'monthly_weekday']) {
      const { data, error } = await admin.from('event_series')
        .insert({ kind: 'dive', freq, interval: 2 } as never).select('id').single()
      expect(error).toBeNull()
      if (data) await admin.from('event_series').delete().eq('id', (data as { id: string }).id)
    }
  })
})

// The single most important property here: a shop deleting a series must not
// lose the dives divers have already booked onto.
describe('deleting a series never deletes its events', () => {
  it('nulls series_id and leaves the event standing', async () => {
    const seriesId = await mintSeries()
    const eventId = await mintEvent(seriesId, '2031-03-01')
    try {
      const { error } = await admin.from('event_series').delete().eq('id', seriesId)
      expect(error).toBeNull()

      const { data } = await admin.from('events').select('id, series_id').eq('id', eventId).single()
      expect(data).not.toBeNull()
      expect((data as { series_id: string | null }).series_id).toBeNull()
    } finally {
      await admin.from('events').delete().eq('id', eventId)
    }
  })

  it('keeps a booking on an occurrence whose series is deleted', async () => {
    const seriesId = await mintSeries()
    const eventId = await mintEvent(seriesId, '2031-03-08')
    const { data: booking } = await admin.from('bookings').insert({
      user_id: diverUser.id, event_id: eventId, status: 'confirmed', details: {},
    } as never).select('id').single()
    try {
      await admin.from('event_series').delete().eq('id', seriesId)
      const { data } = await admin.from('bookings').select('id').eq('id', (booking as { id: string }).id)
      expect((data ?? []).length).toBe(1)
    } finally {
      await admin.from('bookings').delete().eq('event_id', eventId)
      await admin.from('events').delete().eq('id', eventId)
    }
  })
})

describe('event_series RLS', () => {
  it('an admin can create, read and delete a series', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await sb.from('event_series')
      .insert({ ...WEEKLY, created_by: adminUser.id } as never).select('id').single()
    expect(error).toBeNull()
    const id = (data as { id: string }).id
    const { data: read } = await sb.from('event_series').select('*').eq('id', id)
    expect((read ?? []).length).toBe(1)
    expect((await sb.from('event_series').delete().eq('id', id)).error).toBeNull()
  })

  it('staff can read a series but not create one', async () => {
    const id = await mintSeries()
    try {
      const sb = await userClient(staffUser.email, staffUser.password)
      const { data } = await sb.from('event_series').select('*').eq('id', id)
      expect((data ?? []).length).toBe(1)

      const { error } = await sb.from('event_series').insert({ ...WEEKLY } as never)
      expect(error).not.toBeNull()
    } finally {
      await admin.from('event_series').delete().eq('id', id)
    }
  })

  it('staff cannot delete or edit a series', async () => {
    const id = await mintSeries({ label: 'Untouched' })
    try {
      const sb = await userClient(staffUser.email, staffUser.password)
      // Failing the USING predicate is a silent no-op under PostgREST + RLS.
      await sb.from('event_series').update({ label: 'Hijacked' } as never).eq('id', id)
      await sb.from('event_series').delete().eq('id', id)
      const { data } = await admin.from('event_series').select('label').eq('id', id).single()
      expect((data as { label: string }).label).toBe('Untouched')
    } finally {
      await admin.from('event_series').delete().eq('id', id)
    }
  })

  // Divers see the occurrences on the calendar; the rule behind them is shop
  // scheduling, not diver-facing content.
  it('a diver sees no series rows', async () => {
    const id = await mintSeries()
    try {
      const sb = await userClient(diverUser.email, diverUser.password)
      const { data } = await sb.from('event_series').select('*')
      expect(data ?? []).toEqual([])
    } finally {
      await admin.from('event_series').delete().eq('id', id)
    }
  })

  it('anon sees no series rows', async () => {
    const id = await mintSeries()
    try {
      const { data } = await anonClient().from('event_series').select('*')
      expect(data ?? []).toEqual([])
    } finally {
      await admin.from('event_series').delete().eq('id', id)
    }
  })

  // events itself is publicly readable, and series_id rides along on the row —
  // it identifies a batch, not anything private.
  it('leaves the occurrences themselves publicly readable', async () => {
    const seriesId = await mintSeries()
    const eventId = await mintEvent(seriesId, '2031-04-01')
    try {
      const { data } = await anonClient().from('events').select('id, series_id').eq('id', eventId).single()
      expect((data as { series_id: string }).series_id).toBe(seriesId)
    } finally {
      await admin.from('events').delete().eq('id', eventId)
      await admin.from('event_series').delete().eq('id', seriesId)
    }
  })
})

// The generator builds its rows from the same pure helpers the app does, so
// inserting them here is what proves a generated occurrence actually satisfies
// every constraint on `events` — events_dive_has_start and
// events_course_has_days in particular, which differ by kind.
describe('generated occurrences satisfy the events constraints', () => {
  async function generate(form: FormState, count: number) {
    const seriesId = await mintSeries({ kind: form.type })
    const anchor = seriesAnchor(form)!
    const dates = occurrenceDates({ freq: 'weekly', interval: 1, weekdays: [6], count }, anchor)
    const rows = dates.map(date => ({
      ...eventPayloadFromForm(shiftFormToDate(form, date)),
      series_id: seriesId,
    }))
    const { error } = await admin.from('events').insert(rows as never)
    return { seriesId, dates, error }
  }

  async function cleanup(seriesId: string) {
    await admin.from('events').delete().eq('series_id', seriesId)
    await admin.from('event_series').delete().eq('id', seriesId)
  }

  it('inserts a batch of dives as one statement, all sharing the series', async () => {
    const form: FormState = {
      ...EMPTY_FORM, type: 'dive', admin_title: 'Saturday boat dive',
      start_date: '2031-05-03', notes: 'bring a torch', capacity: '8',
    }
    const { seriesId, dates, error } = await generate(form, 4)
    try {
      expect(error).toBeNull()
      const { data } = await admin.from('events')
        .select('start_date, capacity, series_id, notes')
        .eq('series_id', seriesId).order('start_date')
      const rows = (data ?? []) as Array<{ start_date: string; capacity: number; notes: string }>
      expect(rows.map(r => r.start_date)).toEqual(dates)
      // The template's own fields ride along unchanged on every occurrence.
      expect(rows.every(r => r.capacity === 8 && r.notes === 'bring a torch')).toBe(true)
    } finally {
      await cleanup(seriesId)
    }
  })

  it('shifts a multi-day course block, keeping its gaps and its day count', async () => {
    const form: FormState = {
      ...EMPTY_FORM, type: 'course', admin_title: 'Open Water',
      course_name: 'Open Water',
      // Sat, Sun, then the FOLLOWING Sat — the shape must survive the shift.
      courseDays: ['2031-05-03', '2031-05-04', '2031-05-10'],
    }
    const { seriesId, error } = await generate(form, 3)
    try {
      expect(error).toBeNull()
      const { data } = await admin.from('events')
        .select('course_days, start_date').eq('series_id', seriesId)
      const rows = (data ?? []) as Array<{ course_days: string[]; start_date: string | null }>
      expect(rows).toHaveLength(3)
      const sets = rows.map(r => r.course_days.map(d => String(d).slice(0, 10)).sort())
      expect(sets).toContainEqual(['2031-05-03', '2031-05-04', '2031-05-10'])
      expect(sets).toContainEqual(['2031-05-10', '2031-05-11', '2031-05-17'])
      expect(sets).toContainEqual(['2031-05-17', '2031-05-18', '2031-05-24'])
      // A course carries no envelope; events_course_has_days is what it satisfies.
      expect(rows.every(r => r.start_date === null)).toBe(true)
    } finally {
      await cleanup(seriesId)
    }
  })

  it('carries the shifted cancellation and payment deadlines, not the template\'s', async () => {
    const form: FormState = {
      ...EMPTY_FORM, type: 'dive', admin_title: 'Deadline dive', notes: '',
      start_date: '2031-06-07', cancel_date: '2031-06-05', full_payment_deadline: '2031-05-31',
    }
    const { seriesId, error } = await generate(form, 3)
    try {
      expect(error).toBeNull()
      const { data } = await admin.from('events')
        .select('start_date, cancel_date, full_payment_deadline')
        .eq('series_id', seriesId).order('start_date')
      const rows = (data ?? []) as Array<{ start_date: string; cancel_date: string; full_payment_deadline: string }>
      // Every occurrence keeps the same two-day / seven-day lead time.
      for (const r of rows) {
        const start = new Date(r.start_date).getTime()
        expect((start - new Date(r.cancel_date).getTime()) / 86_400_000).toBe(2)
        expect((start - new Date(r.full_payment_deadline).getTime()) / 86_400_000).toBe(7)
      }
      expect(rows.map(r => r.cancel_date)).toEqual(['2031-06-05', '2031-06-12', '2031-06-19'])
    } finally {
      await cleanup(seriesId)
    }
  })

  it('rejects the whole batch rather than half of it when a row is invalid', async () => {
    // A dive with no start_date violates events_dive_has_start; because the
    // occurrences go in as one statement, none of them should land.
    const seriesId = await mintSeries()
    try {
      const { error } = await admin.from('events').insert([
        { kind: 'dive', admin_title: 'good', start_date: '2031-07-05', notes: '', series_id: seriesId },
        { kind: 'dive', admin_title: 'bad', start_date: null, notes: '', series_id: seriesId },
      ] as never)
      expect(error).not.toBeNull()
      const { data } = await admin.from('events').select('id').eq('series_id', seriesId)
      expect(data ?? []).toEqual([])
    } finally {
      await cleanup(seriesId)
    }
  })
})

// create_events_with_relations (20260805000000). The property under test is
// all-or-nothing: before it, a batch was 2 + 2N round trips from the browser and
// a failure partway left a half-generated series nobody could undo.
describe('create_events_with_relations', () => {
  const baseEvent = (over: Record<string, unknown> = {}) => ({
    kind: 'dive', admin_title: 'atomic dive', notes: '', start_date: '2032-01-03',
    fully_booked: false, featured: false, is_private: false, has_transport: true,
    is_boat_dive: false, is_trip: false, nitrox_required: false,
    ...over,
  })

  async function cleanupTitles(prefix: string) {
    await admin.from('events').delete().like('admin_title', `${prefix}%`)
    await admin.from('event_series').delete().like('label', `${prefix}%`)
  }

  it('creates one event with no series when no rule is given', async () => {
    const { data, error } = await admin.rpc('create_events_with_relations', {
      p_events: [baseEvent({ admin_title: 'atomic-one A' })],
    })
    try {
      expect(error).toBeNull()
      expect((data as string[]).length).toBe(1)
      const { data: row } = await admin.from('events')
        .select('series_id, start_date').eq('id', (data as string[])[0]).single()
      expect((row as { series_id: string | null }).series_id).toBeNull()
    } finally {
      await cleanupTitles('atomic-one')
    }
  })

  // Every NOT NULL column has to be in the payload: jsonb_populate_record
  // leaves an absent key NULL rather than falling back to the column default,
  // so a forgotten key is an insert failure, not a silently wrong row.
  it('refuses a payload that omits a NOT NULL column rather than writing a null', async () => {
    const withoutTransport: Record<string, unknown> = baseEvent({ admin_title: 'atomic-null A' })
    delete withoutTransport.has_transport
    const { error } = await admin.rpc('create_events_with_relations', { p_events: [withoutTransport] })
    try {
      expect(error).not.toBeNull()
    } finally {
      await cleanupTitles('atomic-null')
    }
  })

  it('carries has_transport through to every event in the batch', async () => {
    const { data, error } = await admin.rpc('create_events_with_relations', {
      p_events: [
        baseEvent({ admin_title: 'atomic-dry A', start_date: '2032-03-06', has_transport: false }),
        baseEvent({ admin_title: 'atomic-dry B', start_date: '2032-03-13', has_transport: false }),
      ],
    })
    try {
      expect(error).toBeNull()
      const { data: rows } = await admin.from('events')
        .select('has_transport').in('id', data as string[])
      expect((rows ?? []).map(r => (r as { has_transport: boolean }).has_transport)).toEqual([false, false])
    } finally {
      await cleanupTitles('atomic-dry')
    }
  })

  it('creates a series and points every event at it, in the order given', async () => {
    const { data, error } = await admin.rpc('create_events_with_relations', {
      p_events: [
        baseEvent({ admin_title: 'atomic-many A', start_date: '2032-02-07' }),
        baseEvent({ admin_title: 'atomic-many B', start_date: '2032-02-14' }),
        baseEvent({ admin_title: 'atomic-many C', start_date: '2032-02-21' }),
      ],
      p_series: { kind: 'dive', freq: 'weekly', interval: 1, weekdays: [6], label: 'atomic-many series' },
    })
    try {
      expect(error).toBeNull()
      const ids = data as string[]
      expect(ids).toHaveLength(3)
      const { data: rows } = await admin.from('events')
        .select('id, series_id, start_date').in('id', ids)
      const seriesIds = new Set((rows ?? []).map(r => (r as { series_id: string }).series_id))
      expect(seriesIds.size).toBe(1)
      expect([...seriesIds][0]).not.toBeNull()
      // Returned ids follow the input order, which is what lets the caller
      // navigate to the first occurrence.
      const byId = new Map((rows ?? []).map(r => [(r as { id: string }).id, r as { start_date: string }]))
      expect(byId.get(ids[0])!.start_date).toBe('2032-02-07')
      expect(byId.get(ids[2])!.start_date).toBe('2032-02-21')
    } finally {
      await cleanupTitles('atomic-many')
    }
  })

  // The whole point. A dive with no start_date violates events_dive_has_start.
  it('rolls back every event AND the series when one row is invalid', async () => {
    const { error } = await admin.rpc('create_events_with_relations', {
      p_events: [
        baseEvent({ admin_title: 'atomic-rb A', start_date: '2032-03-06' }),
        baseEvent({ admin_title: 'atomic-rb B', start_date: null }),
      ],
      p_series: { kind: 'dive', freq: 'weekly', interval: 1, weekdays: [6], label: 'atomic-rb series' },
    })
    expect(error).not.toBeNull()

    const { data: events } = await admin.from('events').select('id').like('admin_title', 'atomic-rb%')
    expect(events ?? []).toEqual([])
    const { data: series } = await admin.from('event_series').select('id').like('label', 'atomic-rb%')
    expect(series ?? []).toEqual([])
  })

  it('attaches to an existing series with p_series_id, for extending a batch', async () => {
    const seriesId = await mintSeries({ label: 'atomic-ext series' })
    const { data, error } = await admin.rpc('create_events_with_relations', {
      p_events: [baseEvent({ admin_title: 'atomic-ext A', start_date: '2032-04-03' })],
      p_series_id: seriesId,
    })
    try {
      expect(error).toBeNull()
      const { data: row } = await admin.from('events')
        .select('series_id').eq('id', (data as string[])[0]).single()
      expect((row as { series_id: string }).series_id).toBe(seriesId)
    } finally {
      await cleanupTitles('atomic-ext')
    }
  })

  it('refuses to both create and attach a series', async () => {
    const seriesId = await mintSeries({ label: 'atomic-both series' })
    try {
      const { error } = await admin.rpc('create_events_with_relations', {
        p_events: [baseEvent({ admin_title: 'atomic-both A' })],
        p_series: { kind: 'dive', freq: 'weekly', interval: 1, weekdays: [6] },
        p_series_id: seriesId,
      })
      expect(error).not.toBeNull()
      const { data: events } = await admin.from('events').select('id').like('admin_title', 'atomic-both%')
      expect(events ?? []).toEqual([])
    } finally {
      await cleanupTitles('atomic-both')
    }
  })

  it('rejects an empty batch and one past the occurrence cap', async () => {
    expect((await admin.rpc('create_events_with_relations', { p_events: [] })).error).not.toBeNull()
    const tooMany = Array.from({ length: 53 }, (_, i) => baseEvent({ admin_title: `atomic-cap ${i}` }))
    const { error } = await admin.rpc('create_events_with_relations', { p_events: tooMany })
    expect(error).not.toBeNull()
    const { data } = await admin.from('events').select('id').like('admin_title', 'atomic-cap%')
    expect(data ?? []).toEqual([])
  })

  // SECURITY INVOKER: the events / event_series RLS policies do the
  // authorization, so there is no second gate here to drift out of step.
  it('lets an admin call it and refuses a staff user', async () => {
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const ok = await asAdmin.rpc('create_events_with_relations', {
      p_events: [baseEvent({ admin_title: 'atomic-rls A', start_date: '2032-05-01' })],
    })
    try {
      expect(ok.error).toBeNull()
      const asStaff = await userClient(staffUser.email, staffUser.password)
      const denied = await asStaff.rpc('create_events_with_relations', {
        p_events: [baseEvent({ admin_title: 'atomic-rls B', start_date: '2032-05-08' })],
      })
      expect(denied.error).not.toBeNull()
      const { data } = await admin.from('events').select('id').eq('admin_title', 'atomic-rls B')
      expect(data ?? []).toEqual([])
    } finally {
      await cleanupTitles('atomic-rls')
    }
  })

  it('is not callable by an unauthenticated client', async () => {
    const { error } = await anonClient().rpc('create_events_with_relations', {
      p_events: [baseEvent({ admin_title: 'atomic-anon A' })],
    })
    expect(error).not.toBeNull()
  })
})
