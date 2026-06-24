import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhatHappensNext } from './WhatHappensNext'

describe('WhatHappensNext', () => {
  it('tells a confirmed registrant to check spam and pay the deposit', () => {
    render(<WhatHappensNext />)
    expect(screen.getByText(/what happens next/i)).toBeInTheDocument()
    expect(screen.getByText(/spam or junk folder/i)).toBeInTheDocument()
    expect(screen.getByText(/pay your deposit/i)).toBeInTheDocument()
    // No payment is owed yet on the waitlist, so that copy must not appear.
    expect(screen.queryByText(/no payment is needed until then/i)).not.toBeInTheDocument()
  })

  it('shows waitlist copy (no deposit nudge) when waitlisted', () => {
    render(<WhatHappensNext waitlisted />)
    expect(screen.getByText(/24 hours to claim/i)).toBeInTheDocument()
    expect(screen.getByText(/no payment is needed until then/i)).toBeInTheDocument()
    expect(screen.queryByText(/spam or junk folder/i)).not.toBeInTheDocument()
  })
})
