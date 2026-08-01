import { describe, it, expect } from 'vitest'
import { splitByTransport, transportHeadcount, gearTotals, dayKeyOffset, careItemsForBooking, careTotals, isCareGearItem, addonTotals, partitionByWaitlist, gearSizeBreakdown, isSizedGearItem, gearSizeSource, gearDayDiff } from './logistics'
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

  it('so a waitlisted diver never inflates the day\'s gear-to-pack totals', () => {
    // The seat-honest workflow: pack for seated divers, tally waitlist apart.
    const rows = [
      { booking: { id: 'b1', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } } as unknown as Booking },
      { booking: { id: 'b2', status: 'waitlisted', details: { gear: { rent: true, items: ['BCD', 'Wetsuit'] } } } as unknown as Booking },
    ]
    const { seated, waitlisted } = partitionByWaitlist(rows)
    expect(gearTotals(seated)).toEqual([{ item: 'BCD', count: 1 }])
    expect(gearTotals(waitlisted)).toEqual([{ item: 'BCD', count: 1 }, { item: 'Wetsuit', count: 1 }])
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
})

describe('gearSizeBreakdown', () => {
  const sized = (id: string, name: string, items: string[], sizes: Partial<Profile>) => ({
    booking: { id, details: { gear: { rent: true, items } } } as unknown as Booking,
    profile: { name, ...sizes } as unknown as Profile,
  })

  it('groups the divers who need an item by their size, in rack order', () => {
    const rows = [
      sized('b1', 'Ada', ['BCD'], { bcd_size: 'L' }),
      sized('b2', 'Bo',  ['BCD'], { bcd_size: 'M' }),
      sized('b3', 'Cy',  ['BCD'], { bcd_size: 'M' }),
      sized('b4', 'Di',  ['BCD'], { bcd_size: 'S' }),
    ]
    expect(gearSizeBreakdown(rows, 'BCD')).toEqual([
      { size: 'S', divers: [{ bookingId: 'b4', name: 'Di' }] },
      { size: 'M', divers: [{ bookingId: 'b2', name: 'Bo' }, { bookingId: 'b3', name: 'Cy' }] },
      { size: 'L', divers: [{ bookingId: 'b1', name: 'Ada' }] },
    ])
  })

  it('ignores divers who are not renting that item', () => {
    const rows = [
      sized('b1', 'Ada', ['BCD'],     { bcd_size: 'M', wetsuit_size: 'S' }),
      sized('b2', 'Bo',  ['Wetsuit'], { bcd_size: 'L', wetsuit_size: 'M' }),
    ]
    expect(gearSizeBreakdown(rows, 'BCD')).toEqual([
      { size: 'M', divers: [{ bookingId: 'b1', name: 'Ada' }] },
    ])
  })

  it('collects divers with no size on file into a trailing unknown group', () => {
    const rows = [
      sized('b1', 'Ada', ['Wetsuit'], { wetsuit_size: '  ' }),
      sized('b2', 'Bo',  ['Wetsuit'], {}),
      sized('b3', 'Cy',  ['Wetsuit'], { wetsuit_size: 'M' }),
    ]
    expect(gearSizeBreakdown(rows, 'Wetsuit')).toEqual([
      { size: 'M', divers: [{ bookingId: 'b3', name: 'Cy' }] },
      { size: null, divers: [{ bookingId: 'b1', name: 'Ada' }, { bookingId: 'b2', name: 'Bo' }] },
    ])
  })

  it('groups case-insensitively so "m" and "M" are one rack slot', () => {
    const rows = [
      sized('b1', 'Ada', ['BCD'], { bcd_size: 'M' }),
      sized('b2', 'Bo',  ['BCD'], { bcd_size: 'm' }),
    ]
    const groups = gearSizeBreakdown(rows, 'BCD')
    expect(groups).toHaveLength(1)
    expect(groups[0].divers).toHaveLength(2)
  })

  it('sorts numeric sizes by value, not as strings', () => {
    const rows = [
      sized('b1', 'Ada', ['Fins'], { fin_size: '42' }),
      sized('b2', 'Bo',  ['Fins'], { fin_size: '9' }),
      sized('b3', 'Cy',  ['Fins'], { fin_size: '38' }),
    ]
    expect(gearSizeBreakdown(rows, 'Fins').map(g => g.size)).toEqual(['9', '38', '42'])
  })

  it('reads boots off the shoe size, normalised to JP so one pair counts once', () => {
    // Same foot expressed two ways: EU 41 M and JP 26 both convert to JP 26.
    const rows = [
      sized('b1', 'Ada', ['Boots'], { shoe_size: 'EU 41 M' }),
      sized('b2', 'Bo',  ['Boots'], { shoe_size: 'JP 26 M' }),
      sized('b3', 'Cy',  ['Boots'], { shoe_size: null }),
    ]
    const groups = gearSizeBreakdown(rows, 'Boots')
    expect(groups[0]).toEqual({
      size: 'JP 26',
      divers: [{ bookingId: 'b1', name: 'Ada' }, { bookingId: 'b2', name: 'Bo' }],
    })
    expect(groups[1].size).toBeNull()
  })

  it('returns nothing for an item the shop does not size', () => {
    const rows = [sized('b1', 'Ada', ['Regulator'], {})]
    expect(gearSizeBreakdown(rows, 'Regulator')).toEqual([])
  })
})

describe('gearDayDiff', () => {
  const diver = (id: string, name: string, items: string[], sizes: Partial<Profile> = {}) => ({
    booking: { id, details: { gear: { rent: true, items } } } as unknown as Booking,
    profile: { name, ...sizes } as unknown as Profile,
  })
  const lineFor = (diff: ReturnType<typeof gearDayDiff>, item: string, size: string | null) =>
    diff.lines.find(l => l.item === item && l.size === size)!

  it('keeps a size out when both days need it, in the same quantity', () => {
    const today = [diver('b1', 'Ada', ['BCD'], { bcd_size: 'M' })]
    const next  = [diver('b2', 'Bo',  ['BCD'], { bcd_size: 'M' })]
    const diff = gearDayDiff(today, next)
    expect(diff).toMatchObject({ keep: 1, add: 0, free: 0 })
    expect(lineFor(diff, 'BCD', 'M')).toMatchObject({ today: 1, next: 1, keep: 1, add: 0, free: 0 })
  })

  it('matches per size, not per item — a spare M does not cover an XL', () => {
    const today = [
      diver('b1', 'Ada', ['BCD'], { bcd_size: 'M' }),
      diver('b2', 'Bo',  ['BCD'], { bcd_size: 'M' }),
    ]
    const next = [
      diver('b3', 'Cy',  ['BCD'], { bcd_size: 'M' }),
      diver('b4', 'Di',  ['BCD'], { bcd_size: 'XL' }),
    ]
    const diff = gearDayDiff(today, next)
    expect(diff).toMatchObject({ keep: 1, add: 1, free: 1 })
    expect(lineFor(diff, 'BCD', 'M')).toMatchObject({ keep: 1, add: 0, free: 1 })
    expect(lineFor(diff, 'BCD', 'XL')).toMatchObject({ keep: 0, add: 1, free: 0 })
  })

  it('counts one-size items on quantity alone', () => {
    const today = [diver('b1', 'Ada', ['Regulator']), diver('b2', 'Bo', ['Regulator'])]
    const next  = [diver('b3', 'Cy',  ['Regulator'])]
    const diff = gearDayDiff(today, next)
    expect(lineFor(diff, 'Regulator', null)).toMatchObject({ today: 2, next: 1, keep: 1, add: 0, free: 1 })
  })

  it('never reuses a piece whose diver has no size on file, and counts it apart', () => {
    // An unknown size can't be promised to match anything. It is NOT folded
    // into add/free either: one unsized diver puts a line in every sized item
    // they rent, which would swamp the real answer in all three columns.
    const today = [diver('b1', 'Ada', ['Wetsuit'], { wetsuit_size: null })]
    const next  = [diver('b2', 'Bo',  ['Wetsuit'], { wetsuit_size: null })]
    const diff = gearDayDiff(today, next)
    expect(diff).toMatchObject({ keep: 0, add: 0, free: 0, unsized: 1 })
    expect(lineFor(diff, 'Wetsuit', null)).toMatchObject({ unknownSize: true, nextDivers: ['Bo'] })
  })

  it('keeps one unsized diver from drowning out everyone who IS sized', () => {
    // The reported symptom: sized pieces match and vanish into "stays out", so
    // the unsized ones are all that is left visible and the board reads as if
    // no sizes existed at all. They belong in their own bucket.
    const today = [
      diver('b1', 'Ada', ['BCD', 'Wetsuit', 'Fins'], { bcd_size: 'M', wetsuit_size: 'M', fin_size: 'M' }),
      diver('b2', 'Bo',  ['BCD', 'Wetsuit', 'Fins'], {}),
    ]
    const next = [
      diver('b3', 'Cy',  ['BCD', 'Wetsuit', 'Fins'], { bcd_size: 'M', wetsuit_size: 'M', fin_size: 'M' }),
      diver('b4', 'Di',  ['BCD', 'Wetsuit', 'Fins'], {}),
    ]
    const diff = gearDayDiff(today, next)
    // Three matched pieces stay out; nothing extra to pull or return.
    expect(diff).toMatchObject({ keep: 3, add: 0, free: 0, unsized: 3 })
    // The unsized lines are still there to be listed — just not as pack items.
    expect(diff.lines.filter(l => l.unknownSize).map(l => l.item))
      .toEqual(['BCD', 'Wetsuit', 'Fins'])
  })

  it('groups sizes case-insensitively and lists them in rack order', () => {
    const today = [
      diver('b1', 'Ada', ['Wetsuit'], { wetsuit_size: 'l' }),
      diver('b2', 'Bo',  ['Wetsuit'], { wetsuit_size: 'S' }),
      diver('b3', 'Cy',  ['Wetsuit'], { wetsuit_size: 'L' }),
    ]
    const diff = gearDayDiff(today, [])
    expect(diff.lines.map(l => l.size?.toUpperCase())).toEqual(['S', 'L'])
    expect(lineFor(diff, 'Wetsuit', 'S')).toMatchObject({ free: 1 })
    expect(diff.free).toBe(3)
  })

  it('orders items by the canonical gear list and skips ones neither day rents', () => {
    const today = [diver('b1', 'Ada', ['Fins', 'BCD'], { fin_size: 'M', bcd_size: 'M' })]
    const next  = [diver('b2', 'Bo',  ['Regulator'])]
    expect(gearDayDiff(today, next).lines.map(l => l.item)).toEqual(['BCD', 'Regulator', 'Fins'])
  })

  it('is empty when neither day rents anything', () => {
    expect(gearDayDiff([], [])).toEqual({ lines: [], keep: 0, add: 0, free: 0, unsized: 0 })
  })

  it('treats an empty next day as everything coming home', () => {
    const diff = gearDayDiff([diver('b1', 'Ada', ['BCD', 'Regulator'], { bcd_size: 'M' })], [])
    expect(diff).toMatchObject({ keep: 0, add: 0, free: 2, unsized: 0 })
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
