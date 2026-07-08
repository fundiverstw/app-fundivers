import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminScheduledTripRegistrationsTab } from './AdminScheduledTripRegistrationsTab'
import type { AdminScheduledTripRegistration } from '../../lib/scheduled-trip-registrations'

const { fetchRegistrationsWithDivers, setRegistrationStatus } = vi.hoisted(() => ({
  fetchRegistrationsWithDivers: vi.fn(),
  setRegistrationStatus: vi.fn(),
}))

vi.mock('../../lib/scheduled-trip-registrations', () => ({
  fetchRegistrationsWithDivers: (...a: unknown[]) => fetchRegistrationsWithDivers(...a),
  setRegistrationStatus: (...a: unknown[]) => setRegistrationStatus(...a),
}))

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

function registration(over: Partial<AdminScheduledTripRegistration> = {}): AdminScheduledTripRegistration {
  return {
    id: 'reg1', created_at: '2026-06-10T00:00:00Z', scheduled_trip_id: 's1', diver_id: 'u1',
    estimated_cost: 82000, estimated_currency: 'TWD', details: {} as AdminScheduledTripRegistration['details'],
    notes: null, status: 'registered', admin_notes: null,
    diver: { id: 'u1', name: 'Ada Lovelace', nickname: 'Ada', email: 'ada@x.test', contact_id: '0900111222' },
    trip_title: 'Palau Liveaboard',
    ...over,
  }
}

beforeEach(() => {
  for (const m of [fetchRegistrationsWithDivers, setRegistrationStatus]) m.mockReset()
  fetchRegistrationsWithDivers.mockResolvedValue([registration()])
  setRegistrationStatus.mockResolvedValue(undefined)
})

describe('AdminScheduledTripRegistrationsTab', () => {
  it('shows a registration card with its diver, trip and estimate', async () => {
    render(<AdminScheduledTripRegistrationsTab />)
    expect(await screen.findByText('Palau Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace \(Ada\)/)).toBeInTheDocument()
    expect(screen.getByText(/Est\. 82,000 TWD/)).toBeInTheDocument()
  })

  it('reveals the diver contact only on request', async () => {
    const user = userEvent.setup()
    render(<AdminScheduledTripRegistrationsTab />)
    await screen.findByText('Palau Liveaboard')
    expect(screen.queryByText(/ada@x.test/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reveal contact/ }))
    expect(screen.getByText(/ada@x.test · 0900111222/)).toBeInTheDocument()
  })

  it('marks a registration completed', async () => {
    const user = userEvent.setup()
    render(<AdminScheduledTripRegistrationsTab />)
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Mark completed' }))
    await waitFor(() => expect(setRegistrationStatus).toHaveBeenCalledWith('reg1', 'completed'))
  })

  it('filters by diver or trip', async () => {
    const user = userEvent.setup()
    fetchRegistrationsWithDivers.mockResolvedValue([
      registration(),
      registration({
        id: 'reg2', trip_title: 'Green Island Weekend',
        diver: { id: 'u2', name: 'Bo', nickname: null, email: null, contact_id: null },
      }),
    ])
    render(<AdminScheduledTripRegistrationsTab />)
    await screen.findByText('Palau Liveaboard')
    await user.type(screen.getByLabelText('Search registrations'), 'Green Island')
    expect(screen.queryByText('Palau Liveaboard')).not.toBeInTheDocument()
    expect(screen.getByText('Green Island Weekend')).toBeInTheDocument()
  })
})
