import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RegisterPage } from './RegisterPage'
import { mockQueryBuilder } from '../../tests/test-utils'

const { from, useAuthMock, fetchEventsForBookings, fetchEventsInRange, signInWithPassword, signUp } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsForBookings: vi.fn(),
  fetchEventsInRange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signUp: (...a: unknown[]) => signUp(...a),
    },
  },
}))
vi.mock('../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../lib/events')>('../lib/events')
  return {
    ...actual,
    fetchEventsForBookings: (...a: unknown[]) => fetchEventsForBookings(...a),
    fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  }
})
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
// Register form body is covered by its own tests; stub it here so this test
// stays focused on the page-level phase transitions (event / auth / locked).
vi.mock('../components/register/RegisterForm', async () => {
  const actual = await vi.importActual<typeof import('../components/register/RegisterForm')>('../components/register/RegisterForm')
  return {
    ...actual,
    RegisterFormBody: ({ event }: { event: { title: string } }) => <div data-testid="form-body">{event.title}</div>,
  }
})

const testEvent = {
  id: 'dive-a', type: 'dive', title: 'Kenting Dive',
  start_time: '2099-05-01T09:00:00Z', end_time: null,
  fully_booked: false, price: 3000, deposit_amount: null, currency: 'TWD',
  featured: false, dive_days: 1, gear_rental_info: null,
  has_rooms: false, room_type_ids: [], has_addons: false, addon_ids: [],
  nitrox_required: false,
}

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
  fetchEventsForBookings.mockReset()
  fetchEventsInRange.mockReset()
  signInWithPassword.mockReset()
  signUp.mockReset()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/:type/:id" element={<RegisterPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RegisterPage', () => {
  it('at /register (no event in URL), shows an event picker framed as step 1', async () => {
    useAuthMock.mockReturnValue({ user: null, profile: null, loading: false })
    fetchEventsInRange.mockResolvedValue([
      { ...testEvent, id: 'dive-a', title: 'Kenting Dive' },
      { ...testEvent, id: 'course-a', type: 'course', title: 'OW Batch' },
    ])

    renderAt('/register')
    await screen.findByText('Which event?')
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument()
    expect(screen.getByText('Kenting Dive')).toBeInTheDocument()
    expect(screen.getByText('OW Batch')).toBeInTheDocument()
  })

  it('unauthed visitors see the form directly with a Sign-in affordance for returning divers', async () => {
    useAuthMock.mockReturnValue({ user: null, profile: null, loading: false })
    fetchEventsForBookings.mockResolvedValue(new Map([['dive-a', testEvent]]))

    renderAt('/register/dive/dive-a')
    // The form body (stubbed) renders in place of the old gate — no auth wall.
    await screen.findByTestId('form-body')
    // Returning divers can collapse-expand a sign-in form from the banner.
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  it('shows the locked confirmation screen when the user already has a booking for this event', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, profile: {}, loading: false })
    fetchEventsForBookings.mockResolvedValue(new Map([['dive-a', testEvent]]))
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({
        data: { id: 'b1', status: 'confirmed', user_id: 'u1', eo_dive_id: 'dive-a' },
      })
      return mockQueryBuilder({ data: null })
    })

    renderAt('/register/dive/dive-a')
    await screen.findByText(/already registered/i)
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument()
  })

  it('shows the form body when authed and not yet booked', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, profile: {}, loading: false })
    fetchEventsForBookings.mockResolvedValue(new Map([['dive-a', testEvent]]))
    from.mockImplementation(() => mockQueryBuilder({ data: null }))

    renderAt('/register/dive/dive-a')
    await screen.findByTestId('form-body')
    expect(screen.getByTestId('form-body')).toHaveTextContent('Kenting Dive')
  })

  it('auto-submits a pending booking draft when a freshly-authed user returns via the email confirmation link', async () => {
    // Draft was stashed while the user was unauthed; they're back now with a
    // session (emailRedirectTo bounced them here). The page should apply the
    // profile patch, insert the booking, and clear the localStorage key.
    const draft = {
      profilePatch: { full_name: 'Grace Hopper' },
      details: { payment_method: 'bank_transfer', total: 3000 },
      notes: null,
    }
    localStorage.setItem('pending-booking:dive:dive-a', JSON.stringify(draft))

    useAuthMock.mockReturnValue({ user: { id: 'u-new' }, profile: null, loading: false })
    fetchEventsForBookings.mockResolvedValue(new Map([['dive-a', testEvent]]))

    const profileUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    const bookingInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'b-just-booked', status: 'pending' }, error: null }) }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'profiles') return { update: profileUpdate }
      if (table === 'bookings') return { ...mockQueryBuilder({ data: null }), insert: bookingInsert }
      return mockQueryBuilder({ data: null })
    })

    renderAt('/register/dive/dive-a')
    await waitFor(() => expect(bookingInsert).toHaveBeenCalled())
    const [payload] = bookingInsert.mock.calls[0]
    expect(payload).toMatchObject({ user_id: 'u-new', eo_dive_id: 'dive-a', eo_course_id: null, status: 'pending' })
    expect(localStorage.getItem('pending-booking:dive:dive-a')).toBeNull()
    await screen.findByText(/registration submitted/i)
  })
})
