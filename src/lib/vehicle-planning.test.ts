import { describe, it, expect } from 'vitest'
import { planFleet } from './vehicle-planning'

const FLEET = [
  { name: 'Delica', passenger_seats: 7 },
  { name: "Sigi's Car", passenger_seats: 4 },
  { name: 'Veryca', passenger_seats: 1 },
]

describe('planFleet', () => {
  it('seats divers plus the non-driving staff, one staff driving each car', () => {
    // 5 divers + 3 staff. One staff drives, so 5 + 2 = 7 passengers need a seat.
    const p = planFleet(5, 3, FLEET)
    expect(p.used.map(v => v.name)).toEqual(['Delica'])
    expect(p.driversNeeded).toBe(1)
    expect(p.ridingStaff).toBe(2)
    expect(p.passengers).toBe(7)
    expect(p.seats).toBe(7)
    expect(p.fits).toBe(true)
    expect(p.reason).toBeNull()
  })

  it('adds the next-largest vehicle when one is not enough', () => {
    // 10 divers + 2 staff. Both staff drive (2 cars), so 10 passengers need a
    // seat. Delica (7) alone is short; add Sigi's Car (4) → 11 seats.
    const p = planFleet(10, 2, FLEET)
    expect(p.used.map(v => v.name)).toEqual(['Delica', "Sigi's Car"])
    expect(p.driversNeeded).toBe(2)
    expect(p.ridingStaff).toBe(0)
    expect(p.passengers).toBe(10)
    expect(p.seats).toBe(11)
    expect(p.fits).toBe(true)
  })

  it('flags no-drivers when there are riders but zero on-duty staff', () => {
    const p = planFleet(10, 0, FLEET)
    expect(p.fits).toBe(false)
    expect(p.driversNeeded).toBe(0)
    expect(p.reason).toBe('no-drivers')
    expect(p.shortfall).toBe(10)
  })

  it('flags driver-limited when staff (not vehicles) run out first', () => {
    // 10 divers + 1 staff: only one driver, so only one car — 7 seats for 10.
    // Vehicles sit spare, so adding a van won't help; you need more staff.
    const p = planFleet(10, 1, FLEET)
    expect(p.used.map(v => v.name)).toEqual(['Delica'])
    expect(p.driversNeeded).toBe(1)
    expect(p.passengers).toBe(10)
    expect(p.fits).toBe(false)
    expect(p.shortfall).toBe(3)
    expect(p.reason).toBe('driver-limited')
  })

  it('flags fleet-limited when every vehicle is in play and still short', () => {
    // 20 divers + 3 staff: all 3 cars out (3 drivers), 12 seats, 17 riders.
    const p = planFleet(20, 3, FLEET)
    expect(p.used).toHaveLength(3)
    expect(p.driversNeeded).toBe(3)
    expect(p.ridingStaff).toBe(0)
    expect(p.passengers).toBe(20)
    expect(p.seats).toBe(12)
    expect(p.fits).toBe(false)
    expect(p.shortfall).toBe(8)
    expect(p.reason).toBe('fleet-limited')
  })

  it('needs no vehicles when nobody needs a ride and no staff are on duty', () => {
    const p = planFleet(0, 0, FLEET)
    expect(p.used).toEqual([])
    expect(p.fits).toBe(true)
    expect(p.driversNeeded).toBe(0)
    expect(p.reason).toBeNull()
  })

  it('reports no-drivers shortfall when the fleet is empty too', () => {
    const p = planFleet(4, 0, [])
    expect(p.fits).toBe(false)
    expect(p.seats).toBe(0)
    expect(p.shortfall).toBe(4)
    expect(p.reason).toBe('no-drivers')
  })

  it('does not mutate the input fleet order', () => {
    const fleet = [...FLEET]
    planFleet(3, 2, fleet)
    expect(fleet.map(v => v.name)).toEqual(['Delica', "Sigi's Car", 'Veryca'])
  })
})
