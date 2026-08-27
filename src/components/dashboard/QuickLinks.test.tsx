import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QuickLinks } from './QuickLinks'

function renderLinks() {
  return render(<MemoryRouter><QuickLinks /></MemoryRouter>)
}

describe('QuickLinks', () => {
  it('links to the pages the header used to shortcut plus the almanac', () => {
    renderLinks()
    expect(screen.getByRole('link', { name: /trusted partners/i })).toHaveAttribute('href', '/trusted-partners')
    expect(screen.getByRole('link', { name: /packages/i })).toHaveAttribute('href', '/packages')
    expect(screen.getByRole('link', { name: /scheduled trips/i })).toHaveAttribute('href', '/scheduled-trips')
    expect(screen.getByRole('link', { name: /almanac/i })).toHaveAttribute('href', '/almanac')
  })

  it('names each destination in text, not by icon alone', () => {
    renderLinks()
    expect(screen.getByText(/trusted partners/i)).toBeInTheDocument()
    expect(screen.getByText(/^packages$/i)).toBeInTheDocument()
    expect(screen.getByText(/scheduled trips/i)).toBeInTheDocument()
    expect(screen.getByText(/almanac/i)).toBeInTheDocument()
  })

  // Was a greyed-out "coming soon" tile back when the map lived behind a
  // development-only route. It is a page now, open to every signed-in diver.
  it('links to the dive site maps like any other destination', () => {
    renderLinks()
    expect(screen.getByRole('link', { name: /dive site maps/i })).toHaveAttribute('href', '/site-maps')
    expect(screen.queryByText(/soon/i)).not.toBeInTheDocument()
  })

  it('stacks two-up on a phone and three-up from the sm breakpoint', () => {
    renderLinks()
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('grid-cols-2')
    expect(nav.className).toContain('sm:grid-cols-3')
  })
})
