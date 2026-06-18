import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookingPaymentsBlock } from './BookingPaymentsBlock'
import type { ChargeLine } from '../../lib/booking-charges'

const noop = async () => {}

const baseProps = {
  payments: [],
  owed: 3200,
  paid: 0,
  outstanding: 3200,
  pending: false,
  cancelled: false,
  readOnly: true,
  onRecord: noop,
}

describe('BookingPaymentsBlock — charge breakdown', () => {
  const charges: ChargeLine[] = [
    { kind: 'base', label: 'Base', amount: 2800 },
    { kind: 'gear', label: 'Gear: BCD', amount: 400 },
  ]

  it('renders an itemized Charges section when charges are provided', () => {
    render(<BookingPaymentsBlock {...baseProps} charges={charges} currency="NTD" />)
    expect(screen.getByText('Charges')).toBeInTheDocument()
    expect(screen.getByText('Gear: BCD')).toBeInTheDocument()
    expect(screen.getByText('NTD 400')).toBeInTheDocument()
  })

  it('omits the Charges section when no charges are provided', () => {
    render(<BookingPaymentsBlock {...baseProps} />)
    expect(screen.queryByText('Charges')).not.toBeInTheDocument()
    // The Payments section still renders.
    expect(screen.getByText('Payments')).toBeInTheDocument()
  })
})
