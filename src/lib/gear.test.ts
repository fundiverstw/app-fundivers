import { describe, it, expect } from 'vitest'
import {
  suggestsGearIncluded, packsAGearSet, gearPackList, gearSlot, gearAlternatives,
  defaultRentalItems, needsRental, toggleGearSelection, FULL_GEAR_SET, GEAR_ITEMS,
  GEAR_ALACARTE_PRICES, HAS_GEAR_ALTERNATIVES, RENTAL_GEAR_ITEMS,
  HAS_RENTAL_GEAR_ALTERNATIVES, HAS_OWNED_ONLY_GEAR,
  gearOwnGroups, gearBaseLabel, gearStyleLabel, ownedInSlot,
} from './gear'
import type { Booking } from '../types/database'

const bookingWith = (gear: unknown): Booking =>
  ({ details: { gear } } as unknown as Booking)

const RUBBER = 'Boots (rubber sole)'
const FELT   = 'Boots (felt sole)'

describe('gearPackList', () => {
  it('packs nothing for a diver on their own gear', () => {
    expect(gearPackList(bookingWith({ rent: false }))).toEqual({ summary: 'Own gear', items: [] })
    expect(gearPackList(bookingWith(undefined))).toEqual({ summary: 'Own gear', items: [] })
  })

  it('packs a full set for course-included gear', () => {
    const out = gearPackList(bookingWith({ rent: false, included: true }))
    expect(out.summary).toBe('Included with course')
    expect(out.items).toContain('BCD')
    expect(out.items).toContain('Dive computer')
  })

  it('packs the boot style the shop rents for course-included gear, not both', () => {
    const out = gearPackList(bookingWith({ rent: false, included: true }))
    expect(out.items).toContain(FELT)
    expect(out.items).not.toContain(RUBBER)
  })

  it('surfaces the assistance note and packs nothing yet', () => {
    const out = gearPackList(bookingWith({ rent: false, assistance_note: 'unsure on fins' }))
    expect(out).toEqual({ summary: 'Needs help', items: [], note: 'unsure on fins' })
  })

  it('packs exactly the à-la-carte items', () => {
    const out = gearPackList(bookingWith({ rent: true, items: ['BCD', 'Fins'] }))
    expect(out.summary).toBe('À-la-carte (2)')
    expect(out.items).toEqual(['BCD', 'Fins'])
  })
})

describe('packsAGearSet', () => {
  // The flag alone cannot tell a Discover Scuba (a set is bundled and has to
  // fit somebody) from a hike whose fee "includes gear" because there is none.
  it('packs a set for a gear-included event that goes in the water', () => {
    expect(packsAGearSet({ gear_included: true, type: 'course' })).toBe(true)
    expect(packsAGearSet({ gear_included: true, type: 'dive' })).toBe(true)
  })

  it('packs nothing for a gear-included outing that never gets wet', () => {
    expect(packsAGearSet({ gear_included: true, type: 'adventure' })).toBe(false)
  })

  it('packs nothing when gear is rented a-la-carte — the selection decides', () => {
    expect(packsAGearSet({ gear_included: false, type: 'course' })).toBe(false)
    expect(packsAGearSet({ gear_included: false, type: 'adventure' })).toBe(false)
  })
})

describe('suggestsGearIncluded', () => {
  it('suggests gear-included for Open Water courses', () => {
    expect(suggestsGearIncluded('course', 'Open Water Course')).toBe(true)
    expect(suggestsGearIncluded('course', 'PADI Open Water Course')).toBe(true)
    expect(suggestsGearIncluded('course', 'open water')).toBe(true)
  })

  it('suggests gear-included for Discover Scuba / DSD / Try Dive', () => {
    expect(suggestsGearIncluded('course', 'Discover Scuba Diving')).toBe(true)
    expect(suggestsGearIncluded('course', 'DSD')).toBe(true)
    expect(suggestsGearIncluded('course', 'Try Dive')).toBe(true)
  })

  it('suggests gear-included for EFR (a dry first-aid course)', () => {
    expect(suggestsGearIncluded('course', 'EFR Course')).toBe(true)
    expect(suggestsGearIncluded('course', 'Emergency First Response')).toBe(true)
  })

  // Not a dive and not a course: nothing goes in the water, so there is no
  // gear question worth putting whatever it is called.
  it('suggests gear-included for every non-diving kind', () => {
    expect(suggestsGearIncluded('adventure', 'Yangmingshan Hike')).toBe(true)
    expect(suggestsGearIncluded('adventure', null)).toBe(true)
  })

  it('does NOT suggest it for Advanced Open Water', () => {
    expect(suggestsGearIncluded('course', 'Advanced Open Water')).toBe(false)
    expect(suggestsGearIncluded('course', 'PADI Advanced Open Water Course')).toBe(false)
  })

  it('does NOT suggest it for other continuing-ed courses', () => {
    expect(suggestsGearIncluded('course', 'EANx / Nitrox Course')).toBe(false)
    expect(suggestsGearIncluded('course', 'Deep Specialty')).toBe(false)
    expect(suggestsGearIncluded('course', 'PADI Rescue Course')).toBe(false)
    expect(suggestsGearIncluded('course', 'Equipment Course')).toBe(false)
  })

  // A fun dive rents a-la-carte however it is titled — a shop that runs a
  // "Discover Scuba" dive rather than a course still charges for the set.
  it('does NOT suggest it for dives, whatever they are called', () => {
    expect(suggestsGearIncluded('dive', 'Open Water Fun Dive')).toBe(false)
    expect(suggestsGearIncluded('dive', 'Try Dive at Longdong')).toBe(false)
  })

  it('handles null / empty course titles', () => {
    expect(suggestsGearIncluded('course', null)).toBe(false)
    expect(suggestsGearIncluded('course', undefined)).toBe(false)
    expect(suggestsGearIncluded('course', '')).toBe(false)
  })
})

describe('the shipped catalog', () => {
  it('lets a diver say they own either boot style', () => {
    expect(GEAR_ITEMS).toContain(RUBBER)
    expect(GEAR_ITEMS).toContain(FELT)
  })

  it('rents felt soles only', () => {
    expect(RENTAL_GEAR_ITEMS).toContain(FELT)
    expect(RENTAL_GEAR_ITEMS).not.toContain(RUBBER)
  })

  it('prices every item it rents, and rents every item it prices', () => {
    for (const item of RENTAL_GEAR_ITEMS) {
      expect(GEAR_ALACARTE_PRICES[item], `${item} has no price`).toBeTypeOf('number')
    }
    for (const priced of Object.keys(GEAR_ALACARTE_PRICES)) {
      expect(RENTAL_GEAR_ITEMS, `${priced} is priced but never offered`).toContain(priced)
    }
  })

  it('rents everything else in the catalog', () => {
    for (const item of GEAR_ITEMS) {
      if (item === RUBBER) continue
      expect(RENTAL_GEAR_ITEMS, `${item} is not rentable`).toContain(item)
    }
  })

  it('shows the profile styles hint but not the rental one', () => {
    expect(HAS_GEAR_ALTERNATIVES).toBe(true)
    expect(HAS_RENTAL_GEAR_ALTERNATIVES).toBe(false)
    expect(HAS_OWNED_ONLY_GEAR).toBe(true)
  })
})

describe('gearSlot', () => {
  it('reads the two boot styles as one slot on the diver', () => {
    expect(gearSlot(RUBBER)).toBe('boots')
    expect(gearSlot(FELT)).toBe('boots')
  })

  it('leaves an unqualified item as its own slot', () => {
    expect(gearSlot('BCD')).toBe('bcd')
    expect(gearSlot('Dive computer')).toBe('dive computer')
  })

  it('only strips a trailing qualifier, not a parenthesis mid-name', () => {
    expect(gearSlot('Mask (low volume)')).toBe('mask')
    expect(gearSlot('Wetsuit (5mm) hooded')).toBe('wetsuit (5mm) hooded')
  })

  it('keeps distinct items distinct', () => {
    expect(gearSlot('Fins')).not.toBe(gearSlot('Mask'))
  })
})

describe('gearAlternatives', () => {
  it('pairs the two boot styles with each other', () => {
    expect(gearAlternatives(RUBBER)).toEqual([FELT])
    expect(gearAlternatives(FELT)).toEqual([RUBBER])
  })

  it('finds none for an item the shop offers in one style', () => {
    expect(gearAlternatives('BCD')).toEqual([])
    expect(gearAlternatives('Regulator')).toEqual([])
  })

  it('never lists the item itself', () => {
    for (const item of GEAR_ITEMS) {
      expect(gearAlternatives(item)).not.toContain(item)
    }
  })

  it('finds no rentable alternative to felt soles, since rubber is owned-only', () => {
    expect(gearAlternatives(FELT, RENTAL_GEAR_ITEMS)).toEqual([])
  })
})

describe('gearOwnGroups', () => {
  it('folds the boot styles into one row with both styles to choose from', () => {
    const boots = gearOwnGroups().find(g => g.label === 'Boots')
    expect(boots).toEqual({ items: [RUBBER, FELT], label: 'Boots', styles: ['rubber sole', 'felt sole'] })
  })

  it('leaves a single-style item as its own row, styles empty', () => {
    const bcd = gearOwnGroups().find(g => g.label === 'BCD')
    expect(bcd).toEqual({ items: ['BCD'], label: 'BCD', styles: [] })
  })

  it('covers the whole catalog exactly once, in catalog order', () => {
    expect(gearOwnGroups().flatMap(g => g.items)).toEqual(GEAR_ITEMS)
  })

  it('keeps a lone qualified item spelled out rather than shortening it', () => {
    expect(gearOwnGroups(['Mask (low volume)'])).toEqual([
      { items: ['Mask (low volume)'], label: 'Mask (low volume)', styles: [] },
    ])
  })

  it('reads an unqualified entry as a style of its own name', () => {
    const groups = gearOwnGroups(['Boots', 'Boots (felt sole)'])
    expect(groups).toEqual([
      { items: ['Boots', 'Boots (felt sole)'], label: 'Boots', styles: ['Boots', 'felt sole'] },
    ])
  })
})

describe('gearBaseLabel / gearStyleLabel', () => {
  it('splits a styled item into the name a checkbox reads and the style beside it', () => {
    expect(gearBaseLabel(FELT)).toBe('Boots')
    expect(gearStyleLabel(FELT)).toBe('felt sole')
  })

  it('leaves an unstyled item whole', () => {
    expect(gearBaseLabel('Dive computer')).toBe('Dive computer')
    expect(gearStyleLabel('Dive computer')).toBeNull()
  })

  it('keeps the catalog\'s own casing, unlike the slot key', () => {
    expect(gearBaseLabel(RUBBER)).toBe('Boots')
    expect(gearSlot(RUBBER)).toBe('boots')
  })
})

describe('ownedInSlot', () => {
  it('lists what the diver owns in a slot, in catalog order', () => {
    expect(ownedInSlot([FELT, 'BCD', RUBBER], [RUBBER, FELT])).toEqual([RUBBER, FELT])
    expect(ownedInSlot(['BCD'], [RUBBER, FELT])).toEqual([])
  })
})

describe('needsRental', () => {
  it('is true for a diver whose profile lists nothing', () => {
    expect(needsRental([])).toBe(true)
    expect(needsRental(null)).toBe(true)
  })

  it('is false once the diver owns every slot the shop rents', () => {
    expect(needsRental(defaultRentalItems([]))).toBe(false)
  })

  it('stays true while any one slot is still missing', () => {
    const allButFins = defaultRentalItems([]).filter(i => gearSlot(i) !== 'fins')
    expect(needsRental(allButFins)).toBe(true)
  })

  it('counts an owned-only style as covering its slot', () => {
    expect(needsRental(defaultRentalItems([]).map(i => i === FELT ? RUBBER : i))).toBe(false)
  })
})

describe('defaultRentalItems', () => {
  it('ticks the boot style the shop rents for a diver who owns nothing', () => {
    const items = defaultRentalItems([])
    expect(items.filter(i => gearSlot(i) === 'boots')).toEqual([FELT])
  })

  it('never offers an owned-only item, whoever the diver is', () => {
    expect(defaultRentalItems([])).not.toContain(RUBBER)
    expect(defaultRentalItems([FELT])).not.toContain(RUBBER)
    expect(defaultRentalItems(['BCD', 'Mask'])).not.toContain(RUBBER)
  })

  it('still ticks everything else the diver does not own', () => {
    const items = defaultRentalItems([])
    expect(items).toContain('BCD')
    expect(items).toContain('Regulator')
    expect(items).toContain('Dive computer')
  })

  it('drops the boots slot entirely for a diver who owns felt-soled ones', () => {
    const items = defaultRentalItems([FELT])
    expect(items.some(i => gearSlot(i) === 'boots')).toBe(false)
    expect(items).toContain('BCD')
  })

  it('drops it for a diver who owns rubber-soled ones too', () => {
    expect(defaultRentalItems([RUBBER]).some(i => gearSlot(i) === 'boots')).toBe(false)
  })

  it('still lets that diver rent felt ones by hand, for a slippery entry', () => {
    expect(RENTAL_GEAR_ITEMS).toContain(FELT)
    expect(toggleGearSelection(defaultRentalItems([RUBBER]), FELT)).toContain(FELT)
  })

  it('excludes every other item the diver owns, by exact name', () => {
    const items = defaultRentalItems(['BCD', 'Mask'])
    expect(items).not.toContain('BCD')
    expect(items).not.toContain('Mask')
    expect(items).toContain('Fins')
  })

  it('ignores owned gear the catalog no longer lists', () => {
    const items = defaultRentalItems(['Rebreather'])
    expect(items).toEqual(defaultRentalItems([]))
  })

  it('handles a null / undefined profile field', () => {
    expect(defaultRentalItems(null)).toEqual(defaultRentalItems([]))
    expect(defaultRentalItems(undefined)).toEqual(defaultRentalItems([]))
  })

  it('is what FULL_GEAR_SET is: one of every slot the shop rents', () => {
    expect(FULL_GEAR_SET).toEqual(defaultRentalItems([]))
    expect(FULL_GEAR_SET).toEqual(RENTAL_GEAR_ITEMS)
    expect(FULL_GEAR_SET.length).toBe(GEAR_ITEMS.length - 1)
  })
})

describe('toggleGearSelection', () => {
  it('adds an item that is not selected', () => {
    expect(toggleGearSelection(['BCD'], 'Mask')).toEqual(['BCD', 'Mask'])
  })

  it('removes an item that is selected', () => {
    expect(toggleGearSelection(['BCD', 'Mask'], 'BCD')).toEqual(['Mask'])
  })

  it('swaps boot styles rather than stacking them', () => {
    expect(toggleGearSelection(['BCD', RUBBER], FELT)).toEqual(['BCD', FELT])
    expect(toggleGearSelection(['BCD', FELT], RUBBER)).toEqual(['BCD', RUBBER])
  })

  it('clears a style the shop no longer rents, which no box can untick', () => {
    expect(RENTAL_GEAR_ITEMS).not.toContain(RUBBER)
    expect(toggleGearSelection(['Regulator', RUBBER], FELT)).toEqual(['Regulator', FELT])
  })

  it('leaves the diver with no boots when they untick the one they had', () => {
    expect(toggleGearSelection([RUBBER], RUBBER)).toEqual([])
  })

  it('does not disturb unrelated items when swapping styles', () => {
    const out = toggleGearSelection(['Regulator', RUBBER, 'Mask'], FELT)
    expect(out).toContain('Regulator')
    expect(out).toContain('Mask')
    expect(out.filter(i => gearSlot(i) === 'boots')).toEqual([FELT])
  })

  it('is a no-op on the second toggle back', () => {
    const once = toggleGearSelection(['BCD'], FELT)
    expect(toggleGearSelection(once, FELT)).toEqual(['BCD'])
  })
})
