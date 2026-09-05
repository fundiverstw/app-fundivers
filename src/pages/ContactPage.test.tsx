import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactPage } from './ContactPage'
import { renderWithRouter } from '../../tests/test-utils'
import { ShopContactContext } from '../hooks/shop-contact-context'
import type { ContactChannel } from '../types/database'
import { t } from '../i18n'

const SHOP = {
  email: 'shop@example.com',
  phone: '+886 900-000-000',
  address: '1 Test St',
  mapsUrl: 'https://maps.example/x',
}

const channel = (over: Partial<ContactChannel> = {}): ContactChannel => ({
  id: 'ch-1',
  created_at: '2026-09-01T00:00:00Z',
  created_by: null,
  kind: 'line',
  label: null,
  url: 'https://line.me/R/ti/p/%40example',
  sort_order: 1,
  active: true,
  ...over,
})

function renderPage(channels: ContactChannel[], contact = SHOP) {
  return renderWithRouter(
    <ShopContactContext.Provider
      value={{ contact, channels, loading: false, refresh: vi.fn() }}
    >
      <ContactPage />
    </ShopContactContext.Provider>,
  )
}

describe('ContactPage', () => {
  beforeEach(() => {
    // window.location.href assignment is how the mailto: handoff fires;
    // stub it so the test can read what would have been opened.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  // The buttons are whatever the shop set up, in its own order — they used to
  // be two hardcoded links, so this is the property that matters.
  it('renders the shop\'s own buttons, in the order it put them in', () => {
    renderPage([
      channel(),
      channel({ id: 'ch-2', kind: 'whatsapp', url: 'https://wa.me/886900000000', sort_order: 2 }),
      channel({ id: 'ch-3', kind: 'telegram', url: 'https://t.me/example', sort_order: 3 }),
    ])

    const links = screen.getAllByRole('link')
    expect(links.map(a => a.textContent?.trim())).toEqual([
      `${t.contact.channelDefaults.line}›`,
      `${t.contact.channelDefaults.whatsapp}›`,
      `${t.contact.channelDefaults.telegram}›`,
    ])
    expect(links[0]).toHaveAttribute('href', 'https://line.me/R/ti/p/%40example')
  })

  it('opens a chat service in its own tab, safely', () => {
    renderPage([channel()])
    const line = screen.getByRole('link', { name: /add us on line/i })
    expect(line).toHaveAttribute('target', '_blank')
    expect(line).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  // A phone number is stored as a number and dialled as a tel: — and a new tab
  // for the dialler is a blank tab left behind.
  it('turns a phone channel into a tel: link in the same tab', () => {
    renderPage([channel({ kind: 'phone', url: '+886 900-000-000' })])
    const call = screen.getByRole('link', { name: t.contact.channelDefaults.phone })
    expect(call).toHaveAttribute('href', 'tel:+886900000000')
    expect(call).not.toHaveAttribute('target')
  })

  it('shows the shop\'s own wording for a button when it wrote some', () => {
    renderPage([channel({ label: 'Ask us about courses' })])
    expect(screen.getByRole('link', { name: /Ask us about courses/ })).toBeInTheDocument()
  })

  it('says so when the shop has set up no buttons at all', () => {
    renderPage([])
    expect(screen.getByText(t.contact.noChannels)).toBeInTheDocument()
  })

  it('submitting the form opens a mailto: with subject and body prefilled', async () => {
    const user = userEvent.setup()
    renderPage([channel()])
    await user.type(screen.getByLabelText(/subject/i), 'Trip question')
    await user.type(screen.getByLabelText(/message/i), 'Hi there\nthanks')
    await user.click(screen.getByRole('button', { name: /send email/i }))
    expect(window.location.href).toBe(
      `mailto:${SHOP.email}?subject=Trip+question&body=Hi+there%0Athanks`,
    )
  })

  it('submitting with empty fields still opens a bare mailto:', async () => {
    const user = userEvent.setup()
    renderPage([channel()])
    await user.click(screen.getByRole('button', { name: /send email/i }))
    expect(window.location.href).toBe(`mailto:${SHOP.email}`)
  })

  // A form that opens a blank compose window is worse than no form.
  it('offers no email form when the shop has published no address', () => {
    renderPage([channel()], { ...SHOP, email: '' })
    expect(screen.queryByRole('button', { name: /send email/i })).not.toBeInTheDocument()
  })
})
