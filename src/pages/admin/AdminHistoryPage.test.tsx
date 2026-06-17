import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminHistoryPage } from './AdminHistoryPage'
import type { DailyWeather } from '../../lib/weather'

const { from, fetchYearWeather } = vi.hoisted(() => ({ from: vi.fn(), fetchYearWeather: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../lib/weather', async (orig) => ({
  ...(await orig<typeof import('../../lib/weather')>()),
  fetchYearWeather: (...a: unknown[]) => fetchYearWeather(...a),
}))

function builder(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'gte', 'lt', 'lte', 'is', 'in', 'eq', 'order']) b[m] = () => b
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return b
}

beforeEach(() => {
  from.mockReset()
  fetchYearWeather.mockReset()
  fetchYearWeather.mockImplementation((year: number) =>
    Promise.resolve<DailyWeather[]>([
      { date: `${year}-07-15`, tempMax: 31, tempMin: 27, precipitation: 5, windMax: 20, waveMax: 1.2, seaTemp: 29 },
    ]))
  from.mockImplementation((table: string) => {
    switch (table) {
      case 'bookings': return builder({ data: [{ created_at: '2026-07-10T00:00:00+08:00' }], error: null })
      case 'EO_dives': return builder({ data: [{ start_date: '2026-07-15' }], error: null })
      case 'EO_courses': return builder({ data: [], error: null })
      default: return builder({ data: [], error: null })
    }
  })
})

function renderPage() {
  return render(<MemoryRouter><AdminHistoryPage /></MemoryRouter>)
}

describe('AdminHistoryPage', () => {
  it('renders the headline, charts, and event-day comparison from fetched data', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Historical perspective' })).toBeInTheDocument()
    expect(screen.getByText('Bookings (Jun–Aug)')).toBeInTheDocument()
    expect(screen.getByText('Rainfall by month (avg mm/day)')).toBeInTheDocument()
    // fetched three years of weather (current + two prior)
    expect(fetchYearWeather).toHaveBeenCalledTimes(3)
  })

  it('surfaces a fetch error', async () => {
    from.mockImplementation((table: string) =>
      table === 'bookings'
        ? builder({ data: null, error: { message: 'kaboom' } })
        : builder({ data: [], error: null }))
    renderPage()
    expect(await screen.findByText('kaboom')).toBeInTheDocument()
  })
})
