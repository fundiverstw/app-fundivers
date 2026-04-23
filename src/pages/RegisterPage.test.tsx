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
vi.mock('../components/register/RegisterForm', () => ({
  RegisterFormBody: ({ event }: { event: { title: string } }) => <div data-testid="form-body">{event.title}</div>,
}))

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

  it('shows the sign-in / sign-up gate when the visitor is not authed', async () => {
    useAuthMock.mockReturnValue({ user: null, profile: null, loading: false })
    fetchEventsForBookings.mockResolvedValue(new Map([['dive-a', testEvent]]))

    renderAt('/register/dive/dive-a')
    await screen.findByText('Kenting Dive')
    // Two buttons include "Sign in" text — the tab and the submit — so match exactly.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
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

  it('passes the current page URL as emailRedirectTo on signup so the confirmation link bounces back', async () => {
    useAuthMock.mockReturnValue({ user: null, profile: null, loading: false })
    fetchEventsForBookings.mockResolvedValue(new Map([['dive-a', testEvent]]))
    signUp.mockResolvedValue({ error: null })

    const user = userEvent.setup()
    renderAt('/register/dive/dive-a')
    await screen.findByText('Kenting Dive')

    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.type(screen.getByLabelText(/email/i), 'new@diver.test')
    await user.type(screen.getByLabelText(/password/i), 'abcdefgh')
    await user.click(screen.getByRole('button', { name: /create account and continue/i }))

    await waitFor(() => expect(signUp).toHaveBeenCalledOnce())
    const [arg] = signUp.mock.calls[0]
    expect(arg.email).toBe('new@diver.test')
    expect(arg.password).toBe('abcdefgh')
    // jsdom/happy-dom uses its own base URL (not the MemoryRouter's), so we
    // only assert that emailRedirectTo was supplied — the real value in
    // production is window.location.href of the register page.
    expect(typeof arg.options?.emailRedirectTo).toBe('string')
  })
})
