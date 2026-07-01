import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactPage } from './ContactPage'
import { renderWithRouter } from '../../tests/test-utils'
import { siteConfig } from '../config/site'

describe('ContactPage', () => {
  beforeEach(() => {
    // window.location.href assignment is how the mailto: handoff fires;
    // stub it so the test can read what would have been opened.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  it('renders LINE and WhatsApp deep links with safe target attrs', () => {
    renderWithRouter(<ContactPage />)
    const line = screen.getByRole('link', { name: /add us on line/i })
    const wa = screen.getByRole('link', { name: /message us on whatsapp/i })
    expect(line).toHaveAttribute('href', siteConfig.contact.lineUrl)
    expect(line).toHaveAttribute('target', '_blank')
    expect(line).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(wa).toHaveAttribute('href', siteConfig.contact.whatsappUrl)
    expect(wa).toHaveAttribute('target', '_blank')
    expect(wa).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('submitting the form opens a mailto: with subject and body prefilled', async () => {
    const user = userEvent.setup()
    renderWithRouter(<ContactPage />)
    await user.type(screen.getByLabelText(/subject/i), 'Trip question')
    await user.type(screen.getByLabelText(/message/i), 'Hi there\nthanks')
    await user.click(screen.getByRole('button', { name: /send email/i }))
    expect(window.location.href).toBe(
      `mailto:${siteConfig.contact.email}?subject=Trip+question&body=Hi+there%0Athanks`,
    )
  })

  it('submitting with empty fields still opens a bare mailto:', async () => {
    const user = userEvent.setup()
    renderWithRouter(<ContactPage />)
    await user.click(screen.getByRole('button', { name: /send email/i }))
    expect(window.location.href).toBe(`mailto:${siteConfig.contact.email}`)
  })
})
