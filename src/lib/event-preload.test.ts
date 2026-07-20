import { describe, it, expect } from 'vitest'
import { newestPerCourseType, type PastEventOption } from './event-preload'

const opt = (over: Partial<PastEventOption> & { id: string }): PastEventOption => ({
  startDate: '2026-01-01',
  title: 'Course',
  courseType: 'OW',
  ...over,
})

describe('newestPerCourseType', () => {
  it('keeps only the most recent offering of each course type', () => {
    const kept = newestPerCourseType([
      opt({ id: 'ow-old', courseType: 'OW',  startDate: '2026-01-10' }),
      opt({ id: 'ow-new', courseType: 'OW',  startDate: '2026-05-17' }),
      opt({ id: 'aow',    courseType: 'AOW', startDate: '2026-03-02' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['ow-new', 'aow'])
  })

  it('returns them newest first', () => {
    const kept = newestPerCourseType([
      opt({ id: 'efr',  courseType: 'EFR',  startDate: '2026-02-01' }),
      opt({ id: 'ow',   courseType: 'OW',   startDate: '2026-05-01' }),
      opt({ id: 'deep', courseType: 'Deep', startDate: '2026-03-01' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['ow', 'deep', 'efr'])
  })

  it('does not care what order it is given', () => {
    const ascending = newestPerCourseType([
      opt({ id: 'ow-old', courseType: 'OW', startDate: '2026-01-10' }),
      opt({ id: 'ow-new', courseType: 'OW', startDate: '2026-05-17' }),
    ])
    const descending = newestPerCourseType([
      opt({ id: 'ow-new', courseType: 'OW', startDate: '2026-05-17' }),
      opt({ id: 'ow-old', courseType: 'OW', startDate: '2026-01-10' }),
    ])
    expect(ascending.map(k => k.id)).toEqual(['ow-new'])
    expect(descending.map(k => k.id)).toEqual(['ow-new'])
  })

  it('groups on the course type, not the diver-facing title', () => {
    // Display titles drift per offering and carry a capacity suffix, so
    // grouping on them would leave the duplicates the picker is meant to hide.
    const kept = newestPerCourseType([
      opt({ id: 'a', courseType: 'OW', title: 'Open Water Course', startDate: '2026-01-10' }),
      opt({ id: 'b', courseType: 'OW', title: 'Open Water (2 remaining)', startDate: '2026-05-17' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['b'])
  })

  it('treats whitespace-only course types as untyped', () => {
    const kept = newestPerCourseType([
      opt({ id: 'x', courseType: '   ', startDate: '2026-01-10' }),
      opt({ id: 'y', courseType: null,  startDate: '2026-02-10' }),
    ])
    expect(kept.map(k => k.id).sort()).toEqual(['x', 'y'])
  })

  it('keeps every untyped course rather than collapsing them into one', () => {
    // They have nothing to be deduplicated against; picking an arbitrary
    // winner would silently hide the others.
    const kept = newestPerCourseType([
      opt({ id: 'u1', courseType: null, startDate: '2026-01-10' }),
      opt({ id: 'u2', courseType: null, startDate: '2026-02-10' }),
      opt({ id: 'u3', courseType: null, startDate: '2026-03-10' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['u3', 'u2', 'u1'])
  })

  it('ignores surrounding whitespace when matching a type', () => {
    const kept = newestPerCourseType([
      opt({ id: 'a', courseType: 'OW',   startDate: '2026-01-10' }),
      opt({ id: 'b', courseType: ' OW ', startDate: '2026-05-17' }),
    ])
    expect(kept.map(k => k.id)).toEqual(['b'])
  })

  it('is a no-op on an empty list', () => {
    expect(newestPerCourseType([])).toEqual([])
  })
})
