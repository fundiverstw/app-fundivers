import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminUsersPage } from './AdminUsersPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

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

  it('leaves every card collapsed with no ?diver param', async () => {
    renderAt('/admin/users')
    await screen.findByText('Ada')
    for (const id of ['diver-u1', 'diver-u2']) {
      const toggle = document.getElementById(id)!.querySelector('[aria-expanded]')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }
  })
})
