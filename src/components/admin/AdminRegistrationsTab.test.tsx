import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminRegistrationsTab } from './AdminRegistrationsTab'
import type { AdminRegistration } from '../../lib/package-registrations'

const {
  fetchRegistrationsWithDivers, setKickbackStatus, setRegistrationStatus,
} = vi.hoisted(() => ({
  fetchRegistrationsWithDivers: vi.fn(),
  setKickbackStatus: vi.fn(),
  setRegistrationStatus: vi.fn(),
}))

vi.mock('../../lib/package-registrations', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/package-registrations')>()
  return {
    // summarizeKickbacks is a pure helper — keep the real one.
    summarizeKickbacks: actual.summarizeKickbacks,
    fetchRegistrationsWithDivers: (...a: unknown[]) => fetchRegistrationsWithDivers(...a),
    setKickbackStatus: (...a: unknown[]) => setKickbackStatus(...a),
    setRegistrationStatus: (...a: unknown[]) => setRegistrationStatus(...a),
  }
})

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

function registration(over: Partial<AdminRegistration> = {}): AdminRegistration {
  return {
    id: 'reg1', created_at: '2026-06-10T00:00:00Z', package_id: 'p1', tier_id: 't1', diver_id: 'u1',
    preferred_start: null, preferred_end: null, estimated_cost: 55000, estimated_currency: 'TWD',
    details: {} as AdminRegistration['details'], notes: null, status: 'registered',
    kickback_rate: 0.05, kickback_amount: 3000, kickback_status: 'expected', paid_at: null, admin_notes: null,
    diver: { id: 'u1', name: 'Ada Lovelace', nickname: 'Ada', email: 'ada@x.test', contact_id: '0900111222' },
    package_title: 'Raja Ampat Liveaboard', tier_name: 'Package A',
    ...over,
  }
}

beforeEach(() => {
  for (const m of [fetchRegistrationsWithDivers, setKickbackStatus, setRegistrationStatus]) m.mockReset()
  fetchRegistrationsWithDivers.mockResolvedValue([registration()])
  setKickbackStatus.mockResolvedValue(undefined)
  setRegistrationStatus.mockResolvedValue(undefined)
})

describe('AdminRegistrationsTab', () => {
  it('rolls up expected vs paid kickbacks by currency', async () => {
    fetchRegistrationsWithDivers.mockResolvedValue([
      registration({ kickback_amount: 3000, kickback_status: 'paid' }),
      registration({ id: 'reg2', kickback_amount: 2000, kickback_status: 'expected' }),
    ])
    render(<AdminRegistrationsTab />)
    const group = await screen.findByRole('group', { name: /Kickback totals/ })
    expect(within(group).getByText(/5,000 expected/)).toBeInTheDocument()
    expect(within(group).getByText(/3,000 paid/)).toBeInTheDocument()
    expect(within(group).getByText(/2,000 outstanding/)).toBeInTheDocument()
  })

  it('shows a registration card with its diver, tier and estimate', async () => {
    render(<AdminRegistrationsTab />)
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace \(Ada\) · Package A/)).toBeInTheDocument()
    expect(screen.getByText(/Est\. 55,000 TWD/)).toBeInTheDocument()
  })

  it('reveals the diver contact only on request', async () => {
    const user = userEvent.setup()
    render(<AdminRegistrationsTab />)
    await screen.findByText('Raja Ampat Liveaboard')
    expect(screen.queryByText(/ada@x.test/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reveal contact/ }))
    expect(screen.getByText(/ada@x.test · 0900111222/)).toBeInTheDocument()
  })

  it('marks a kickback paid', async () => {
    const user = userEvent.setup()
    render(<AdminRegistrationsTab />)
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Mark kickback paid' }))
    await waitFor(() => expect(setKickbackStatus).toHaveBeenCalledWith('reg1', 'paid'))
  })

  it('filters by diver, package or tier', async () => {
    const user = userEvent.setup()
    fetchRegistrationsWithDivers.mockResolvedValue([
      registration(),
      registration({
        id: 'reg2', package_title: 'Anilao Macro Week', tier_name: 'Package B',
        diver: { id: 'u2', name: 'Bo', nickname: null, email: null, contact_id: null },
      }),
    ])
    render(<AdminRegistrationsTab />)
    await screen.findByText('Raja Ampat Liveaboard')
    await user.type(screen.getByLabelText('Search registrations'), 'Anilao')
    expect(screen.queryByText('Raja Ampat Liveaboard')).not.toBeInTheDocument()
    expect(screen.getByText('Anilao Macro Week')).toBeInTheDocument()
  })
})
