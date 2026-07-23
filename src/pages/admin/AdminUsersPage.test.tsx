import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminUsersPage } from './AdminUsersPage'
import { fetchEventsForBookings } from '../../lib/events'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { t } from '../../i18n'

// AdminUsersPage pulls in a large tree (the diver-facing ProfileForm, family
// panel, notes, charge/credit maths). We only exercise the ?diver deep link
// here, so the heavy children and data helpers are stubbed to no-ops.
const { from, useAuthMock } = vi.hoisted(() => ({ from: vi.fn(), useAuthMock: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('../ProfilePage', () => ({ ProfileForm: () => null }))
vi.mock('../../components/admin/DiverNotes', () => ({ DiverNotes: () => null }))
vi.mock('../../components/admin/AdminFamilyPanel', () => ({ AdminFamilyPanel: () => null }))
vi.mock('../../components/admin/BookingPaymentsBlock', () => ({ BookingPaymentsBlock: () => null }))
vi.mock('../../lib/cert-card', () => ({ getCertCardSignedUrl: vi.fn().mockResolvedValue(null) }))
vi.mock('../../lib/events', () => ({
  fetchEventsForBookings: vi.fn().mockResolvedValue(new Map()),
  formatEventSpan: () => '',
}))
vi.mock('../../lib/booking-amendments', () => ({
  fetchAmendmentsForBookings: vi.fn().mockResolvedValue(new Map()),
  amendmentsDelta: () => 0,
}))
vi.mock('../../lib/booking-charge-catalog', () => ({ fetchChargeCatalog: vi.fn().mockResolvedValue({}) }))
vi.mock('../../lib/booking-charges', () => ({ resolveCharges: () => [] }))
vi.mock('../../lib/credits', () => ({
  fetchCreditsForUser: vi.fn().mockResolvedValue([]),
  openCreditForBooking: () => null,
  openCreditBalance: () => 0,
  diverCreditBalance: () => 0,
  createCredit: vi.fn(), settleCredit: vi.fn(), reopenCredit: vi.fn(), applyCreditToBooking: vi.fn(),
}))

const profiles = [
  { id: 'u1', name: 'Ada', nickname: 'Ada', role: 'diver', email: 'a@x.io', logged_dives: 0, gear_owned: [] },
  { id: 'u2', name: 'Bo',  nickname: 'Bo',  role: 'diver', email: 'b@x.io', logged_dives: 0, gear_owned: [] },
]

beforeEach(() => {
  from.mockReset(); useAuthMock.mockReset()
  vi.mocked(fetchEventsForBookings).mockResolvedValue(new Map())
  useAuthMock.mockReturnValue({ profile: { id: 'admin-1', role: 'admin' }, user: { id: 'admin-1' } })
  from.mockImplementation((table: string) => {
    if (table === 'profiles') return mockQueryBuilder({ data: profiles })
    return mockQueryBuilder({ data: [] })
  })
})

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AdminUsersPage /></MemoryRouter>)
}

describe('AdminUsersPage deep link', () => {
  it('auto-expands the diver named in ?diver=', async () => {
    renderAt('/admin/users?diver=u2')
    // Bo's card opens; Ada's stays collapsed.
    await waitFor(() => {
      const bo = document.getElementById('diver-u2')!.querySelector('[aria-expanded]')
      expect(bo).toHaveAttribute('aria-expanded', 'true')
    })
    const ada = document.getElementById('diver-u1')!.querySelector('[aria-expanded]')
    expect(ada).toHaveAttribute('aria-expanded', 'false')
  })

  it('exposes a register-on-behalf deep link on the expanded diver card', async () => {
    renderAt('/admin/users?diver=u2')
    const link = await screen.findByRole('link', { name: t.admin.users.registerForEvent })
    // Reuses the create-diver deep link: events list → preselected add-diver modal.
    expect(link).toHaveAttribute('href', '/admin/events?diver=u2')
  })

  it('links each booking to its event so an admin can act on the registration', async () => {
    // Without this an admin reading a diver's card had no way through to the
    // event page, where booking status is actually changed.
    vi.mocked(fetchEventsForBookings).mockResolvedValue(
      new Map([['ev-1', { id: 'ev-1', title: 'Green Island Fun Dive' }]]) as never,
    )
    from.mockImplementation((table: string) => {
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'bookings') {
        return mockQueryBuilder({ data: [{ id: 'b1', user_id: 'u2', event_id: 'ev-1', status: 'confirmed', details: { total: 3000 } }] })
      }
      return mockQueryBuilder({ data: [] })
    })

    renderAt('/admin/users?diver=u2')

    const link = await screen.findByRole('link', { name: 'Green Island Fun Dive' })
    expect(link).toHaveAttribute('href', '/admin/events/ev-1')
  })

  it('leaves every card collapsed with no ?diver param', async () => {
    renderAt('/admin/users')
    await screen.findByText('Ada')
    for (const id of ['diver-u1', 'diver-u2']) {
      const toggle = document.getElementById(id)!.querySelector('[aria-expanded]')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }
  })
})

describe('AdminUsersPage role promotion', () => {
  it('an admin can promote another user to staff', async () => {
    const builder = mockQueryBuilder({ data: profiles })
    const updateSpy = vi.fn(() => builder)
    ;(builder as Record<string, unknown>).update = updateSpy
    from.mockImplementation((table: string) =>
      table === 'profiles' ? builder : mockQueryBuilder({ data: [] }),
    )

    render(<MemoryRouter initialEntries={['/admin/users?diver=u2']}><AdminUsersPage /></MemoryRouter>)

    // Bo's card auto-expands; its admin action row exposes a role <select>.
    const card = await waitFor(() => {
      const el = document.getElementById('diver-u2')!.querySelector('select')
      if (!el) throw new Error('role select not rendered yet')
      return el as HTMLSelectElement
    })
    await userEvent.selectOptions(card, 'staff')

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ role: 'staff' }))
  })

  it('offers no role control for the admin’s own row', async () => {
    // admin-1 is the signed-in admin; expanding their own card must not let
    // them change their own role (guards against self-lockout).
    const self = [{ id: 'admin-1', name: 'Me', nickname: 'Me', role: 'admin', email: 'me@x.io', logged_dives: 0, gear_owned: [] }]
    from.mockImplementation((table: string) =>
      table === 'profiles' ? mockQueryBuilder({ data: self }) : mockQueryBuilder({ data: [] }),
    )
    render(<MemoryRouter initialEntries={['/admin/users?diver=admin-1']}><AdminUsersPage /></MemoryRouter>)
    await screen.findByText('Me')
    await waitFor(() => {
      const el = document.getElementById('diver-admin-1')!.querySelector('[aria-expanded]')
      expect(el).toHaveAttribute('aria-expanded', 'true')
    })
    expect(document.getElementById('diver-admin-1')!.querySelector('select')).toBeNull()
  })
})
