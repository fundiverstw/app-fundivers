import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminReferralsTab } from './AdminReferralsTab'
import type { Trip } from '../../types/database'
import type { AdminReferral } from '../../lib/trip-referrals'

const {
  fetchReferralsWithDivers, updateReferral, recordReferralBooking, setKickbackStatus,
} = vi.hoisted(() => ({
  fetchReferralsWithDivers: vi.fn(),
  updateReferral: vi.fn(),
  recordReferralBooking: vi.fn(),
  setKickbackStatus: vi.fn(),
}))

vi.mock('../../lib/trip-referrals', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/trip-referrals')>()
  return {
    // summarizeKickbacks is a pure helper — keep the real one.
    summarizeKickbacks: actual.summarizeKickbacks,
    fetchReferralsWithDivers: (...a: unknown[]) => fetchReferralsWithDivers(...a),
    updateReferral: (...a: unknown[]) => updateReferral(...a),
    recordReferralBooking: (...a: unknown[]) => recordReferralBooking(...a),
    setKickbackStatus: (...a: unknown[]) => setKickbackStatus(...a),
  }
})

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const trip: Trip = {
  id: 't1', created_at: '2026-06-01T00:00:00Z', partner_shop_id: 's1',
  title: 'Raja Ampat Liveaboard', destination: 'Indonesia', summary: null, description: null,
  start_date: null, end_date: null, price: 60000, currency: 'TWD', hero_image_url: null,
  highlights: [], booking_url: null, kickback_rate: 0.05, status: 'published', published_at: null, created_by: null,
}

function referral(over: Partial<AdminReferral> = {}): AdminReferral {
  return {
    id: 'r1', created_at: '2026-06-10T00:00:00Z', trip_id: 't1', diver_id: 'u1',
    referral_code: 'FD-7K2MQ4', status: 'interested', booked_amount: null, booked_currency: null,
    kickback_rate: null, kickback_amount: null, kickback_status: 'pending', received_at: null, admin_notes: null,
    diver: { id: 'u1', name: 'Ada Lovelace', nickname: 'Ada', email: 'ada@x.test', contact_id: '0900111222' },
    ...over,
  }
}

beforeEach(() => {
  for (const m of [fetchReferralsWithDivers, updateReferral, recordReferralBooking, setKickbackStatus]) m.mockReset()
  fetchReferralsWithDivers.mockResolvedValue([referral()])
  updateReferral.mockResolvedValue(undefined)
  recordReferralBooking.mockResolvedValue(undefined)
  setKickbackStatus.mockResolvedValue(undefined)
})

function renderTab() {
  return render(<AdminReferralsTab trips={[trip]} />)
}

describe('AdminReferralsTab', () => {
  it('lists a referral with its trip, diver and code', async () => {
    renderTab()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Ada/)).toBeInTheDocument()
    expect(screen.getByText('FD-7K2MQ4')).toBeInTheDocument()
    expect(screen.getByText('interested')).toBeInTheDocument()
  })

  it('reveals the diver contact only on request', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText('Raja Ampat Liveaboard')
    expect(screen.queryByText(/ada@x.test/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reveal contact/ }))
    expect(screen.getByText(/ada@x.test · 0900111222/)).toBeInTheDocument()
  })

  it('advances an interested referral to introduced', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Mark introduced' }))
    await waitFor(() => expect(updateReferral).toHaveBeenCalledWith('r1', { status: 'introduced' }))
  })

  it('records a booking, defaulting amount and rate from the trip', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Record booking' }))

    const dialog = await screen.findByRole('dialog')
    // Defaults pre-filled from the trip: 60000 / 5%.
    expect(within(dialog).getByLabelText('Booked amount')).toHaveValue(60000)
    expect(within(dialog).getByLabelText('Kickback percent')).toHaveValue(5)
    await user.click(within(dialog).getByRole('button', { name: 'Record booking' }))

    await waitFor(() => expect(recordReferralBooking).toHaveBeenCalledWith({
      id: 'r1', bookedAmount: 60000, bookedCurrency: 'TWD', kickbackRate: 0.05,
    }))
  })

  it('marks a booked referral’s kickback as received', async () => {
    const user = userEvent.setup()
    fetchReferralsWithDivers.mockResolvedValue([
      referral({ status: 'booked', booked_amount: 60000, booked_currency: 'TWD', kickback_rate: 0.05, kickback_amount: 3000 }),
    ])
    renderTab()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Kickback received' }))
    await waitFor(() => expect(setKickbackStatus).toHaveBeenCalledWith('r1', 'received'))
  })

  it('shows a kickback rollup of received vs outstanding', async () => {
    fetchReferralsWithDivers.mockResolvedValue([
      referral({ status: 'completed', kickback_status: 'received', booked_currency: 'TWD', kickback_amount: 3000 }),
      referral({ id: 'r2', status: 'booked', kickback_status: 'pending', booked_currency: 'TWD', kickback_amount: 2000 }),
    ])
    renderTab()
    const group = await screen.findByRole('group', { name: /Kickback totals/ })
    expect(within(group).getByText(/3,000 received/)).toBeInTheDocument()
    expect(within(group).getByText(/2,000 outstanding/)).toBeInTheDocument()
  })

  it('filters by referral code', async () => {
    const user = userEvent.setup()
    fetchReferralsWithDivers.mockResolvedValue([
      referral(),
      referral({ id: 'r2', referral_code: 'FD-ZZZZZZ', diver: { id: 'u2', name: 'Bo', nickname: 'Bo', email: null, contact_id: null } }),
    ])
    renderTab()
    await screen.findByText('FD-7K2MQ4')
    await user.type(screen.getByLabelText('Search referrals'), 'ZZZ')
    expect(screen.queryByText('FD-7K2MQ4')).not.toBeInTheDocument()
    expect(screen.getByText('FD-ZZZZZZ')).toBeInTheDocument()
  })
})
