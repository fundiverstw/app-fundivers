import { describe, it, expect, beforeEach } from 'vitest'
import {
  GEAR_PACKED_PREFIX,
  gearPieceKey,
  loadPackedGear,
  savePackedGear,
  togglePackedGear,
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

describe('togglePackedGear', () => {
  it('adds a missing piece and removes a present one, without mutating the input', () => {
    const start = new Set(['b1|BCD'])
    const added = togglePackedGear(start, 'b2|Fins')
    expect(added).toEqual(new Set(['b1|BCD', 'b2|Fins']))
    expect(start).toEqual(new Set(['b1|BCD']))
    expect(togglePackedGear(added, 'b1|BCD')).toEqual(new Set(['b2|Fins']))
  })
})
