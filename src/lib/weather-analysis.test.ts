import { describe, it, expect } from 'vitest'
import {
  monthlyWeather, monthlyCounts, seasonAverages, filterMonths, eventDayWeather, PEAK_SEASON_MONTHS,
} from './weather-analysis'
import type { DailyWeather } from './weather'

function day(date: string, over: Partial<DailyWeather> = {}): DailyWeather {
  return { date, tempMax: 30, tempMin: 26, precipitation: 0, windMax: 10, waveMax: 1, seaTemp: 28, ...over }
}

describe('monthlyWeather', () => {
  it('produces 12 Jan→Dec rows averaging each metric', () => {
    const daily = [
      day('2026-07-01', { precipitation: 0, waveMax: 1.0 }),
      day('2026-07-15', { precipitation: 4, waveMax: 2.0 }),
      day('2026-08-01', { precipitation: 10 }),
    ]
    const m = monthlyWeather(daily, 2026)
    expect(m).toHaveLength(12)
    expect(m[6].month).toBe('2026-07')
    expect(m[6].precipitation).toBe(2)   // (0 + 4) / 2
    expect(m[6].waveMax).toBe(1.5)       // (1 + 2) / 2
    expect(m[7].precipitation).toBe(10)
    expect(m[0].precipitation).toBeNull() // no January data
  })
})

describe('monthlyCounts', () => {
  it('counts date keys per calendar month', () => {
    const counts = monthlyCounts(['2026-07-01', '2026-07-09', '2026-08-20', '2025-07-01'], 2026)
    expect(counts[6]).toBe(2) // Jul 2026
    expect(counts[7]).toBe(1) // Aug 2026
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3) // 2025 row excluded
  })
})

describe('filterMonths + seasonAverages', () => {
  it('restricts to the peak season then averages', () => {
    const daily = [
      day('2026-03-01', { waveMax: 5 }),  // outside Jun–Aug
      day('2026-06-10', { waveMax: 1 }),
      day('2026-08-10', { waveMax: 2 }),
    ]
    const peak = filterMonths(daily, PEAK_SEASON_MONTHS)
    expect(peak).toHaveLength(2)
    expect(seasonAverages(peak).waveMax).toBe(1.5)
  })

  it('returns null averages for an empty set', () => {
    expect(seasonAverages([]).precipitation).toBeNull()
  })
})

describe('eventDayWeather', () => {
  it('compares weather on event days against all days', () => {
    const daily = [
      day('2026-07-01', { precipitation: 12 }), // event day, rainy
      day('2026-07-02', { precipitation: 0 }),
      day('2026-07-03', { precipitation: 0 }),
    ]
    const cmp = eventDayWeather(daily, ['2026-07-01'])
    expect(cmp.eventDayCount).toBe(1)
    expect(cmp.onEventDays.precipitation).toBe(12)
    expect(cmp.allDays.precipitation).toBe(4) // (12 + 0 + 0) / 3
  })

  it('reports zero event days when none match', () => {
    const cmp = eventDayWeather([day('2026-07-01')], ['2026-09-09'])
    expect(cmp.eventDayCount).toBe(0)
    expect(cmp.onEventDays.precipitation).toBeNull()
  })
})
