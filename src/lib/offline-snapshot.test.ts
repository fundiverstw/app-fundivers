import { describe, it, expect, vi } from 'vitest'
import {
  OFFLINE_DAYS, SNAPSHOT_VERSION, buildSnapshot, coversDay, isUsableSnapshot,
  offlineDays, redactProfileForOffline, selectDayBoard, selectDayTransport,
  type OfflineSnapshot, type SnapshotSources,
} from './offline-snapshot'
import { EMPTY_DAY_BOARD, type DayBoardData } from './day-board'
import type { Profile } from '../types/database'

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: 'p1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  nickname: 'Ada',
  date_of_birth: '1990-04-02',
  nationality: 'British',
  id_number: 'A123456789',
  emergency_contact_name: 'Charles',
  emergency_contact_phone: '+886-900-000-000',
  cert_agency: 'PADI',
  cert_level: 'AOW',
  cert_card_path: 'p1/card.jpg',
  nitrox_card_path: 'p1/nitrox.jpg',
  deep_card_path: null,
  medical_notes: 'Asthma, carries an inhaler',
  avatar_url: 'p1/avatar.jpg',
  role: 'diver',
  height_cm: 170,
  weight_kg: 62,
  shoe_size: 'JP 25',
  fin_size: 'M',
  bcd_size: 'S',
  wetsuit_size: 'M',
  gender: 'female',
  contact_method: 'line',
  contact_id: 'ada_line',
  nitrox_certified: true,
  deep_certified: false,
  uncertified: false,
  logged_dives: 42,
  last_dive_date: '2026-08-01',
  gear_owned: ['Mask'],
  agreed_to_terms_at: '2026-01-01T00:00:00Z',
  agreed_to_terms_version: 3,
  application_submitted_at: '2026-01-01T00:00:00Z',
  status: 'active',
  parent_account: null,
  ...over,
})

const board = (over: Partial<DayBoardData> = {}): DayBoardData => ({
  ...EMPTY_DAY_BOARD, ...over,
})

function sources(over: Partial<SnapshotSources> = {}): SnapshotSources {
  return {
    fetchDayBoard: vi.fn(async () => board()),
    fetchDayTransport: vi.fn(async () => ({ allocations: [], rideGroups: [] })),
    fetchUpcomingDays: vi.fn(async () => ['2026-08-15']),
    fetchVehicles: vi.fn(async () => []),
    fetchGearModels: vi.fn(async () => []),
    ...over,
  }
}

describe('redactProfileForOffline', () => {
  it('keeps what the board packs gear and names divers from', () => {
    const out = redactProfileForOffline(profile())
    expect(out.id).toBe('p1')
    expect(out.name).toBe('Ada Lovelace')
    expect(out.nickname).toBe('Ada')
    expect(out.shoe_size).toBe('JP 25')
    expect(out.fin_size).toBe('M')
    expect(out.bcd_size).toBe('S')
    expect(out.wetsuit_size).toBe('M')
    expect(out.height_cm).toBe(170)
    expect(out.weight_kg).toBe(62)
    expect(out.gear_owned).toEqual(['Mask'])
    expect(out.gender).toBe('female')
  })

  it('keeps the certification and contact fields the roster shows', () => {
    const out = redactProfileForOffline(profile())
    expect(out.cert_agency).toBe('PADI')
    expect(out.cert_level).toBe('AOW')
    expect(out.nitrox_certified).toBe(true)
    expect(out.deep_certified).toBe(false)
    expect(out.uncertified).toBe(false)
    expect(out.logged_dives).toBe(42)
    expect(out.contact_method).toBe('line')
    expect(out.contact_id).toBe('ada_line')
    expect(out.role).toBe('diver')
  })

  // The whole point of the projection: a phone that leaves the shop and never
  // comes back must not be carrying these.
  it('drops the fields that must never reach a device', () => {
    const out = redactProfileForOffline(profile())
    expect(out.medical_notes).toBeNull()
    expect(out.id_number).toBeNull()
    expect(out.date_of_birth).toBeNull()
    expect(out.nationality).toBeNull()
    expect(out.emergency_contact_name).toBeNull()
    expect(out.emergency_contact_phone).toBeNull()
    expect(out.email).toBeNull()
  })

  it('drops the document paths and the avatar, which would not load anyway', () => {
    const out = redactProfileForOffline(profile())
    expect(out.cert_card_path).toBeNull()
    expect(out.nitrox_card_path).toBeNull()
    expect(out.deep_card_path).toBeNull()
    expect(out.avatar_url).toBeNull()
  })

  it('leaves the source row untouched', () => {
    const source = profile()
    redactProfileForOffline(source)
    expect(source.medical_notes).toBe('Asthma, carries an inhaler')
  })
})

describe('offlineDays', () => {
  it('covers today plus the following nine days', () => {
    const days = offlineDays('2026-08-15')
    expect(days).toHaveLength(OFFLINE_DAYS)
    expect(days[0]).toBe('2026-08-15')
    expect(days.at(-1)).toBe('2026-08-24')
  })

  it('crosses a month boundary in calendar space', () => {
    expect(offlineDays('2026-08-28')).toContain('2026-09-01')
  })
})

describe('buildSnapshot', () => {
  it('captures every day in the window', async () => {
    const src = sources()
    const snap = await buildSnapshot('u1', '2026-08-15', '2026-08-15T07:14:00Z', src, 30)
    expect(snap.days).toHaveLength(OFFLINE_DAYS)
    expect(src.fetchDayBoard).toHaveBeenCalledTimes(OFFLINE_DAYS)
    expect(Object.keys(snap.boards)).toHaveLength(OFFLINE_DAYS)
    expect(snap.version).toBe(SNAPSHOT_VERSION)
    expect(snap.userId).toBe('u1')
    expect(snap.capturedAt).toBe('2026-08-15T07:14:00Z')
  })

  it('redacts every profile it stores', async () => {
    const src = sources({
      fetchDayBoard: vi.fn(async () => board({ profiles: [profile()] })),
    })
    const snap = await buildSnapshot('u1', '2026-08-15', 'now', src, 30)
    expect(snap.boards['2026-08-15'].profiles[0].medical_notes).toBeNull()
    expect(snap.boards['2026-08-15'].profiles[0].name).toBe('Ada Lovelace')
  })

  // A capture abandoned because day seven timed out is how staff end up on a
  // boat with nothing at all.
  it('stores an empty board for a day that fails and keeps going', async () => {
    const fetchDayBoard = vi.fn(async (day: string) => {
      if (day === '2026-08-18') throw new Error('timeout')
      return board({ profiles: [profile()] })
    })
    const snap = await buildSnapshot('u1', '2026-08-15', 'now', sources({ fetchDayBoard }), 30)
    expect(snap.boards['2026-08-18']).toEqual(EMPTY_DAY_BOARD)
    expect(snap.boards['2026-08-19'].profiles).toHaveLength(1)
    expect(Object.keys(snap.boards)).toHaveLength(OFFLINE_DAYS)
  })

  it('survives a transport read failing without losing that day\'s roster', async () => {
    const src = sources({
      fetchDayBoard: vi.fn(async () => board({ profiles: [profile()] })),
      fetchDayTransport: vi.fn(async () => { throw new Error('nope') }),
    })
    const snap = await buildSnapshot('u1', '2026-08-15', 'now', src, 30)
    expect(snap.transport['2026-08-15']).toEqual({ allocations: [], rideGroups: [] })
    expect(snap.boards['2026-08-15'].profiles).toHaveLength(1)
  })

  it('falls back to the captured days when the picker list cannot be read', async () => {
    const src = sources({ fetchUpcomingDays: vi.fn(async () => { throw new Error('nope') }) })
    const snap = await buildSnapshot('u1', '2026-08-15', 'now', src, 30)
    expect(snap.upcomingDays).toEqual(snap.days)
  })

  it('asks the picker for its own longer window, not just the ten days', async () => {
    const src = sources()
    await buildSnapshot('u1', '2026-08-15', 'now', src, 30)
    expect(src.fetchUpcomingDays).toHaveBeenCalledWith('2026-08-15', '2026-09-14')
  })

  it('passes each day\'s event ids to the transport read', async () => {
    const fetchDayBoard = vi.fn(async () => board({
      events: [{ id: 'e1' }, { id: 'e2' }] as DayBoardData['events'],
    }))
    const src = sources({ fetchDayBoard })
    await buildSnapshot('u1', '2026-08-15', 'now', src, 30)
    expect(src.fetchDayTransport).toHaveBeenCalledWith('2026-08-15', ['e1', 'e2'])
  })

  it('keeps the fleet and the sizing charts, which are the same every day', async () => {
    const src = sources({
      fetchVehicles: vi.fn(async () => [{ id: 'v1' }] as never),
      fetchGearModels: vi.fn(async () => [{ id: 'g1' }] as never),
    })
    const snap = await buildSnapshot('u1', '2026-08-15', 'now', src, 30)
    expect(snap.vehicles).toHaveLength(1)
    expect(snap.gearModels).toHaveLength(1)
    expect(src.fetchVehicles).toHaveBeenCalledTimes(1)
  })
})

describe('isUsableSnapshot', () => {
  const good: OfflineSnapshot = {
    version: SNAPSHOT_VERSION,
    userId: 'u1',
    capturedAt: '2026-08-15T07:14:00Z',
    days: ['2026-08-15'],
    upcomingDays: [],
    vehicles: [],
    gearModels: [],
    boards: { '2026-08-15': board() },
    transport: {},
  }

  it('accepts this user\'s current-version snapshot', () => {
    expect(isUsableSnapshot(good, 'u1')).toBe(true)
  })

  // The leak sw-cache-policy.ts exists to prevent, in a different store.
  it('refuses a snapshot captured by somebody else on this device', () => {
    expect(isUsableSnapshot(good, 'u2')).toBe(false)
  })

  it('refuses a snapshot written by an older build', () => {
    expect(isUsableSnapshot({ ...good, version: SNAPSHOT_VERSION - 1 }, 'u1')).toBe(false)
  })

  it('refuses junk', () => {
    expect(isUsableSnapshot(null, 'u1')).toBe(false)
    expect(isUsableSnapshot('nope', 'u1')).toBe(false)
    expect(isUsableSnapshot({}, 'u1')).toBe(false)
    expect(isUsableSnapshot({ ...good, days: 'nope' }, 'u1')).toBe(false)
    expect(isUsableSnapshot({ ...good, boards: undefined }, 'u1')).toBe(false)
  })

  it('refuses a snapshot with no capture time — the board could not label it', () => {
    expect(isUsableSnapshot({ ...good, capturedAt: undefined }, 'u1')).toBe(false)
  })
})

describe('selectors', () => {
  const snap: OfflineSnapshot = {
    version: SNAPSHOT_VERSION,
    userId: 'u1',
    capturedAt: 'now',
    days: ['2026-08-15', '2026-08-16'],
    upcomingDays: [],
    vehicles: [],
    gearModels: [],
    boards: {
      '2026-08-15': board({ profiles: [profile()] }),
      '2026-08-16': board(),
    },
    transport: { '2026-08-15': { allocations: [], rideGroups: [{ id: 'r1' }] as never } },
  }

  it('returns the stored board for a captured day', () => {
    expect(selectDayBoard(snap, '2026-08-15')?.profiles).toHaveLength(1)
  })

  // "Captured, and quiet" is an answer. "Never captured" is not.
  it('distinguishes a quiet captured day from one outside the window', () => {
    expect(selectDayBoard(snap, '2026-08-16')).toEqual(board())
    expect(coversDay(snap, '2026-08-16')).toBe(true)
    expect(selectDayBoard(snap, '2026-09-01')).toBeNull()
    expect(coversDay(snap, '2026-09-01')).toBe(false)
  })

  it('returns transport per day, and null where none was stored', () => {
    expect(selectDayTransport(snap, '2026-08-15')?.rideGroups).toHaveLength(1)
    expect(selectDayTransport(snap, '2026-08-16')).toBeNull()
  })
})
