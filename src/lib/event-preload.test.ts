import { describe, it, expect } from 'vitest'
import { newestPerGroup, type PastEventOption } from './event-preload'

const opt = (over: Partial<PastEventOption> & { id: string }): PastEventOption => ({
  startDate: '2026-01-01',
  title: 'Course',
  groupKey: 'OW',
  ...over,
})

describe('newestPerGroup', () => {
  it('keeps only the most recent offering of each course type', () => {
    const kept = newestPerGroup([
      opt({ id: 'ow-old', groupKey: 'OW',  startDate: '2026-01-10' }),
      opt({ id: 'ow-new', groupKey: 'OW',  startDate: '2026-05-17' }),
      opt({ id: 'aow',    groupKey: 'AOW', startDate: '2026-03-02' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['ow-new', 'aow'])
  })

  it('returns them newest first', () => {
    const kept = newestPerGroup([
      opt({ id: 'efr',  groupKey: 'EFR',  startDate: '2026-02-01' }),
      opt({ id: 'ow',   groupKey: 'OW',   startDate: '2026-05-01' }),
      opt({ id: 'deep', groupKey: 'Deep', startDate: '2026-03-01' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['ow', 'deep', 'efr'])
  })

  it('does not care what order it is given', () => {
    const ascending = newestPerGroup([
      opt({ id: 'ow-old', groupKey: 'OW', startDate: '2026-01-10' }),
      opt({ id: 'ow-new', groupKey: 'OW', startDate: '2026-05-17' }),
    ])
    const descending = newestPerGroup([
      opt({ id: 'ow-new', groupKey: 'OW', startDate: '2026-05-17' }),
      opt({ id: 'ow-old', groupKey: 'OW', startDate: '2026-01-10' }),
    ])
    expect(ascending.map(k => k.id)).toEqual(['ow-new'])
    expect(descending.map(k => k.id)).toEqual(['ow-new'])
  })

  it('groups on the internal label, not the diver-facing title', () => {
    // Display titles drift per offering and carry a capacity suffix, so
    // grouping on them would leave the duplicates the picker is meant to hide.
    const kept = newestPerGroup([
      opt({ id: 'a', groupKey: 'OW', title: 'Open Water Course', startDate: '2026-01-10' }),
      opt({ id: 'b', groupKey: 'OW', title: 'Open Water (2 remaining)', startDate: '2026-05-17' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['b'])
  })

  it('treats whitespace-only group keys as ungrouped', () => {
    const kept = newestPerGroup([
      opt({ id: 'x', groupKey: '   ', startDate: '2026-01-10' }),
      opt({ id: 'y', groupKey: null,  startDate: '2026-02-10' }),
    ])
    expect(kept.map(k => k.id).sort()).toEqual(['x', 'y'])
  })

  it('collapses dives by location, keeping the most recent trip to each site', () => {
    // For a dive, admin_title is the site — "Long Dong Bay", "Penghu".
    const kept = newestPerGroup([
      opt({ id: 'ldb-jan', groupKey: 'Long Dong Bay', startDate: '2026-01-18' }),
      opt({ id: 'ldb-may', groupKey: 'Long Dong Bay', startDate: '2026-05-03' }),
      opt({ id: 'penghu',  groupKey: 'Penghu',        startDate: '2026-05-15' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['penghu', 'ldb-may'])
  })

  it('keeps every ungrouped event rather than collapsing them into one', () => {
    // They have nothing to be deduplicated against; picking an arbitrary
    // winner would silently hide the others.
    const kept = newestPerGroup([
      opt({ id: 'u1', groupKey: null, startDate: '2026-01-10' }),
      opt({ id: 'u2', groupKey: null, startDate: '2026-02-10' }),
      opt({ id: 'u3', groupKey: null, startDate: '2026-03-10' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['u3', 'u2', 'u1'])
  })

  it('ignores surrounding whitespace when matching a group', () => {
    const kept = newestPerGroup([
      opt({ id: 'a', groupKey: 'OW',   startDate: '2026-01-10' }),
      opt({ id: 'b', groupKey: ' OW ', startDate: '2026-05-17' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['b'])
  })

  it('is a no-op on an empty list', () => {
    expect(newestPerGroup([])).toEqual([])
  })
})
