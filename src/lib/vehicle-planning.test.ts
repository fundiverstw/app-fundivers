import { describe, it, expect } from 'vitest'
import { planFleet } from './vehicle-planning'

const FLEET = [
  { name: 'Delica', passenger_seats: 7 },
  { name: "Sigi's Car", passenger_seats: 4 },
  { name: 'Veryca', passenger_seats: 1 },
]

describe('planFleet', () => {
  it('packs riders into the fewest, largest vehicles first', () => {
    const p = planFleet(5, FLEET, 3)
    expect(p.used.map(v => v.name)).toEqual(['Delica'])
    expect(p.seats).toBe(7)
    expect(p.fits).toBe(true)
    expect(p.shortfall).toBe(0)
    expect(p.driversNeeded).toBe(1)
    expect(p.enoughDrivers).toBe(true)
  })

  it('adds the next-largest vehicle when one is not enough', () => {
    const p = planFleet(9, FLEET, 3)
    expect(p.used.map(v => v.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.seats).toBe(11)
    expect(p.fits).toBe(true)
    expect(p.driversNeeded).toBe(2)
  })

  it('flags a shortfall when the whole fleet cannot seat everyone', () => {
    const p = planFleet(15, FLEET, 5)
    expect(p.fits).toBe(false)
    expect(p.used).toHaveLength(3)        // every vehicle is in play
    expect(p.seats).toBe(12)
    expect(p.shortfall).toBe(3)
  })

  it('flags too few drivers when vehicles needed exceed on-duty staff', () => {
    const p = planFleet(11, FLEET, 1)     // needs Delica + Sigi's Car = 2 drivers
    expect(p.fits).toBe(true)
    expect(p.driversNeeded).toBe(2)
    expect(p.enoughDrivers).toBe(false)
  })

  it('needs no vehicles when nobody needs a ride', () => {
    const p = planFleet(0, FLEET, 0)
    expect(p.used).toEqual([])
    expect(p.fits).toBe(true)
    expect(p.driversNeeded).toBe(0)
    expect(p.enoughDrivers).toBe(true)
  })

  it('reports the full shortfall when the fleet is empty', () => {
    const p = planFleet(4, [], 2)
    expect(p.fits).toBe(false)
    expect(p.seats).toBe(0)
    expect(p.shortfall).toBe(4)
    expect(p.driversNeeded).toBe(0)
  })

  it('does not mutate the input fleet order', () => {
    const fleet = [...FLEET]
    planFleet(3, fleet, 2)
    expect(fleet.map(v => v.name)).toEqual(['Delica', "Sigi's Car", 'Veryca'])
  })
})
