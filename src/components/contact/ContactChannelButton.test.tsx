import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContactChannelButton } from './ContactChannelButton'
import { CONTACT_CHANNEL_KINDS, type ContactChannel } from '../../types/database'
import { t } from '../../i18n'

const channel = (over: Partial<ContactChannel> = {}): ContactChannel => ({
  id: 'ch-1',
  created_at: '2026-09-01T00:00:00Z',
  created_by: null,
  kind: 'line',
  label: null,
  url: 'https://line.me/R/ti/p/%40x',
  sort_order: 1,
  active: true,
  ...over,
})

describe('ContactChannelButton', () => {
  it('points at the link the shop published, in its own tab', () => {
    render(<ContactChannelButton channel={channel()} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://line.me/R/ti/p/%40x')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  // The dialler opens in place; a new tab for a tel: is a blank tab left behind.
  it('opens a phone number in the same tab', () => {
    render(<ContactChannelButton channel={channel({ kind: 'phone', url: '0912 345 678' })} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'tel:0912345678')
    expect(link).not.toHaveAttribute('target')
  })

  it('wears the service\'s own color, so a diver recognises it before reading it', () => {
    const { container: line } = render(<ContactChannelButton channel={channel()} />)
    expect(line.querySelector('a')!.className).toContain('#06C755')

    const { container: telegram } = render(
      <ContactChannelButton channel={channel({ kind: 'telegram', url: 'https://t.me/x' })} />,
    )
    expect(telegram.querySelector('a')!.className).toContain('#229ED9')
  })

  // `other` invokes nobody's brand, so it looks like the app.
  it('gives an unbranded channel the app\'s own styling', () => {
    const { container } = render(
      <ContactChannelButton channel={channel({ kind: 'other', url: 'https://example.com' })} />,
    )
    expect(container.querySelector('a')!.className).toContain('bg-brand-700')
  })

  it('draws a glyph for every service the vocabulary knows', () => {
    for (const kind of CONTACT_CHANNEL_KINDS) {
      const url = kind === 'phone' || kind === 'sms' ? '0912345678' : 'https://example.com'
      const { container } = render(<ContactChannelButton channel={channel({ kind, url })} />)
      const path = container.querySelector('svg path')
      expect(path?.getAttribute('d')).toBeTruthy()
    }
  })

  it('says what the shop wrote, or the wording for the service', () => {
    render(<ContactChannelButton channel={channel({ label: 'Ask us anything' })} />)
    expect(screen.getByText('Ask us anything')).toBeInTheDocument()

    render(<ContactChannelButton channel={channel({ id: 'ch-2' })} />)
    expect(screen.getByText(t.contact.channelDefaults.line)).toBeInTheDocument()
  })
})
