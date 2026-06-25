import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FeaturedEvents } from './FeaturedEvents'
import type { AppEvent } from '../../types/database'

const { fetchEventsInRange } = vi.hoisted(() => ({ fetchEventsInRange: vi.fn() }))
vi.mock('../../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../../lib/events')>('../../lib/events')
  return { ...actual, fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a) }
})

function event(overrides: Partial<AppEvent> & Pick<AppEvent, 'id' | 'type' | 'title'>): AppEvent {
  return {
    start_time: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    end_time: null, start_time_hhmm: null,
    featured: true, fully_booked: false,
    price: 2800, currency: 'TWD',
    has_rooms: false, room_type_ids: [], has_addons: false, addon_ids: [],
    gear_rental_info: null, nitrox_required: false, dive_days: 1,
    ...overrides,
  }
}

beforeEach(() => { fetchEventsInRange.mockReset() })

function renderIt() {
  return render(<MemoryRouter><FeaturedEvents /></MemoryRouter>)
}

describe('FeaturedEvents', () => {
  it('lists only featured upcoming events, linking each to its registration form', async () => {
    fetchEventsInRange.mockResolvedValue([
      event({ id: 'd1', type: 'dive', title: 'Featured Reef Dive', featured: true }),
      event({ id: 'd2', type: 'dive', title: 'Ordinary Dive', featured: false }),
      event({ id: 'c1', type: 'course', title: 'Featured Course', featured: true }),
    ])
    renderIt()

    const link = await screen.findByRole('link', { name: /featured reef dive/i })
    expect(link).toHaveAttribute('href', '/register/dive/d1')
    expect(screen.getByRole('link', { name: /featured course/i })).toHaveAttribute('href', '/register/course/c1')
    // Non-featured events are excluded.
    expect(screen.queryByText('Ordinary Dive')).not.toBeInTheDocument()
  })

  it('flags a full featured event as waitlist', async () => {
    fetchEventsInRange.mockResolvedValue([
      event({ id: 'd1', type: 'dive', title: 'Sold Out Dive', featured: true, fully_booked: true }),
    ])
    renderIt()
    expect(await screen.findByText(/waitlist/i)).toBeInTheDocument()
  })

  it('renders nothing when there are no featured events', async () => {
    fetchEventsInRange.mockResolvedValue([
      event({ id: 'd2', type: 'dive', title: 'Ordinary Dive', featured: false }),
    ])
    const { container } = renderIt()
    await waitFor(() => expect(fetchEventsInRange).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
