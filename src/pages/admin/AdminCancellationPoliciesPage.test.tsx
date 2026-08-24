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
  { id: 'p1', title: 'Standard', cancellation_policy: 'Full refund up to 7 days before.', language: 'English', active: true, deposit_refundable: true },
  { id: 'p2', title: 'Peak season', cancellation_policy: 'Non-refundable.', language: null, active: false, deposit_refundable: false },
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

  it('badges the policies whose deposit the shop keeps', async () => {
    renderPage()
    await screen.findByText('Peak season')
    expect(screen.getByText(/deposit kept/i)).toBeInTheDocument()
    // The refundable one carries no badge, so the list reads as an exception
    // list rather than a column of labels.
    expect(screen.getAllByText(/deposit kept/i)).toHaveLength(1)
  })

  it('saves a non-refundable deposit as deposit_refundable false', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Standard')
    await user.click(screen.getByRole('button', { name: /new policy/i }))

    await user.type(screen.getByLabelText(/^title/i), 'Course with eLearning')
    await user.type(screen.getByLabelText(/policy text/i), 'The deposit is non-refundable.')
    await user.click(screen.getByRole('checkbox', { name: /deposit is non-refundable/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(saveCancellationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ deposit_refundable: false }),
      undefined,
    ))
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
        language: null, active: true, deposit_refundable: true,
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
