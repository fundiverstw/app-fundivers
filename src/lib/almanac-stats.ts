/**
 * Summary statistics for a stack of almanac observations.
 *
 * A site/date lookup usually returns a handful of readings — one per diver who
 * filed for that day — so everything here is written for small n and stays
 * honest about it: `summarize` reports the sample it was given rather than
 * smoothing it, and callers decide which marks a sample of that size earns
 * (a lone reading is a number, not a distribution).
 */

/** A metric's sample, ordered and reduced to the five-number summary + mean. */
export interface NumericSummary {
  /** Every value, ascending — small samples are plotted point by point. */
  values: number[]
  n: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  mean: number
}

/**
 * The p-quantile of an ascending sample, interpolating between neighbors
 * (the "type 7" definition NumPy and spreadsheets use), so a 4-value sample
 * still yields quartiles that sit between the points rather than on them.
 */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('quantile of an empty sample')
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Null when nothing was reported — a metric with no readings is not plotted. */
export function summarize(values: readonly number[]): NumericSummary | null {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return {
    values: sorted,
    n: sorted.length,
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
  }
}

/** How many observations reported one value of a categorical reading. */
export interface Tally<T> {
  value: T
  count: number
}

/**
 * Counts along a known scale, keeping the scale's own order and its unreported
 * levels. "Nobody called it strong" is a reading of the day too, and it only
 * shows if the empty level keeps its place on the axis.
 */
export function tallyOrdered<T extends string>(
  values: readonly (T | null)[],
  order: readonly T[],
): Tally<T>[] {
  const counts = new Map<T, number>(order.map(level => [level, 0]))
  for (const value of values) {
    if (value !== null && counts.has(value)) counts.set(value, counts.get(value)! + 1)
  }
  return order.map(value => ({ value, count: counts.get(value)! }))
}

/**
 * Counts for a reading with no natural order (weather, wildlife), commonest
 * first. Ties keep the order they were first seen in, so the same day always
 * renders the same way.
 */
export function tallyByCount<T extends string>(values: readonly (T | null)[]): Tally<T>[] {
  const counts = new Map<T, number>()
  for (const value of values) {
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

/** The non-null values of one numeric column across a stack of records. */
export function valuesOf<R>(records: readonly R[], pick: (record: R) => number | null): number[] {
  // Finiteness rather than `!== null`, so a column a query forgot to select
  // reads as "nobody filed this" instead of reaching `summarize` as undefined
  // and taking the whole report down on `.toFixed`.
  return records.map(pick).filter((v): v is number => Number.isFinite(v))
}
