import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Logo } from './Logo'
import { siteConfig } from '../config/site'

describe('Logo', () => {
  it('renders the brand image with the height preset for the given size', () => {
    render(<Logo size="sm" />)
    const img = screen.getByAltText(siteConfig.identity.logoAlt)
    expect(img).toHaveClass('h-9')
  })
})
