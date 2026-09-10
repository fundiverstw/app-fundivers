import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ListingHero } from './ListingHero'
import { PackagesIcon } from './icons/PackagesIcon'
import { ScheduledTripsIcon } from './icons/ScheduledTripsIcon'

// A listing with no photograph yet is a normal listing, not a broken one — the
// point of the placeholder is that it says so.

const icon = <PackagesIcon className="w-10 h-10" />

describe('ListingHero', () => {
  it('shows the shop’s image when there is one', () => {
    const { container } = render(
      <ListingHero src="https://cdn.test/palau.jpg" heightClass="h-36" icon={icon} />,
    )
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://cdn.test/palau.jpg')
    expect(img.className).toContain('h-36')
    expect(screen.queryByTestId('listing-hero-placeholder')).not.toBeInTheDocument()
  })

  it('stands in with the section’s own mark when there is none', () => {
    render(<ListingHero src={null} heightClass="h-36" icon={icon} />)
    expect(screen.getByTestId('listing-hero-placeholder').querySelector('svg')).toBeInTheDocument()
  })

  // A package should not stand in with a parasol, nor a trip with a plane:
  // the placeholder's whole job is saying which kind of listing this is.
  it('shows whichever mark the caller passes', () => {
    const pkg = render(<ListingHero src={null} heightClass="h-36" icon={<PackagesIcon />} />)
    const packagePath = pkg.container.querySelector('svg path')!.getAttribute('d')
    pkg.unmount()

    const trip = render(<ListingHero src={null} heightClass="h-36" icon={<ScheduledTripsIcon />} />)
    const tripPath = trip.container.querySelector('svg path')!.getAttribute('d')

    expect(tripPath).not.toBe(packagePath)
  })

  it('takes the height of the surface it is on', () => {
    const { rerender } = render(<ListingHero src={null} heightClass="h-36" icon={icon} />)
    expect(screen.getByTestId('listing-hero-placeholder').className).toContain('h-36')
    rerender(<ListingHero src={null} heightClass="h-48" icon={icon} />)
    expect(screen.getByTestId('listing-hero-placeholder').className).toContain('h-48')
  })

  // The title sits right beneath it, so the banner carries no information of
  // its own — announcing it would only add noise to a screen reader.
  it('is decorative in both states', () => {
    const { container, rerender } = render(
      <ListingHero src="https://cdn.test/x.jpg" heightClass="h-36" icon={icon} />,
    )
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('')
    rerender(<ListingHero src={null} heightClass="h-36" icon={icon} />)
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})
