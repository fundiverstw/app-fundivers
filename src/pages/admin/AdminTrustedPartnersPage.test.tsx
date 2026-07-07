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
  {
    id: 'p1', created_at: '', name: 'Blue Manta', country: 'Philippines', location: 'Anilao',
    website: null, contact_name: null, contact_email: 'bm@x.io', vouch_notes: null,
    logo_url: null, default_kickback_rate: 0.05, active: true, created_by: null,
  },
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
  it('lists partners with location + contact email (admin sees the email)', async () => {
    renderPage()
    expect(await screen.findByText('Blue Manta')).toBeInTheDocument()
    expect(screen.getByText(/Anilao · bm@x\.io/)).toBeInTheDocument()
  })

  it('requires a name, rejects an invalid email, and saves the unified fields', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Blue Manta')
    await user.click(screen.getByRole('button', { name: /new partner/i }))

    // Save is blocked without a name.
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(save).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/shop name/i), 'Deep Blue')
    // A malformed contact email is rejected (email is optional but must be valid).
    await user.type(screen.getByLabelText(/contact email/i), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(save).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText(/contact email/i))
    await user.type(screen.getByLabelText(/contact email/i), 'hello@deepblue.io')
    await user.type(screen.getByLabelText(/^website/i), 'https://deepblue.example')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Deep Blue', contact_email: 'hello@deepblue.io',
        website: 'https://deepblue.example', active: true,
      }),
      undefined,
    ))
  })

  it('creates a partner with just a name (contact email optional)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Blue Manta')
    await user.click(screen.getByRole('button', { name: /new partner/i }))
    await user.type(screen.getByLabelText(/shop name/i), 'Nameless Reef')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nameless Reef', contact_email: null }),
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
