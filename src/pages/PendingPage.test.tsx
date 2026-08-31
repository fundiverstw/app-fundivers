import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PendingPage } from './PendingPage'
import { t } from '../i18n'

const { useAuthMock, signOut } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  signOut:     vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  useAuthMock.mockReset()
  signOut.mockReset()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <PendingPage />
    </MemoryRouter>
  )
}

describe('PendingPage', () => {
  it('renders the on-hold copy for pending status', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'pending' }, signOut })
    renderPage()
    expect(screen.getByRole('heading', { name: t.pending.holdTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.pending.rejectedTitle })).not.toBeInTheDocument()
  })

  it('renders the closed copy for rejected status', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'rejected' }, signOut })
    renderPage()
    expect(screen.getByRole('heading', { name: t.pending.rejectedTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.pending.holdTitle })).not.toBeInTheDocument()
  })

  it('signs the user out when the button is clicked', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'pending' }, signOut })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: t.common.signOut }))
    expect(signOut).toHaveBeenCalled()
  })

  // The one useful action for a suspended account is talking to a human.
  it('gives the shop address to write to, in both states', () => {
    for (const status of ['pending', 'rejected'] as const) {
      useAuthMock.mockReturnValue({ profile: { status }, signOut })
      const { unmount } = renderPage()
      expect(screen.getByRole('link', { name: /@/ })).toHaveAttribute('href', expect.stringMatching(/^mailto:/))
      unmount()
    }
  })

  // Signup no longer lands anyone here, so the page must not imply that
  // filling a form in is what gets the account back — the profile form and
  // its "still blank" nag both belonged to the old approval queue.
  it('offers no profile form to fill in', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'u1', status: 'pending' },
      signOut,
    })
    renderPage()
    expect(document.querySelector('form')).toBeNull()
    expect(document.querySelector('input')).toBeNull()
  })
})
