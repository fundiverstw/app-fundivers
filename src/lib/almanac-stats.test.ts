import { describe, it, expect } from 'vitest'
import { quantile, summarize, tallyOrdered, tallyByCount, valuesOf } from './almanac-stats'

describe('quantile', () => {
  it('interpolates between neighbors rather than snapping to a point', () => {
    const sorted = [1, 2, 3, 4]
    expect(quantile(sorted, 0.25)).toBe(1.75)
    expect(quantile(sorted, 0.5)).toBe(2.5)
    expect(quantile(sorted, 0.75)).toBe(3.25)
  })

  it('lands on the point when the position is a whole rank', () => {
    expect(quantile([10, 20, 30], 0.5)).toBe(20)
  })

  it('reports the one value of a one-value sample at every quantile', () => {
    expect(quantile([7], 0)).toBe(7)
    expect(quantile([7], 0.5)).toBe(7)
    expect(quantile([7], 1)).toBe(7)
  })

  it('refuses an empty sample instead of returning a number for nothing', () => {
    expect(() => quantile([], 0.5)).toThrow()
  })
})

describe('summarize', () => {
  it('sorts the sample and reports the five-number summary with the mean', () => {
    const s = summarize([28, 26, 30, 27])!
    expect(s.values).toEqual([26, 27, 28, 30])
    expect(s.n).toBe(4)
    expect(s.min).toBe(26)
    expect(s.q1).toBe(26.75)
    expect(s.median).toBe(27.5)
    expect(s.q3).toBe(28.5)
    expect(s.max).toBe(30)
    expect(s.mean).toBe(27.75)
  })

  it('summarizes a lone reading without inventing a spread', () => {
    const s = summarize([28.5])!
    expect(s.n).toBe(1)
    expect(s.min).toBe(28.5)
    expect(s.max).toBe(28.5)
    expect(s.mean).toBe(28.5)
    expect(s.median).toBe(28.5)
  })

  it('returns null for a metric nobody reported', () => {
    expect(summarize([])).toBeNull()
  })

  it("leaves the caller's array untouched", () => {
    const input = [3, 1, 2]
    summarize(input)
    expect(input).toEqual([3, 1, 2])
  })
})

describe('tallyOrdered', () => {
  const SCALE = ['calm', 'light', 'moderate', 'strong'] as const

  it('keeps the scale order and the levels nobody reported', () => {
    expect(tallyOrdered(['light', 'moderate', 'light', null], SCALE)).toEqual([
      { value: 'calm', count: 0 },
      { value: 'light', count: 2 },
      { value: 'moderate', count: 1 },
      { value: 'strong', count: 0 },
    ])
  })

  it('ignores a value that is not on the scale', () => {
    const counted = tallyOrdered(['gale' as 'calm', 'calm'], SCALE)
    expect(counted.find(c => c.value === 'calm')!.count).toBe(1)
    expect(counted.reduce((sum, c) => sum + c.count, 0)).toBe(1)
  })
})

describe('tallyByCount', () => {
  it('orders by count, commonest first, and drops nulls', () => {
    expect(tallyByCount(['clear', 'rain', 'clear', null, 'clear', 'rain'])).toEqual([
      { value: 'clear', count: 3 },
      { value: 'rain', count: 2 },
    ])
  })

  it('breaks ties by first appearance, so the same day renders the same way', () => {
    expect(tallyByCount(['turtle', 'manta', 'manta', 'turtle'])).toEqual([
      { value: 'turtle', count: 2 },
      { value: 'manta', count: 2 },
    ])
  })
})

describe('valuesOf', () => {
  it('pulls one column across records, dropping the blanks', () => {
    const records = [{ temp: 28 }, { temp: null }, { temp: 26 }]
    expect(valuesOf(records, r => r.temp)).toEqual([28, 26])
  })
})

describe('valuesOf robustness', () => {
  it('drops a column a query never selected instead of crashing the report', () => {
    const records = [{ n: 3 }, {}, { n: 5 }] as Array<{ n?: number }>
    expect(valuesOf(records, r => r.n as number | null)).toEqual([3, 5])
  })

  it('drops NaN, which would poison every statistic it touched', () => {
    expect(valuesOf([{ n: 1 }, { n: NaN }, { n: 2 }], r => r.n)).toEqual([1, 2])
  })
})
