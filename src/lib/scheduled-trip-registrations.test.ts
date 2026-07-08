// scheduled-trip-registrations lib: the admin roster read joins the base
// registrations table to profile + trip labels in a single round-trip. We verify
// the join wiring (diver + trip_title attached, misses coerced to null) and the
// live-count badge query.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

beforeEach(() => { from.mockReset() })

describe('fetchRegistrationsWithDivers', () => {
  it('attaches each diver profile and trip title to its registration', async () => {
    const regs = [
      { id: 'reg1', scheduled_trip_id: 's1', diver_id: 'u1', status: 'registered', estimated_cost: 80000 },
      { id: 'reg2', scheduled_trip_id: 's2', diver_id: 'u2', status: 'completed', estimated_cost: 60000 },
    ]
    const profiles = [
      { id: 'u1', name: 'Ada Lovelace', nickname: 'Ada', email: 'ada@x.test', contact_id: '0900111222' },
    ]
    const trips = [{ id: 's1', title: 'Palau Liveaboard' }]

    from.mockImplementation((table: string) => {
      if (table === 'scheduled_trip_registrations') {
        return { select: () => ({ order: () => Promise.resolve({ data: regs, error: null }) }) }
      }
      if (table === 'profiles') {
        return { select: () => ({ in: () => Promise.resolve({ data: profiles, error: null }) }) }
      }
      return { select: () => ({ in: () => Promise.resolve({ data: trips, error: null }) }) }
    })

    const { fetchRegistrationsWithDivers } = await import('./scheduled-trip-registrations')
    const rows = await fetchRegistrationsWithDivers()

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'reg1', trip_title: 'Palau Liveaboard' })
    expect(rows[0].diver).toEqual(profiles[0])
    // Second registration has no matching profile/trip — both fall back to null.
    expect(rows[1]).toMatchObject({ id: 'reg2', trip_title: null, diver: null })
  })

  it('throws when the base read errors', async () => {
    from.mockImplementation(() => ({
      select: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
    }))
    const { fetchRegistrationsWithDivers } = await import('./scheduled-trip-registrations')
    await expect(fetchRegistrationsWithDivers()).rejects.toBeTruthy()
  })
})

describe('countNewRegistrations', () => {
  it('counts live registrations still in the registered state', async () => {
    from.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ count: 3, error: null }) }),
    }))
    const { countNewRegistrations } = await import('./scheduled-trip-registrations')
    expect(await countNewRegistrations()).toBe(3)
  })

  it('coerces a null count to zero', async () => {
    from.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ count: null, error: null }) }),
    }))
    const { countNewRegistrations } = await import('./scheduled-trip-registrations')
    expect(await countNewRegistrations()).toBe(0)
  })
})

describe('setRegistrationStatus', () => {
  it('updates the row status by id', async () => {
    let patched: unknown = null
    from.mockImplementation(() => ({
      update: (p: unknown) => { patched = p; return { eq: () => Promise.resolve({ error: null }) } },
    }))
    const { setRegistrationStatus } = await import('./scheduled-trip-registrations')
    await setRegistrationStatus('reg1', 'completed')
    expect(patched).toEqual({ status: 'completed' })
  })
})
