import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PartnerConnectPage } from './PartnerConnectPage'

const useAuthMock = vi.fn()
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

const sendMock = vi.fn()
vi.mock('../lib/partner-connect', () => ({
  sendPartnerConnectRequest: (...a: unknown[]) => sendMock(...a),
}))

beforeEach(() => {
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ profile: { name: 'Ada Lovelace', nickname: null } })
  sendMock.mockReset()
})

function renderPage() {
  return render(<MemoryRouter><PartnerConnectPage /></MemoryRouter>)
}

describe('PartnerConnectPage', () => {
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
