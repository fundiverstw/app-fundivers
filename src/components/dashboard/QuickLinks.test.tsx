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

  // Staff-facing for now, so a diver is not shown it at all rather than shown
  // it and refused. It used to render greyed out with "coming soon", which was
  // honest while the page did not exist.
  it('keeps the dive site maps out of a diver’s tiles entirely', () => {
    renderLinks()
    expect(screen.queryByText(/dive site maps/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/soon/i)).not.toBeInTheDocument()
  })

  it('gives an admin the dive site maps tile', () => {
    render(<MemoryRouter><QuickLinks isAdmin /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /dive site maps/i })).toHaveAttribute('href', '/site-maps')
  })

  it('stacks two-up on a phone and three-up from the sm breakpoint', () => {
    renderLinks()
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('grid-cols-2')
    expect(nav.className).toContain('sm:grid-cols-3')
  })
})
