import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminTrustedPartnersPage } from './AdminTrustedPartnersPage'
import type { TrustedPartnerRow } from '../../types/database'

const { fetchAll, save, del } = vi.hoisted(() => ({ fetchAll: vi.fn(), save: vi.fn(), del: vi.fn() }))
vi.mock('../../lib/trusted-partners', () => ({
  fetchAllTrustedPartners: (...a: unknown[]) => fetchAll(...a),
  saveTrustedPartner: (...a: unknown[]) => save(...a),
  deleteTrustedPartner: (...a: unknown[]) => del(...a),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const partners: TrustedPartnerRow[] = [
  { id: 'p1', name: 'Blue Manta', region: 'Anilao', blurb: null, email: 'bm@x.io', active: true, created_at: '', created_by: null },
]

beforeEach(() => {
  fetchAll.mockReset().mockResolvedValue(partners)
  save.mockReset().mockResolvedValue(undefined)
  del.mockReset().mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminTrustedPartnersPage /></MemoryRouter>)
}

describe('AdminTrustedPartnersPage', () => {
  it('lists partners with region + email (admin sees the email)', async () => {
    renderPage()
    expect(await screen.findByText('Blue Manta')).toBeInTheDocument()
    expect(screen.getByText(/Anilao · bm@x\.io/)).toBeInTheDocument()
  })

  it('creates a partner, requiring a valid email', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Blue Manta')
    await user.click(screen.getByRole('button', { name: /new partner/i }))

    await user.type(screen.getByLabelText(/shop name/i), 'Deep Blue')
    // Save is blocked without a valid email.
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(save).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^email/i), 'hello@deepblue.io')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Deep Blue', email: 'hello@deepblue.io', active: true }),
      undefined,
    ))
  })

  it('deletes a partner after confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Blue Manta')
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('p1'))
  })
})
