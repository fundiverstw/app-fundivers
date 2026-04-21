import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarPage } from './CalendarPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const from = vi.fn()
const insert = vi.fn()
const update = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

const useAuthMock = vi.fn()
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  from.mockReset()
  insert.mockReset()
  update.mockReset()
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'u1' } })
})

function futureDate(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString()
}

function buildActivity(overrides: Partial<{ id: string; type: 'dive' | 'course' | 'event'; title: string }> = {}) {
  return {
    id: overrides.id ?? 'a1',
    type: overrides.type ?? 'dive',
    title: overrides.title ?? 'Green Island Dive',
    description: 'Test',
    start_time: futureDate(),
    end_time: null,
    location: 'Green Island',
    capacity: 10,
    price: 1500,
    currency: 'TWD',
    is_published: true,
    created_at: new Date().toISOString(),
  }
}

/**
 * from('activities') -> chain returning activities data
 * from('bookings')   -> chain returning bookings data OR an insert/update chain
 */
function setupFrom(activities: unknown[], bookings: unknown[], inserted?: unknown) {
  from.mockImplementation((table: string) => {
    if (table === 'activities') return mockQueryBuilder({ data: activities })
    return {
      ...mockQueryBuilder({ data: bookings }),
      insert: (...a: unknown[]) => {
        insert(...a)
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted ?? null, error: null }),
          }),
        }
      },
      update: (...a: unknown[]) => {
        update(...a)
        return mockQueryBuilder({ data: null })
      },
    }
  })
}

describe('CalendarPage', () => {
  it('shows an empty state when there are no activities', async () => {
    setupFrom([], [])
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText(/no activities scheduled/i)).toBeInTheDocument()
  })

  it('renders activities in the month list with type badge', async () => {
    const a = buildActivity({ title: 'Beginner Course', type: 'course' })
    setupFrom([a], [])
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText('Beginner Course')).toBeInTheDocument()
    // "Course" appears once in the legend plus once per course activity — so 2x here
    expect(screen.getAllByText('Course')).toHaveLength(2)
  })

  it('tags activities the current user has booked', async () => {
    const a = buildActivity()
    setupFrom([a], [{ id: 'b1', user_id: 'u1', activity_id: a.id, status: 'confirmed' }])
    renderWithRouter(<CalendarPage />)
    await screen.findByText(a.title)
    expect(screen.getByText(/^booked$/i)).toBeInTheDocument()
  })

  it('opens the detail modal when an activity is clicked', async () => {
    const a = buildActivity()
    setupFrom([a], [])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(a.title))
    expect(await screen.findByRole('button', { name: /register/i })).toBeInTheDocument()
    expect(screen.getByText(/Capacity: 10/)).toBeInTheDocument()
  })

  it('clicking "Register" calls bookings.insert with pending status', async () => {
    const a = buildActivity()
    const insertedRow = { id: 'b-new', user_id: 'u1', activity_id: a.id, status: 'pending' }
    setupFrom([a], [], insertedRow)

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(a.title))
    await user.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    const payload = insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ user_id: 'u1', activity_id: a.id, status: 'pending' })
  })

  it('clicking "Cancel booking" updates booking status to cancelled', async () => {
    const a = buildActivity()
    setupFrom([a], [{ id: 'b1', user_id: 'u1', activity_id: a.id, status: 'confirmed' }])

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(a.title))
    await user.click(screen.getByRole('button', { name: /cancel booking/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0][0]).toEqual({ status: 'cancelled' })
  })

  it('advances and reverses the month with the nav arrows', async () => {
    setupFrom([], [])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)

    const now = new Date()
    const heading = await screen.findByRole('heading', { level: 1 })
    const monthLabel = heading.textContent
    expect(monthLabel).toMatch(new RegExp(`${now.getFullYear()}`))

    await user.click(screen.getByRole('button', { name: '›' }))
    await waitFor(() => expect(heading.textContent).not.toBe(monthLabel))
  })
})
