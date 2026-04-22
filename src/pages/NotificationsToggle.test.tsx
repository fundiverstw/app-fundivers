import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationsToggle } from './ProfilePage'
import { renderWithRouter } from '../../tests/test-utils'

const { supported, getSub, subscribe, unsubscribe } = vi.hoisted(() => ({
  supported:   vi.fn(),
  getSub:      vi.fn(),
  subscribe:   vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../lib/push', () => ({
  pushSupported:       () => supported(),
  getPushSubscription: () => getSub(),
  subscribeToPush:     () => subscribe(),
  unsubscribeFromPush: () => unsubscribe(),
}))

beforeEach(() => {
  supported.mockReset()
  getSub.mockReset()
  subscribe.mockReset()
  unsubscribe.mockReset()
})

describe('NotificationsToggle', () => {
  it('renders the iOS install hint when push is unsupported', async () => {
    supported.mockReturnValue(false)
    renderWithRouter(<NotificationsToggle />)
    expect(await screen.findByText(/install .* to your Home Screen/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows the toggle checked when a subscription already exists', async () => {
    supported.mockReturnValue(true)
    getSub.mockResolvedValue({ endpoint: 'https://push.example/1' })
    renderWithRouter(<NotificationsToggle />)
    const cb = await screen.findByRole('checkbox')
    await waitFor(() => expect(cb).toBeChecked())
  })

  it('shows the toggle unchecked when no subscription exists', async () => {
    supported.mockReturnValue(true)
    getSub.mockResolvedValue(null)
    renderWithRouter(<NotificationsToggle />)
    const cb = await screen.findByRole('checkbox')
    await waitFor(() => expect(cb).not.toBeChecked())
  })

  it('calls subscribeToPush when user turns the toggle on', async () => {
    supported.mockReturnValue(true)
    getSub.mockResolvedValue(null)
    subscribe.mockResolvedValue({})
    renderWithRouter(<NotificationsToggle />)
    const cb = await screen.findByRole('checkbox')
    await waitFor(() => expect(cb).not.toBeChecked())

    await userEvent.click(cb)
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce())
    expect(cb).toBeChecked()
  })

  it('calls unsubscribeFromPush when user turns the toggle off', async () => {
    supported.mockReturnValue(true)
    getSub.mockResolvedValue({ endpoint: 'https://push.example/1' })
    unsubscribe.mockResolvedValue(undefined)
    renderWithRouter(<NotificationsToggle />)
    const cb = await screen.findByRole('checkbox')
    await waitFor(() => expect(cb).toBeChecked())

    await userEvent.click(cb)
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce())
    expect(cb).not.toBeChecked()
  })

  it('surfaces the error message when subscribeToPush throws', async () => {
    supported.mockReturnValue(true)
    getSub.mockResolvedValue(null)
    subscribe.mockRejectedValue(new Error('Permission denied'))
    renderWithRouter(<NotificationsToggle />)
    const cb = await screen.findByRole('checkbox')
    await waitFor(() => expect(cb).not.toBeChecked())

    await userEvent.click(cb)
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
  })
})
