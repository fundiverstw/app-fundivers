import { describe, it, expect } from 'vitest'
import { splitByTransport, gearTotals, dayKeyOffset } from './logistics'
import type { Booking } from '../types/database'

const row = (transportation: boolean | undefined, items: string[] = []) => ({
  booking: { details: { transportation, gear: { rent: true, items } } } as unknown as Booking,
})

describe('splitByTransport', () => {
  it('buckets rows by the transportation choice', () => {
    const rows = [row(true), row(false), row(undefined), row(true)]
    const out = splitByTransport(rows)
    expect(out.needsRide).toHaveLength(2)
    expect(out.selfTransport).toHaveLength(1)
    expect(out.unspecified).toHaveLength(1)
  })
})

describe('gearTotals', () => {
  it('counts pieces to pack across bookings, ordered by GEAR_ITEMS, omitting zeros', () => {
    const rows = [
      row(true, ['BCD', 'Fins']),
      row(false, ['BCD', 'Wetsuit']),
      row(true, []),
    ]
    expect(gearTotals(rows)).toEqual([
      { item: 'BCD', count: 2 },
      { item: 'Wetsuit', count: 1 },
      { item: 'Fins', count: 1 },
    ])
  })

  it('returns an empty list when nobody rents gear', () => {
    expect(gearTotals([row(true, [])])).toEqual([])
  })
})

describe('dayKeyOffset', () => {
  it('shifts a day key by n calendar days', () => {
    expect(dayKeyOffset('2026-06-18', 0)).toBe('2026-06-18')
    expect(dayKeyOffset('2026-06-18', 1)).toBe('2026-06-19')
    expect(dayKeyOffset('2026-06-18', 2)).toBe('2026-06-20')
  })

  it('rolls over month boundaries', () => {
    expect(dayKeyOffset('2026-06-30', 2)).toBe('2026-07-02')
  })
})
