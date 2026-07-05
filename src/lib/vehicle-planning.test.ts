import { describe, it, expect } from 'vitest'
import { planFleet, type Rider } from './vehicle-planning'

const FLEET = [
  { name: 'Delica', passenger_seats: 7 },
  { name: "Sigi's Car", passenger_seats: 4 },
  { name: 'Veryca', passenger_seats: 1 },
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
