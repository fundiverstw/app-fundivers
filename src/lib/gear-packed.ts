// Which individual pieces of gear are already on the van. The shared list is
// the `packed_pieces` table (src/lib/packed-sync.ts), so every crew phone reads
// the same ticks; this file is the device-side half of it:
//
//   - a copy of the day's list as last seen, so the board paints its ticks at
//     once and still has them with no signal;
//   - the ticks made here that the server has not confirmed yet, so a tick made
//     on a boat is sent when the connection comes back instead of being lost.
//
// Both are stored one key per day, so a day's list is loaded, written and
// expired on its own; the payload is `${bookingId}|${item}` piece keys.

export const GEAR_PACKED_PREFIX = 'fd_gear_packed_v1'
export const GEAR_PENDING_PREFIX = 'fd_gear_pending_v1'

// Enough to cover a long weekend and the days either side of it. Older days are
// dropped on write so the shop's tablet doesn't accumulate a year of lists.
const MAX_DAYS = 14

/** A single piece of gear: this diver's copy of this item. Size is deliberately
 *  not part of the key — correcting a diver's size must not lose the tick. */
export function gearPieceKey(bookingId: string, item: string): string {
  return `${bookingId}|${item}`
}

/** The booking and item a piece key names. Booking ids are uuids, so the first
 *  `|` is always the separator, whatever the item's label contains. */
export function splitPieceKey(key: string): { bookingId: string; item: string } {
  const at = key.indexOf('|')
  return { bookingId: key.slice(0, at), item: key.slice(at + 1) }
}

function storageKey(day: string): string {
  return `${GEAR_PACKED_PREFIX}:${day}`
}

/** This device's copy of the day's list; empty when nothing is stored, the
 *  entry is corrupt, or storage is unavailable (private mode). */
export function loadPackedGear(day: string): Set<string> {
  let raw: string | null
  try {
    raw = localStorage.getItem(storageKey(day))
  } catch { return new Set() }
  if (!raw) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function savePackedGear(day: string, packed: Set<string>): void {
  try {
    if (packed.size === 0) localStorage.removeItem(storageKey(day))
    else localStorage.setItem(storageKey(day), JSON.stringify([...packed].sort()))
    pruneOldDays(GEAR_PACKED_PREFIX)
  } catch { /* storage full / unavailable — the copy is best-effort */ }
}

/** Ticks made on this device that the server has not confirmed: piece key →
 *  packed or unpacked. Empty when nothing is waiting or storage is unavailable. */
export function loadPendingPacks(day: string): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(`${GEAR_PENDING_PREFIX}:${day}`)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
  } catch {
    return new Map()
  }
}

export function savePendingPacks(day: string, pending: Map<string, boolean>): void {
  try {
    const key = `${GEAR_PENDING_PREFIX}:${day}`
    if (pending.size === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(Object.fromEntries(pending)))
    pruneOldDays(GEAR_PENDING_PREFIX)
  } catch { /* storage full / unavailable — the tick still goes out if online */ }
}

/** The server's list with this device's unconfirmed ticks laid over it. A tick
 *  made here and not yet sent is newer than anything the server holds. */
export function applyPending(server: Set<string>, pending: Map<string, boolean>): Set<string> {
  const next = new Set(server)
  for (const [key, packed] of pending) {
    if (packed) next.add(key)
    else next.delete(key)
  }
  return next
}

// Day keys are ISO dates, so lexical order is chronological: keep the newest
// MAX_DAYS and drop the rest.
function pruneOldDays(prefix: string): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(`${prefix}:`)) keys.push(key)
  }
  if (keys.length <= MAX_DAYS) return
  for (const key of keys.sort().slice(0, keys.length - MAX_DAYS)) {
    localStorage.removeItem(key)
  }
}

/** Tick (or untick) several pieces at once, returning a new set. A guest's
 *  card offers this as a single button: a packer who has just carried
 *  someone's whole kit out should not have to tap each item. */
export function setPiecesPacked(packed: Set<string>, keys: string[], value: boolean): Set<string> {
  const next = new Set(packed)
  for (const key of keys) {
    if (value) next.add(key)
    else next.delete(key)
  }
  return next
}
