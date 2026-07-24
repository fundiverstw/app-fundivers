import { describe, it, expect } from 'vitest'
import { planFleet, planRuns, type Rider, type RunInput } from './vehicle-planning'

const FLEET = [
  { id: 'v1', name: 'Delica', passenger_seats: 7 },
  { id: 'v2', name: "Sigi's Car", passenger_seats: 4 },
  { id: 'v3', name: 'Veryca', passenger_seats: 1 },
]

const divers = (...names: string[]): Rider[] =>
  names.map(name => ({ id: name, name, kind: 'diver' }))
const staff = (...names: string[]): Rider[] =>
  names.map(name => ({ id: name, name, kind: 'staff' }))

const d = (n: number) => divers(...Array.from({ length: n }, (_, i) => `D${i + 1}`))
const s = (n: number) => staff(...Array.from({ length: n }, (_, i) => `S${i + 1}`))

describe('planFleet', () => {
  it('seats every diver and staff member — all are passengers, no driver reserved', () => {
    // 5 divers + 3 staff = 8 bodies. Delica (7) alone can't hold them, so the
    // next-largest joins.
    const p = planFleet(FLEET, d(5), s(3))
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.vehiclesNeeded).toBe(2)
    expect(p.riders).toBe(8)
    expect(p.seats).toBe(11)
    expect(p.fits).toBe(true)
    // Staff fill seats ahead of divers.
    expect(p.cars[0].passengers.map(r => r.name)).toEqual(['S1', 'S2', 'S3', 'D1', 'D2', 'D3', 'D4'])
    expect(p.cars[1].passengers.map(r => r.name)).toEqual(['D5'])
    expect(p.unseated).toEqual([])
  })

  it('adds vehicles largest-first until everyone fits', () => {
    // 10 divers + 2 staff = 12 bodies. Delica (7) + Sigi (4) = 11 < 12, so the
    // Veryca (1) is pulled in too.
    const p = planFleet(FLEET, d(10), s(2))
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica', "Sigi's Car", 'Veryca'])
    expect(p.vehiclesNeeded).toBe(3)
    expect(p.cars[0].passengers).toHaveLength(7)
    expect(p.cars[1].passengers).toHaveLength(4)
    expect(p.cars[2].passengers).toHaveLength(1)
    expect(p.fits).toBe(true)
  })

  it('seats a staff-free group of divers the same way', () => {
    const p = planFleet(FLEET, d(10), [])
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.cars[0].passengers).toHaveLength(7)
    expect(p.cars[1].passengers).toHaveLength(3)
    expect(p.fits).toBe(true)
    expect(p.unseated).toEqual([])
  })

  it('leaves riders unseated only when the whole fleet is too small', () => {
    // 20 divers + 3 staff = 23 bodies; fleet holds 12 → 11 ride-less.
    const p = planFleet(FLEET, d(20), s(3))
    expect(p.cars).toHaveLength(3)
    expect(p.seats).toBe(12)
    expect(p.fits).toBe(false)
    expect(p.shortfall).toBe(11)
    // Staff are seated first, so the overflow is all divers.
    expect(p.unseated.every(r => r.kind === 'diver')).toBe(true)
    expect(p.unseated).toHaveLength(11)
  })

  it('takes no vehicles when nobody travels', () => {
    const p = planFleet(FLEET, [], [])
    expect(p.cars).toEqual([])
    expect(p.fits).toBe(true)
    expect(p.vehiclesNeeded).toBe(0)
    expect(p.unseated).toEqual([])
  })

  it('reports everyone ride-less when the fleet is empty', () => {
    const p = planFleet([], d(4), [])
    expect(p.cars).toEqual([])
    expect(p.seats).toBe(0)
    expect(p.shortfall).toBe(4)
    expect(p.fits).toBe(false)
  })

  it('does not mutate the input fleet order', () => {
    const fleet = [...FLEET]
    planFleet(fleet, d(3), s(2))
    expect(fleet.map(v => v.name)).toEqual(['Delica', "Sigi's Car", 'Veryca'])
  })
})

// A run is the set of events travelling together. These cover the counting
// mistakes the old per-event summing made: a shared car counted twice, a person
// on two events counted twice, and slack pooled across runs that can't share.
describe('planRuns', () => {
  const run = (over: Partial<RunInput> & { key: string }): RunInput => ({
    events: [{ id: over.key, title: over.key }],
    divers: [],
    staff: [],
    fleet: [],
    ...over,
  })

  it('counts a car serving two events of one run once', () => {
    const shared = { id: 'v1', name: 'Delica', passenger_seats: 8 }
    const p = planRuns([run({
      key: 'group:g1',
      events: [{ id: 'e1', title: 'Bat Cave' }, { id: 'e2', title: 'Refresher' }],
      // The same allocation shows up once per event of the run.
      fleet: [shared, shared],
      divers: d(5),
      staff: s(2),
    })])
    expect(p.runs[0].fleetSeats).toBe(8)
    expect(p.runs[0].seats).toBe(8)
    expect(p.runs[0].cars).toHaveLength(1)
    expect(p.runs[0].riders).toBe(7)
    expect(p.runs[0].fits).toBe(true)
    expect(p.seats).toBe(8)
    expect(p.cars).toBe(1)
  })

  it('counts a diver booked on two events of one run as one body', () => {
    const p = planRuns([run({
      key: 'group:g1',
      events: [{ id: 'e1', title: 'Dive' }, { id: 'e2', title: 'Course' }],
      divers: [...divers('Ada'), ...divers('Ada'), ...divers('Bo')],
      fleet: [{ id: 'v1', name: 'Car', passenger_seats: 4 }],
    })])
    expect(p.runs[0].divers).toBe(2)
    expect(p.divers).toBe(2)
  })

  it('gives a staff member who is also booked as a diver one seat, as staff', () => {
    const p = planRuns([run({
      key: 'event:e1',
      divers: [{ id: 'p1', name: 'Ada', kind: 'diver' }, ...divers('Bo')],
      staff: [{ id: 'p1', name: 'Ada', kind: 'staff' }],
      fleet: [{ id: 'v1', name: 'Car', passenger_seats: 4 }],
    })])
    expect(p.runs[0].riders).toBe(2)
    expect(p.runs[0].staff).toBe(1)
    expect(p.runs[0].divers).toBe(1)
    expect(p.riders).toBe(2)
  })

  it('never pools seats across runs — one run can be short while the other has slack', () => {
    const p = planRuns([
      run({ key: 'event:e1', divers: d(6), fleet: [{ id: 'v1', name: 'Small', passenger_seats: 4 }] }),
      run({ key: 'event:e2', divers: divers('Zoe'), fleet: [{ id: 'v2', name: 'Big', passenger_seats: 8 }] }),
    ])
    expect(p.runs[0].fits).toBe(false)
    expect(p.runs[0].shortfall).toBe(2)
    expect(p.runs[1].fits).toBe(true)
    // The day's own totals still add the bodies and the cars taken up...
    expect(p.riders).toBe(7)
    expect(p.seats).toBe(12)
    // ...but the day does not "fit" just because the totals would.
    expect(p.fits).toBe(false)
    expect(p.shortfall).toBe(2)
  })

  it('flags one car taken by two runs — it can only make one', () => {
    const shared = { id: 'v1', name: 'Delica', passenger_seats: 8 }
    const p = planRuns([
      run({ key: 'event:e1', divers: d(2), fleet: [shared] }),
      run({ key: 'event:e2', divers: divers('Zoe'), fleet: [shared] }),
    ])
    expect(p.conflicts).toEqual([
      { kind: 'car', name: 'Delica', runKeys: ['event:e1', 'event:e2'] },
    ])
    // Counted once for the day, however many runs claim it.
    expect(p.cars).toBe(1)
    expect(p.seats).toBe(8)
  })

  it('flags a staff member and a diver expected on two runs at once', () => {
    const car = (id: string) => ({ id, name: id, passenger_seats: 6 })
    const p = planRuns([
      run({ key: 'event:e1', divers: divers('Ada'), staff: staff('Billy'), fleet: [car('v1')] }),
      run({ key: 'event:e2', divers: divers('Ada'), staff: staff('Billy'), fleet: [car('v2')] }),
    ])
    expect(p.conflicts).toEqual([
      { kind: 'staff', name: 'Billy', runKeys: ['event:e1', 'event:e2'] },
      { kind: 'diver', name: 'Ada', runKeys: ['event:e1', 'event:e2'] },
    ])
    // Both runs need a seat for each of them, but the day counts two people.
    expect(p.runs[0].riders).toBe(2)
    expect(p.runs[1].riders).toBe(2)
    expect(p.riders).toBe(2)
  })

  it('does not flag a car that is only spare on the other run', () => {
    const big = { id: 'v1', name: 'Big', passenger_seats: 8 }
    const small = { id: 'v2', name: 'Small', passenger_seats: 2 }
    const p = planRuns([
      // One rider, so only the largest car is taken and Small sits spare.
      run({ key: 'event:e1', divers: divers('Ada'), fleet: [big, small] }),
      run({ key: 'event:e2', divers: divers('Bo'), fleet: [small] }),
    ])
    expect(p.runs[0].spare.map(v => v.name)).toEqual(['Small'])
    expect(p.conflicts).toEqual([])
  })

  it('reports a run with riders but no car as seatless rather than short', () => {
    const p = planRuns([run({ key: 'event:e1', divers: d(3), staff: s(1) })])
    expect(p.runs[0].seats).toBe(0)
    expect(p.runs[0].fits).toBe(false)
    expect(p.runs[0].shortfall).toBe(4)
    expect(p.runs[0].cars).toEqual([])
  })

  it('marks a single-event run as not shared', () => {
    const p = planRuns([
      run({ key: 'event:e1' }),
      run({ key: 'group:g1', events: [{ id: 'e2', title: 'A' }, { id: 'e3', title: 'B' }] }),
    ])
    expect(p.runs[0].shared).toBe(false)
    expect(p.runs[1].shared).toBe(true)
  })

  it('is empty and fitting when the day has no events', () => {
    const p = planRuns([])
    expect(p).toMatchObject({ runs: [], riders: 0, seats: 0, cars: 0, fits: true, shortfall: 0, conflicts: [] })
  })
})
