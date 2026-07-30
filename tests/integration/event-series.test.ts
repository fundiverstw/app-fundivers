import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, type TestUser,
} from './helpers'

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
