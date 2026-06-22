import { describe, it, expect } from 'vitest'
import { splitByTransport, gearTotals, dayKeyOffset, careItemsForBooking, careTotals, isCareGearItem, addonTotals } from './logistics'
import type { Booking, Profile } from '../types/database'

const row = (transportation: boolean | undefined, items: string[] = []) => ({
  booking: { details: { transportation, gear: { rent: true, items } } } as unknown as Booking,
})

const careRow = (id: string, name: string, gearItems: string[], addOns: string[] = []) => ({
  booking: { id, details: { gear: { rent: true, items: gearItems }, add_ons: addOns } } as unknown as Booking,
  profile: { name } as unknown as Profile,
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

describe('gearTotals — care items still counted here (callers filter for display)', () => {
  it('includes Dive computer in the raw totals; isCareGearItem flags it for removal', () => {
    const totals = gearTotals([row(true, ['BCD', 'Dive computer'])])
    expect(totals).toEqual([{ item: 'BCD', count: 1 }, { item: 'Dive computer', count: 1 }])
    expect(totals.filter(t => !isCareGearItem(t.item))).toEqual([{ item: 'BCD', count: 1 }])
  })
})

describe('careItemsForBooking', () => {
  const titles = new Map([
    ['light2', 'Light Rental (2 Days)'],
    ['cam1', 'Camera Rental (1 Dive)'],
    ['smb', 'SMB Rental'],
  ])

  it('picks up a rented dive computer (gear) and lights/cameras (add-ons by title)', () => {
    const b = { details: { gear: { rent: true, items: ['Dive computer', 'BCD'] }, add_ons: ['light2', 'cam1'] } } as unknown as Booking
    expect(careItemsForBooking(b, titles).sort()).toEqual(['Camera', 'Dive computer', 'Dive light'])
  })

  it('ignores dive-bag add-ons like SMB and plain gear', () => {
    const b = { details: { gear: { rent: true, items: ['BCD', 'Fins'] }, add_ons: ['smb'] } } as unknown as Booking
    expect(careItemsForBooking(b, titles)).toEqual([])
  })

  it('dedupes duration variants of the same care add-on to one label', () => {
    const dupTitles = new Map([['l1', 'Light Rental (1 Day)'], ['l2', 'Light Rental (2 Days)']])
    const b = { details: { gear: { rent: false }, add_ons: ['l1', 'l2'] } } as unknown as Booking
    expect(careItemsForBooking(b, dupTitles)).toEqual(['Dive light'])
  })
})

describe('careTotals', () => {
  it('lists divers per care item in CARE_ITEMS order, omitting items nobody rented', () => {
    const titles = new Map([['light1', 'Light Rental (1 Day)']])
    const rows = [
      careRow('b1', 'Ada', ['Dive computer'], []),
      careRow('b2', 'Bo', [], ['light1']),
      careRow('b3', 'Cy', ['Dive computer'], ['light1']),
    ]
    expect(careTotals(rows, titles)).toEqual([
      { item: 'Dive computer', divers: [{ bookingId: 'b1', name: 'Ada' }, { bookingId: 'b3', name: 'Cy' }] },
      { item: 'Dive light',    divers: [{ bookingId: 'b2', name: 'Bo' }, { bookingId: 'b3', name: 'Cy' }] },
    ])
  })
})

describe('addonTotals', () => {
  const titles = new Map([
    ['smb', 'SMB Rental'],
    ['nx', '2 Nitrox Tanks'],
    ['light', 'Light Rental (1 Day)'],
  ])
  const addonRow = (ids: string[]) => ({ booking: { details: { add_ons: ids } } as unknown as Booking })

  it('counts every add-on by catalog title, alphabetically, including delicate ones', () => {
    const rows = [addonRow(['smb', 'nx']), addonRow(['smb', 'light']), addonRow([])]
    expect(addonTotals(rows, titles)).toEqual([
      { title: '2 Nitrox Tanks', count: 1 },
      { title: 'Light Rental (1 Day)', count: 1 },
      { title: 'SMB Rental', count: 2 },
    ])
  })

  it('skips add-on ids with no resolved title and returns [] when there are none', () => {
    expect(addonTotals([addonRow(['unknown-id'])], titles)).toEqual([])
    expect(addonTotals([addonRow([])], titles)).toEqual([])
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
