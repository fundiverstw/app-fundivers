import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('is collapsed by default', () => {
    render(<Disclosure title="Waivers"><p>body</p></Disclosure>)
    // <details> without open renders closed; the summary label is present.
    expect(screen.getByText('Waivers').closest('details')).not.toHaveAttribute('open')
  })

  it('honours defaultOpen', () => {
    render(<Disclosure title="Waivers" defaultOpen><p>body</p></Disclosure>)
    expect(screen.getByText('Waivers').closest('details')).toHaveAttribute('open')
  })

  it('keeps its body in the DOM even when collapsed, so content is still queryable', () => {
    render(<Disclosure title="Notes"><p>a private note</p></Disclosure>)
    expect(screen.getByText('a private note')).toBeInTheDocument()
  })

  it('renders the chevron marker and hides the native details marker', () => {
    render(<Disclosure title="Family"><p>body</p></Disclosure>)
    const summary = screen.getByText('Family').closest('summary')!
    expect(summary.className).toContain('[&::-webkit-details-marker]:hidden')
    // The custom chevron glyph is present as an aria-hidden span.
    expect(summary.querySelector('[aria-hidden]')).not.toBeNull()
  })
})
