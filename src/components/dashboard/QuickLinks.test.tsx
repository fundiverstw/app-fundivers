import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QuickLinks } from './QuickLinks'

function renderLinks() {
  return render(<MemoryRouter><QuickLinks /></MemoryRouter>)
}

describe('QuickLinks', () => {
  it('links to the three pages the header used to shortcut', () => {
    renderLinks()
    expect(screen.getByRole('link', { name: /trusted partners/i })).toHaveAttribute('href', '/trusted-partners')
    expect(screen.getByRole('link', { name: /packages/i })).toHaveAttribute('href', '/packages')
    expect(screen.getByRole('link', { name: /scheduled trips/i })).toHaveAttribute('href', '/scheduled-trips')
  })

  it('names each destination in text, not by icon alone', () => {
    renderLinks()
    expect(screen.getByText(/trusted partners/i)).toBeInTheDocument()
    expect(screen.getByText(/^packages$/i)).toBeInTheDocument()
    expect(screen.getByText(/scheduled trips/i)).toBeInTheDocument()
  })

  it('shows the dive site maps tile as not yet available', () => {
    renderLinks()
    expect(screen.getByText(/dive site maps/i)).toBeInTheDocument()
    expect(screen.getByText(/soon/i)).toBeInTheDocument()
    // No href yet — the bathymetry page does not exist, and a link to a route
    // with no match would land the diver on the catch-all redirect.
    expect(screen.queryByRole('link', { name: /dive site maps/i })).not.toBeInTheDocument()
  })

  it('makes the map tile a link once a destination exists', () => {
    render(<MemoryRouter><QuickLinks siteMapTo="/dev/site-map" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /dive site maps/i })).toHaveAttribute('href', '/dev/site-map')
    expect(screen.queryByText(/soon/i)).not.toBeInTheDocument()
  })

  it('stacks two-up on a phone and four-up from the sm breakpoint', () => {
    renderLinks()
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('grid-cols-2')
    expect(nav.className).toContain('sm:grid-cols-4')
  })
})
