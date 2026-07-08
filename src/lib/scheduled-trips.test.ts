// scheduled-trips lib: the register-scheduled-trip edge-fn wrapper, the
// diver-facing definer-function fetchers, and the diver-owned cancel RPC. The
// RPC/function contracts themselves are locked by the integration tests; here we
// only verify the wrapper shapes (invoke/rpc args, error propagation,
// empty-data coercion).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

beforeEach(() => { rpc.mockReset(); invoke.mockReset() })

describe('fetchScheduledTrips', () => {
  it('calls list_scheduled_trips and returns rows', async () => {
    const rows = [{ id: 's1', title: 'Palau Liveaboard', addon_ids: ['a1'], room_type_ids: ['r1'] }]
    rpc.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchScheduledTrips } = await import('./scheduled-trips')

    expect(await fetchScheduledTrips()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_scheduled_trips')
  })

  it('coerces a null payload to an empty list', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchScheduledTrips } = await import('./scheduled-trips')
    expect(await fetchScheduledTrips()).toEqual([])
  })

  it('throws when the rpc errors', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'boom' } }))
    const { fetchScheduledTrips } = await import('./scheduled-trips')
    await expect(fetchScheduledTrips()).rejects.toBeTruthy()
  })
})

describe('fetchScheduledTrip', () => {
  it('reads list_scheduled_trips filtered to the one id', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: { id: 's1', title: 'Palau Liveaboard' } }))
    const { fetchScheduledTrip } = await import('./scheduled-trips')
    expect(await fetchScheduledTrip('s1')).toEqual({ id: 's1', title: 'Palau Liveaboard' })
    expect(rpc).toHaveBeenCalledWith('list_scheduled_trips')
  })

  it('returns null when the trip is not published', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchScheduledTrip } = await import('./scheduled-trips')
    expect(await fetchScheduledTrip('missing')).toBeNull()
  })
})

describe('registerForScheduledTrip', () => {
  const input = {
    scheduledTripId: 's1', addonIds: ['a1', 'a2'], roomId: 'r1', notes: 'window seat',
  }

  it('invokes register-scheduled-trip with the snake_cased body and returns the result', async () => {
    invoke.mockResolvedValue({ data: { registration_id: 'reg-1', estimated_cost: 80000, estimated_currency: 'TWD' }, error: null })
    const { registerForScheduledTrip } = await import('./scheduled-trips')

    const res = await registerForScheduledTrip(input)
    expect(res).toEqual({ registration_id: 'reg-1', estimated_cost: 80000, estimated_currency: 'TWD' })
    expect(invoke).toHaveBeenCalledWith('register-scheduled-trip', {
      body: {
        scheduled_trip_id: 's1', addon_ids: ['a1', 'a2'], room_id: 'r1', notes: 'window seat',
      },
    })
  })

  it('throws when the edge function errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'trip is not open for registration' } })
    const { registerForScheduledTrip } = await import('./scheduled-trips')
    await expect(registerForScheduledTrip(input)).rejects.toBeTruthy()
  })

  it('surfaces the server error body from the FunctionsHttpError context', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'add-on not offered on this trip' }) } },
    })
    const { registerForScheduledTrip } = await import('./scheduled-trips')
    await expect(registerForScheduledTrip(input)).rejects.toThrow(/add-on not offered on this trip/)
  })
})

describe('fetchMyScheduledTripRegistrations', () => {
  it('calls list_my_scheduled_trip_registrations and returns rows', async () => {
    const rows = [{ id: 'reg1', scheduled_trip_id: 's1', status: 'registered', estimated_cost: 80000 }]
    rpc.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchMyScheduledTripRegistrations } = await import('./scheduled-trips')

    expect(await fetchMyScheduledTripRegistrations()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_my_scheduled_trip_registrations')
  })

  it('coerces a null payload to an empty list', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchMyScheduledTripRegistrations } = await import('./scheduled-trips')
    expect(await fetchMyScheduledTripRegistrations()).toEqual([])
  })
})

describe('cancelMyScheduledTripRegistration', () => {
  it('calls the definer RPC with the registration id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { cancelMyScheduledTripRegistration } = await import('./scheduled-trips')
    await cancelMyScheduledTripRegistration('reg-1')
    expect(rpc).toHaveBeenCalledWith('cancel_my_scheduled_trip_registration', { p_id: 'reg-1' })
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { cancelMyScheduledTripRegistration } = await import('./scheduled-trips')
    await expect(cancelMyScheduledTripRegistration('reg-1')).rejects.toBeTruthy()
  })
})
