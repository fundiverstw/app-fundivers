import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TrustedPartnersPage } from './TrustedPartnersPage'

const useAuthMock = vi.fn()
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

const sendMock = vi.fn()
vi.mock('../lib/partner-connect', () => ({
  sendPartnerConnectRequest: (...a: unknown[]) => sendMock(...a),
}))

const { fetchPartnersMock, contactMock } = vi.hoisted(() => ({
  fetchPartnersMock: vi.fn(), contactMock: vi.fn(),
}))
vi.mock('../lib/trusted-partners', () => ({
  fetchTrustedPartners: (...a: unknown[]) => fetchPartnersMock(...a),
  contactTrustedPartner: (...a: unknown[]) => contactMock(...a),
}))

beforeEach(() => {
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ profile: { name: 'Ada Lovelace', nickname: null } })
  sendMock.mockReset()
  fetchPartnersMock.mockReset(); fetchPartnersMock.mockResolvedValue([])
  contactMock.mockReset()
})

function renderPage() {
  return render(<MemoryRouter><TrustedPartnersPage /></MemoryRouter>)
}

describe('TrustedPartnersPage', () => {
  it('keeps the submit button disabled until a destination is entered', async () => {
    const user = userEvent.setup()
    renderPage()
    const button = screen.getByRole('button', { name: /send request/i })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/where do you want to go/i), 'Cebu')
    expect(button).toBeEnabled()
  })

  it('submits destination + note and shows a confirmation', async () => {
    sendMock.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/where do you want to go/i), 'Cebu, Philippines')
    await user.type(screen.getByLabelText(/anything else/i), 'going in March')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => expect(sendMock).toHaveBeenCalledWith({ destination: 'Cebu, Philippines', note: 'going in March' }))
    expect(await screen.findByText(/we got your request/i)).toBeInTheDocument()
    expect(screen.getByText(/Cebu, Philippines/)).toBeInTheDocument()
  })

  it('lists trusted partners and messages one through the edge function', async () => {
    fetchPartnersMock.mockResolvedValue([
      { id: 'p1', name: 'Blue Manta', region: 'Anilao', blurb: 'Great muck diving' },
    ])
    contactMock.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Blue Manta')).toBeInTheDocument()
    expect(screen.getByText('Anilao')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^message$/i }))
    await user.type(screen.getByLabelText(/message to Blue Manta/i), 'Coming in March')
    await user.click(screen.getByRole('button', { name: /send to Blue Manta/i }))

    await waitFor(() => expect(contactMock).toHaveBeenCalledWith({ partnerId: 'p1', message: 'Coming in March' }))
    expect(await screen.findByText(/will reply straight to your email/i)).toBeInTheDocument()
  })

  it('stays on the form when the request fails', async () => {
    sendMock.mockRejectedValue(new Error('email failed'))
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/where do you want to go/i), 'Bali')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => expect(sendMock).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument()
    expect(screen.queryByText(/we got your request/i)).not.toBeInTheDocument()
  })
})
