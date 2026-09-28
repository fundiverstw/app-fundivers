import { GEAR_ITEMS, gearPackList } from './gear'
import { gearPieceKey } from './gear-packed'
import { CARE_ITEMS, careLabelForAddon, compareSizes, gearSizeFor, isCareGearItem, isSizedGearItem } from './logistics'
import type { Booking, BookingDetails, Profile } from '../types/database'

/**
 * The logistics pack list, built one guest at a time. Every physical thing the
 * shop brings for a guest is a piece tied to that guest's booking, so the
 * checklist can never say "BCD ×3" without also saying whose three.
 *
 * Three kinds of piece, in the order a packer meets them:
 *  - `gear`  — the dive bag: whatever the booking rents, with the size to pull.
 *  - `care`  — delicate kit handed out one by one (computers, lights, cameras).
 *  - `extra` — every other add-on the guest bought (SMBs, nitrox tanks, …).
 */

export type PieceKind = 'gear' | 'care' | 'extra'

export interface PackPiece {
  /** The day's tick-list key (`gearPieceKey`), unchanged from the older board
   *  so a list ticked before this layout still reads. */
  key: string
  item: string
  kind: PieceKind
  /** The size to pull; null for one-size kit and for a size nobody recorded. */
  size: string | null
  /** Sized kit with no size on file — nobody can pull it until someone asks. */
  sizeMissing: boolean
  /** The diver's profile says they own one. */
  owned: boolean
}

type DiverRow = { booking: Booking; profile: Profile | null }

/** Everything the shop brings for one booking, as tickable pieces. */
export function guestPieces(row: DiverRow, addonTitleById: Map<string, string>): PackPiece[] {
  const { booking, profile } = row
  const owned = new Set(profile?.gear_owned ?? [])
  const seen = new Set<string>()
  const byKind: Record<PieceKind, PackPiece[]> = { gear: [], care: [], extra: [] }
  const add = (item: string, kind: PieceKind) => {
    if (seen.has(item)) return
    seen.add(item)
    const size = kind === 'gear' ? gearSizeFor(profile, item) : null
    byKind[kind].push({
      key: gearPieceKey(booking.id, item),
      item,
      kind,
      size,
      sizeMissing: kind === 'gear' && isSizedGearItem(item) && size === null,
      owned: owned.has(item),
    })
  }
  for (const item of gearPackList(booking).items) add(item, isCareGearItem(item) ? 'care' : 'gear')
  for (const id of (booking.details as BookingDetails | undefined)?.add_ons ?? []) {
    const title = addonTitleById.get(id)
    if (!title) continue
    const care = careLabelForAddon(title)
    add(care ?? title, care ? 'care' : 'extra')
  }
  return [...byKind.gear, ...byKind.care, ...byKind.extra]
}

export interface PackCount {
  packed: number
  total: number
}

export function packProgress(pieces: PackPiece[], packed: Set<string>): PackCount {
  return { packed: pieces.filter(p => packed.has(p.key)).length, total: pieces.length }
}

/** One guest's pieces, named — the input to the by-item view. */
export interface PackGuest {
  bookingId: string
  name: string
  pieces: PackPiece[]
}

export interface PackItemGroup {
  item: string
  kind: PieceKind
  sizes: Array<{
    size: string | null
    sizeMissing: boolean
    entries: Array<{ key: string; bookingId: string; name: string }>
  }>
}

/**
 * The same pieces turned rack-side: per item, per size, whose each one is. For
 * the person pulling kit off the rack, who thinks "three medium BCDs" — every
 * piece still carries its guest, and ticking it here ticks it on their card.
 */
export function piecesByItem(guests: PackGuest[]): PackItemGroup[] {
  const groups = new Map<string, PackItemGroup>()
  for (const g of guests) {
    for (const p of g.pieces) {
      const group = groups.get(p.item) ?? { item: p.item, kind: p.kind, sizes: [] }
      groups.set(p.item, group)
      const sizeKey = p.size?.toUpperCase() ?? null
      let slot = group.sizes.find(s => (s.size?.toUpperCase() ?? null) === sizeKey && s.sizeMissing === p.sizeMissing)
      if (!slot) {
        slot = { size: p.size, sizeMissing: p.sizeMissing, entries: [] }
        group.sizes.push(slot)
      }
      slot.entries.push({ key: p.key, bookingId: g.bookingId, name: g.name })
    }
  }
  for (const group of groups.values()) group.sizes.sort((a, b) => compareSizes(a.size, b.size))
  return [...groups.values()].sort((a, b) => itemRank(a) - itemRank(b) || a.item.localeCompare(b.item))
}

// Dive bag in catalog order, then delicate kit, then add-ons alphabetically.
function itemRank(g: PackItemGroup): number {
  if (g.kind === 'gear') {
    const i = (GEAR_ITEMS as readonly string[]).indexOf(g.item)
    return i >= 0 ? i : GEAR_ITEMS.length
  }
  if (g.kind === 'care') {
    const i = (CARE_ITEMS as readonly string[]).indexOf(g.item)
    return 100 + (i >= 0 ? i : CARE_ITEMS.length)
  }
  return 200
}
