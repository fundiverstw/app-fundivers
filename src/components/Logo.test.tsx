import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Logo } from './Logo'

describe('Logo', () => {
  it('renders the brand image with the height preset for the given size', () => {
    render(<Logo size="sm" />)
    const img = screen.getByAltText('FunDivers Taiwan')
    expect(img).toHaveClass('h-9')
  })

  it('shows the beta badge by default', () => {
    render(<Logo size="sm" />)
    expect(screen.getByText(/beta/i)).toBeInTheDocument()
  })

  it('hides the beta badge when beta is false', () => {
    render(<Logo size="sm" beta={false} />)
    expect(screen.queryByText(/beta/i)).not.toBeInTheDocument()
  })
})
