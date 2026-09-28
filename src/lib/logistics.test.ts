import { describe, it, expect } from 'vitest'
import { splitByTransport, transportHeadcount, dayKeyOffset, careLabelForAddon, isCareGearItem, partitionByWaitlist, isSizedGearItem, gearSizeSource, gearSizeFor, compareSizes, needsShoeSize, packedGearTypes } from './logistics'
import type { Booking, Profile } from '../types/database'

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

describe('transportHeadcount', () => {
  // A person, not a booking: someone on two of the day's events is one body.
  const person = (id: string, transportation: boolean | undefined) => ({
    booking: { id: `b-${id}-${String(transportation)}`, details: { transportation } } as unknown as Booking,
    profile: { id } as unknown as Profile,
  })

  it('counts each diver once however many of the day\'s events they are on', () => {
    const out = transportHeadcount([person('p1', true), person('p1', true), person('p2', false)])
    expect(out).toEqual({ needsRide: 1, selfTransport: 1, unspecified: 0 })
  })

  it('takes the most demanding answer when one person\'s bookings disagree', () => {
    // Ride to the morning dive, own car to the afternoon course — the shop
    // still has to seat them.
    expect(transportHeadcount([person('p1', false), person('p1', true)]))
      .toEqual({ needsRide: 1, selfTransport: 0, unspecified: 0 })
    // Unspecified outranks self-transport for the same reason.
    expect(transportHeadcount([person('p2', false), person('p2', undefined)]))
      .toEqual({ needsRide: 0, selfTransport: 0, unspecified: 1 })
  })

  it('keeps profile-less rows apart — they cannot be merged', () => {
    const anon = (id: string) => ({
      booking: { id, details: { transportation: true } } as unknown as Booking,
      profile: null,
    })
    expect(transportHeadcount([anon('b1'), anon('b2')]).needsRide).toBe(2)
  })

  it('is all zeroes for no rows', () => {
    expect(transportHeadcount([])).toEqual({ needsRide: 0, selfTransport: 0, unspecified: 0 })
  })
})

describe('partitionByWaitlist', () => {
  const statusRow = (id: string, status: string) => ({
    booking: { id, status } as unknown as Booking,
  })

  it('splits waitlisted rows out from the seated (pending/confirmed) ones', () => {
    const rows = [
      statusRow('b1', 'confirmed'),
      statusRow('b2', 'waitlisted'),
      statusRow('b3', 'pending'),
      statusRow('b4', 'waitlisted'),
    ]
    const { seated, waitlisted } = partitionByWaitlist(rows)
    expect(seated.map(r => r.booking.id)).toEqual(['b1', 'b3'])
    expect(waitlisted.map(r => r.booking.id)).toEqual(['b2', 'b4'])
  })

  it('treats every non-waitlisted status as seated and preserves order', () => {
    const rows = [statusRow('b1', 'pending'), statusRow('b2', 'confirmed')]
    const { seated, waitlisted } = partitionByWaitlist(rows)
    expect(seated).toHaveLength(2)
    expect(waitlisted).toHaveLength(0)
  })
})

describe('gearSizeSource / isSizedGearItem', () => {
  it('maps the sized items to their profile column and leaves the rest unsized', () => {
    expect(gearSizeSource('BCD')).toBe('bcd')
    expect(gearSizeSource('Wetsuit')).toBe('wetsuit')
    expect(gearSizeSource('Fins')).toBe('fins')
    expect(gearSizeSource('Boots')).toBe('boots')
    expect(gearSizeSource('Regulator')).toBeNull()
    expect(gearSizeSource('Mask')).toBeNull()
    expect(isSizedGearItem('Dive computer')).toBe(false)
  })

  it('resolves a fork\'s relabelled items by substring', () => {
    expect(gearSizeSource('Wetsuit 5mm')).toBe('wetsuit')
    expect(gearSizeSource('Full-foot fin')).toBe('fins')
    expect(gearSizeSource('Dive boot')).toBe('boots')
  })

  it('packs both boot styles by shoe size', () => {
    expect(gearSizeSource('Boots (rubber sole)')).toBe('boots')
    expect(gearSizeSource('Boots (felt sole)')).toBe('boots')
  })
})

describe('needsShoeSize', () => {
  it('asks only when the set holds something worn on a foot', () => {
    expect(needsShoeSize(['Fins'])).toBe(true)
    expect(needsShoeSize(['Boots (felt sole)'])).toBe(true)
    expect(needsShoeSize(['BCD', 'Wetsuit', 'Regulator'])).toBe(false)
    expect(needsShoeSize([])).toBe(false)
  })
})

describe('packedGearTypes', () => {
  it('names the charts the packed items call for, and nothing else', () => {
    expect(packedGearTypes(['BCD', 'Wetsuit', 'Fins'])).toEqual(['wetsuit', 'bcd', 'fins'])
    expect(packedGearTypes(['Regulator', 'Mask', 'Dive computer'])).toEqual([])
    expect(packedGearTypes([])).toEqual([])
  })

  // Boots have no sizing chart of their own — they are packed off the shoe size.
  it('reads a style-qualified item as its type', () => {
    expect(packedGearTypes(['Wetsuit (5mm)'])).toEqual(['wetsuit'])
    expect(packedGearTypes(['Boots (felt sole)'])).toEqual([])
  })

  it('names a type once however many styles of it are packed', () => {
    expect(packedGearTypes(['Wetsuit (3mm)', 'Wetsuit (5mm)'])).toEqual(['wetsuit'])
  })
})

describe('careLabelForAddon / isCareGearItem', () => {
  it('folds every duration of a delicate rental down to one label', () => {
    expect(careLabelForAddon('Light Rental (1 Day)')).toBe('Dive light')
    expect(careLabelForAddon('Light Rental (3 Days)')).toBe('Dive light')
    expect(careLabelForAddon('Camera Rental (2 Dives)')).toBe('Camera')
  })

  it('leaves dive-bag add-ons alone', () => {
    expect(careLabelForAddon('SMB Rental')).toBeNull()
    expect(careLabelForAddon('2 Nitrox Tanks')).toBeNull()
  })

  it('flags a rented dive computer as delicate, and nothing else in the bag', () => {
    expect(isCareGearItem('Dive computer')).toBe(true)
    expect(isCareGearItem('BCD')).toBe(false)
  })
})

describe('gearSizeFor', () => {
  const p = (sizes: Partial<Profile>) => sizes as unknown as Profile

  it('reads each sized item off its own profile column', () => {
    const diver = p({ bcd_size: 'M', wetsuit_size: 'L', fin_size: '42' })
    expect(gearSizeFor(diver, 'BCD')).toBe('M')
    expect(gearSizeFor(diver, 'Wetsuit')).toBe('L')
    expect(gearSizeFor(diver, 'Fins')).toBe('42')
  })

  it('reads boots off the shoe size, normalized to JP so one foot is one size', () => {
    expect(gearSizeFor(p({ shoe_size: 'EU 41 M' }), 'Boots (felt sole)')).toBe('JP 26')
    expect(gearSizeFor(p({ shoe_size: 'JP 26 M' }), 'Boots (felt sole)')).toBe('JP 26')
  })

  it('is null for one-size kit, a blank size, or no profile at all', () => {
    expect(gearSizeFor(p({ bcd_size: 'M' }), 'Regulator')).toBeNull()
    expect(gearSizeFor(p({ wetsuit_size: '  ' }), 'Wetsuit')).toBeNull()
    expect(gearSizeFor(null, 'BCD')).toBeNull()
  })
})

describe('compareSizes', () => {
  it('sorts letter sizes in rack order and numbers by value', () => {
    expect(['L', 'S', 'XL', 'M'].sort(compareSizes)).toEqual(['S', 'M', 'L', 'XL'])
    expect(['42', '9', '38'].sort(compareSizes)).toEqual(['9', '38', '42'])
  })

  it('puts an unrecorded size last, because it is a to-do rather than a rack slot', () => {
    expect(['M', null, 'S'].sort(compareSizes)).toEqual(['S', 'M', null])
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
