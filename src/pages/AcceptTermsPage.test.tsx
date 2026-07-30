import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AcceptTermsPage } from './AcceptTermsPage'
import * as terms from '../lib/terms'

vi.mock('../lib/use-terms', () => ({
  useTerms: () => ({
    terms: { title: 'Terms of Use & Privacy', body: 'You agree to dive safely.', version: 3, updatedAt: '' },
    loading: false,
  }),
}))

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/accept-terms${query}`]}>
      <Routes>
        <Route path="/accept-terms" element={<AcceptTermsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.restoreAllMocks() })

describe('AcceptTermsPage', () => {
  it('shows the terms document and an agree button for a valid link', async () => {
    vi.spyOn(terms, 'termsTokenState').mockResolvedValue('valid')
    renderAt('?token=abc')

    expect(await screen.findByRole('button', { name: /i agree/i })).toBeInTheDocument()
    // The document has to be in front of them at the moment they agree, not a
    // link to it.
    expect(screen.getByText(/you agree to dive safely/i)).toBeInTheDocument()
    expect(screen.getByText('Terms of Use & Privacy')).toBeInTheDocument()
  })

  it('records consent and thanks them', async () => {
    vi.spyOn(terms, 'termsTokenState').mockResolvedValue('valid')
    const accept = vi.spyOn(terms, 'acceptTermsWithToken').mockResolvedValue(3)
    const user = userEvent.setup()
    renderAt('?token=abc')

    await user.click(await screen.findByRole('button', { name: /i agree/i }))
    expect(accept).toHaveBeenCalledWith('abc')
    expect(await screen.findByText(/that's recorded/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /i agree/i })).not.toBeInTheDocument()
  })

  it('tells an already-used link that there is nothing to do', async () => {
    vi.spyOn(terms, 'termsTokenState').mockResolvedValue('used')
    renderAt('?token=abc')

    expect(await screen.findByText(/already been used/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /i agree/i })).not.toBeInTheDocument()
  })

  it('points an expired link at the shop for a fresh one', async () => {
    vi.spyOn(terms, 'termsTokenState').mockResolvedValue('expired')
    renderAt('?token=abc')

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /i agree/i })).not.toBeInTheDocument()
  })

  it('treats a missing token as unreadable without calling the RPC', async () => {
    const state = vi.spyOn(terms, 'termsTokenState')
    renderAt('')

    expect(await screen.findByText(/couldn't read this link/i)).toBeInTheDocument()
    expect(state).not.toHaveBeenCalled()
  })

  // A read failure must not present as a working link — the diver would tap
  // Accept and land on a raw error instead of "ask us for a fresh one".
  it('does not offer the button when the state lookup fails', async () => {
    vi.spyOn(terms, 'termsTokenState').mockRejectedValue(new Error('offline'))
    renderAt('?token=abc')

    expect(await screen.findByText(/couldn't read this link/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /i agree/i })).not.toBeInTheDocument()
  })

  // Two tabs on the same link: the second one loses the UPDATE race.
  it('falls back to the used message when the accept call is rejected', async () => {
    vi.spyOn(terms, 'termsTokenState').mockResolvedValue('valid')
    vi.spyOn(terms, 'acceptTermsWithToken').mockRejectedValue(new Error('no longer valid'))
    const user = userEvent.setup()
    renderAt('?token=abc')

    await user.click(await screen.findByRole('button', { name: /i agree/i }))
    expect(await screen.findByText(/already been used/i)).toBeInTheDocument()
  })
})
