import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminWaiversPage } from './AdminWaiversPage'
import type { WaiverRow } from '../../types/database'

const { fetchAllWaivers, saveWaiver, deleteWaiver } = vi.hoisted(() => ({
  fetchAllWaivers: vi.fn(),
  saveWaiver: vi.fn(),
  deleteWaiver: vi.fn(),
}))
vi.mock('../../lib/waivers', () => ({
  fetchAllWaivers: (...a: unknown[]) => fetchAllWaivers(...a),
  saveWaiver: (...a: unknown[]) => saveWaiver(...a),
  deleteWaiver: (...a: unknown[]) => deleteWaiver(...a),
}))
vi.mock('../../lib/waiver-pdf', () => ({
  uploadWaiverPdf: vi.fn(),
  getWaiverPdfSignedUrl: vi.fn().mockResolvedValue('https://signed/pdf'),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const rows: WaiverRow[] = [
  { id: 'w1', created_at: '', created_by: null, code: 'padi_liability', title: 'Boat Liability', language: 'English', body: 'Release text.', pdf_path: null, cadence: 'annual', version: 2, applies_to: 'dives', course_colors: null, active: true },
  { id: 'w2', created_at: '', created_by: null, code: 'house_pdf', title: 'House Waiver', language: null, body: null, pdf_path: 'w2/x.pdf', cadence: 'per_event', version: 1, applies_to: 'none', course_colors: null, active: false },
]

beforeEach(() => {
  fetchAllWaivers.mockReset().mockResolvedValue(rows)
  saveWaiver.mockReset().mockResolvedValue(undefined)
  deleteWaiver.mockReset().mockResolvedValue(undefined)
})

const renderPage = () => render(<MemoryRouter><AdminWaiversPage /></MemoryRouter>)

describe('AdminWaiversPage', () => {
  it('lists waivers with their type, cadence and inactive flag', async () => {
    renderPage()
    expect(await screen.findByText('Boat Liability')).toBeInTheDocument()
    expect(screen.getByText(/Text · Annual · applies to dives/i)).toBeInTheDocument()
    expect(screen.getByText(/PDF · Per event/i)).toBeInTheDocument()
    expect(screen.getByText(/\(inactive\)/i)).toBeInTheDocument()
  })

  it('creates a text waiver through the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Boat Liability')
    await user.click(screen.getByRole('button', { name: /new waiver/i }))

    await user.type(screen.getByLabelText(/^title/i), 'Night Dive Release')
    await user.type(screen.getByLabelText(/^code/i), 'night_release')
    await user.type(screen.getByLabelText(/waiver text/i), 'I accept the risks of night diving.')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(saveWaiver).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'night_release', title: 'Night Dive Release',
        body: 'I accept the risks of night diving.', pdf_path: null,
        cadence: 'annual', applies_to: 'none', version: 1, active: true,
      }),
      undefined,
    ))
  })

  it('deletes a waiver after confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Boat Liability')
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteWaiver).toHaveBeenCalledWith('w1'))
  })
})
