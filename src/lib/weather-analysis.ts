// Pure rollups for the historical-perspective view: monthly weather averages,
// per-month event/booking counts, and a peak-season comparison. No I/O.
import type { DailyWeather } from './weather'

/** Peak diving season — used for the season-over-season headline comparison. */
export const PEAK_SEASON_MONTHS = [6, 7, 8] as const

export interface MonthlyWeather {
  month: string // 'YYYY-MM'
  precipitation: number | null
  windMax: number | null
  waveMax: number | null
  tempMax: number | null
  seaTemp: number | null
}

export interface SeasonAverages {
  precipitation: number | null
  windMax: number | null
  waveMax: number | null
  tempMax: number | null
  seaTemp: number | null
}

export interface EventDayComparison {
  onEventDays: SeasonAverages
  allDays: SeasonAverages
  eventDayCount: number
}

function mean(vals: Array<number | null>): number | null {
  const v = vals.filter((n): n is number => typeof n === 'number')
  if (!v.length) return null
  return Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10
}

const monthOf = (dateKey: string): number => Number(dateKey.slice(5, 7))

export function filterMonths(daily: DailyWeather[], months: readonly number[]): DailyWeather[] {
  const set = new Set(months)
  return daily.filter(d => set.has(monthOf(d.date)))
}

export function seasonAverages(daily: DailyWeather[]): SeasonAverages {
  return {
    precipitation: mean(daily.map(d => d.precipitation)),
    windMax: mean(daily.map(d => d.windMax)),
    waveMax: mean(daily.map(d => d.waveMax)),
    tempMax: mean(daily.map(d => d.tempMax)),
    seaTemp: mean(daily.map(d => d.seaTemp)),
  }
}

/** 12 monthly-average rows (Jan→Dec) for the given year. */
export function monthlyWeather(daily: DailyWeather[], year: number): MonthlyWeather[] {
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    const rows = daily.filter(d => d.date.slice(0, 7) === key)
    return {
      month: key,
      precipitation: mean(rows.map(r => r.precipitation)),
      windMax: mean(rows.map(r => r.windMax)),
      waveMax: mean(rows.map(r => r.waveMax)),
      tempMax: mean(rows.map(r => r.tempMax)),
      seaTemp: mean(rows.map(r => r.seaTemp)),
    }
  })
}

/** Counts of date keys ('YYYY-MM-DD') per calendar month (Jan→Dec) of a year. */
export function monthlyCounts(dateKeys: string[], year: number): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    return dateKeys.filter(d => d.slice(0, 7) === key).length
  })
}

/** Weather averaged over the days events ran, vs. over all days in range. */
export function eventDayWeather(daily: DailyWeather[], eventDateKeys: string[]): EventDayComparison {
  const set = new Set(eventDateKeys)
  const onDays = daily.filter(d => set.has(d.date))
  return { onEventDays: seasonAverages(onDays), allDays: seasonAverages(daily), eventDayCount: onDays.length }
}
