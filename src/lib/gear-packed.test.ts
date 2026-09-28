import { describe, it, expect, beforeEach } from 'vitest'
import {
  GEAR_PACKED_PREFIX,
  GEAR_PENDING_PREFIX,
  applyPending,
  gearPieceKey,
  loadPackedGear,
  loadPendingPacks,
  savePackedGear,
  savePendingPacks,
  setPiecesPacked,
  splitPieceKey,
} from './gear-packed'

beforeEach(() => localStorage.clear())

describe('gearPieceKey', () => {
  it('identifies a piece by diver booking and item, never by size', () => {
    // A size correction must not lose the tick, so size is not in the key.
    expect(gearPieceKey('b1', 'BCD')).toBe('b1|BCD')
    expect(gearPieceKey('b1', 'BCD')).not.toBe(gearPieceKey('b1', 'Wetsuit'))
  })
})

describe('savePackedGear / loadPackedGear', () => {
  it('round-trips a day\'s ticked pieces', () => {
    savePackedGear('2026-06-18', new Set(['b1|BCD', 'b2|Fins']))
    expect(loadPackedGear('2026-06-18')).toEqual(new Set(['b1|BCD', 'b2|Fins']))
  })

  it('keeps each day\'s list separate', () => {
    savePackedGear('2026-06-18', new Set(['b1|BCD']))
    savePackedGear('2026-06-19', new Set(['b3|Wetsuit']))
    expect(loadPackedGear('2026-06-18')).toEqual(new Set(['b1|BCD']))
    expect(loadPackedGear('2026-06-19')).toEqual(new Set(['b3|Wetsuit']))
  })

  it('drops the entry entirely once everything is unticked', () => {
    savePackedGear('2026-06-18', new Set(['b1|BCD']))
    savePackedGear('2026-06-18', new Set())
    expect(localStorage.getItem(`${GEAR_PACKED_PREFIX}:2026-06-18`)).toBeNull()
    expect(loadPackedGear('2026-06-18')).toEqual(new Set())
  })

  it('is empty for an unknown day', () => {
    expect(loadPackedGear('2026-01-01')).toEqual(new Set())
  })

  it('survives a corrupt or hand-edited entry instead of throwing', () => {
    localStorage.setItem(`${GEAR_PACKED_PREFIX}:2026-06-18`, '{not json')
    expect(loadPackedGear('2026-06-18')).toEqual(new Set())
    localStorage.setItem(`${GEAR_PACKED_PREFIX}:2026-06-19`, '{"a":1}')
    expect(loadPackedGear('2026-06-19')).toEqual(new Set())
    localStorage.setItem(`${GEAR_PACKED_PREFIX}:2026-06-20`, '["b1|BCD", 7, null]')
    expect(loadPackedGear('2026-06-20')).toEqual(new Set(['b1|BCD']))
  })

  it('expires the oldest days so the shop tablet never accumulates a year', () => {
    // 16 days written; the 14 most recent survive (ISO keys sort chronologically).
    for (let d = 1; d <= 16; d++) {
      savePackedGear(`2026-06-${String(d).padStart(2, '0')}`, new Set([`b${d}|BCD`]))
    }
    expect(loadPackedGear('2026-06-01')).toEqual(new Set())
    expect(loadPackedGear('2026-06-02')).toEqual(new Set())
    expect(loadPackedGear('2026-06-03')).toEqual(new Set(['b3|BCD']))
    expect(loadPackedGear('2026-06-16')).toEqual(new Set(['b16|BCD']))
  })

  it('leaves other apps\' localStorage keys alone when expiring', () => {
    localStorage.setItem('unrelated', 'keep me')
    for (let d = 1; d <= 16; d++) {
      savePackedGear(`2026-06-${String(d).padStart(2, '0')}`, new Set([`b${d}|BCD`]))
    }
    expect(localStorage.getItem('unrelated')).toBe('keep me')
  })
})

describe('setPiecesPacked', () => {
  it('ticks every piece asked for without touching anyone else', () => {
    const start = new Set(['b2|BCD'])
    const next = setPiecesPacked(start, ['b1|BCD', 'b1|Fins'], true)
    expect(next).toEqual(new Set(['b2|BCD', 'b1|BCD', 'b1|Fins']))
    expect(start).toEqual(new Set(['b2|BCD']))
  })

  it('unticks only the pieces asked for', () => {
    const start = new Set(['b1|BCD', 'b1|Fins', 'b1|Mask', 'b2|BCD'])
    expect(setPiecesPacked(start, ['b1|BCD', 'b1|Fins'], false))
      .toEqual(new Set(['b1|Mask', 'b2|BCD']))
  })

  it('is a no-op for a guest with nothing to pack', () => {
    const start = new Set(['b1|BCD'])
    expect(setPiecesPacked(start, [], true)).toEqual(start)
  })
})

describe('splitPieceKey', () => {
  it('reads the booking and item back out of a key, even when the item has a bar in it', () => {
    expect(splitPieceKey(gearPieceKey('b1', 'BCD'))).toEqual({ bookingId: 'b1', item: 'BCD' })
    expect(splitPieceKey(gearPieceKey('b1', 'Light | 2 days'))).toEqual({ bookingId: 'b1', item: 'Light | 2 days' })
  })
})

describe('loadPendingPacks / savePendingPacks', () => {
  it('round-trips the unsent ticks for one day, packed and unpacked alike', () => {
    savePendingPacks('2026-08-15', new Map([['b1|BCD', true], ['b2|Fins', false]]))
    expect(loadPendingPacks('2026-08-15')).toEqual(new Map([['b1|BCD', true], ['b2|Fins', false]]))
    expect(loadPendingPacks('2026-08-16').size).toBe(0)
  })

  it('removes the entry once nothing is waiting', () => {
    savePendingPacks('2026-08-15', new Map([['b1|BCD', true]]))
    savePendingPacks('2026-08-15', new Map())
    expect(localStorage.getItem(`${GEAR_PENDING_PREFIX}:2026-08-15`)).toBeNull()
  })

  it('reads a corrupt entry as nothing waiting', () => {
    localStorage.setItem(`${GEAR_PENDING_PREFIX}:2026-08-15`, '{nope')
    expect(loadPendingPacks('2026-08-15').size).toBe(0)
  })
})

describe('applyPending', () => {
  it("lays this device's unsent ticks and unticks over the server's list", () => {
    const server = new Set(['b1|BCD', 'b2|Fins'])
    const out = applyPending(server, new Map([['b2|Fins', false], ['b3|Mask', true]]))
    expect(out).toEqual(new Set(['b1|BCD', 'b3|Mask']))
    expect(server).toEqual(new Set(['b1|BCD', 'b2|Fins']))
  })
})
