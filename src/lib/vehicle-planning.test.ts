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
  it('seats divers plus non-driving staff, one staff driving each car', () => {
    // 5 divers + 3 staff. One drives, so 5 + 2 = 7 passengers — Delica (7) fits.
    const p = planFleet(FLEET, d(5), s(3))
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica'])
    expect(p.driversNeeded).toBe(1)
    expect(p.driversShort).toBe(0)
    expect(p.riders).toBe(8)
    expect(p.seats).toBe(7)
    expect(p.fits).toBe(true)
    expect(p.cars[0].driver?.name).toBe('S1')
    // Non-driving staff ride ahead of divers.
    expect(p.cars[0].passengers.map(r => r.name))
      .toEqual(['S2', 'S3', 'D1', 'D2', 'D3', 'D4', 'D5'])
    expect(p.unseated).toEqual([])
  })

  it('adds the next-largest vehicle when one is not enough', () => {
    // 10 divers + 2 staff. Both drive, 10 passengers; Delica (7) + Sigi (4).
    const p = planFleet(FLEET, d(10), s(2))
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.driversNeeded).toBe(2)
    expect(p.driversShort).toBe(0)
    expect(p.cars[0].driver?.name).toBe('S1')
    expect(p.cars[1].driver?.name).toBe('S2')
    expect(p.cars[0].passengers).toHaveLength(7)
    expect(p.cars[1].passengers).toHaveLength(3)
    expect(p.fits).toBe(true)
  })

  it('buckets riders into vehicles even when no staff can drive', () => {
    // 10 divers, 0 staff. Vehicles still hold them — each just needs a driver.
    const p = planFleet(FLEET, d(10), [])
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.cars.every(c => c.driver === null)).toBe(true)
    expect(p.driversShort).toBe(2)
    expect(p.cars[0].passengers).toHaveLength(7)
    expect(p.cars[1].passengers).toHaveLength(3)
    expect(p.fits).toBe(true)
    expect(p.unseated).toEqual([])
  })

  it('flags one car needing a driver when staff run short', () => {
    // 10 divers + 1 staff. Two cars hold everyone; the second has no driver.
    const p = planFleet(FLEET, d(10), s(1))
    expect(p.cars.map(c => c.vehicle.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.cars[0].driver?.name).toBe('S1')
    expect(p.cars[1].driver).toBeNull()
    expect(p.driversShort).toBe(1)
    expect(p.fits).toBe(true)
  })

  it('leaves riders unseated only when the whole fleet is too small', () => {
    // 20 divers + 3 staff: all 3 cars out, 12 seats, 20 divers → 8 ride-less.
    const p = planFleet(FLEET, d(20), s(3))
    expect(p.cars).toHaveLength(3)
    expect(p.seats).toBe(12)
    expect(p.fits).toBe(false)
    expect(p.shortfall).toBe(8)
    expect(p.unseated.map(r => r.name)).toEqual(
      ['D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20'],
    )
  })

  it('takes no vehicles when nobody travels', () => {
    const p = planFleet(FLEET, [], [])
    expect(p.cars).toEqual([])
    expect(p.fits).toBe(true)
    expect(p.driversNeeded).toBe(0)
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
