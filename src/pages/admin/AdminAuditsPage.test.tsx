import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminAuditsPage } from './AdminAuditsPage'
import type { DiverAuditTrail } from '../../lib/audit-trail'

const { from, fetchDiverAuditTrail } = vi.hoisted(() => ({
  from: vi.fn(),
  fetchDiverAuditTrail: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../lib/audit-trail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/audit-trail')>()),
  fetchDiverAuditTrail: (...a: unknown[]) => fetchDiverAuditTrail(...a),
}))

function query(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'in', 'eq']) b[m] = () => b
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return b
}

const profiles = [
  { id: 'd1', name: 'Alice Diver', nickname: null, contact_id: 'LINE-alice' },
  { id: 'd2', name: 'Carol Diver', nickname: null, contact_id: null },
  { id: 'admin1', name: 'Bob Admin', nickname: null, contact_id: null },
]

const trail: DiverAuditTrail = {
  profile: { id: 'd1', name: 'Alice Diver', nickname: null } as DiverAuditTrail['profile'],
  registrations: [{
    booking: { id: 'b1', status: 'confirmed', event_id: 'ev1', user_id: 'd1', details: { total: 4000 } } as DiverAuditTrail['registrations'][number]['booking'],
    event: { id: 'ev1', title: 'Green Island', currency: 'TWD', start_time: '2026-08-01T00:00:00Z', end_time: null, start_time_hhmm: null } as DiverAuditTrail['registrations'][number]['event'],
    owedBase: 4000,
    amendmentsDelta: 500,
    owed: 4500,
    paid: 1000,
    openCredit: 0,
    balance: { net: 3500, amount: 3500, state: 'due' },
    entries: [
      { id: 'payment:p1', at: '2026-05-10T00:00:00Z', source: 'payment', kind: 'payment_paid', bookingId: 'b1', userId: 'd1', amount: 1000, currency: 'TWD', actorId: 'admin1', note: null, method: 'bank_transfer', changed: null, raw: { id: 'p1' } },
      { id: 'amendment:a1', at: '2026-05-12T00:00:00Z', source: 'amendment', kind: 'amendment', bookingId: 'b1', userId: null, amount: 500, currency: null, actorId: 'admin1', note: 'extra tank', changed: null, raw: { id: 'a1' } },
    ],
  }],
  generalCredits: [],
  accountCreditBalance: 0,
  totals: { paid: 1000, refunded: 0, credited: 0, adjusted: 500 },
  allEntries: [],
}

beforeEach(() => {
  from.mockReset(); fetchDiverAuditTrail.mockReset()
  from.mockImplementation(() => query({ data: profiles, error: null }))
  fetchDiverAuditTrail.mockResolvedValue(trail)
})

function renderPage() {
  return render(<MemoryRouter><AdminAuditsPage /></MemoryRouter>)
}

describe('AdminAuditsPage', () => {
  it('lists divers and filters them by search', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Alice Diver')).toBeInTheDocument()
    expect(screen.getByText('Carol Diver')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/search divers/i), 'alice')
    expect(screen.getByText('Alice Diver')).toBeInTheDocument()
    expect(screen.queryByText('Carol Diver')).not.toBeInTheDocument()
  })

  it('opens a diver and shows the registration trail with balance and entry log', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Alice Diver/ }))

    await waitFor(() => expect(fetchDiverAuditTrail).toHaveBeenCalledWith('d1'))

    // Registration card: event, reconciled balance (owed 4500 − paid 1000).
    expect(await screen.findByText('Green Island')).toBeInTheDocument()
    expect(screen.getByText('TWD 3,500')).toBeInTheDocument()

    // Timeline entries render localized kind labels...
    expect(screen.getByText('Payment recorded')).toBeInTheDocument()
    expect(screen.getByText('Balance adjusted')).toBeInTheDocument()
    // ...attributed to the acting admin, resolved from the profile roster.
    expect(screen.getAllByText(/by Bob Admin/).length).toBeGreaterThan(0)
    // ...and each exposes a raw-record debug drawer.
    expect(screen.getAllByText('Raw record').length).toBe(2)
  })

  it('links the registration card through to its event', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Alice Diver/ }))

    const link = await screen.findByRole('link', { name: 'Green Island' })
    expect(link).toHaveAttribute('href', '/admin/events/ev1')
  })

  it('lets the admin return to the diver list', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Alice Diver/ }))
    await screen.findByText('Green Island')
    await user.click(screen.getByRole('button', { name: /change diver/i }))
    expect(screen.getByPlaceholderText(/search divers/i)).toBeInTheDocument()
  })
})
