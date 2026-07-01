// Weather client for the admin "Historical perspective" BI view. Live fetch
// from Open-Meteo (free, no API key, CORS-enabled) for a single fixed home
// region — a consistent baseline for season-over-season comparison. No data
// is stored; the view fetches on demand. URL builders + the response parser
// are pure so they're unit-testable without network.

import { siteConfig } from '../config/site'

export interface DailyWeather {
  date: string            // YYYY-MM-DD in the shop timezone (Open-Meteo returns local dates)
  tempMax: number | null  // °C
  tempMin: number | null  // °C
  precipitation: number | null // mm
  windMax: number | null  // km/h
  waveMax: number | null  // m
  seaTemp: number | null  // °C (daily mean sea-surface temperature)
}

// Home dive region for the weather baseline — set per shop in fundive.config.ts.
export const HOME_REGION = siteConfig.weatherRegion
const TZ = siteConfig.locale.timezone

export function buildArchiveUrl(start: string, end: string): string {
  const p = new URLSearchParams({
    latitude: String(HOME_REGION.latitude),
    longitude: String(HOME_REGION.longitude),
    start_date: start,
    end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
    timezone: TZ,
  })
  return `https://archive-api.open-meteo.com/v1/archive?${p.toString()}`
}

export function buildMarineUrl(start: string, end: string): string {
  const p = new URLSearchParams({
    latitude: String(HOME_REGION.latitude),
    longitude: String(HOME_REGION.longitude),
    start_date: start,
    end_date: end,
    daily: 'wave_height_max,sea_surface_temperature_mean',
    timezone: TZ,
  })
  return `https://marine-api.open-meteo.com/v1/marine?${p.toString()}`
}

type DailyBlock = Record<string, unknown[] | undefined>
interface OpenMeteoResponse { daily?: DailyBlock }

const numAt = (arr: unknown[] | undefined, i: number): number | null => {
  const v = arr?.[i]
  return typeof v === 'number' ? v : null
}

/** Merge the archive (land) and marine daily blocks into one row per date. */
export function parseDailyWeather(archive: OpenMeteoResponse | null, marine: OpenMeteoResponse | null): DailyWeather[] {
  const a = archive?.daily ?? {}
  const times = (a.time as string[] | undefined) ?? []

  const m = marine?.daily ?? {}
  const marineTimes = (m.time as string[] | undefined) ?? []
  const waveByDate = new Map<string, number | null>()
  const sstByDate = new Map<string, number | null>()
  marineTimes.forEach((t, i) => {
    waveByDate.set(t, numAt(m.wave_height_max, i))
    sstByDate.set(t, numAt(m.sea_surface_temperature_mean, i))
  })

  return times.map((t, i) => ({
    date: t,
    tempMax: numAt(a.temperature_2m_max, i),
    tempMin: numAt(a.temperature_2m_min, i),
    precipitation: numAt(a.precipitation_sum, i),
    windMax: numAt(a.windspeed_10m_max, i),
    waveMax: waveByDate.get(t) ?? null,
    seaTemp: sstByDate.get(t) ?? null,
  }))
}

const minKey = (a: string, b: string): string => (a < b ? a : b)

/**
 * Fetch one calendar year of daily home-region weather. For the current year
 * the range is clamped to today (the archive rejects future dates; the last
 * day or two may be null due to the archive's short lag). Network failures
 * resolve to [] so the view degrades to "no weather data" rather than throwing.
 */
export async function fetchYearWeather(year: number, todayKey: string): Promise<DailyWeather[]> {
  const start = `${year}-01-01`
  const end = year >= Number(todayKey.slice(0, 4)) ? minKey(`${year}-12-31`, todayKey) : `${year}-12-31`
  if (start > end) return []
  const get = (url: string): Promise<OpenMeteoResponse | null> =>
    fetch(url).then(r => (r.ok ? r.json() as Promise<OpenMeteoResponse> : null)).catch(() => null)
  const [archive, marine] = await Promise.all([get(buildArchiveUrl(start, end)), get(buildMarineUrl(start, end))])
  return parseDailyWeather(archive, marine)
}
