import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PendingPage } from './PendingPage'

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
  it('renders the under-review copy for pending status', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'pending' }, signOut })
    renderPage()
    expect(screen.getByRole('heading', { name: /under review/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /not approved/i })).not.toBeInTheDocument()
  })

  it('renders the rejected copy for rejected status', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'rejected' }, signOut })
    renderPage()
    expect(screen.getByRole('heading', { name: /not approved/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /under review/i })).not.toBeInTheDocument()
  })

  it('signs the user out when the button is clicked', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'pending' }, signOut })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(signOut).toHaveBeenCalled()
  })

  it('shows the "application submitted" screen when the diver already filled in the required fields', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1', status: 'pending',
        name: 'Ada', nickname: 'Ada',
        date_of_birth: '1990-01-01',
        cert_level: 'Open Water',
        contact_method: 'email', contact_id: 'ada@example.com',
      },
      signOut,
    })
    renderPage()
    expect(screen.getByRole('heading', { name: /application submitted/i })).toBeInTheDocument()
    // Form is hidden in this state.
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
  })

  it('treats an uncertified diver (no cert level) as complete', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1', status: 'pending',
        name: 'Ada', nickname: 'Ada',
        date_of_birth: '1990-01-01',
        cert_level: null, uncertified: true,
        contact_method: 'email', contact_id: 'ada@example.com',
      },
      signOut,
    })
    renderPage()
    expect(screen.getByRole('heading', { name: /application submitted/i })).toBeInTheDocument()
  })

  it('keeps a diver who has neither a cert level nor an uncertified flag on the form', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1', status: 'pending',
        name: 'Ada', nickname: 'Ada',
        date_of_birth: '1990-01-01',
        cert_level: null,
        contact_method: 'email', contact_id: 'ada@example.com',
      },
      signOut,
    })
    renderPage()
    expect(screen.getByRole('heading', { name: /under review/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })
})
