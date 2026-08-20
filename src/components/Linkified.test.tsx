import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Linkified } from './Linkified'

describe('Linkified', () => {
  it('turns a pasted folder link into an anchor that opens safely', () => {
    render(<Linkified text="Photos are up: https://drive.google.com/drive/folders/1AbC" />)
    const link = screen.getByRole('link', { name: 'https://drive.google.com/drive/folders/1AbC' })
    expect(link).toHaveAttribute('href', 'https://drive.google.com/drive/folders/1AbC')
    expect(link).toHaveAttribute('target', '_blank')
    // noopener: the opened tab must not get a handle on this one.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps the surrounding words as text', () => {
    render(<Linkified text="Photos are up: https://a.test/x — enjoy" />)
    expect(screen.getByText(/Photos are up:/)).toBeInTheDocument()
    expect(screen.getByText(/enjoy/)).toBeInTheDocument()
  })

  it('renders a body with no link as plain text and no anchors', () => {
    render(<Linkified text="See you at the pier at 8." />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('See you at the pier at 8.')).toBeInTheDocument()
  })

  it('leaves a javascript: URL as inert text', () => {
    render(<Linkified text="tap javascript:alert(1) now" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('lets a long link break rather than widening the page', () => {
    render(<Linkified text="https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" />)
    expect(screen.getByRole('link')).toHaveClass('break-all')
  })
})
