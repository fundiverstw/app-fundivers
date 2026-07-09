import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminCancellationPoliciesPage } from './AdminCancellationPoliciesPage'
import type { CancellationPolicy } from '../../types/database'

const { fetchCancellationPolicies, saveCancellationPolicy, deleteCancellationPolicy } = vi.hoisted(() => ({
  fetchCancellationPolicies: vi.fn(),
  saveCancellationPolicy: vi.fn(),
  deleteCancellationPolicy: vi.fn(),
}))
vi.mock('../../lib/cancellation-policies', () => ({
  fetchCancellationPolicies: (...a: unknown[]) => fetchCancellationPolicies(...a),
  saveCancellationPolicy: (...a: unknown[]) => saveCancellationPolicy(...a),
  deleteCancellationPolicy: (...a: unknown[]) => deleteCancellationPolicy(...a),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const rows: CancellationPolicy[] = [
  { id: 'p1', title: 'Standard', cancellation_policy: 'Full refund up to 7 days before.', language: 'English', active: true },
  { id: 'p2', title: 'Peak season', cancellation_policy: 'Non-refundable.', language: null, active: false },
]

beforeEach(() => {
  fetchCancellationPolicies.mockReset().mockResolvedValue(rows)
  saveCancellationPolicy.mockReset().mockResolvedValue(undefined)
  deleteCancellationPolicy.mockReset().mockResolvedValue(undefined)
})

const renderPage = () => render(<MemoryRouter><AdminCancellationPoliciesPage /></MemoryRouter>)

describe('AdminCancellationPoliciesPage', () => {
  it('lists policies with their language and inactive flag', async () => {
    renderPage()
    expect(await screen.findByText('Standard')).toBeInTheDocument()
    expect(screen.getByText(/Full refund up to 7 days/i)).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText(/\(inactive\)/i)).toBeInTheDocument()
  })

  it('creates a policy through the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Standard')
    await user.click(screen.getByRole('button', { name: /new policy/i }))

    await user.type(screen.getByLabelText(/^title/i), 'Weekend trips')
    await user.type(screen.getByLabelText(/policy text/i), '50% refund up to 3 days before.')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(saveCancellationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Weekend trips', cancellation_policy: '50% refund up to 3 days before.',
        language: null, active: true,
      }),
      undefined,
    ))
  })

  it('deletes a policy after confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Standard')
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteCancellationPolicy).toHaveBeenCalledWith('p1'))
  })
})
