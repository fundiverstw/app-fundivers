import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminTermsPage } from './AdminTermsPage'

// The version is what forces every diver to re-accept, so the rule this page
// exists to enforce is: a save only bumps it when the admin says the change was
// material. Everything else here is chrome.

const update = vi.fn()
const eq = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ update: (...a: unknown[]) => { update(...a); return { eq: (...b: unknown[]) => { eq(...b); return { error: null } } } } }) },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'admin-1' } }) }))
const toastSuccess = vi.fn()
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: toastSuccess, error: vi.fn() }) }))

const fetchTerms = vi.fn()
vi.mock('../../lib/terms', () => ({
  fetchTerms: () => fetchTerms(),
  invalidateTerms: vi.fn(),
}))

beforeEach(() => {
  update.mockReset(); eq.mockReset(); toastSuccess.mockReset(); fetchTerms.mockReset()
  fetchTerms.mockResolvedValue({ title: 'Terms of Use', body: '# Hi', version: 3, updatedAt: '2026-07-10T00:00:00Z' })
})

async function renderPage() {
  render(<AdminTermsPage />)
  await screen.findByRole('button', { name: /^Save$/ })
}

describe('AdminTermsPage', () => {
  it('does not bump the version for a non-material edit', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][0]).toMatchObject({ version: 3 })
  })

  it('bumps the version when the edit is marked material', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][0]).toMatchObject({ version: 4 })
  })

  it('refuses to publish an empty body', async () => {
    fetchTerms.mockResolvedValue({ title: 'T', body: '', version: 1, updatedAt: '2026-07-10T00:00:00Z' })
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(await screen.findByText(/cannot be empty/i)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('loads the starter template into an empty body without a confirm', async () => {
    fetchTerms.mockResolvedValue({ title: 'T', body: '', version: 1, updatedAt: '2026-07-10T00:00:00Z' })
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: /starter template/i }))
    const textarea = screen.getByPlaceholderText(/starter template below/i) as HTMLTextAreaElement
    expect(textarea.value).toContain('TODO_JURISDICTION')
    expect(textarea.value).toContain('Delete this block before publishing')
  })

  it('asks before overwriting existing text with the template', async () => {
    // happy-dom does not implement window.confirm.
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: /starter template/i }))
    expect(confirm).toHaveBeenCalled()
    // Declined: the admin's own text survives.
    expect(screen.getByDisplayValue('# Hi')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('overwrites when the admin confirms', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: /starter template/i }))
    expect(screen.queryByDisplayValue('# Hi')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
