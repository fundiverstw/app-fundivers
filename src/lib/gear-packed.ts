// Which individual pieces of gear are already on the van, ticked off by the
// person loading it. Deliberately device-local (localStorage), not a table:
// this is a scratchpad for one packing session, not a record anyone reads back
// later, and a staff member halfway through a van should not need a round trip
// per checkbox. The consequence is that it does NOT sync between phones — two
// people packing the same van keep two separate lists.
//
// Stored one key per day so a day's list is loaded, written and expired on its
// own; the payload is the set of `${bookingId}|${item}` pieces marked packed.

export const GEAR_PACKED_PREFIX = 'fd_gear_packed_v1'

// Enough to cover a long weekend and the days either side of it. Older days are
// dropped on write so the shop's tablet doesn't accumulate a year of lists.
const MAX_DAYS = 14

/** A single piece of gear: this diver's copy of this item. Size is deliberately
 *  not part of the key — correcting a diver's size must not lose the tick. */
export function gearPieceKey(bookingId: string, item: string): string {
  return `${bookingId}|${item}`
}

function storageKey(day: string): string {
  return `${GEAR_PACKED_PREFIX}:${day}`
}

/** The pieces marked packed on `day`; empty when nothing is stored, the entry
 *  is corrupt, or storage is unavailable (private mode). */
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
    pruneOldDays()
  } catch { /* storage full / unavailable — the tick list is best-effort */ }
}

// Day keys are ISO dates, so lexical order is chronological: keep the newest
// MAX_DAYS and drop the rest.
function pruneOldDays(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(`${GEAR_PACKED_PREFIX}:`)) keys.push(key)
  }
  if (keys.length <= MAX_DAYS) return
  for (const key of keys.sort().slice(0, keys.length - MAX_DAYS)) {
    localStorage.removeItem(key)
  }
}

/** Flip one piece, returning a new set — the caller owns persisting it. */
export function togglePackedGear(packed: Set<string>, key: string): Set<string> {
  const next = new Set(packed)
  if (!next.delete(key)) next.add(key)
  return next
}
