import { describe, it, expect } from 'vitest'
import { buildArchiveUrl, buildMarineUrl, parseDailyWeather } from './weather'

describe('weather URL builders', () => {
  it('targets the archive endpoint with the land daily variables', () => {
    const url = buildArchiveUrl('2025-01-01', '2025-12-31')
    expect(url).toContain('archive-api.open-meteo.com/v1/archive')
    expect(url).toContain('start_date=2025-01-01')
    expect(url).toContain('end_date=2025-12-31')
    expect(url).toContain('temperature_2m_max')
    expect(url).toContain('precipitation_sum')
    expect(url).toContain('windspeed_10m_max')
  })

  it('targets the marine endpoint with wave + sea-temp daily variables', () => {
    const url = buildMarineUrl('2025-06-01', '2025-06-02')
    expect(url).toContain('marine-api.open-meteo.com/v1/marine')
    expect(url).toContain('wave_height_max')
    expect(url).toContain('sea_surface_temperature_mean')
  })
})

describe('parseDailyWeather', () => {
  const archive = {
    daily: {
      time: ['2025-07-01', '2025-07-02'],
      temperature_2m_max: [31.4, 30.9],
      temperature_2m_min: [27.8, 27.1],
      precipitation_sum: [0.1, 1.7],
      windspeed_10m_max: [26.3, 19.1],
    },
  }
  const marine = {
    daily: {
      time: ['2025-07-01', '2025-07-02'],
      wave_height_max: [1.0, 0.72],
      sea_surface_temperature_mean: [29.5, 29.6],
    },
  }

  it('merges land and marine blocks by date', () => {
    const rows = parseDailyWeather(archive, marine)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      date: '2025-07-01', tempMax: 31.4, tempMin: 27.8,
      precipitation: 0.1, windMax: 26.3, waveMax: 1.0, seaTemp: 29.5,
    })
  })

  it('tolerates a missing marine response (wave/sea null)', () => {
    const rows = parseDailyWeather(archive, null)
    expect(rows[1].waveMax).toBeNull()
    expect(rows[1].seaTemp).toBeNull()
    expect(rows[1].tempMax).toBe(30.9)
  })

  it('returns [] when the archive response is missing', () => {
    expect(parseDailyWeather(null, marine)).toEqual([])
  })

  it('maps explicit nulls in the daily arrays through', () => {
    const rows = parseDailyWeather({ daily: { time: ['2025-07-01'], precipitation_sum: [null] } }, null)
    expect(rows[0].precipitation).toBeNull()
    expect(rows[0].tempMax).toBeNull()
  })
})
