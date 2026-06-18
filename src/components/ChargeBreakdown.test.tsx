import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChargeBreakdown } from './ChargeBreakdown'
import type { ChargeLine } from '../lib/booking-charges'

const lines: ChargeLine[] = [
  { kind: 'base', label: 'Base', amount: 2800 },
  { kind: 'gear', label: 'Gear: BCD (x2 days)', amount: 800 },
  { kind: 'surcharge', label: 'Card/PayPal surcharge (5%)', amount: 180 },
]

describe('ChargeBreakdown', () => {
  it('renders each line label with its amount plus a total', () => {
    render(<ChargeBreakdown lines={lines} currency="NTD" total={3780} />)
    expect(screen.getByText('Gear: BCD (x2 days)')).toBeInTheDocument()
    expect(screen.getByText('NTD 800')).toBeInTheDocument()
    expect(screen.getByText('Card/PayPal surcharge (5%)')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('NTD 3,780')).toBeInTheDocument()
  })

  it('renders amendment lines (discounts shown with a minus) and ties out to the total', () => {
    render(
      <ChargeBreakdown
        lines={[{ kind: 'base', label: 'Base', amount: 8950 }]}
        amendments={[{ label: '2 person discount', amount: -800 }]}
        currency="TWD"
      />,
    )
    expect(screen.getByText('2 person discount')).toBeInTheDocument()
    expect(screen.getByText('−TWD 800')).toBeInTheDocument()
    // 8950 − 800 = 8150, computed when no explicit total is passed.
    expect(screen.getByText('TWD 8,150')).toBeInTheDocument()
  })

  it('falls back to summing the lines when no total is given', () => {
    render(<ChargeBreakdown lines={lines} currency="NTD" />)
    expect(screen.getByText('NTD 3,780')).toBeInTheDocument()
  })

  it('shows the deposit line only when a positive deposit is passed', () => {
    const { rerender } = render(<ChargeBreakdown lines={lines} currency="NTD" deposit={1000} />)
    expect(screen.getByText('Deposit to hold spot')).toBeInTheDocument()
    rerender(<ChargeBreakdown lines={lines} currency="NTD" deposit={0} />)
    expect(screen.queryByText('Deposit to hold spot')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no lines', () => {
    const { container } = render(<ChargeBreakdown lines={[]} currency="NTD" />)
    expect(container).toBeEmptyDOMElement()
  })
})
