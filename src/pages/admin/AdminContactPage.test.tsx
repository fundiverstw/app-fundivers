import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminContactPage } from './AdminContactPage'
import type { ContactChannel } from '../../types/database'
import { t } from '../../i18n'

const {
  fetchAllContactChannels, fetchShopContact, saveShopContact,
  saveContactChannel, deleteContactChannel, refresh,
} = vi.hoisted(() => ({
  fetchAllContactChannels: vi.fn(),
  fetchShopContact: vi.fn(),
  saveShopContact: vi.fn(),
  saveContactChannel: vi.fn(),
  deleteContactChannel: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../../lib/contact', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/contact')>()),
  fetchAllContactChannels: (...a: unknown[]) => fetchAllContactChannels(...a),
  fetchShopContact: (...a: unknown[]) => fetchShopContact(...a),
  saveShopContact: (...a: unknown[]) => saveShopContact(...a),
  saveContactChannel: (...a: unknown[]) => saveContactChannel(...a),
  deleteContactChannel: (...a: unknown[]) => deleteContactChannel(...a),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../hooks/useShopContact', () => ({
  useShopContact: () => ({
    contact: { email: '', phone: '', address: '', mapsUrl: null },
    channels: [],
    loading: false,
    refresh,
  }),
}))

const ac = t.admin.contact

const channels: ContactChannel[] = [
  {
    id: 'ch-1', created_at: '2026-09-01T00:00:00Z', created_by: null,
    kind: 'line', label: null, url: 'https://line.me/R/ti/p/%40x',
    sort_order: 1, active: true,
  },
  {
    id: 'ch-2', created_at: '2026-09-01T00:00:00Z', created_by: null,
    kind: 'phone', label: 'Call the dive desk', url: '+886 909-083-683',
    sort_order: 2, active: false,
  },
]

beforeEach(() => {
  fetchAllContactChannels.mockReset().mockResolvedValue(channels)
  fetchShopContact.mockReset().mockResolvedValue({
    email: 'shop@example.com', phone: '+886 900-000-000',
    address: '1 Test St', mapsUrl: 'https://maps.example/x',
  })
  saveShopContact.mockReset().mockResolvedValue(undefined)
  saveContactChannel.mockReset().mockResolvedValue(undefined)
  deleteContactChannel.mockReset().mockResolvedValue(undefined)
  refresh.mockReset().mockResolvedValue(undefined)
})

const renderPage = () => render(<MemoryRouter><AdminContactPage /></MemoryRouter>)

describe('AdminContactPage — the shop\'s details', () => {
  it('opens on what the shop has published', async () => {
    renderPage()
    expect(await screen.findByDisplayValue('shop@example.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+886 900-000-000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1 Test St')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://maps.example/x')).toBeInTheDocument()
  })

  it('saves an edited email, trimmed', async () => {
    const user = userEvent.setup()
    renderPage()
    const email = await screen.findByDisplayValue('shop@example.com')
    await user.clear(email)
    await user.type(email, '  hello@newshop.com  ')
    await user.click(screen.getByRole('button', { name: ac.saveDetails }))

    await waitFor(() => expect(saveShopContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'hello@newshop.com',
    })))
  })

  // A blank map link is an absence, not an empty string: the column is nullable
  // and the check constraint refuses a value that is not a URL.
  it('sends a cleared map link as null', async () => {
    const user = userEvent.setup()
    renderPage()
    const maps = await screen.findByDisplayValue('https://maps.example/x')
    await user.clear(maps)
    await user.click(screen.getByRole('button', { name: ac.saveDetails }))

    await waitFor(() => expect(saveShopContact).toHaveBeenCalledWith(expect.objectContaining({
      maps_url: null,
    })))
  })

  // Every diver-facing surface reads the provider, so a save that did not
  // refresh it would look like it had not saved.
  it('refreshes what the rest of the app is showing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('shop@example.com')
    await user.click(screen.getByRole('button', { name: ac.saveDetails }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})

describe('AdminContactPage — the buttons', () => {
  it('lists them with their service, and marks the hidden ones', async () => {
    renderPage()
    expect(await screen.findByText(t.contact.channelDefaults.line)).toBeInTheDocument()
    expect(screen.getByText('Call the dive desk')).toBeInTheDocument()
    expect(screen.getByText(ac.kinds.phone)).toBeInTheDocument()
    expect(screen.getByText(t.admin.waivers.inactive)).toBeInTheDocument()
  })

  // What a phone number turns into is the thing worth checking before a diver
  // taps it, so the row shows the href rather than the stored value.
  it('shows what a phone button will actually dial', async () => {
    renderPage()
    expect(await screen.findByText('tel:+886909083683')).toBeInTheDocument()
  })

  it('adds a button for a service the shop was not offering before', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(t.contact.channelDefaults.line)
    await user.click(screen.getByRole('button', { name: ac.newChannel }))

    await user.selectOptions(screen.getByLabelText(ac.kindLabel), 'telegram')
    await user.type(screen.getByLabelText(ac.urlLabel), 'https://t.me/example')
    await user.click(screen.getByRole('button', { name: t.admin.catalog.saveChanges }))

    await waitFor(() => expect(saveContactChannel).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'telegram', url: 'https://t.me/example', label: null }),
      undefined,
    ))
  })

  // Phone and SMS hold a number, not a link, and the form has to say so or the
  // shop ends up with a dead button.
  it('asks for a number rather than a link once the service is a phone call', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(t.contact.channelDefaults.line)
    await user.click(screen.getByRole('button', { name: ac.newChannel }))

    expect(screen.getByLabelText(ac.urlLabel)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(ac.kindLabel), 'phone')
    expect(screen.getByLabelText(ac.numberLabel)).toBeInTheDocument()
    expect(screen.queryByLabelText(ac.urlLabel)).not.toBeInTheDocument()
  })

  it('refuses to save a button with nothing to point at', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(t.contact.channelDefaults.line)
    await user.click(screen.getByRole('button', { name: ac.newChannel }))
    await user.click(screen.getByRole('button', { name: t.admin.catalog.saveChanges }))

    expect(saveContactChannel).not.toHaveBeenCalled()
  })

  it('edits an existing button in place', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(t.contact.channelDefaults.line)
    await user.click(screen.getAllByRole('button', { name: t.admin.waivers.edit })[0])

    const url = screen.getByLabelText(ac.urlLabel)
    await user.clear(url)
    await user.type(url, 'https://line.me/R/ti/p/%40moved')
    await user.click(screen.getByRole('button', { name: t.admin.catalog.saveChanges }))

    await waitFor(() => expect(saveContactChannel).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://line.me/R/ti/p/%40moved' }),
      'ch-1',
    ))
  })

  it('deletes one only after the admin confirms', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(t.contact.channelDefaults.line)
    await user.click(screen.getAllByRole('button', { name: t.admin.waivers.delete })[0])
    expect(deleteContactChannel).not.toHaveBeenCalled()

    // The confirm dialog's own Delete, not the row's.
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: t.admin.waivers.delete }))
    await waitFor(() => expect(deleteContactChannel).toHaveBeenCalledWith('ch-1'))
  })
})
