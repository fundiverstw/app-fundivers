import { describe, it, expect } from 'vitest'
import { guestPieces, packProgress, piecesByItem, type PackGuest } from './pack-list'
import { gearPieceKey } from './gear-packed'
import type { Booking, Profile } from '../types/database'

function row(id: string, details: Record<string, unknown>, profile: Partial<Profile> | null = {}) {
  return {
    booking: { id, details } as unknown as Booking,
    profile: profile ? ({ id: `u-${id}`, name: `Diver ${id}`, gear_owned: [], ...profile } as unknown as Profile) : null,
  }
}

const rent = (items: string[], add_ons: string[] = []) => ({ gear: { rent: true, items }, add_ons })
const addons = new Map([
  ['a-light', 'Light Rental (2 Days)'],
  ['a-cam', 'Camera Rental (1 Dive)'],
  ['a-smb', 'SMB Rental'],
])

describe('guestPieces', () => {
  it('lists every rented piece against the guest, with the size to pull', () => {
    const pieces = guestPieces(row('b1', rent(['BCD', 'Regulator']), { bcd_size: 'M' }), addons)
    expect(pieces).toEqual([
      { key: gearPieceKey('b1', 'BCD'), item: 'BCD', kind: 'gear', size: 'M', sizeMissing: false, owned: false },
      { key: gearPieceKey('b1', 'Regulator'), item: 'Regulator', kind: 'gear', size: null, sizeMissing: false, owned: false },
    ])
  })

  it('flags a sized piece with no size on file, but never a one-size one', () => {
    const pieces = guestPieces(row('b1', rent(['Wetsuit', 'Mask'])), addons)
    expect(pieces.map(p => [p.item, p.sizeMissing])).toEqual([['Wetsuit', true], ['Mask', false]])
  })

  it('puts delicate kit after the dive bag, whether rented as gear or as an add-on', () => {
    const pieces = guestPieces(row('b1', rent(['Dive computer', 'Fins'], ['a-light', 'a-cam'])), addons)
    expect(pieces.map(p => [p.item, p.kind])).toEqual([
      ['Fins', 'gear'],
      ['Dive computer', 'care'],
      ['Dive light', 'care'],
      ['Camera', 'care'],
    ])
  })

  it('keeps the key a care add-on has always been ticked under', () => {
    const [light] = guestPieces(row('b1', rent([], ['a-light'])), addons)
    expect(light.key).toBe(gearPieceKey('b1', 'Dive light'))
  })

  it('lists the other add-ons by catalog title, and skips ones it cannot name', () => {
    const pieces = guestPieces(row('b1', rent([], ['a-smb', 'a-gone'])), addons)
    expect(pieces.map(p => [p.item, p.kind])).toEqual([['SMB Rental', 'extra']])
  })

  it('lists a rented item once even when two add-ons rent it', () => {
    const pieces = guestPieces(row('b1', rent([], ['a-light', 'a-light'])), addons)
    expect(pieces).toHaveLength(1)
  })

  it('marks a piece the diver says they own', () => {
    const [bcd] = guestPieces(row('b1', rent(['BCD']), { gear_owned: ['BCD'] }), addons)
    expect(bcd.owned).toBe(true)
  })

  it('is empty for a guest on their own gear', () => {
    expect(guestPieces(row('b1', {}), addons)).toEqual([])
  })
})

describe('packProgress', () => {
  it('counts the ticked pieces out of the total', () => {
    const pieces = guestPieces(row('b1', rent(['BCD', 'Fins', 'Mask'])), addons)
    expect(packProgress(pieces, new Set([gearPieceKey('b1', 'Fins')]))).toEqual({ packed: 1, total: 3 })
  })

  it('ignores ticks that belong to someone else', () => {
    const pieces = guestPieces(row('b1', rent(['BCD'])), addons)
    expect(packProgress(pieces, new Set([gearPieceKey('b2', 'BCD')]))).toEqual({ packed: 0, total: 1 })
  })
})

describe('piecesByItem', () => {
  function guest(id: string, items: string[], profile: Partial<Profile> = {}, add_ons: string[] = []): PackGuest {
    return { bookingId: id, name: `Diver ${id}`, pieces: guestPieces(row(id, rent(items, add_ons), profile), addons) }
  }

  it('groups the day by item, then by size in rack order, naming whose each piece is', () => {
    const groups = piecesByItem([
      guest('b1', ['BCD'], { bcd_size: 'L' }),
      guest('b2', ['BCD'], { bcd_size: 'S' }),
      guest('b3', ['BCD']),
      guest('b4', ['BCD'], { bcd_size: 'l' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].item).toBe('BCD')
    expect(groups[0].sizes.map(s => [s.size, s.sizeMissing, s.entries.map(e => e.name)])).toEqual([
      ['S', false, ['Diver b2']],
      ['L', false, ['Diver b1', 'Diver b4']],
      [null, true, ['Diver b3']],
    ])
  })

  it('orders dive-bag gear by the catalog, then delicate kit, then add-ons', () => {
    const groups = piecesByItem([
      guest('b1', ['Fins', 'BCD', 'Dive computer'], {}, ['a-smb']),
    ])
    expect(groups.map(g => g.item)).toEqual(['BCD', 'Fins', 'Dive computer', 'SMB Rental'])
  })

  it('gives one-size kit a single unlabelled group', () => {
    const [reg] = piecesByItem([guest('b1', ['Regulator']), guest('b2', ['Regulator'])])
    expect(reg.sizes).toEqual([{ size: null, sizeMissing: false, entries: [
      { key: gearPieceKey('b1', 'Regulator'), bookingId: 'b1', name: 'Diver b1' },
      { key: gearPieceKey('b2', 'Regulator'), bookingId: 'b2', name: 'Diver b2' },
    ] }])
  })
})
