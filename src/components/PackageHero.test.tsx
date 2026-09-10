import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PackageHero } from './PackageHero'

// A package with no photograph yet is a normal package, not a broken one — the
// point of the placeholder is that it says so.

describe('PackageHero', () => {
  it('shows the shop’s image when there is one', () => {
    const { container } = render(<PackageHero src="https://cdn.test/palau.jpg" heightClass="h-36" />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://cdn.test/palau.jpg')
    expect(img.className).toContain('h-36')
    expect(screen.queryByTestId('package-hero-placeholder')).not.toBeInTheDocument()
  })

  it('stands in with the packages mark when there is none', () => {
    render(<PackageHero src={null} heightClass="h-36" />)
    const placeholder = screen.getByTestId('package-hero-placeholder')
    expect(placeholder.querySelector('svg')).toBeInTheDocument()
  })

  it('takes the height of the surface it is on', () => {
    const { rerender } = render(<PackageHero src={null} heightClass="h-36" />)
    expect(screen.getByTestId('package-hero-placeholder').className).toContain('h-36')
    rerender(<PackageHero src={null} heightClass="h-48" />)
    expect(screen.getByTestId('package-hero-placeholder').className).toContain('h-48')
  })

  // The title sits right beneath it, so the banner carries no information of
  // its own — announcing it would only add noise to a screen reader.
  it('is decorative in both states', () => {
    const { container, rerender } = render(<PackageHero src="https://cdn.test/x.jpg" heightClass="h-36" />)
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('')
    rerender(<PackageHero src={null} heightClass="h-36" />)
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})
