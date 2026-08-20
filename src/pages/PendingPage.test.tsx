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

vi.mock('./ProfilePage', () => ({
  ProfileForm: () => <div>PROFILE_FORM</div>,
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
  it('renders the awaiting-approval copy for pending status', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'pending' }, signOut })
    renderPage()
    expect(screen.getByRole('heading', { name: t.pending.reviewTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.pending.rejectedTitle })).not.toBeInTheDocument()
  })

  it('renders the rejected copy for rejected status', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'rejected' }, signOut })
    renderPage()
    expect(screen.getByRole('heading', { name: t.pending.rejectedTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.pending.reviewTitle })).not.toBeInTheDocument()
  })

  it('signs the user out when the button is clicked', () => {
    useAuthMock.mockReturnValue({ profile: { status: 'pending' }, signOut })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: t.common.signOut }))
    expect(signOut).toHaveBeenCalled()
  })

  it('offers the profile form to a diver who has filled in nothing at all', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'u1', status: 'pending' },
      signOut,
    })
    renderPage()
    // An empty profile is not an unfinished application — it waits for
    // approval like any other.
    expect(screen.getByRole('heading', { name: t.pending.reviewTitle })).toBeInTheDocument()
    expect(screen.getByText('PROFILE_FORM')).toBeInTheDocument()
  })

  it('names the blanks the shop would still like filled', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1', status: 'pending',
        name: 'Ada', date_of_birth: '1990-01-01', nationality: 'British',
        contact_method: 'email', contact_id: 'ada@example.com',
        uncertified: true,
      },
      signOut,
    })
    renderPage()
    expect(screen.getByText(t.pending.stillMissing(t.profile.genderLabel))).toBeInTheDocument()
  })

  it('says nothing about blanks when the profile is complete', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1', status: 'pending',
        name: 'Ada', date_of_birth: '1990-01-01', nationality: 'British',
        gender: 'female', contact_method: 'email', contact_id: 'ada@example.com',
        uncertified: true,
      },
      signOut,
    })
    renderPage()
    expect(screen.queryByText(t.pending.stillMissing(t.profile.genderLabel))).not.toBeInTheDocument()
  })
})
