// package-estimate: the cost-estimate math for partner packages. Add-ons are
// charged per day, the room per night, over the diver's preferred range. Also
// asserts the client copy stays in sync with the authoritative server copy in
// supabase/functions/_shared/package-estimate.ts (the two are intentionally
// duplicated because the Vite bundle and Deno can't share a module cleanly).
import { describe, it, expect } from 'vitest'
import { rangeDaysNights, buildPackageCharges, estimateTotal } from './package-estimate'
import * as server from '../../supabase/functions/_shared/package-estimate'

describe('rangeDaysNights', () => {
  it('derives nights = span and days = nights + 1', () => {
    expect(rangeDaysNights('2026-08-01', '2026-08-05')).toEqual({ days: 5, nights: 4 })
  })
  it('a same-day range is 1 day / 0 nights', () => {
    expect(rangeDaysNights('2026-08-01', '2026-08-01')).toEqual({ days: 1, nights: 0 })
  })
  it('an absent or reversed range yields 0 / 0', () => {
    expect(rangeDaysNights('', '2026-08-05')).toEqual({ days: 0, nights: 0 })
    expect(rangeDaysNights('2026-08-05', '2026-08-01')).toEqual({ days: 0, nights: 0 })
    expect(rangeDaysNights(null, null)).toEqual({ days: 0, nights: 0 })
  })
})

describe('buildPackageCharges', () => {
  const input = {
    tierName: 'Package A', tierPrice: 10000,
    addons: [{ label: 'Nitrox', price: 500 }, { label: 'Camera', price: 800 }],
    room: { label: 'Deluxe', price: 1200 },
    days: 5, nights: 4,
  }

  it('multiplies add-ons by days and the room by nights', () => {
    const lines = buildPackageCharges(input)
    expect(lines).toEqual([
      { kind: 'base', label: 'Package: Package A', amount: 10000 },
      { kind: 'addon', label: 'Add-on: Nitrox (x5 days)', amount: 2500 },
      { kind: 'addon', label: 'Add-on: Camera (x5 days)', amount: 4000 },
      { kind: 'room', label: 'Room: Deluxe (x4 nights)', amount: 4800 },
    ])
    expect(estimateTotal(lines)).toBe(21300)
  })

  it('drops zero-amount lines (e.g. add-ons before a range is picked)', () => {
    const lines = buildPackageCharges({ ...input, days: 0, nights: 0 })
    expect(lines).toEqual([{ kind: 'base', label: 'Package: Package A', amount: 10000 }])
  })

  it('omits the day/night suffix for a single day/night', () => {
    const lines = buildPackageCharges({
      tierName: 'A', tierPrice: 100, addons: [{ label: 'Nitrox', price: 50 }],
      room: { label: 'Std', price: 30 }, days: 1, nights: 0,
    })
    expect(lines).toEqual([
      { kind: 'base', label: 'Package: A', amount: 100 },
      { kind: 'addon', label: 'Add-on: Nitrox', amount: 50 },
      // 0 nights → room line dropped
    ])
  })
})

describe('client/server parity', () => {
  const cases = [
    { tierName: 'A', tierPrice: 10000, addons: [{ label: 'Nitrox', price: 500 }], room: { label: 'Deluxe', price: 1200 }, days: 5, nights: 4 },
    { tierName: 'B', tierPrice: 0, addons: [], room: null, days: 0, nights: 0 },
    { tierName: 'C', tierPrice: 7, addons: [{ label: 'X', price: 3 }], room: { label: 'R', price: 9 }, days: 1, nights: 0 },
  ]
  it('buildPackageCharges matches the server copy', () => {
    for (const c of cases) {
      expect(buildPackageCharges(c)).toEqual(server.buildPackageCharges(c))
    }
  })
  it('rangeDaysNights matches the server copy', () => {
    for (const [s, e] of [['2026-08-01', '2026-08-05'], ['2026-08-01', '2026-08-01'], ['', '']] as const) {
      expect(rangeDaysNights(s, e)).toEqual(server.rangeDaysNights(s, e))
    }
  })
})
