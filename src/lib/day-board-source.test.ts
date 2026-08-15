import { describe, it, expect, vi, beforeEach } from 'vitest'
import { liveOrStored, loadDayBoard, loadDayGearRows, loadDayTransport } from './day-board-source'
import { EMPTY_DAY_BOARD, type DayBoardData } from './day-board'
import { SNAPSHOT_VERSION, type OfflineSnapshot } from './offline-snapshot'
import type { Booking, Profile } from '../types/database'

const { fetchDayBoardMock, fetchDayTransportMock, fetchDayGearRowsMock } = vi.hoisted(() => ({
  fetchDayBoardMock: vi.fn(),
  fetchDayTransportMock: vi.fn(),
  fetchDayGearRowsMock: vi.fn(),
}))
vi.mock('./day-board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./day-board')>()),
  fetchDayBoard: (...a: unknown[]) => fetchDayBoardMock(...a),
  fetchDayTransport: (...a: unknown[]) => fetchDayTransportMock(...a),
}))
vi.mock('./logistics-day', () => ({
  fetchDayGearRows: (...a: unknown[]) => fetchDayGearRowsMock(...a),
}))

const board = (over: Partial<DayBoardData> = {}): DayBoardData => ({ ...EMPTY_DAY_BOARD, ...over })

function snapshotWith(boards: Record<string, DayBoardData>, days = Object.keys(boards)): OfflineSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    userId: 'u1',
    capturedAt: '2026-08-15T07:14:00Z',
    days,
    upcomingDays: [],
    vehicles: [],
    gearModels: [],
    boards,
    transport: {},
  }
}

beforeEach(() => {
  fetchDayBoardMock.mockReset()
  fetchDayTransportMock.mockReset()
  fetchDayGearRowsMock.mockReset()
})

describe('liveOrStored', () => {
  it('takes the live value when there is a connection', async () => {
    expect(await liveOrStored(true, async () => 'live', () => 'stored')).toBe('live')
  })

  it('falls back when the live read throws', async () => {
    expect(await liveOrStored(true, async () => { throw new Error('x') }, () => 'stored')).toBe('stored')
  })

  // supabase-js resolves a query against an unreachable host as an error
  // *result* often enough that catching alone would hand the board an empty
  // fleet and present it as fact.
  it('does not attempt a read the browser has already said will fail', async () => {
    const live = vi.fn(async () => 'live')
    expect(await liveOrStored(false, live, () => 'stored')).toBe('stored')
    expect(live).not.toHaveBeenCalled()
  })
})

describe('loadDayBoard', () => {
  it('reads live when there is a connection, and says so', async () => {
    fetchDayBoardMock.mockResolvedValue(board({ bookings: [{ id: 'b1' }] as Booking[] }))
    const out = await loadDayBoard('2026-08-15', null, true)
    expect(out).toEqual({ data: expect.objectContaining({ bookings: [{ id: 'b1' }] }), source: 'live' })
  })

  it('does not touch the network when the browser reports no connection', async () => {
    const snap = snapshotWith({ '2026-08-15': board() })
    await loadDayBoard('2026-08-15', snap, false)
    expect(fetchDayBoardMock).not.toHaveBeenCalled()
  })

  it('serves the stored day offline, and labels it', async () => {
    const snap = snapshotWith({ '2026-08-15': board({ bookings: [{ id: 'stored' }] as Booking[] }) })
    const out = await loadDayBoard('2026-08-15', snap, false)
    expect(out?.source).toBe('snapshot')
    expect(out?.data.bookings).toEqual([{ id: 'stored' }])
  })

  // The case the feature exists for: the browser thinks it is online because
  // there is a bar of signal or a captive portal, and the read still fails.
  it('falls back to the device when a live read fails despite being "online"', async () => {
    fetchDayBoardMock.mockRejectedValue(new Error('network'))
    const snap = snapshotWith({ '2026-08-15': board({ bookings: [{ id: 'stored' }] as Booking[] }) })
    const out = await loadDayBoard('2026-08-15', snap, true)
    expect(out?.source).toBe('snapshot')
  })

  it('returns null when there is neither a connection nor a snapshot', async () => {
    expect(await loadDayBoard('2026-08-15', null, false)).toBeNull()
  })

  it('returns null for a day the snapshot never covered, not an empty board', async () => {
    const snap = snapshotWith({ '2026-08-15': board() })
    expect(await loadDayBoard('2026-09-30', snap, false)).toBeNull()
  })

  // A captured day with no events is an answer. Rendering it as "unavailable"
  // would send someone looking for a connection they do not need.
  it('serves a captured but quiet day as an empty board', async () => {
    const snap = snapshotWith({ '2026-08-15': board() })
    const out = await loadDayBoard('2026-08-15', snap, false)
    expect(out).toEqual({ data: EMPTY_DAY_BOARD, source: 'snapshot' })
  })

  it('prefers live data over a stored copy of the same day', async () => {
    fetchDayBoardMock.mockResolvedValue(board({ bookings: [{ id: 'fresh' }] as Booking[] }))
    const snap = snapshotWith({ '2026-08-15': board({ bookings: [{ id: 'stored' }] as Booking[] }) })
    const out = await loadDayBoard('2026-08-15', snap, true)
    expect(out?.data.bookings).toEqual([{ id: 'fresh' }])
  })
})

describe('loadDayTransport', () => {
  it('reads live when it can', async () => {
    fetchDayTransportMock.mockResolvedValue({ allocations: [{ id: 'a1' }], rideGroups: [] })
    const out = await loadDayTransport('2026-08-15', ['e1'], null, true)
    expect(out.allocations).toEqual([{ id: 'a1' }])
  })

  it('falls back to the stored plan', async () => {
    const snap = snapshotWith({ '2026-08-15': board() })
    snap.transport = { '2026-08-15': { allocations: [{ id: 'stored' }] as never, rideGroups: [] } }
    const out = await loadDayTransport('2026-08-15', ['e1'], snap, false)
    expect(out.allocations).toEqual([{ id: 'stored' }])
  })

  // Transport is advisory next to the roster — an empty plan still leaves a
  // usable board, so it never returns null the way the roster does.
  it('returns an empty plan rather than nothing when neither source answers', async () => {
    fetchDayTransportMock.mockRejectedValue(new Error('network'))
    expect(await loadDayTransport('2026-08-15', ['e1'], null, true))
      .toEqual({ allocations: [], rideGroups: [] })
  })
})

describe('loadDayGearRows', () => {
  it('reads live when it can', async () => {
    fetchDayGearRowsMock.mockResolvedValue([{ booking: { id: 'b1' }, profile: null }])
    const out = await loadDayGearRows('2026-08-16', null, true)
    expect(out).toHaveLength(1)
  })

  it('pairs stored bookings with their stored divers', async () => {
    const snap = snapshotWith({
      '2026-08-16': board({
        bookings: [{ id: 'b1', user_id: 'p1' }, { id: 'b2', user_id: 'ghost' }] as Booking[],
        profiles: [{ id: 'p1', name: 'Ada' }] as Profile[],
      }),
    })
    const out = await loadDayGearRows('2026-08-16', snap, false)
    expect(out).toHaveLength(2)
    expect(out[0].profile?.name).toBe('Ada')
    // A booking whose diver was not captured reads as "no size on file", the
    // same as it would online — never dropped, which would hide a diver.
    expect(out[1].profile).toBeNull()
  })

  // Diffing against a silently empty next day reads as a real answer —
  // everything comes home to the shop — and sends a van back half-loaded.
  it('throws rather than returning an empty day it cannot vouch for', async () => {
    fetchDayGearRowsMock.mockRejectedValue(new Error('network'))
    await expect(loadDayGearRows('2026-08-16', null, true)).rejects.toThrow()
    const snap = snapshotWith({ '2026-08-15': board() })
    await expect(loadDayGearRows('2026-08-16', snap, false)).rejects.toThrow()
  })
})
